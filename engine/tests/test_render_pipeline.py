"""Tests for Phase 3 — the async diffusion render pipeline.

Covers both the DI fake path AND the real production resolution path
(RenderPipeline() with no injected renderer -> backends.renderer singleton),
same lesson as pipeline/live_pipeline.py's PoserLike: a DI fake alone gave
false confidence once before (see test_session_consent_gate.py / the
_resolve_poser fix) and isn't repeated here.
"""
from __future__ import annotations

import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

import config
import consent
from characters import registry
from backends.diffusion_renderer import DiffusionRenderer
from pipeline.render_pipeline import RenderPipeline


@pytest.fixture(autouse=True)
def _isolated_generated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(registry, "_generated_dir", lambda: tmp_path)
    monkeypatch.setattr(registry, "_generated_manifest_path", lambda: tmp_path / "manifest.json")
    registry._STOCK_MANIFEST = None
    consent.store._issued.clear()
    consent.store._used.clear()
    yield


@pytest.fixture(autouse=True)
def _reset_diffusion_cmd():
    """diffusion_render_cmd lives on the frozen, shared `cfg` singleton — bypass
    frozen with object.__setattr__ (same approach as the CONSENT_SECRET test)
    and always restore it so tests don't leak config into each other."""
    original = config.cfg.diffusion_render_cmd
    yield
    object.__setattr__(config.cfg, "diffusion_render_cmd", original)


class FakeRenderer:
    loaded = True

    def render_audio(self, reference_rgb, audio_path, out_mp4, progress=None):
        out_mp4.parent.mkdir(parents=True, exist_ok=True)
        out_mp4.write_bytes(b"fake-mp4-bytes")
        if progress:
            progress(1.0)
        return out_mp4


# --------------------------------------------------------------------------- RenderPipeline (injected fake)
def test_render_pipeline_with_injected_fake(tmp_path):
    char = registry.register_generated_character("Test", b"\x89PNG fake")
    pipeline = RenderPipeline(renderer=FakeRenderer())
    out = tmp_path / "out.mp4"
    result = pipeline.render(char.id, "unused-audio-path", "audio", out)
    assert result == out
    assert out.read_bytes() == b"fake-mp4-bytes"


def test_render_pipeline_rejects_unsupported_driver_type(tmp_path):
    char = registry.register_generated_character("Test", b"\x89PNG fake")
    pipeline = RenderPipeline(renderer=FakeRenderer())
    with pytest.raises(RuntimeError, match="Unsupported"):
        pipeline.render(char.id, "unused", "video", tmp_path / "o.mp4")


# --------------------------------------------------------------------------- RenderPipeline (real resolution path)
def test_render_pipeline_real_path_reports_unconfigured():
    object.__setattr__(config.cfg, "diffusion_render_cmd", None)
    char = registry.register_generated_character("Test", b"\x89PNG fake")
    pipeline = RenderPipeline()  # no injection -> resolves backends.renderer for real
    with pytest.raises(RuntimeError, match="not configured"):
        pipeline.render(char.id, "unused", "audio", Path("/tmp/whatever.mp4"))


def test_render_pipeline_real_path_runs_configured_command(tmp_path):
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"fake-audio-bytes")
    out = tmp_path / "out.mp4"
    object.__setattr__(config.cfg, "diffusion_render_cmd", "cp {audio} {output}")
    object.__setattr__(config.cfg, "diffusion_render_timeout_s", 30)

    char = registry.register_generated_character("Test", b"\x89PNG fake")
    pipeline = RenderPipeline()
    result = pipeline.render(char.id, str(audio), "audio", out)
    assert result == out
    assert out.read_bytes() == b"fake-audio-bytes"


# --------------------------------------------------------------------------- DiffusionRenderer directly
def test_diffusion_renderer_raises_when_unconfigured(tmp_path):
    object.__setattr__(config.cfg, "diffusion_render_cmd", None)
    r = DiffusionRenderer()
    with pytest.raises(RuntimeError, match="DIFFUSION_RENDER_CMD"):
        r.render_audio(np.zeros((4, 4, 3), dtype="uint8"), "nonexistent", tmp_path / "o.mp4")


def test_diffusion_renderer_raises_on_missing_audio_file(tmp_path):
    object.__setattr__(config.cfg, "diffusion_render_cmd", "cp {audio} {output}")
    r = DiffusionRenderer()
    with pytest.raises(RuntimeError, match="not found"):
        r.render_audio(np.zeros((4, 4, 3), dtype="uint8"), str(tmp_path / "missing.wav"), tmp_path / "o.mp4")


def test_diffusion_renderer_raises_when_command_fails(tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    object.__setattr__(config.cfg, "diffusion_render_cmd", "false {audio} {output}")
    object.__setattr__(config.cfg, "diffusion_render_timeout_s", 30)
    r = DiffusionRenderer()
    with pytest.raises(RuntimeError, match="exit"):
        r.render_audio(np.zeros((4, 4, 3), dtype="uint8"), str(audio), tmp_path / "o.mp4")


# --------------------------------------------------------------------------- full API flow
def test_full_render_flow_via_api(tmp_path):
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"fake-audio-bytes")
    object.__setattr__(config.cfg, "diffusion_render_cmd", "cp {audio} {output}")
    object.__setattr__(config.cfg, "diffusion_render_timeout_s", 30)
    object.__setattr__(config.cfg, "render_output_dir", str(tmp_path / "render-output"))

    import app as app_module
    client = TestClient(app_module.app)

    char = registry.register_generated_character("Alice", b"\x89PNG fake")
    cid, steps, _ = consent.issue_challenge()
    _, token, _ = consent.verify_challenge(cid, steps[:2], {"face": "alice"})
    registry.mark_consented(char.id, consent.token_face_hash(token))

    resp = client.post(
        "/api/render",
        json={
            "character_id": char.id, "driver": "audio", "driver_url": str(audio),
            "quality": "high", "consent_token": token,
        },
    )
    assert resp.status_code == 200, resp.text
    job = resp.json()
    assert job["status"] in ("queued", "running", "done")

    got = job
    for _ in range(100):
        got = client.get(f"/api/render/{job['job_id']}").json()
        if got["status"] in ("done", "failed"):
            break
        time.sleep(0.05)
    assert got["status"] == "done", got

    dl = client.get(got["download_url"])
    assert dl.status_code == 200
    assert dl.content == b"fake-audio-bytes"


def test_render_blocked_by_mismatched_consent(tmp_path):
    object.__setattr__(config.cfg, "diffusion_render_cmd", "cp {audio} {output}")
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")

    import app as app_module
    client = TestClient(app_module.app)

    char = registry.register_generated_character("Bob", b"\x89PNG fake")
    cid, steps, _ = consent.issue_challenge()
    _, owner_token, _ = consent.verify_challenge(cid, steps[:2], {"face": "bob"})
    registry.mark_consented(char.id, consent.token_face_hash(owner_token))

    cid2, steps2, _ = consent.issue_challenge()
    _, other_token, _ = consent.verify_challenge(cid2, steps2[:2], {"face": "mallory"})

    resp = client.post(
        "/api/render",
        json={
            "character_id": char.id, "driver": "audio", "driver_url": str(audio),
            "quality": "high", "consent_token": other_token,
        },
    )
    assert resp.status_code == 403


def test_render_rejects_remote_driver_url(tmp_path):
    object.__setattr__(config.cfg, "diffusion_render_cmd", "cp {audio} {output}")

    import app as app_module
    client = TestClient(app_module.app)

    char = registry.register_generated_character("Stock-ish", b"\x89PNG fake", tags=["t"])
    cid, steps, _ = consent.issue_challenge()
    _, token, _ = consent.verify_challenge(cid, steps[:2], {"face": "x"})
    registry.mark_consented(char.id, consent.token_face_hash(token))

    resp = client.post(
        "/api/render",
        json={
            "character_id": char.id, "driver": "audio",
            "driver_url": "https://example.com/audio.wav",
            "quality": "high", "consent_token": token,
        },
    )
    assert resp.status_code == 400
    assert "local file path" in resp.json()["detail"]
