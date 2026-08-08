"""animated-self engine — FastAPI entrypoint.

Surface (the control panel talks to this via the gateway with ?XTransformPort=3031):

  REST
    GET  /api/health                       capability flags (cuda? model loaded?)
    GET  /api/characters                   -> Character[]
    GET  /api/characters/{id}/thumbnail    -> PNG
    GET  /api/characters/providers         -> GenProviderInfo[]  (Phase 2)
    POST /api/characters/generate           -> Character  (Phase 2, text->image, BYOK)
    POST /api/characters/transfer           -> Character  (Phase 2, selfie->anime, BYOK)
    POST /api/characters/upload             -> Character  (Phase 2, raw PNG upload)
    POST /api/characters/{id}/consent/bind  -> Character  (Phase 2, bind liveness to char)
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
from consent import (
    issue_challenge,
    validate_consent_token,
    verify_challenge,
)
from models import (
    Character,
    ConsentBindRequest,
    FrameStats,
    GenerateCharacterRequest,
    GenProviderInfo,
    LivenessChallenge,
    LivenessResult,
    LivenessVerifyRequest,
    PoseVector,
    RenderJob,
    RenderRequest,
    StartSessionRequest,
    StartSessionResponse,
    TransferCharacterRequest,
    UploadCharacterRequest,
)
from backends import poser, get_provider, list_providers
from characters import (
    list_characters,
    get_character,
    get_character_image,
    register_generated_character,
    mark_consented,
)
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
    if not cfg.consent_secret:
        log.warning(
            "CONSENT_SECRET is not set. Consent tokens will be signed with a "
            "random key generated for this process only — fine for local "
            "dev, but set CONSENT_SECRET before any deployment where consent "
            "must persist across restarts or multiple instances."
        )
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


# ---------------------------------------------------------------------------
# Phase 2 — character generation (BYOK)
# ---------------------------------------------------------------------------
def _decode_b64(s: str) -> bytes:
    """Accept raw base64 or a data URI (data:image/png;base64,...)."""
    if "," in s and s.startswith("data:"):
        s = s.split(",", 1)[1]
    try:
        return base64.b64decode(s)
    except Exception as e:
        raise HTTPException(400, f"invalid base64 image: {e}")


@app.get("/api/characters/providers", response_model=list[GenProviderInfo])
def get_providers() -> list[GenProviderInfo]:
    return [GenProviderInfo(**p) for p in list_providers()]


@app.post("/api/characters/generate", response_model=Character)
def generate_character(req: GenerateCharacterRequest) -> Character:
    """Text prompt -> anime character image. BYOK: the user's api_key is used
    for this request only and never persisted. Generated chars start
    consented=False — they must be consent-bound before driving."""
    try:
        provider = get_provider(req.provider)
    except KeyError:
        raise HTTPException(400, f"unknown provider: {req.provider}")
    if provider.byok and not req.api_key:
        raise HTTPException(400, f"provider '{req.provider}' requires an api_key (BYOK)")
    try:
        png_bytes = provider.generate_from_prompt(req.prompt, req.api_key)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        log.warning("character generation failed: %s", e)
        raise HTTPException(502, f"generation failed: {e}")
    return register_generated_character(req.name, png_bytes, tags=["generated"])


@app.post("/api/characters/transfer", response_model=Character)
def transfer_character(req: TransferCharacterRequest) -> Character:
    """Selfie -> anime character. Description-based (VLM describes the selfie,
    then the provider generates an anime character matching the description).
    NOT pixel-level identity preservation — see backends/character_gen.py."""
    try:
        provider = get_provider(req.provider)
    except KeyError:
        raise HTTPException(400, f"unknown provider: {req.provider}")
    if provider.byok and not req.api_key:
        raise HTTPException(400, f"provider '{req.provider}' requires an api_key (BYOK)")
    selfie_bytes = _decode_b64(req.selfie_b64)
    try:
        png_bytes = provider.generate_from_selfie(selfie_bytes, req.api_key)
    except Exception as e:  # noqa: BLE001
        log.warning("selfie transfer failed: %s", e)
        raise HTTPException(502, f"transfer failed: {e}")
    return register_generated_character(req.name, png_bytes, tags=["selfie-transfer"])


@app.post("/api/characters/upload", response_model=Character)
def upload_character(req: UploadCharacterRequest) -> Character:
    """Raw PNG upload. Starts consented=False like generated chars — the
    creator must complete liveness before driving it."""
    from models import CharacterSource
    png_bytes = _decode_b64(req.image_b64)
    return register_generated_character(
        req.name, png_bytes, source=CharacterSource.UPLOADED, tags=["uploaded"]
    )


@app.post("/api/characters/{character_id}/consent/bind", response_model=Character)
def consent_bind(character_id: str, req: ConsentBindRequest) -> Character:
    """Bind a verified consent_token to a generated/uploaded character.

    Called after the creator completes the liveness challenge. Validates the
    token (signature + expiry), extracts the bound face_hash, and marks the
    character consented=True so it can be driven.
    """
    if req.character_id != character_id:
        raise HTTPException(400, "character_id mismatch")
    ok, reason = validate_consent_token(req.consent_token)
    if not ok:
        raise HTTPException(403, f"invalid consent token: {reason}")
    # Extract the face_hash from the token payload for the binding record.
    from consent import _verify_sig
    payload = _verify_sig(req.consent_token)
    face_hash = (payload or {}).get("fh", "")
    try:
        return mark_consented(character_id, face_hash)
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.post("/api/session/start", response_model=StartSessionResponse)
def start_session(req: StartSessionRequest) -> StartSessionResponse:
    chars = {c.id: c for c in list_characters()}
    if req.character_id not in chars:
        raise HTTPException(404, "character not found")
    char = chars[req.character_id]

    # Consent gate (finding #1 fix): non-consented (custom) characters require
    # a VALID consent token — signature, expiry, and single-use challenge are
    # all checked in consent.validate_consent_token(). Any non-empty string no
    # longer passes.
    if not char.consented:
        ok, reason = validate_consent_token(req.consent_token)
        if not ok:
            raise HTTPException(403, f"consent required: {reason}")

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
# Enforcement lives in engine/consent.py. This surface just exposes it.
# Stock characters (Phase 1) have consented=True and bypass the gate. Custom
# characters (Phase 2) require a valid HMAC-signed consent_token at session
# start — see start_session() above.


@app.post("/api/consent/liveness/request", response_model=LivenessChallenge)
def request_liveness() -> LivenessChallenge:
    cid, steps, issued_at_ms = issue_challenge()
    return LivenessChallenge(challenge_id=cid, steps=steps, issued_at=issued_at_ms)


@app.post("/api/consent/liveness/verify", response_model=LivenessResult)
def verify_liveness(req: LivenessVerifyRequest) -> LivenessResult:
    """Verify the challenge issued for THIS challenge_id (not any challenge),
    check the detected steps against the ones actually issued, and issue a
    consent_token derived (HMAC-signed) from the captured face evidence.

    The challenge is single-use; the token is reusable within its TTL so a
    creator doesn't redo liveness per stream. The face hash is a Phase 1
    placeholder for a real ArcFace embedding (Phase 2) — the token format and
    enforcement path are stable either way.
    """
    passed, token, reason = verify_challenge(
        challenge_id=req.challenge_id,
        detected_steps=req.detected_steps,
        landmark_evidence=req.landmark_evidence,
    )
    return LivenessResult(
        challenge_id=req.challenge_id,
        passed=passed,
        consent_token=token,
        reason=reason,
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
        while True:
            await asyncio.sleep(15)
            try:
                await ws.send_text(json.dumps({"type": "ping"}))
            except (WebSocketDisconnect, RuntimeError):
                # Socket closed mid-sleep; recv_poses will tear us down.
                return

    # Finding #2 fix: recv_poses is the primary task; heartbeat is cancelled
    # when it returns so we never send_text() on a closed socket. The previous
    # asyncio.gather() let heartbeat raise RuntimeError on a closed socket up
    # to 15s after disconnect — logged noise on every teardown.
    import contextlib

    hb = asyncio.create_task(heartbeat())
    try:
        await recv_poses()
    finally:
        hb.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await hb
        log.info("ws_live disconnected session=%s", session_id)


# Dev entrypoint (production uses `uvicorn app:app`)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host=cfg.host, port=cfg.port, reload=False)
