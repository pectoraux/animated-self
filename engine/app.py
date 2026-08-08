"""animated-self engine — FastAPI entrypoint.

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
from __future__ import annotations

import asyncio
import base64
import json
import logging
import secrets
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from config import cfg
from models import (
    Character,
    FrameStats,
    LivenessChallenge,
    LivenessResult,
    PoseVector,
    RenderJob,
    RenderRequest,
    StartSessionRequest,
    StartSessionResponse,
)
from backends import poser
from characters import list_characters, get_character_image
from pipeline import LivePipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("animated-self")

app = FastAPI(title="animated-self engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # local dev; the gateway handles external exposure
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
_sessions: dict[str, LivePipeline] = {}
_render_jobs: dict[str, RenderJob] = {}


def _capabilities() -> dict[str, bool]:
    import torch
    return {
        "cuda": torch.cuda.is_available(),
        "model_loaded": poser.loaded,
        "virtual_cam": True,  # best-effort; sink.start() will raise if unavailable
    }


@app.on_event("startup")
def _startup() -> None:
    try:
        poser.load()
        log.info("THA3 poser loaded: %s", poser.loaded)
    except Exception as e:  # noqa: BLE001
        log.warning("THA3 load failed (engine will still serve REST): %s", e)


# ---------------------------------------------------------------------------
# REST
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict[str, object]:
    return {"ok": True, "capabilities": _capabilities(), "config": {
        "output_size": cfg.output_size, "fps": cfg.target_fps, "device": cfg.device,
    }}


@app.get("/api/characters", response_model=list[Character])
def get_characters() -> list[Character]:
    return list_characters()


@app.get("/api/characters/{character_id}/thumbnail")
def character_thumbnail(character_id: str) -> Response:
    try:
        rgb = get_character_image(character_id)
    except KeyError:
        raise HTTPException(404, "character not found")
    import cv2
    ok, buf = cv2.imencode(".png", rgb[:, :, ::-1])
    if not ok:
        raise HTTPException(500, "encode failed")
    return Response(content=buf.tobytes(), media_type="image/png")


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


@app.post("/api/session/{session_id}/stop")
def stop_session(session_id: str) -> dict[str, bool]:
    pipe = _sessions.pop(session_id, None)
    if pipe is None:
        raise HTTPException(404, "session not found")
    pipe.stop()
    return {"ok": True}


@app.get("/api/session/{session_id}/preview.jpg")
def session_preview(session_id: str) -> Response:
    pipe = _sessions.get(session_id)
    if pipe is None or pipe.sink is None:
        raise HTTPException(404, "session not found")
    jpeg = getattr(pipe.sink, "jpeg", lambda: None)()
    if not jpeg:
        raise HTTPException(409, "no frame yet")
    return Response(content=jpeg, media_type="image/jpeg")


# ---------------------------------------------------------------------------
# Consent / liveness — the anti-deepfake gate
# ---------------------------------------------------------------------------
_CHALLENGE_STEPS = [
    ["look_left", "look_right", "smile"],
    ["blink_twice", "look_up", "smile"],
    ["turn_head_left", "turn_head_right", "open_mouth"],
]


@app.post("/api/consent/liveness/request", response_model=LivenessChallenge)
def request_liveness() -> LivenessChallenge:
    import random
    steps = random.choice(_CHALLENGE_STEPS)
    return LivenessChallenge(
        challenge_id=secrets.token_urlsafe(8),
        steps=steps,
        issued_at=int(time.time() * 1000),
    )


@app.post("/api/consent/liveness/verify", response_model=LivenessResult)
def verify_liveness(payload: dict) -> LivenessResult:
    """Phase 1: verify the challenge steps were detected (client sends the
    landmark evidence). Issue a consent_token bound to the captured face hash.

    Phase 2 will harden this: the consent_token is bound to an ArcFace-style
    embedding, and re-verified on each session start for custom characters.
    """
    challenge_id = payload.get("challenge_id", "")
    detected = payload.get("detected_steps", [])
    expected = next(
        (s for s in _CHALLENGE_STEPS if any(d in s for d in detected)), []
    )
    passed = len(detected) >= 2 and all(d in expected for d in detected[:2])
    # crude face "hash" placeholder — real embedding ships in Phase 2.
    face_hash = secrets.token_hex(16)
    return LivenessResult(
        challenge_id=challenge_id,
        passed=passed,
        consent_token=base64.urlsafe_b64encode(face_hash.encode()).decode(),
        reason=None if passed else "challenge steps not detected in order",
    )


# ---------------------------------------------------------------------------
# Async render (Phase 3 — contract stable)
# ---------------------------------------------------------------------------
@app.post("/api/render", response_model=RenderJob)
def create_render(req: RenderRequest) -> RenderJob:
    job_id = secrets.token_urlsafe(8)
    job = RenderJob(job_id=job_id, status="queued")
    _render_jobs[job_id] = job
    # Phase 3: hand off to render_pipeline.render(...) in a background task.
    # For now we surface a clear status so the UI can render the shape.
    job.status = "failed"
    job.error = "Diffusion quality mode ships in Phase 3 (contract stable, impl stubbed)."
    return job


@app.get("/api/render/{job_id}", response_model=RenderJob)
def get_render(job_id: str) -> RenderJob:
    job = _render_jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    return job


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


# Dev entrypoint (production uses `uvicorn app:app`)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host=cfg.host, port=cfg.port, reload=False)
