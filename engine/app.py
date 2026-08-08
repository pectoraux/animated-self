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
    POST /api/render                       -> RenderJob (Phase 3: audio-driven diffusion, backgrounded)
    GET  /api/render/{job_id}              -> RenderJob
    GET  /api/render/{job_id}/file          -> MP4 (once status=="done")

  WebSocket
    WS   /ws/live?session_id=...           client -> PoseVector (JSON), server -> FrameStats (<=1/s)
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import secrets
import threading
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from config import cfg
from consent import (
    issue_challenge,
    token_face_hash,
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
    RenderDriverType,
    RenderJob,
    RenderRequest,
    StartSessionRequest,
    StartSessionResponse,
    TransferCharacterRequest,
    UploadCharacterRequest,
    VoiceConvertRequest,
    VoiceConvertResult,
    MarketplaceListing,
    PublishRequest,
    ReviewActionRequest,
)
from backends import poser, get_provider, list_providers
from backends.voice_converter import get_converter
from characters import (
    AlreadyConsentedError,
    list_characters,
    get_character,
    get_character_image,
    get_bound_face_hash,
    register_generated_character,
    mark_consented,
)
from pipeline import LivePipeline, render_pipeline

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
    try:
        import torch
        cuda = torch.cuda.is_available()
    except ImportError:
        cuda = False
    return {
        "cuda": cuda,
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
    """Accept raw base64 or a data URI (data:image/png;base64,...).

    Enforces a 25MB cap on the decoded payload — cheap insurance against
    accidental huge uploads on a local-first single-operator tool. Not a
    security boundary; a real deployment behind a reverse proxy should also
    cap request size at the proxy level.
    """
    MAX_PAYLOAD_BYTES = 25 * 1024 * 1024  # 25 MB
    if len(s) > MAX_PAYLOAD_BYTES * 2:  # base64 is ~4/3 the size, allow headroom
        raise HTTPException(
            413, f"payload too large (>{MAX_PAYLOAD_BYTES // (1024*1024)}MB decoded cap)"
        )
    if "," in s and s.startswith("data:"):
        s = s.split(",", 1)[1]
    try:
        decoded = base64.b64decode(s)
    except Exception as e:
        raise HTTPException(400, f"invalid base64 payload: {e}")
    if len(decoded) > MAX_PAYLOAD_BYTES:
        raise HTTPException(
            413, f"decoded payload too large ({len(decoded)} > {MAX_PAYLOAD_BYTES} bytes)"
        )
    return decoded


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
    face_hash = token_face_hash(req.consent_token) or ""
    try:
        return mark_consented(character_id, face_hash)
    except KeyError as e:
        raise HTTPException(404, str(e))
    except AlreadyConsentedError as e:
        raise HTTPException(409, str(e))


def _enforce_consent_gate(character_id: str, char: Character, consent_token: str | None) -> None:
    """Shared by start_session and create_render — anywhere a character gets
    driven, live or rendered. Raises HTTPException if not authorized.

    `consented` is a one-shot flag flipped permanently True by
    mark_consented() — fine to gate on alone for STOCK characters
    (pre-consented, never bound to anyone's face, safe to skip forever). It
    is NOT enough for characters bound to a face_hash: gating on `consented`
    alone would mean the check only ever runs on the FIRST session after
    binding, then is skipped forever after, letting ANY valid-but-unrelated
    token drive it from then on (Phase 2 audit finding). So a bound character
    re-checks the token's face_hash against the bound hash on EVERY request.
    """
    bound_hash = get_bound_face_hash(character_id)
    if bound_hash is not None:
        ok, reason = validate_consent_token(consent_token)
        if not ok:
            raise HTTPException(403, f"consent required: {reason}")
        presented_hash = token_face_hash(consent_token)
        if presented_hash != bound_hash:
            raise HTTPException(
                403, "consent token does not match the face this character is bound to"
            )
    elif not char.consented:
        raise HTTPException(403, "consent required for this character")


@app.post("/api/session/start", response_model=StartSessionResponse)
def start_session(req: StartSessionRequest) -> StartSessionResponse:
    chars = {c.id: c for c in list_characters()}
    if req.character_id not in chars:
        raise HTTPException(404, "character not found")
    char = chars[req.character_id]

    _enforce_consent_gate(req.character_id, char, req.consent_token)

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
# Async render (Phase 3 — audio-driven diffusion quality mode)
# ---------------------------------------------------------------------------
def _render_output_path(job_id: str) -> Path:
    return Path(cfg.render_output_dir) / f"{job_id}.mp4"


def _run_render_job(job_id: str, req: RenderRequest) -> None:
    job = _render_jobs[job_id]
    job.status = "running"
    try:
        def _progress(p: float) -> None:
            _render_jobs[job_id].progress = p

        render_pipeline.render(
            character_id=req.character_id,
            driver_url=req.driver_url,
            driver_type=req.driver.value,
            out_mp4=_render_output_path(job_id),
            progress=_progress,
        )
    except Exception as e:  # noqa: BLE001 — surface any failure on the job, not a 500
        log.warning("render job %s failed: %s", job_id, e)
        job.status = "failed"
        job.error = str(e)
        return
    job.status = "done"
    job.progress = 1.0
    job.download_url = f"/api/render/{job_id}/file"


@app.post("/api/render", response_model=RenderJob)
def create_render(req: RenderRequest) -> RenderJob:
    char = get_character(req.character_id)
    if char is None:
        raise HTTPException(404, "character not found")
    _enforce_consent_gate(req.character_id, char, req.consent_token)

    if req.driver != RenderDriverType.AUDIO:
        raise HTTPException(400, "only driver='audio' is implemented (video re-drive is a later phase)")
    if req.driver_url.startswith("http://") or req.driver_url.startswith("https://"):
        raise HTTPException(400, "driver_url must be a local file path — remote URLs aren't fetched")
    if not Path(req.driver_url).exists():
        raise HTTPException(400, f"driver_url not found: {req.driver_url}")

    job_id = secrets.token_urlsafe(8)
    job = RenderJob(job_id=job_id, status="queued")
    _render_jobs[job_id] = job

    # Rendering is slow (minutes) and blocking (subprocess), so it runs on a
    # background thread rather than in the request or FastAPI's own
    # threadpool-per-request — the job outlives this request.
    threading.Thread(target=_run_render_job, args=(job_id, req), daemon=True).start()
    return job


@app.get("/api/render/{job_id}", response_model=RenderJob)
def get_render(job_id: str) -> RenderJob:
    job = _render_jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    return job


@app.get("/api/render/{job_id}/file")
def download_render(job_id: str) -> FileResponse:
    job = _render_jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    if job.status != "done":
        raise HTTPException(409, f"render not finished (status={job.status})")
    out_path = _render_output_path(job_id)
    if not out_path.exists():
        raise HTTPException(404, "render file missing on disk")
    return FileResponse(str(out_path), media_type="video/mp4", filename=f"{job_id}.mp4")


# ---------------------------------------------------------------------------
# Phase 4 — voice conversion
# ---------------------------------------------------------------------------
# Optional RVC-style mic→avatar-voice stage. If no converter is configured
# (VOICE_CONVERT_CMD / VOICE_CLOUD_PROVIDER unset), the endpoints return a
# clear 503 — voice conversion is simply unavailable, not faked.
#
# Consent: voice conversion tied to a character goes through the SAME
# _enforce_consent_gate as live sessions and async renders — no parallel
# check. Converting audio to sound like someone's avatar is identity-affecting.

# In-process store for converted audio files (downloadable for the process
# lifetime). Phase 5 moves this to durable storage.
_voice_outputs: dict[str, Path] = {}


@app.post("/api/voice/convert", response_model=VoiceConvertResult)
def voice_convert(req: VoiceConvertRequest) -> VoiceConvertResult:
    """Convert an audio file to the avatar's voice.

    Async (file in, file out). For the live path, see /ws/voice — but live
    voice conversion needs a virtual audio device (VB-Cable/BlackHole) for
    OBS, same as the virtual camera needs a driver. That's documented in
    docs/reality-check.md.
    """
    converter = get_converter()
    if converter is None:
        raise HTTPException(
            503,
            "Voice conversion not configured. Set VOICE_CONVERT_CMD "
            "(external command) or VOICE_CLOUD_PROVIDER (BYOK cloud).",
        )

    char = get_character(req.character_id)
    if char is None:
        raise HTTPException(404, "character not found")
    # Same gate as live sessions and async renders.
    _enforce_consent_gate(req.character_id, char, req.consent_token)

    audio_bytes = _decode_b64(req.audio_b64)

    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_in:
        tmp_in.write(audio_bytes)
        in_path = Path(tmp_in.name)

    out_id = secrets.token_urlsafe(8)
    out_path = Path(cfg.render_output_dir) / f"voice-{out_id}.wav"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        converter.convert(in_path, out_path, None, api_key=req.api_key)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        log.warning("voice conversion failed: %s", e)
        raise HTTPException(502, f"conversion failed: {e}")
    finally:
        in_path.unlink(missing_ok=True)

    _voice_outputs[out_id] = out_path
    return VoiceConvertResult(ok=True, download_url=f"/api/voice/{out_id}/download")


@app.get("/api/voice/{out_id}/download")
def voice_download(out_id: str) -> FileResponse:
    p = _voice_outputs.get(out_id)
    if p is None or not p.exists():
        raise HTTPException(404, "voice output not found")
    return FileResponse(str(p), media_type="audio/wav", filename=f"voice-{out_id}.wav")


# ---------------------------------------------------------------------------
# Phase 5 — marketplace
# ---------------------------------------------------------------------------
# Discoverable character packs. The inference stack is UNTOUCHED — a marketplace
# character is just a registry entry + a signed consent artifact.
#
# Consent gate: publish goes through _enforce_consent_gate (same helper as
# live/render/voice — no parallel check). Only the creator who bound the
# character can publish it. The bound_face_hash is recorded on the listing
# as an audit trail but does NOT transfer to installers — installing creates
# a new unconsented character that the installer must bind to their own face.
#
# Review pipeline: pHash near-duplicate flag at publish time + manual
# approve/reject. NOT automated moderation — see docs/reality-check.md #11.

from marketplace import phash as mphash, review as mreview, store as mstore


def _listing_to_response(raw: dict) -> MarketplaceListing:
    return MarketplaceListing(
        listing_id=raw["listing_id"],
        publisher_id=raw["publisher_id"],
        character_name=raw["character_name"],
        character_tags=raw.get("character_tags", []),
        thumbnail_url=f"/api/marketplace/{raw['listing_id']}/thumbnail",
        review_status=raw["review_status"],
        flagged=raw.get("flagged", False),
        flag_reason=raw.get("flag_reason"),
        published_at=raw["published_at"],
        reviewed_at=raw.get("reviewed_at"),
        reviewer_id=raw.get("reviewer_id"),
    )


@app.post("/api/marketplace/publish", response_model=MarketplaceListing)
def marketplace_publish(req: PublishRequest) -> MarketplaceListing:
    """Publish a consented character to the marketplace.

    Consent-gated: the consent_token must match the character's
    bound_face_hash. The character's image + metadata are COPIED into the
    listing (immutable after publish). The publisher's bound_face_hash is
    recorded as an audit trail.
    """
    char = get_character(req.character_id)
    if char is None:
        raise HTTPException(404, "character not found")
    _enforce_consent_gate(req.character_id, char, req.consent_token)

    # Get the character image bytes.
    import cv2
    rgb = get_character_image(req.character_id)
    ok, png_buf = cv2.imencode(".png", rgb[:, :, ::-1])
    if not ok:
        raise HTTPException(500, "failed to encode character image")
    image_png = png_buf.tobytes()

    # Compute pHash and check for near-duplicates.
    new_phash = mphash.compute_phash(image_png)
    flagged, flag_reason = mreview.flag_at_publish(new_phash)
    final_status = mreview.auto_approve_unflagged({"flagged": flagged})

    listing = mstore.create_listing(
        publisher_id=req.publisher_id,
        character_name=char.name,
        character_image_png=image_png,
        character_tags=char.tags,
        bound_face_hash=get_bound_face_hash(req.character_id) or "",
        phash=new_phash,
        flagged=flagged,
        flag_reason=flag_reason,
    )
    # Auto-approve unflagged listings; flagged ones stay pending for review.
    if final_status == "approved":
        mstore.set_review_status(listing["listing_id"], "approved", "system-auto")
        listing["review_status"] = "approved"

    return _listing_to_response({**listing, "review_status": listing["review_status"]})


@app.get("/api/marketplace", response_model=list[MarketplaceListing])
def marketplace_list() -> list[MarketplaceListing]:
    """List approved marketplace listings."""
    return [_listing_to_response(l) for l in mstore.list_approved()]


@app.get("/api/marketplace/pending", response_model=list[MarketplaceListing])
def marketplace_pending() -> list[MarketplaceListing]:
    """List pending listings awaiting review (manual review queue)."""
    return [_listing_to_response(l) for l in mstore.list_pending()]


@app.get("/api/marketplace/{listing_id}/thumbnail")
def marketplace_thumbnail(listing_id: str) -> FileResponse:
    p = mstore.get_listing_image(listing_id)
    if p is None:
        raise HTTPException(404, "listing not found")
    return FileResponse(str(p), media_type="image/png")


@app.post("/api/marketplace/{listing_id}/install", response_model=Character)
def marketplace_install(listing_id: str) -> Character:
    """Install a marketplace character into the local registry.

    Creates a NEW unconsented character — the publisher's bound_face_hash
    does NOT transfer. The installer must run their own liveness to drive it.
    """
    listing = mstore.get_listing(listing_id)
    if listing is None:
        raise HTTPException(404, "listing not found")
    if listing["review_status"] != "approved":
        raise HTTPException(403, "listing not approved for install")
    p = mstore.get_listing_image(listing_id)
    if p is None:
        raise HTTPException(404, "listing image missing")
    from models import CharacterSource
    return register_generated_character(
        name=listing["character_name"],
        image_png_bytes=p.read_bytes(),
        source=CharacterSource.UPLOADED,
        tags=list(listing.get("character_tags", [])) + ["marketplace"],
    )


@app.post("/api/marketplace/{listing_id}/review", response_model=MarketplaceListing)
def marketplace_review(listing_id: str, req: ReviewActionRequest) -> MarketplaceListing:
    """Approve or reject a pending listing. Manual review only."""
    listing = mstore.get_listing(listing_id)
    if listing is None:
        raise HTTPException(404, "listing not found")
    if listing["review_status"] != "pending":
        raise HTTPException(409, f"listing already {listing['review_status']}")
    updated = mstore.set_review_status(listing_id, req.status, req.reviewer_id, req.reason)
    if updated is None:
        raise HTTPException(404, "listing not found")
    return _listing_to_response(updated)


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
