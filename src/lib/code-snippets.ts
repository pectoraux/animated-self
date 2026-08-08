/**
 * Curated code excerpts from the engine/ Python source.
 *
 * These are copy-faithful excerpts (lightly trimmed with `# ...` where a file
 * is long) embedded as template-literal strings so the architecture page can
 * render them with react-syntax-highlighter without hitting the filesystem at
 * request time. Source of truth is the engine/ directory; if engine files
 * change, update the corresponding snippet here.
 */

export interface CodeSnippet {
  id: string;
  filename: string;
  language: string;
  description: string;
  code: string;
}

export const codeSnippets: CodeSnippet[] = [
  {
    id: "app",
    filename: "engine/app.py",
    language: "python",
    description:
      "FastAPI surface: REST for sessions/characters/consent/render + the WebSocket live pose stream.",
    code: `"""animated-self engine — FastAPI entrypoint.

Surface (the control panel talks to this via the gateway with ?XTransformPort=3031):

  REST
    GET  /api/health                       capability flags (cuda? model loaded?)
    GET  /api/characters                   -> Character[]
    GET  /api/characters/{id}/thumbnail    -> PNG
    POST /api/session/start                -> StartSessionResponse (binds char + output sink)
    POST /api/session/{id}/stop
    GET  /api/session/{id}/preview.jpg     (only when output=preview)
    POST /api/consent/liveness/request     -> LivenessChallenge
    POST /api/consent/liveness/verify      -> LivenessResult
    POST /api/render                       -> RenderJob (Phase 3 impl; contract stable now)
    GET  /api/render/{job_id}              -> RenderJob

  WebSocket
    WS   /ws/live?session_id=...           client -> PoseVector (JSON), server -> FrameStats (<=1/s)
"""
# ...
@app.get("/api/health")
def health() -> dict[str, object]:
    return {"ok": True, "capabilities": _capabilities(), "config": {
        "output_size": cfg.output_size, "fps": cfg.target_fps, "device": cfg.device,
    }}


@app.post("/api/session/start", response_model=StartSessionResponse)
def start_session(req: StartSessionRequest) -> StartSessionResponse:
    chars = {c.id: c for c in list_characters()}
    if req.character_id not in chars:
        raise HTTPException(404, "character not found")
    char = chars[req.character_id]

    # Consent gate: non-stock characters require a valid consent token.
    if not char.consented and not req.consent_token:
        raise HTTPException(403, "consent required for this character")

    session_id = secrets.token_urlsafe(12)
    pipe = LivePipeline(
        session_id=session_id,
        character_id=req.character_id,
        output_kind=req.output.value,
    )
    try:
        reference = get_character_image(req.character_id)
        pipe.start(reference)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    _sessions[session_id] = pipe

    char_resp = char.model_copy(update={"thumbnail_url": f"/api/characters/{char.id}/thumbnail"})
    return StartSessionResponse(
        session_id=session_id,
        ws_url="/ws/live",
        character=char_resp,
        output=req.output,
        capabilities=_capabilities(),
    )


# ---------------------------------------------------------------------------
# WebSocket — the live pose stream
# ---------------------------------------------------------------------------
@app.websocket("/ws/live")
async def ws_live(ws: WebSocket) -> None:
    session_id = ws.query_params.get("session_id", "")
    pipe = _sessions.get(session_id)
    if pipe is None:
        await ws.close(code=4404, reason="session not found")
        return
    await ws.accept()
    log.info("ws_live connected session=%s", session_id)

    loop = asyncio.get_running_loop()

    async def recv_poses() -> None:
        try:
            while True:
                raw = await ws.receive_text()
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                pose = PoseVector.model_validate(data)
                # Run inference in a thread so the event loop stays responsive.
                stats = await loop.run_in_executor(None, pipe.push, pose)
                if stats is not None:
                    await ws.send_text(stats.model_dump_json())
        except WebSocketDisconnect:
            return

    async def heartbeat() -> None:
        # Keep proxies/gateway from dropping an idle WS between poses.
        try:
            while True:
                await asyncio.sleep(15)
                await ws.send_text(json.dumps({"type": "ping"}))
        except WebSocketDisconnect:
            return

    try:
        await asyncio.gather(recv_poses(), heartbeat())
    finally:
        log.info("ws_live disconnected session=%s", session_id)
`,
  },
  {
    id: "live_pipeline",
    filename: "engine/pipeline/live_pipeline.py",
    language: "python",
    description:
      "The hot loop. One LivePipeline per session: cache the source tensor once, then push PoseVector → THA3 frame → sink, with drop-too-stale enforcement.",
    code: `"""Live pipeline — the hot loop: PoseVector -> THA3 frame -> virtual cam.

One LivePipeline per active session. Owns:
  * the character's cached source tensor (set on start),
  * the output sink (virtual cam / preview),
  * drop-too-stale enforcement (latency guardrail).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from config import cfg
from models import PoseVector, FrameStats
from backends import poser
from pipeline.pose import pose_vector_to_tha3
from sinks.virtual_cam import VirtualCamSink, PreviewSink, NullSink


@dataclass
class LivePipeline:
    session_id: str
    character_id: str
    output_kind: str = "virtual_cam"
    sink: object | None = None
    # diagnostics
    _in_times: list[float] = field(default_factory=list)
    _out_times: list[float] = field(default_factory=list)
    _infer_ms: list[float] = field(default_factory=list)
    _dropped_stale: int = 0
    _last_stats_at: float = 0.0

    def start(self, reference_rgb: np.ndarray) -> None:
        """Cache the source image and open the output sink."""
        if not poser.loaded:
            raise RuntimeError("THA3 model not loaded — cannot start live session.")
        poser.set_source(self.character_id, reference_rgb)
        if self.output_kind == "virtual_cam":
            self.sink = VirtualCamSink(cfg.output_size, cfg.target_fps)
        elif self.output_kind == "preview":
            self.sink = PreviewSink()
        else:
            self.sink = NullSink()
        self.sink.start()
        self._last_stats_at = time.monotonic()

    def push(self, pose: PoseVector) -> FrameStats | None:
        """Process one pose. Returns FrameStats occasionally (<=1/sec)."""
        now = time.monotonic() * 1000.0
        age = now - pose.ts_ms
        if age > cfg.max_pose_age_ms:
            # Stale: better to skip than to accumulate lag.
            self._dropped_stale += 1
            return None

        tha3_pose = pose_vector_to_tha3(pose)
        t0 = time.perf_counter()
        frame = poser.render(self.character_id, tha3_pose)
        infer_ms = (time.perf_counter() - t0) * 1000.0

        self.sink.send(frame)  # type: ignore[union-attr]

        self._in_times.append(now)
        self._out_times.append(time.monotonic() * 1000.0)
        self._infer_ms.append(infer_ms)
        # bounded history
        if len(self._in_times) > 120:
            self._in_times = self._in_times[-120:]
            self._out_times = self._out_times[-120:]
            self._infer_ms = self._infer_ms[-120:]

        if now - self._last_stats_at >= 1000.0:
            stats = self._snapshot()
            self._last_stats_at = now
            return stats
        return None
    # ...
`,
  },
  {
    id: "tha_poser",
    filename: "engine/backends/tha_poser.py",
    language: "python",
    description:
      "THA3 wrapper. Loads the exported poser checkpoint once, caches the per-character source tensor at session start, then runs one forward pass per pose.",
    code: `"""THA3 (Talking Head Anime 3) poser wrapper.

This is the neural reenactment backend for the LIVE path: one reference anime
image + a pose vector -> one animated frame.

It deliberately does NOT depend on the THA3 demo's GUI/Training code. You give
it a checkpoint exported by \`talking-head-anime-3-demo\`'s \`export_poser.py\`
(which produces a \`Poser\` \`nn.Module\` plus its \`pose_param_names\` list), and
this wrapper handles loading, source-image caching, and inference.

If you don't have a checkpoint, the engine will still start and serve the REST
surface; the live WS will return a clear "model not loaded" error so the
control panel can show a setup prompt rather than a 500.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import numpy as np

from config import cfg


# Canonical THA3 pose-parameter group names (subset). The exact ordered list
# lives in the exported checkpoint's \`pose_param_names\`; \`pose.py\` builds a
# dict keyed by these names and we look them up defensively.
THA3_POSE_KEYS: list[str] = [
    # eyes
    "eye_blink_left", "eye_blink_right",
    "eye_look_in_left", "eye_look_out_left",
    "eye_look_in_right", "eye_look_out_right",
    "eye_dilation_left", "eye_dilation_right",
    # brows
    "eyebrow_down_left", "eyebrow_down_right",
    "eyebrow_up_left", "eyebrow_up_right",
    "eyebrow_steep_left", "eyebrow_steep_right",
    # mouth
    "mouth_open", "mouth_smile", "mouth_frown", "mouth_pucker",
    "mouth_lower", "mouth_upper",
    # head rotation (radians)
    "head_pitch", "head_yaw", "head_roll",
]


class ThaPoser:
    """Thin, dependency-light wrapper around a THA3 \`Poser\` module."""

    def __init__(self) -> None:
        self._loaded = False
        self._poser: Any = None
        self._pose_param_names: list[str] = []
        self._device: str = cfg.device
        # source cache: character_id -> (source_tensor, image_hash)
        self._source_cache: dict[str, tuple[Any, str]] = {}

    # ------------------------------------------------------------------ load
    def load(self) -> None:
        ckpt_path = Path(cfg.tha3_checkpoint)
        if not ckpt_path.exists():
            self._loaded = False
            return
        import torch

        ckpt = torch.load(str(ckpt_path), map_location=self._device, weights_only=False)
        # Expected export shape (see talking-head-anime-3-demo export_poser.py):
        #   {"poser": <nn.Module>, "pose_param_names": [...]}
        self._poser = ckpt["poser"] if isinstance(ckpt, dict) and "poser" in ckpt else ckpt
        self._pose_param_names = (
            ckpt.get("pose_param_names", THA3_POSE_KEYS)
            if isinstance(ckpt, dict) else THA3_POSE_KEYS
        )
        self._poser.to(self._device).eval()
        if cfg.precision == "fp16" and self._device.startswith("cuda"):
            self._poser.half()
        self._loaded = True

    @property
    def loaded(self) -> bool:
        return self._loaded

    # ----------------------------------------------------------- source image
    def set_source(self, character_id: str, image_rgb: np.ndarray) -> str:
        """Preprocess and cache the reference image for a character.

        THA3 expects a 256x256 (or 512) RGB image normalized to [-1, 1], NCHW.
        We run this ONCE at session start, never per frame.
        """
        import torch
        import cv2

        size = cfg.output_size
        img = cv2.resize(image_rgb, (size, size), interpolation=cv2.INTER_AREA)
        t = torch.from_numpy(img).float().permute(2, 0, 1) / 127.5 - 1.0  # [-1,1]
        t = t.unsqueeze(0).to(self._device)
        if cfg.precision == "fp16" and self._device.startswith("cuda"):
            t = t.half()
        h = hashlib.sha1(img.tobytes()).hexdigest()[:12]
        self._source_cache[character_id] = (t, h)
        return h

    # ------------------------------------------------------------------ infer
    def render(self, character_id: str, pose: dict[str, float]) -> np.ndarray:
        """Run one forward pass. Returns an HxWx3 uint8 RGB frame."""
        if not self._loaded:
            raise RuntimeError("THA3 model not loaded (checkpoint missing).")
        import torch

        source, _ = self._source_cache[character_id]
        # Build the pose vector in the model's canonical order.
        vec = torch.tensor(
            [[float(pose.get(k, 0.0)) for k in self._pose_param_names]],
            device=self._device,
            dtype=source.dtype,
        )
        with torch.inference_mode():
            out = self._poser(source, vec)
        # THA3 returns a list/tuple of tensors; index [0] is the final image.
        if isinstance(out, (list, tuple)):
            out = out[0]
        out = (out.clamp(-1, 1) * 127.5 + 127.5).to(torch.uint8)
        frame = out.squeeze(0).permute(1, 2, 0).cpu().numpy()
        return np.ascontiguousarray(frame)


# Module-level singleton; app.py constructs and loads it once at startup.
poser = ThaPoser()
`,
  },
  {
    id: "pose",
    filename: "engine/pipeline/pose.py",
    language: "python",
    description:
      "MediaPipe → THA3 pose dict. The same mapping is reused by the async path so live and async stay visually consistent.",
    code: `"""MediaPipe landmarks -> THA3 pose dict.

In the LIVE path this mapping happens **in the browser** (MediaPipe Tasks JS),
which produces a \`PoseVector\` (see engine/models.py) sent over the WS. The
engine receives that \`PoseVector\` and this module converts it into the exact
parameter dict the THA3 \`Poser\` expects.

The same mapping is reused by the ASYNC render path (when we re-drive from a
recorded video file using MediaPipe Python) so live and async stay visually
consistent.
"""
from __future__ import annotations

import math
import numpy as np

from models import PoseVector
from backends import THA3_POSE_KEYS


def _clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, float(x)))


def transformation_matrix_to_euler(matrix: np.ndarray) -> tuple[float, float, float]:
    """4x4 facial transformation matrix -> (yaw, pitch, roll) in radians."""
    m = np.asarray(matrix, dtype=np.float64).reshape(4, 4)
    r = m[:3, :3]
    pitch = math.asin(_clamp(-r[2, 0], -1, 1))
    if abs(math.cos(pitch)) > 1e-6:
        yaw = math.atan2(r[1, 0], r[0, 0])
        roll = math.atan2(r[2, 1], r[2, 2])
    else:
        yaw = math.atan2(-r[0, 1], r[1, 1])
        roll = 0.0
    return yaw, pitch, roll


def pose_vector_to_tha3(pose: PoseVector) -> dict[str, float]:
    """Convert a wire \`PoseVector\` into the THA3 parameter dict.

    THA3's convention (from the demo's poser params):
      * eye_blink_*: 0 = open, 1 = closed
      * eye_look_in/out_*: [-1, 1] gaze
      * mouth_open / mouth_smile / mouth_frown / mouth_pucker: [0,1] / [-1,1]
      * head_pitch/yaw/roll: radians, small range (~+-0.5 rad is the safe zone;
        beyond that THA3 artifacts — see docs/reality-check.md)
    """
    yaw, pitch, roll = pose.head.yaw, pose.head.pitch, pose.head.roll

    lx = _clamp(pose.left_eye.pupil_x)
    rx = _clamp(pose.right_eye.pupil_x)

    d: dict[str, float] = {
        "eye_blink_left": _clamp(pose.left_eye.blink, 0, 1),
        "eye_blink_right": _clamp(pose.right_eye.blink, 0, 1),
        # THA3 splits horizontal gaze into look_in / look_out per eye.
        "eye_look_in_left": max(0.0, lx),
        "eye_look_out_left": max(0.0, -lx),
        "eye_look_in_right": max(0.0, -rx),
        "eye_look_out_right": max(0.0, rx),
        "eye_dilation_left": _clamp(pose.left_eye.pupil_y, 0, 1),
        "eye_dilation_right": _clamp(pose.right_eye.pupil_y, 0, 1),
        # Brows: PoseVector gives a single signed value per brow; map to
        # THA3's up/down pair.
        "eyebrow_up_left": max(0.0, pose.left_brow),
        "eyebrow_down_left": max(0.0, -pose.left_brow),
        "eyebrow_up_right": max(0.0, pose.right_brow),
        "eyebrow_down_right": max(0.0, -pose.right_brow),
        "eyebrow_steep_left": 0.0,
        "eyebrow_steep_right": 0.0,
        # Mouth
        "mouth_open": _clamp(pose.mouth.open, 0, 1),
        "mouth_smile": max(0.0, pose.mouth.smile),
        "mouth_frown": max(0.0, -pose.mouth.smile),
        "mouth_pucker": _clamp(pose.mouth.pucker, 0, 1),
        "mouth_lower": 0.0,
        "mouth_upper": 0.0,
        # Head rotation. Note: large yaws/pitches degrade THA3 output.
        "head_pitch": float(pitch),
        "head_yaw": float(yaw),
        "head_roll": float(roll),
    }
    # Defensive: only keep keys the loaded model actually knows.
    return {k: d.get(k, 0.0) for k in THA3_POSE_KEYS}
`,
  },
  {
    id: "virtual_cam",
    filename: "engine/sinks/virtual_cam.py",
    language: "python",
    description:
      "Output sinks. VirtualCamSink writes to OBS Virtual Camera / v4l2loopback via pyvirtualcam; PreviewSink holds the latest JPEG for in-app preview.",
    code: `"""Output sinks. The live pipeline writes to exactly one of these.

  * VirtualCamSink  -> OBS Virtual Camera / v4l2loopback (the real distribution channel)
  * PreviewSink     -> holds the latest frame for the in-app preview (JPEG polled)
  * NullSink        -> dev / no-op
"""
from __future__ import annotations

import io
import threading
from typing import Any

import numpy as np

from config import cfg


class NullSink:
    def start(self) -> None: ...
    def send(self, frame: np.ndarray) -> None: ...
    def stop(self) -> None: ...


class VirtualCamSink:
    """Writes frames to the OBS Virtual Camera via pyvirtualcam.

    Requires (documented in engine/README.md):
      * Windows/macOS: OBS Studio installed (provides "OBS Virtual Camera")
      * Linux: v4l2loopback kernel module loaded (e.g. /dev/video99)
    pyvirtualcam auto-selects the backend; override with cfg.virtual_cam_backend.
    """

    def __init__(self, size: int, fps: int) -> None:
        self.size = size
        self.fps = fps
        self._cam: Any = None

    def start(self) -> None:
        import pyvirtualcam

        self._cam = pyvirtualcam.Camera(
            width=self.size,
            height=self.size,
            fps=self.fps,
            device=cfg.virtual_cam_device,
            backend=cfg.virtual_cam_backend,
            fmt=pyvirtualcam.PixelFormat.RGB,
        )

    def send(self, frame: np.ndarray) -> None:
        if self._cam is None:
            return
        # pyvirtualcam wants contiguous uint8 RGB HxWx3
        if frame.shape[0] != self.size or frame.shape[1] != self.size:
            import cv2
            frame = cv2.resize(frame, (self.size, self.size), interpolation=cv2.INTER_AREA)
        self._cam.send(np.ascontiguousarray(frame.astype(np.uint8)))
        # Optional: self._cam.send_and_wait() to throttle to fps — we DON'T,
        # because the live pipeline is push-driven and we don't want to block
        # inference on the sink. pyvirtualcam internally double-buffers.

    def stop(self) -> None:
        if self._cam is not None:
            self._cam.close()
            self._cam = None


class PreviewSink:
    """Holds the latest rendered frame for an in-app preview endpoint.

    The control panel polls /api/session/{id}/preview.jpg (throttled) to show
    what the avatar looks like WITHOUT routing video back over the WS — that
    would eat the latency budget. Preview is opt-in and never blocks inference.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._frame: np.ndarray | None = None

    def start(self) -> None: ...

    def send(self, frame: np.ndarray) -> None:
        with self._lock:
            self._frame = frame.copy()

    def jpeg(self, quality: int = 60) -> bytes | None:
        with self._lock:
            if self._frame is None:
                return None
            import cv2
            ok, buf = cv2.imencode(".jpg", self._frame[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, quality])
            return buf.tobytes() if ok else None

    def stop(self) -> None:
        with self._lock:
            self._frame = None
`,
  },
  {
    id: "models",
    filename: "engine/models.py",
    language: "python",
    description:
      "The PoseVector contract — THE live wire format. ~250 bytes JSON, ~80 bytes packed. Source of truth mirrored in contracts/types.ts and contracts/openapi.yaml.",
    code: `"""API contracts — the source of truth shared by the capture layer (browser),
the inference layer (this engine), and the output layer (virtual cam / file).

Design goal: Phase 1 ships only the live pose path, but the shapes here must
already accommodate Phase 2 (custom chars + voice), Phase 3 (diffusion quality
mode), and Phase 4 (voice conversion) without breaking changes. We do that by:

  * Keeping the live transport a *pose vector*, never a video frame. Adding
    audio later is an additive \`audio\` channel on the same WS, not a new socket.
  * Treating characters as opaque \`id\`s resolved server-side, so a generated
    character (Phase 2) is just a new registry entry.
  * Making the output a *sink* abstraction (\`virtual_cam\` | \`preview\` | \`file\`)
    so the quality-mode MP4 path reuses the session lifecycle.
"""
from __future__ import annotations
from enum import Enum
from typing import Literal
from pydantic import BaseModel, Field


class Character(BaseModel):
    """A drivable anime reference image. The engine resolves \`id\` to the actual
    tensor; the client never touches model weights."""
    id: str
    name: str
    source: str
    thumbnail_url: str
    consented: bool = True
    tags: list[str] = Field(default_factory=list)


# --- Live path: PoseVector is THE wire format for real-time ----------------

class HeadPose(BaseModel):
    """ radians. Derived from MediaPipe \`facialTransformationMatrixes\`. """
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


class EyeState(BaseModel):
    """ blink in [0,1], pupil in [-1,1]. From MediaPipe blendshapes. """
    blink: float = 0.0
    pupil_x: float = 0.0
    pupil_y: float = 0.0


class MouthState(BaseModel):
    """ open in [0,1], smile/frown in [-1,1]. """
    open: float = 0.0
    smile: float = 0.0
    pucker: float = 0.0


class PoseVector(BaseModel):
    """The only thing sent per-frame over the live WebSocket.

    ~250 bytes JSON, ~80 bytes packed. Sending this instead of a video frame
    is what keeps the live path under the 100ms glass-to-glass budget.
    """
    ts_ms: int = Field(..., description="Sender monotonic timestamp (ms). Used for jitter/drop diagnostics.")
    head: HeadPose = Field(default_factory=HeadPose)
    left_eye: EyeState = Field(default_factory=EyeState)
    right_eye: EyeState = Field(default_factory=EyeState)
    mouth: MouthState = Field(default_factory=MouthState)
    left_brow: float = 0.0   # [-1,1], -1 down, +1 up
    right_brow: float = 0.0
    # Phase 4 hook: when voice conversion / audio-driven lip-sync lands, audio
    # features ride as an optional blob on the same message, never a new socket.
    audio_level: float | None = None


# --- Diagnostics the engine pushes back over the WS (not every frame) ------

class FrameStats(BaseModel):
    type: Literal["stats"] = "stats"
    fps_in: float
    fps_out: float
    infer_ms: float
    queue_depth: int
    dropped_stale: int
    budget_warning: bool = False
`,
  },
];

export const codeSnippetById = (id: string): CodeSnippet | undefined =>
  codeSnippets.find((s) => s.id === id);
