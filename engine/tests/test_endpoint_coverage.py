"""Endpoint-coverage gap tests (hardening pass, item 3).

Fills HTTP-level test gaps for routes that had unit-level coverage but no
endpoint-level test. Routes already covered elsewhere:
  - /api/session/start, /api/characters/{id}/consent/bind  (test_session_consent_gate)
  - /api/render, /api/render/{id}, /api/render/{id}/file   (test_render_pipeline)
  - /api/voice/convert, /api/voice/{id}/download           (test_voice_conversion)
  - /api/marketplace, /api/marketplace/publish,
    /api/marketplace/{id}/install, /api/marketplace/{id}/review (test_marketplace)

This file covers the rest:
  - /api/health
  - /api/characters (GET list)
  - /api/characters/providers
  - /api/characters/generate (happy + error: unknown provider, BYOK key missing)
  - /api/characters/transfer
  - /api/characters/upload (happy + error: bad base64)
  - /api/characters/{id}/thumbnail (happy + 404)
  - /api/consent/liveness/request
  - /api/consent/liveness/verify (happy + fail: wrong steps)
  - /api/marketplace/pending
  - /api/marketplace/{id}/thumbnail

Routes not covered here and why:
  - /api/session/{id}/stop, /api/session/{id}/preview.jpg: require a live
    session with a real poser (THA3) which isn't available in the test env.
    The session-start path itself is tested; the stop/preview endpoints are
    thin wrappers over the in-process _sessions dict.
  - /ws/live: requires a real poser + WebSocket client; the pose math and
    staleness logic are unit-tested in test_live_pipeline.py and test_pose.py.
"""
from __future__ import annotations

import base64
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import consent
from characters import registry


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    gen_dir = tmp_path / "gen"
    gen_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(registry, "_generated_dir", lambda: gen_dir)
    monkeypatch.setattr(registry, "_generated_manifest_path", lambda: gen_dir / "manifest.json")
    registry._STOCK_MANIFEST = None
    consent.store._issued.clear()
    consent.store._used.clear()
    from types import SimpleNamespace
    import config as config_mod
    import app as app_module
    import marketplace.store as mp_store_mod
    fake_cfg = SimpleNamespace(
        root=tmp_path,
        render_output_dir=str(tmp_path / "output"),
        characters_dir=tmp_path / "chars",
        output_size=512,
        device="cpu",
        target_fps=30,
        diffusion_checkpoint=None,
        consent_secret="",
        enable_builtin_gen_provider=True,
    )
    monkeypatch.setattr(config_mod, "cfg", fake_cfg)
    monkeypatch.setattr(app_module, "cfg", fake_cfg, raising=False)
    monkeypatch.setattr(mp_store_mod, "cfg", fake_cfg, raising=False)
    yield


@pytest.fixture()
def client():
    import app as app_module
    return TestClient(app_module.app)


def _png_bytes(color=(200, 150, 150)) -> bytes:
    img = Image.new("RGB", (64, 64), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _valid_token(evidence: dict) -> str:
    cid, steps, _ = consent.issue_challenge()
    passed, token, reason = consent.verify_challenge(cid, steps[:2], evidence)
    assert passed, reason
    return token


# --------------------------------------------------------------------------- /api/health
def test_health_endpoint(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert "capabilities" in body
    assert "config" in body


# --------------------------------------------------------------------------- /api/characters
def test_list_characters_includes_stock(client):
    resp = client.get("/api/characters")
    assert resp.status_code == 200
    chars = resp.json()
    ids = [c["id"] for c in chars]
    assert "stock-aoi" in ids  # from the stock manifest


# --------------------------------------------------------------------------- /api/characters/providers
def test_list_providers(client):
    resp = client.get("/api/characters/providers")
    assert resp.status_code == 200
    providers = resp.json()
    ids = [p["id"] for p in providers]
    # Demo provider is enabled by default in the test cfg.
    assert "demo" in ids
    assert "openai" in ids


# --------------------------------------------------------------------------- /api/characters/generate
def test_generate_character_unknown_provider_400(client):
    resp = client.post("/api/characters/generate", json={
        "prompt": "test", "name": "Test", "provider": "not-a-provider",
    })
    assert resp.status_code == 400
    assert "unknown provider" in resp.json()["detail"].lower()


def test_generate_character_byok_key_missing_400(client):
    # OpenAI provider requires a key.
    resp = client.post("/api/characters/generate", json={
        "prompt": "test", "name": "Test", "provider": "openai",
    })
    assert resp.status_code == 400
    assert "api_key" in resp.json()["detail"].lower()


# --------------------------------------------------------------------------- /api/characters/transfer
def test_transfer_character_unknown_provider_400(client):
    resp = client.post("/api/characters/transfer", json={
        "selfie_b64": base64.b64encode(_png_bytes()).decode(),
        "name": "Test", "provider": "not-a-provider",
    })
    assert resp.status_code == 400


# --------------------------------------------------------------------------- /api/characters/upload
def test_upload_character_happy(client):
    resp = client.post("/api/characters/upload", json={
        "name": "My Upload",
        "image_b64": base64.b64encode(_png_bytes()).decode(),
    })
    assert resp.status_code == 200
    char = resp.json()
    assert char["name"] == "My Upload"
    assert char["source"] == "uploaded"
    assert char["consented"] is False  # starts locked


def test_upload_character_bad_base64_400(client):
    resp = client.post("/api/characters/upload", json={
        "name": "Bad", "image_b64": "not-valid-base64!!!",
    })
    assert resp.status_code == 400
    assert "base64" in resp.json()["detail"].lower()


def test_upload_character_oversized_413(client):
    """25MB cap on decoded base64 payloads (item 6 of the hardening pass)."""
    # 30MB of zeros, base64-encoded.
    huge = base64.b64encode(b"\x00" * (30 * 1024 * 1024)).decode()
    resp = client.post("/api/characters/upload", json={
        "name": "Huge", "image_b64": huge,
    })
    assert resp.status_code == 413
    assert "too large" in resp.json()["detail"].lower()


# --------------------------------------------------------------------------- /api/characters/{id}/thumbnail
def test_character_thumbnail_happy(client):
    resp = client.get("/api/characters/stock-aoi/thumbnail")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert len(resp.content) > 0


def test_character_thumbnail_404(client):
    resp = client.get("/api/characters/nonexistent/thumbnail")
    assert resp.status_code == 404


# --------------------------------------------------------------------------- /api/consent/liveness/request
def test_liveness_request_endpoint(client):
    resp = client.post("/api/consent/liveness/request")
    assert resp.status_code == 200
    body = resp.json()
    assert "challenge_id" in body
    assert len(body["steps"]) == 3
    assert body["issued_at"] > 0


# --------------------------------------------------------------------------- /api/consent/liveness/verify
def test_liveness_verify_happy(client):
    # Request a challenge, then verify it.
    ch = client.post("/api/consent/liveness/request").json()
    resp = client.post("/api/consent/liveness/verify", json={
        "challenge_id": ch["challenge_id"],
        "detected_steps": ch["steps"][:2],
        "landmark_evidence": {"face": "test"},
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["passed"] is True
    assert body["consent_token"] is not None


def test_liveness_verify_wrong_steps_fails(client):
    ch = client.post("/api/consent/liveness/request").json()
    # Send steps from a different challenge bank.
    other = next(b for b in consent._CHALLENGE_BANKS if b != ch["steps"])
    resp = client.post("/api/consent/liveness/verify", json={
        "challenge_id": ch["challenge_id"],
        "detected_steps": other[:2],
        "landmark_evidence": {"face": "test"},
    })
    assert resp.status_code == 200
    assert resp.json()["passed"] is False
    assert resp.json()["consent_token"] is None  # None on failure


def test_liveness_verify_unknown_challenge_fails(client):
    resp = client.post("/api/consent/liveness/verify", json={
        "challenge_id": "does-not-exist",
        "detected_steps": ["look_left"],
        "landmark_evidence": {"face": "test"},
    })
    assert resp.status_code == 200
    assert resp.json()["passed"] is False


# --------------------------------------------------------------------------- /api/marketplace/pending
def test_marketplace_pending_empty(client):
    resp = client.get("/api/marketplace/pending")
    assert resp.status_code == 200
    assert resp.json() == []


def test_marketplace_pending_shows_flagged(client):
    # Publish two listings with the same image so the second is flagged.
    png = _png_bytes()
    for i in range(2):
        char = registry.register_generated_character(f"Char{i}", png)
        token = _valid_token({"face": f"face{i}"})
        registry.mark_consented(char.id, consent.token_face_hash(token))
        client.post("/api/marketplace/publish", json={
            "character_id": char.id, "publisher_id": f"pub{i}", "consent_token": token,
        })
    pending = client.get("/api/marketplace/pending").json()
    assert len(pending) >= 1
    assert pending[0]["flagged"] is True


# --------------------------------------------------------------------------- /api/marketplace/{id}/thumbnail
def test_marketplace_thumbnail_happy(client):
    # Create + publish a listing.
    char = registry.register_generated_character("Test", _png_bytes((100, 200, 100)))
    token = _valid_token({"face": "x"})
    registry.mark_consented(char.id, consent.token_face_hash(token))
    pub = client.post("/api/marketplace/publish", json={
        "character_id": char.id, "publisher_id": "x", "consent_token": token,
    }).json()
    resp = client.get(f"/api/marketplace/{pub['listing_id']}/thumbnail")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"


def test_marketplace_thumbnail_404(client):
    resp = client.get("/api/marketplace/nonexistent/thumbnail")
    assert resp.status_code == 404
