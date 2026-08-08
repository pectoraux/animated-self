"""Tests for Phase 4 — voice conversion.

Covers:
  * get_converter() returns None when unconfigured (not faked).
  * ExternalCommandConverter: runs the configured command, produces output,
    fails cleanly on non-zero exit / missing output.
  * Consent gate on /api/voice/convert (same _enforce_consent_gate as live
    + async render — refuses locked char, refuses unrelated token, accepts
    matching token, stock char no token needed).
  * 503 when no converter configured.
  * Download endpoint.
  * Production-path test: get_converter() with VOICE_CONVERT_CMD set returns
    the real ExternalCommandConverter (not a fake) — same class of DI gap
    that let the poser bug through in 80e1088.
"""
from __future__ import annotations

import base64
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import consent
from backends import voice_converter as vc_mod
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
    # Reset the voice converter singleton between tests.
    vc_mod._active = None
    # Redirect render output to tmp (voice outputs go there too).
    from types import SimpleNamespace
    import config as config_mod
    import app as app_module
    fake_cfg = SimpleNamespace(
        render_output_dir=str(tmp_path / "output"),
        diffusion_checkpoint=None,
        output_size=512,
        device="cpu",
        target_fps=30,
        characters_dir=tmp_path,
    )
    monkeypatch.setattr(config_mod, "cfg", fake_cfg)
    monkeypatch.setattr(app_module, "cfg", fake_cfg, raising=False)
    # Clear voice outputs between tests.
    app_module._voice_outputs.clear()
    yield


@pytest.fixture()
def client():
    import app as app_module
    return TestClient(app_module.app)


def _valid_token(evidence: dict) -> str:
    cid, steps, _ = consent.issue_challenge()
    passed, token, reason = consent.verify_challenge(cid, steps[:2], evidence)
    assert passed, reason
    return token


def _audio_b64() -> str:
    return base64.b64encode(b"RIFF fake wav data").decode()


# --------------------------------------------------------------------------- converter selection
def test_get_converter_returns_none_when_unconfigured(monkeypatch):
    monkeypatch.delenv("VOICE_CONVERT_CMD", raising=False)
    monkeypatch.delenv("VOICE_CLOUD_PROVIDER", raising=False)
    vc_mod._active = None
    assert vc_mod.get_converter() is None


def test_get_converter_returns_external_when_cmd_set(monkeypatch):
    monkeypatch.setenv("VOICE_CONVERT_CMD", "cp {input} {output}")
    monkeypatch.delenv("VOICE_CLOUD_PROVIDER", raising=False)
    vc_mod._active = None
    c = vc_mod.get_converter()
    assert c is not None
    assert c.loaded
    assert isinstance(c, vc_mod.ExternalCommandConverter)


def test_external_command_converter_runs_and_produces_output(tmp_path):
    c = vc_mod.ExternalCommandConverter()
    os.environ["VOICE_CONVERT_CMD"] = "cp {input} {output}"
    c.load()
    inp = tmp_path / "in.wav"
    inp.write_bytes(b"audio data")
    out = tmp_path / "out.wav"
    c.convert(inp, out)
    assert out.exists()
    assert out.read_bytes() == b"audio data"


def test_external_command_converter_fails_on_nonzero_exit(tmp_path):
    c = vc_mod.ExternalCommandConverter()
    os.environ["VOICE_CONVERT_CMD"] = "false"  # always exits 1
    c.load()
    inp = tmp_path / "in.wav"
    inp.write_bytes(b"x")
    out = tmp_path / "out.wav"
    with pytest.raises(RuntimeError, match="exit"):
        c.convert(inp, out)


def test_external_command_converter_fails_on_missing_output(tmp_path):
    c = vc_mod.ExternalCommandConverter()
    # Command succeeds but doesn't produce the output file.
    os.environ["VOICE_CONVERT_CMD"] = "true"
    c.load()
    inp = tmp_path / "in.wav"
    inp.write_bytes(b"x")
    out = tmp_path / "out.wav"
    with pytest.raises(RuntimeError, match="did not produce"):
        c.convert(inp, out)


# --------------------------------------------------------------------------- consent gate on voice convert
def test_voice_convert_503_when_unconfigured(client, monkeypatch):
    monkeypatch.delenv("VOICE_CONVERT_CMD", raising=False)
    monkeypatch.delenv("VOICE_CLOUD_PROVIDER", raising=False)
    vc_mod._active = None
    resp = client.post("/api/voice/convert", json={
        "character_id": "stock-aoi", "audio_b64": _audio_b64(),
    })
    assert resp.status_code == 503
    assert "not configured" in resp.json()["detail"]


def test_voice_convert_refuses_locked_char(client, monkeypatch):
    monkeypatch.setenv("VOICE_CONVERT_CMD", "cp {input} {output}")
    vc_mod._active = None
    char = registry.register_generated_character("Locked", b"\x89PNG fake")
    resp = client.post("/api/voice/convert", json={
        "character_id": char.id, "audio_b64": _audio_b64(),
    })
    assert resp.status_code == 403
    assert "consent" in resp.json()["detail"]


def test_voice_convert_refuses_unrelated_token(client, monkeypatch):
    monkeypatch.setenv("VOICE_CONVERT_CMD", "cp {input} {output}")
    vc_mod._active = None
    char = registry.register_generated_character("Alice", b"\x89PNG fake")
    token_a = _valid_token({"face": "alice"})
    registry.mark_consented(char.id, consent.token_face_hash(token_a))
    token_b = _valid_token({"face": "bob"})
    resp = client.post("/api/voice/convert", json={
        "character_id": char.id, "audio_b64": _audio_b64(),
        "consent_token": token_b,
    })
    assert resp.status_code == 403
    assert "does not match" in resp.json()["detail"]


def test_voice_convert_accepts_matching_token(client, monkeypatch):
    monkeypatch.setenv("VOICE_CONVERT_CMD", "cp {input} {output}")
    vc_mod._active = None
    char = registry.register_generated_character("Alice", b"\x89PNG fake")
    token_a = _valid_token({"face": "alice"})
    registry.mark_consented(char.id, consent.token_face_hash(token_a))
    resp = client.post("/api/voice/convert", json={
        "character_id": char.id, "audio_b64": _audio_b64(),
        "consent_token": token_a,
    })
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert resp.json()["download_url"] is not None


def test_voice_convert_stock_char_no_token_needed(client, monkeypatch):
    monkeypatch.setenv("VOICE_CONVERT_CMD", "cp {input} {output}")
    vc_mod._active = None
    resp = client.post("/api/voice/convert", json={
        "character_id": "stock-aoi", "audio_b64": _audio_b64(),
    })
    assert resp.status_code == 200


# --------------------------------------------------------------------------- download endpoint
def test_voice_download_serves_file(client, monkeypatch):
    monkeypatch.setenv("VOICE_CONVERT_CMD", "cp {input} {output}")
    vc_mod._active = None
    resp = client.post("/api/voice/convert", json={
        "character_id": "stock-aoi", "audio_b64": _audio_b64(),
    })
    url = resp.json()["download_url"]
    dl = client.get(url)
    assert dl.status_code == 200
    assert dl.headers["content-type"] == "audio/wav"
    assert len(dl.content) > 0


def test_voice_download_404_for_unknown(client):
    dl = client.get("/api/voice/nonexistent/download")
    assert dl.status_code == 404


# --------------------------------------------------------------------------- production-path test
def test_get_converter_production_path_not_faked(monkeypatch):
    """Production-path test (the lesson from 80e1088): exercise the REAL
    get_converter() resolution, not an injected fake. When VOICE_CONVERT_CMD
    is set, get_converter() must return a real ExternalCommandConverter whose
    .convert actually runs the configured command — not a stand-in that
    pretends to convert. A fake converter would be dishonest on this project.
    """
    import shutil
    if not shutil.which("cp"):
        pytest.skip("cp not available")
    monkeypatch.setenv("VOICE_CONVERT_CMD", "cp {input} {output}")
    vc_mod._active = None
    c = vc_mod.get_converter()
    assert c is not None
    assert isinstance(c, vc_mod.ExternalCommandConverter)
    assert c.loaded
    # Actually run it — this exercises the real subprocess path.
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(b"real audio bytes")
        inp = Path(f.name)
    out = inp.parent / "converted.wav"
    try:
        result = c.convert(inp, out)
        assert result.exists()
        assert result.read_bytes() == b"real audio bytes"
    finally:
        inp.unlink(missing_ok=True)
        out.unlink(missing_ok=True)
