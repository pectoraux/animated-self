"""Integration tests for the Phase 2 audit finding: consent binding was being
recorded (mark_consented) but never actually checked against at the point
that matters — POST /api/session/start. A valid-but-unrelated consent token
(from a completely different liveness pass) used to unlock ANY consented
character, and consent/bind had no guard against silently overwriting an
existing binding.

These hit the real FastAPI app via TestClient (not just the registry/consent
modules directly) since the bug lived in how app.py wired them together, not
in the primitives themselves — unit tests on registry.py and consent.py in
isolation would not have caught it.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import consent
from characters import registry


@pytest.fixture(autouse=True)
def _isolated_generated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(registry, "_generated_dir", lambda: tmp_path)
    monkeypatch.setattr(registry, "_generated_manifest_path", lambda: tmp_path / "manifest.json")
    registry._STOCK_MANIFEST = None
    consent.store._issued.clear()
    consent.store._used.clear()
    yield


@pytest.fixture()
def client():
    import app as app_module
    return TestClient(app_module.app)


def _get_valid_token(evidence: dict) -> str:
    cid, steps, _ = consent.issue_challenge()
    passed, token, reason = consent.verify_challenge(cid, steps[:2], evidence)
    assert passed, reason
    return token


def test_unrelated_valid_token_cannot_drive_someone_elses_character(client):
    # Creator A generates + binds a character to their own face.
    char = registry.register_generated_character("Alice's Avatar", b"\x89PNG fake")
    token_a = _get_valid_token({"face": "alice"})
    registry.mark_consented(char.id, consent.token_face_hash(token_a))

    # A completely unrelated but VALID token (different liveness pass, "bob").
    token_b = _get_valid_token({"face": "bob"})

    resp = client.post(
        "/api/session/start",
        json={"character_id": char.id, "output": "preview", "consent_token": token_b},
    )
    assert resp.status_code == 403
    assert "does not match" in resp.json()["detail"]


def test_matching_token_passes_the_consent_gate(client):
    char = registry.register_generated_character("Alice's Avatar", b"\x89PNG fake")
    token_a = _get_valid_token({"face": "alice"})
    registry.mark_consented(char.id, consent.token_face_hash(token_a))

    resp = client.post(
        "/api/session/start",
        json={"character_id": char.id, "output": "preview", "consent_token": token_a},
    )
    # Must get PAST the consent gate. It may still fail downstream (503) since
    # THA3 has no checkpoint / real image in this test env, but it must not be
    # the 403 consent-mismatch error.
    assert resp.status_code != 403


def test_rebinding_to_a_different_face_is_refused():
    char = registry.register_generated_character("Alice's Avatar", b"\x89PNG fake")
    token_a = _get_valid_token({"face": "alice"})
    registry.mark_consented(char.id, consent.token_face_hash(token_a))

    token_b = _get_valid_token({"face": "bob"})
    with pytest.raises(registry.AlreadyConsentedError):
        registry.mark_consented(char.id, consent.token_face_hash(token_b))


def test_rebinding_to_the_same_face_is_a_harmless_noop():
    char = registry.register_generated_character("Alice's Avatar", b"\x89PNG fake")
    token_a1 = _get_valid_token({"face": "alice"})
    fh = consent.token_face_hash(token_a1)
    registry.mark_consented(char.id, fh)

    # Re-running liveness later (same face) and binding again must not raise.
    bound_again = registry.mark_consented(char.id, fh)
    assert bound_again.consented is True


def test_consent_bind_endpoint_refuses_hijack_via_rebind(client):
    char = registry.register_generated_character("Alice's Avatar", b"\x89PNG fake")
    token_a = _get_valid_token({"face": "alice"})
    bind_a = client.post(
        f"/api/characters/{char.id}/consent/bind",
        json={"character_id": char.id, "consent_token": token_a},
    )
    assert bind_a.status_code == 200

    token_b = _get_valid_token({"face": "bob"})
    bind_b = client.post(
        f"/api/characters/{char.id}/consent/bind",
        json={"character_id": char.id, "consent_token": token_b},
    )
    assert bind_b.status_code == 409
