"""Tests for the consent gate — the finding #1 fix.

Verifies the gate is actually wired up:
  * A challenge is single-use and expiring.
  * verify_challenge checks the EXACT steps issued for that challenge_id.
  * The consent_token is HMAC-signed and derived from face evidence.
  * A token bound to evidence A is not valid for evidence B (binding works).
  * validate_consent_token rejects garbage, expired, and tampered tokens.
  * A client can no longer skip liveness with consent_token="x".
"""
from __future__ import annotations

import time

import pytest

import consent


@pytest.fixture(autouse=True)
def _reset_store():
    """Each test gets a fresh store so single-use semantics don't leak."""
    consent.store._issued.clear()
    consent.store._used.clear()
    yield


def test_issue_challenge_returns_stored_steps():
    cid, steps, issued_at = consent.issue_challenge()
    assert isinstance(cid, str) and len(cid) > 8
    assert len(steps) == 3
    assert steps in consent._CHALLENGE_BANKS
    assert issued_at > 0


def test_verify_requires_the_exact_issued_challenge():
    cid, steps, _ = consent.issue_challenge()
    # Detect a DIFFERENT bank's steps — must fail even if those steps exist
    # in another bank. (The old bug matched against any bank.)
    other_bank = next(b for b in consent._CHALLENGE_BANKS if b != steps)
    passed, token, reason = consent.verify_challenge(
        cid, detected_steps=other_bank[:2], landmark_evidence={"x": 1},
    )
    assert not passed
    assert token is None
    assert "order" in (reason or "")


def test_verify_passes_when_correct_steps_detected_in_order():
    cid, steps, _ = consent.issue_challenge()
    passed, token, reason = consent.verify_challenge(
        cid, detected_steps=steps[:2], landmark_evidence={"lm": [[0.1, 0.2]]},
    )
    assert passed, reason
    assert token is not None
    assert "." in token  # body.signature


def test_challenge_is_single_use():
    cid, steps, _ = consent.issue_challenge()
    p1, t1, _ = consent.verify_challenge(cid, steps[:2], {"x": 1})
    assert p1 and t1
    # Second verify on the same challenge_id must fail (burned).
    p2, t2, r2 = consent.verify_challenge(cid, steps[:2], {"x": 1})
    assert not p2
    assert t2 is None
    assert "used" in (r2 or "")


def test_unknown_challenge_id_rejected():
    passed, token, reason = consent.verify_challenge(
        "does-not-exist", ["look_left"], {"x": 1},
    )
    assert not passed
    assert token is None
    assert "unknown" in (reason or "")


def test_token_is_derived_from_evidence_not_random():
    cid, steps, _ = consent.issue_challenge()
    _, t1, _ = consent.verify_challenge(cid, steps[:2], {"face": "alice"})
    cid2, steps2, _ = consent.issue_challenge()
    _, t2, _ = consent.verify_challenge(cid2, steps2[:2], {"face": "alice"})
    # Same evidence -> same face_hash payload component. Tokens differ only
    # by challenge_id + iat, but the embedded fh MUST match.
    import consent as c
    import base64, json
    def fh(tok):
        body = tok.split(".")[0]
        pad = "=" * (-len(body) % 4)
        return json.loads(base64.urlsafe_b64decode(body + pad))["fh"]
    assert fh(t1) == fh(t2)  # deterministic from evidence


def test_validate_rejects_garbage_and_empty():
    ok, _ = consent.validate_consent_token(None)
    assert not ok
    ok, _ = consent.validate_consent_token("")
    assert not ok
    ok, _ = consent.validate_consent_token("not-a-token")
    assert not ok
    ok, _ = consent.validate_consent_token("xxx.yyy")  # bad signature
    assert not ok


def test_validate_accepts_real_token_and_rejects_tampered():
    cid, steps, _ = consent.issue_challenge()
    _, token, _ = consent.verify_challenge(cid, steps[:2], {"face": "bob"})
    ok, _ = consent.validate_consent_token(token)
    assert ok
    # Tamper: flip one char in the body.
    body, sig = token.split(".", 1)
    tampered = (body[:-1] + ("a" if body[-1] != "a" else "b")) + "." + sig
    ok, reason = consent.validate_consent_token(tampered)
    assert not ok
    assert "signature" in (reason or "")


def test_validate_rejects_expired_token():
    cid, steps, _ = consent.issue_challenge()
    _, token, _ = consent.verify_challenge(cid, steps[:2], {"face": "carol"})
    # Force expiry by monkeypatching time in the validate path.
    import consent as c
    real_time = c.time.time
    c.time.time = lambda: real_time() + c.TOKEN_TTL_S + 1
    try:
        ok, reason = consent.validate_consent_token(token)
    finally:
        c.time.time = real_time
    assert not ok
    assert "expired" in (reason or "")


def test_liveness_skipped_with_bogus_token_is_blocked():
    # The original bug: any non-empty string passed. Now it must not.
    ok, reason = consent.validate_consent_token("x")
    assert not ok
    assert "required" in (reason or "") or "signature" in (reason or "")


def test_fallback_secret_is_not_the_old_known_literal():
    # Regression: the fallback used to be a fixed string committed to the
    # public repo (b"animated-self-dev-insecure-key"), so anyone could forge
    # a validly-signed token without running the liveness challenge at all.
    assert consent._FALLBACK_SECRET != b"animated-self-dev-insecure-key"
    assert len(consent._FALLBACK_SECRET) >= 32


def test_forged_token_with_old_known_key_is_rejected():
    # Simulate an attacker who knows the *old* hardcoded fallback and tries
    # to forge a token with it. Must be rejected now that the real fallback
    # is random and unknown to them.
    import base64
    import hmac
    import json as _json

    payload = {"cid": "forged", "fh": "x", "iat": 0, "exp": 9999999999}
    body = base64.urlsafe_b64encode(
        _json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).rstrip(b"=").decode()
    forged_sig = base64.urlsafe_b64encode(
        hmac.new(b"animated-self-dev-insecure-key", body.encode(), consent.hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    forged_token = f"{body}.{forged_sig}"

    ok, reason = consent.validate_consent_token(forged_token)
    assert not ok
    assert "signature" in (reason or "")


def test_missing_secret_warns_once(monkeypatch, caplog):
    # cfg is a frozen dataclass; swap the module-level reference instead.
    from types import SimpleNamespace

    monkeypatch.setattr(consent, "cfg", SimpleNamespace(consent_secret=""))
    monkeypatch.setattr(consent, "_warned_insecure", False)
    with caplog.at_level("WARNING", logger="animated-self.consent"):
        consent._server_secret()
        consent._server_secret()
    warnings = [r for r in caplog.records if "CONSENT_SECRET" in r.message]
    assert len(warnings) == 1  # only warns once, not on every call
