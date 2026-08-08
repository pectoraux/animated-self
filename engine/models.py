"""API contracts — the source of truth shared by the capture layer (browser),
the inference layer (this engine), and the output layer (virtual cam / file).

Design goal: Phase 1 ships only the live pose path, but the shapes here must
already accommodate Phase 2 (custom chars + voice), Phase 3 (diffusion quality
mode), and Phase 4 (voice conversion) without breaking changes. We do that by:

  * Keeping the live transport a *pose vector*, never a video frame. Adding
    audio later is an additive `audio` channel on the same WS, not a new socket.
  * Treating characters as opaque `id`s resolved server-side, so a generated
    character (Phase 2) is just a new registry entry.
  * Making the output a *sink* abstraction (`virtual_cam` | `preview` | `file`)
    so the quality-mode MP4 path reuses the session lifecycle.

These Pydantic models are mirrored 1:1 in `contracts/types.ts` (TS) and
`contracts/openapi.yaml`. Regenerate the TS mirror when these change.
"""
from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Character
# ---------------------------------------------------------------------------

class CharacterSource(str, Enum):
    STOCK = "stock"
    GENERATED = "generated"   # Phase 2
    UPLOADED = "uploaded"     # Phase 2


class Character(BaseModel):
    """A drivable anime reference image. The engine resolves `id` to the actual
    tensor; the client never touches model weights."""
    id: str
    name: str
    source: CharacterSource
    thumbnail_url: str
    # Whether this character has passed a consent/liveness binding. Stock chars
    # are pre-consented (they are not a real person's likeness). Custom chars
    # require a live liveness check before they can be driven.
    consented: bool = True
    tags: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Live path — PoseVector is THE wire format for real-time
# ---------------------------------------------------------------------------

class HeadPose(BaseModel):
    """ radians. Derived from MediaPipe `facialTransformationMatrixes`. """
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0
    # x/y/z translation (head shift) — optional, THA3 ignores by default.
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
    smile: float = 0.0       # positive = smile, negative = frown
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


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------

class OutputSink(str, Enum):
    VIRTUAL_CAM = "virtual_cam"   # pyvirtualcam -> OBS Virtual Camera
    PREVIEW = "preview"           # in-app only, frames echoed back as JPEG (throttled)
    FILE = "file"                 # async render to mp4 (Phase 3)


class StartSessionRequest(BaseModel):
    character_id: str
    output: OutputSink = OutputSink.VIRTUAL_CAM
    # Optional: re-assert the consent token that was issued at avatar setup.
    # Engine verifies it before allowing a non-stock character to be driven.
    consent_token: str | None = None


class StartSessionResponse(BaseModel):
    session_id: str
    ws_url: str = "/ws/live"   # client appends ?session_id=... &XTransformPort=3031
    character: Character
    output: OutputSink
    # Engine-reported capability flags so the UI can warn (e.g. "no CUDA").
    capabilities: dict[str, bool] = Field(default_factory=dict)


# Diagnostics the engine pushes back over the WS (not every frame).
class FrameStats(BaseModel):
    type: Literal["stats"] = "stats"
    fps_in: float
    fps_out: float
    infer_ms: float
    queue_depth: int
    dropped_stale: int
    # Set when a frame was older than max_pose_age_ms and was skipped.
    budget_warning: bool = False


# ---------------------------------------------------------------------------
# Async render path (Phase 3 — contract exists now, impl stubbed)
# ---------------------------------------------------------------------------

class RenderDriverType(str, Enum):
    AUDIO = "audio"     # AniPortrait-style: audio + reference image -> video
    VIDEO = "video"     # re-drive from a recorded video (higher fidelity than live)


class RenderRequest(BaseModel):
    character_id: str
    driver: RenderDriverType = RenderDriverType.AUDIO
    driver_url: str = Field(..., description="Local path or URL to the audio/video file.")
    quality: Literal["draft", "high"] = "high"
    consent_token: str | None = None


class RenderJob(BaseModel):
    job_id: str
    status: Literal["queued", "running", "rendering", "done", "failed"]
    progress: float = 0.0   # 0..1
    download_url: str | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Consent / liveness (contract exists in Phase 1; enforced for custom chars in Phase 2)
# ---------------------------------------------------------------------------

class LivenessChallenge(BaseModel):
    """A randomized motion challenge the creator must perform on camera."""
    challenge_id: str
    # e.g. ["look_left", "smile", "blink_twice"] — verifiable from landmarks.
    steps: list[str]
    issued_at: int  # epoch ms


class LivenessVerifyRequest(BaseModel):
    """Client payload to /api/consent/liveness/verify."""
    challenge_id: str
    # Steps the client detected the creator performing, in order.
    detected_steps: list[str] = Field(default_factory=list)
    # The captured face evidence. Phase 1: any JSON-serializable landmark
    # summary (deterministically hashed into the consent token). Phase 2
    # replaces this with an ArcFace embedding vector.
    landmark_evidence: dict | list = Field(default_factory=dict)


class LivenessResult(BaseModel):
    challenge_id: str
    passed: bool
    # HMAC-signed token binding {challenge_id, face_hash, iat, exp}. Derived
    # from the captured evidence — NOT random. Single-use challenge; the token
    # itself is reusable within its TTL so a creator doesn't redo liveness per
    # stream. Stock characters bypass this; custom characters (Phase 2) require
    # a valid token at session start.
    consent_token: str | None = None
    reason: str | None = None
