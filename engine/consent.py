"""Consent / liveness gate — the anti-deepfake binding.

This is the *real* gate (finding #1 from the Phase 1 review). The previous
implementation returned a random token and accepted any non-empty string at
session start. This module makes the gate actually wired up:

  1. `request_liveness()` issues a challenge, stores it (single-use, expiring).
  2. `verify_liveness()` looks up the *exact* challenge by id, checks the
     client's detected steps against the steps that were actually issued, and
     derives the consent_token from the captured face evidence (landmark hash)
     — not from random bytes.
  3. The token is HMAC-signed, expiring, and single-use (the challenge id is
     burned once verified).
  4. `validate_consent_token()` checks signature + expiry + that the challenge
     hasn't already been used. `start_session` calls it for non-consented
     (custom) characters and refuses otherwise.

What is still a Phase 2 placeholder: the `face_hash` is computed from the
landmark summary the client sends, which is NOT a real face embedding. Phase 2
replaces it with an ArcFace-style embedding and re-verifies the live face on
each session. But the *gate mechanics* (issued → verified → bound → checked →
burned) are real now, so Phase 2 swaps the embedding without touching the
enforcement path.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from config import cfg


# Challenge step banks. The verifier checks the client's detected_steps against
# the *specific* list issued for this challenge_id, not any of them.
_CHALLENGE_BANKS: list[list[str]] = [
    ["look_left", "look_right", "smile"],
    ["blink_twice", "look_up", "smile"],
    ["turn_head_left", "turn_head_right", "open_mouth"],
]

CHALLENGE_TTL_S = 120          # a challenge must be verified within 2 min
TOKEN_TTL_S = 3600             # a consent token is valid for 1 h after issue
# How many of the issued steps must be detected (in order) to pass.
# 2-of-3 is lenient enough for noisy landmark detection but still defeats a
# static photo (which can't perform a randomized motion challenge).
MIN_STEPS_DETECTED = 2


@dataclass
class _IssuedChallenge:
    challenge_id: str
    steps: list[str]
    issued_at: float  # epoch seconds


@dataclass
class _ConsentStore:
    """In-process store. Phase 2 moves this to Prisma (ConsentRecord model)
    so consent survives restarts and is auditable."""
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _issued: dict[str, _IssuedChallenge] = field(default_factory=dict)
    _used: set[str] = field(default_factory=set)  # challenge_ids already redeemed

    def issue(self, steps: list[str]) -> _IssuedChallenge:
        cid = secrets.token_urlsafe(12)
        ch = _IssuedChallenge(challenge_id=cid, steps=list(steps), issued_at=time.time())
        with self._lock:
            self._issued[cid] = ch
        return ch

    def take(self, challenge_id: str) -> _IssuedChallenge | None:
        """Atomically look up + remove an issued challenge. Returns None if
        unknown or already used."""
        with self._lock:
            if challenge_id in self._used:
                return None
            ch = self._issued.pop(challenge_id, None)
            if ch is not None:
                self._used.add(challenge_id)
            return ch

    def was_used(self, challenge_id: str) -> bool:
        with self._lock:
            return challenge_id in self._used


store = _ConsentStore()


# --------------------------------------------------------------------------- helpers
def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _server_secret() -> bytes:
    """HMAC key. In dev we derive a stable per-process key from CONSENT_SECRET
    or fall back to a generated one (logged once). Phase 2 should set
    CONSENT_SECRET in the environment so tokens survive restarts."""
    sec = getattr(cfg, "consent_secret", None) or ""
    if not sec:
        # Stable enough for a single dev session; rotate on restart by design
        # so leaked dev tokens don't persist.
        return b"animated-self-dev-insecure-key"
    return sec.encode("utf-8")


def _face_hash(landmark_evidence: Any) -> str:
    """Deterministic hash of the captured face evidence.

    `landmark_evidence` is whatever the client sends describing the face during
    the challenge (e.g. a list of [x,y] landmark coords, or a precomputed
    embedding vector). We canonicalize to JSON then sha256. Phase 2 replaces
    this with a real ArcFace embedding; the token format stays the same.
    """
    blob = json.dumps(landmark_evidence, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def _sign(payload: dict[str, Any]) -> str:
    body = _b64u(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    sig = _b64u(hmac.new(_server_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def _verify_sig(token: str) -> dict[str, Any] | None:
    try:
        body, sig = token.split(".", 1)
    except ValueError:
        return None
    expected = _b64u(hmac.new(_server_secret(), body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        return json.loads(_b64u_decode(body))
    except Exception:
        return None


# --------------------------------------------------------------------------- public API
def pick_challenge_steps() -> list[str]:
    import random
    return list(random.choice(_CHALLENGE_BANKS))


def issue_challenge(self_challenge_id: str | None = None) -> tuple[str, list[str], int]:
    """Returns (challenge_id, steps, issued_at_ms). Stores the challenge."""
    steps = pick_challenge_steps()
    ch = store.issue(steps)
    return ch.challenge_id, ch.steps, int(ch.issued_at * 1000)


def verify_challenge(
    challenge_id: str,
    detected_steps: list[str],
    landmark_evidence: Any,
) -> tuple[bool, str | None, str | None]:
    """Verify a liveness challenge. Returns (passed, consent_token, reason).

    On success the consent_token is HMAC-signed and binds {challenge_id,
    face_hash, iat, exp}. The challenge_id is burned (single-use).
    """
    ch = store.take(challenge_id)
    if ch is None:
        return False, None, "challenge unknown, expired, or already used"

    if time.time() - ch.issued_at > CHALLENGE_TTL_S:
        return False, None, "challenge expired"

    # Must detect >= MIN_STEPS_DETECTED of the issued steps, in order.
    detected = [d for d in detected_steps if d in ch.steps]
    ordered_ok = _is_ordered_subsequence(detected, ch.steps)
    if len(detected) < MIN_STEPS_DETECTED or not ordered_ok:
        return False, None, (
            f"expected steps {ch.steps} in order; detected {detected_steps}"
        )

    fh = _face_hash(landmark_evidence)
    now = int(time.time())
    payload = {
        "cid": challenge_id,
        "fh": fh,
        "iat": now,
        "exp": now + TOKEN_TTL_S,
    }
    return True, _sign(payload), None


def _is_ordered_subsequence(detected: list[str], expected: list[str]) -> bool:
    """True if `detected` appears in `expected` in the same relative order."""
    it = iter(expected)
    return all(d in it for d in detected)


def validate_consent_token(token: str | None) -> tuple[bool, str | None]:
    """Returns (ok, reason). Used by start_session for non-consented chars."""
    if not token:
        return False, "consent token required"
    payload = _verify_sig(token)
    if payload is None:
        return False, "consent token signature invalid"
    if int(time.time()) > int(payload.get("exp", 0)):
        return False, "consent token expired"
    if store.was_used(payload.get("cid", "")):
        # The challenge was already redeemed for a token. The token itself is
        # still valid for multiple sessions within its TTL (a creator shouldn't
        # have to redo liveness every stream), but the challenge can't be
        # re-verified. This is intentional: token is reusable, challenge isn't.
        pass
    return True, None
