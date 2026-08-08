"""Tests for Phase 5 — marketplace.

Covers the three threat-model questions from the Phase 5 design:
  1. Publishing requires a valid consent_token matching the character's
     bound_face_hash (can't publish someone else's bound character without
     their token).
  2. Installing a marketplace character creates a NEW unconsented character —
     the publisher's binding does NOT transfer.
  3. pHash near-duplicate detection flags re-uploads of the same image.

Plus:
  * Review pipeline: flagged listings stay pending, unflagged auto-approve.
  * Manual review endpoint (approve/reject).
  * Production-path test: the real pHash computation + real duplicate
    checker (not injected fakes) — the lesson from _resolve_poser and
    get_converter.
  * Persistence: file-based JSON store (consistent with characters/registry).
"""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import consent
from characters import registry
from marketplace import phash, store as mstore, review as mreview


@pytest.fixture(autouse=True)
def _isolated_stores(tmp_path, monkeypatch):
    gen_dir = tmp_path / "gen"
    gen_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(registry, "_generated_dir", lambda: gen_dir)
    monkeypatch.setattr(registry, "_generated_manifest_path", lambda: gen_dir / "manifest.json")
    registry._STOCK_MANIFEST = None
    consent.store._issued.clear()
    consent.store._used.clear()
    # Redirect marketplace store to tmp.
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
    )
    monkeypatch.setattr(config_mod, "cfg", fake_cfg)
    monkeypatch.setattr(app_module, "cfg", fake_cfg, raising=False)
    monkeypatch.setattr(mp_store_mod, "cfg", fake_cfg, raising=False)
    # Reset review singleton.
    mreview._default_checker = None
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


def _make_png(color: tuple = (200, 150, 150), seed: int = 0) -> bytes:
    """A small test PNG with actual structure (not just solid color — solid
    colors are degenerate for pHash since they have no low-frequency content
    to distinguish). We add a circle + noise so the DCT has real structure."""
    import random
    rng = random.Random(seed)
    img = Image.new("RGB", (64, 64), color)
    pixels = img.load()
    for y in range(64):
        for x in range(64):
            # Add deterministic noise so different seeds produce different structure.
            n = rng.randint(-30, 30)
            r = max(0, min(255, color[0] + n))
            g = max(0, min(255, color[1] + n))
            b = max(0, min(255, color[2] + n))
            pixels[x, y] = (r, g, b)
    # Draw a circle so there's geometric structure.
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img)
    draw.ellipse([20, 15, 44, 49], fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# --------------------------------------------------------------------------- publish consent gate
def test_publish_requires_matching_consent_token(client):
    """Threat 1: can't publish a character without a token matching its
    bound_face_hash. Only the creator who bound it can publish it."""
    char = registry.register_generated_character("My Avatar", _make_png())
    token = _valid_token({"face": "alice"})
    registry.mark_consented(char.id, consent.token_face_hash(token))

    # Wrong token (bob's) -> 403.
    token_bob = _valid_token({"face": "bob"})
    resp = client.post("/api/marketplace/publish", json={
        "character_id": char.id, "publisher_id": "alice", "consent_token": token_bob,
    })
    assert resp.status_code == 403
    assert "does not match" in resp.json()["detail"]

    # No token -> 403.
    resp = client.post("/api/marketplace/publish", json={
        "character_id": char.id, "publisher_id": "alice", "consent_token": "",
    })
    assert resp.status_code == 403

    # Matching token -> 200.
    resp = client.post("/api/marketplace/publish", json={
        "character_id": char.id, "publisher_id": "alice", "consent_token": token,
    })
    assert resp.status_code == 200
    assert resp.json()["review_status"] in ("approved", "pending")


def test_publish_unconsented_character_refused(client):
    char = registry.register_generated_character("Locked", _make_png())
    resp = client.post("/api/marketplace/publish", json={
        "character_id": char.id, "publisher_id": "x", "consent_token": "",
    })
    assert resp.status_code == 403


# --------------------------------------------------------------------------- install does NOT transfer binding
def test_install_creates_unconsented_character(client):
    """Threat 2: installing a marketplace character creates a NEW unconsented
    character. The publisher's bound_face_hash does NOT transfer — the
    installer must run their own liveness to drive it."""
    # Alice publishes a character.
    char = registry.register_generated_character("Alice's Avatar", _make_png())
    token = _valid_token({"face": "alice"})
    registry.mark_consented(char.id, consent.token_face_hash(token))
    pub = client.post("/api/marketplace/publish", json={
        "character_id": char.id, "publisher_id": "alice", "consent_token": token,
    })
    listing_id = pub.json()["listing_id"]

    # Bob installs it.
    installed = client.post(f"/api/marketplace/{listing_id}/install")
    assert installed.status_code == 200
    installed_char = installed.json()
    assert installed_char["consented"] is False  # NOT bound!
    assert installed_char["id"] != char.id  # new character, not the original

    # Bob can't drive it without running his own liveness.
    from characters import get_bound_face_hash
    assert get_bound_face_hash(installed_char["id"]) is None


# --------------------------------------------------------------------------- pHash near-duplicate detection
def test_phash_identical_images_flagged_as_near_duplicate():
    """The core automated check: re-uploading the same image is flagged."""
    png = _make_png()
    h1 = phash.compute_phash(png)
    h2 = phash.compute_phash(png)
    assert phash.is_near_duplicate(h1, h2)
    assert phash.hamming_distance(h1, h2) == 0


def test_phash_different_images_not_flagged():
    """Different images (different structure) should not be near-duplicates."""
    h1 = phash.compute_phash(_make_png((200, 150, 150), seed=1))
    h2 = phash.compute_phash(_make_png((50, 100, 200), seed=2))
    assert not phash.is_near_duplicate(h1, h2), (
        f"different structured images flagged as near-duplicate "
        f"(distance {phash.hamming_distance(h1, h2)})"
    )


def test_publish_duplicate_image_flagged_for_review(client):
    """Threat 2 (republishing): re-uploading the same image is flagged and
    stays pending for manual review instead of auto-approving."""
    png = _make_png()
    # First publish: auto-approved (no existing duplicate).
    char1 = registry.register_generated_character("Original", png)
    token1 = _valid_token({"face": "alice"})
    registry.mark_consented(char1.id, consent.token_face_hash(token1))
    pub1 = client.post("/api/marketplace/publish", json={
        "character_id": char1.id, "publisher_id": "alice", "consent_token": token1,
    })
    assert pub1.json()["review_status"] == "approved"
    assert pub1.json()["flagged"] is False

    # Second publish (same image, different publisher): flagged, pending.
    char2 = registry.register_generated_character("Copy", png)
    token2 = _valid_token({"face": "bob"})
    registry.mark_consented(char2.id, consent.token_face_hash(token2))
    pub2 = client.post("/api/marketplace/publish", json={
        "character_id": char2.id, "publisher_id": "bob", "consent_token": token2,
    })
    assert pub2.json()["flagged"] is True
    assert pub2.json()["review_status"] == "pending"
    assert "Near-duplicate" in (pub2.json().get("flag_reason") or "")


# --------------------------------------------------------------------------- review pipeline
def test_manual_review_approve(client):
    char = registry.register_generated_character("Test", _make_png((100, 200, 100)))
    token = _valid_token({"face": "alice"})
    registry.mark_consented(char.id, consent.token_face_hash(token))
    pub = client.post("/api/marketplace/publish", json={
        "character_id": char.id, "publisher_id": "alice", "consent_token": token,
    })
    # This image is unique, so it auto-approves. Let's test the review
    # endpoint by rejecting then checking 409 on re-review.
    listing_id = pub.json()["listing_id"]
    # Already approved -> 409 on review attempt.
    resp = client.post(f"/api/marketplace/{listing_id}/review", json={
        "status": "rejected", "reviewer_id": "mod1", "reason": "test",
    })
    assert resp.status_code == 409


def test_review_pending_listing(client):
    """A flagged (pending) listing can be approved or rejected manually."""
    png = _make_png()
    # Create two listings with the same image so the second is flagged.
    char1 = registry.register_generated_character("A", png)
    t1 = _valid_token({"face": "a"})
    registry.mark_consented(char1.id, consent.token_face_hash(t1))
    client.post("/api/marketplace/publish", json={
        "character_id": char1.id, "publisher_id": "a", "consent_token": t1,
    })
    char2 = registry.register_generated_character("B", png)
    t2 = _valid_token({"face": "b"})
    registry.mark_consented(char2.id, consent.token_face_hash(t2))
    pub2 = client.post("/api/marketplace/publish", json={
        "character_id": char2.id, "publisher_id": "b", "consent_token": t2,
    })
    listing_id = pub2.json()["listing_id"]
    assert pub2.json()["review_status"] == "pending"

    # Approve it.
    resp = client.post(f"/api/marketplace/{listing_id}/review", json={
        "status": "approved", "reviewer_id": "mod1",
    })
    assert resp.status_code == 200
    assert resp.json()["review_status"] == "approved"
    assert resp.json()["reviewer_id"] == "mod1"

    # Now it appears in the approved list.
    listed = client.get("/api/marketplace").json()
    assert any(l["listing_id"] == listing_id for l in listed)


def test_install_refused_for_non_approved(client):
    char = registry.register_generated_character("Test", _make_png())
    token = _valid_token({"face": "x"})
    registry.mark_consented(char.id, consent.token_face_hash(token))
    pub = client.post("/api/marketplace/publish", json={
        "character_id": char.id, "publisher_id": "x", "consent_token": token,
    })
    # Reject it via review (need to make it pending first — use a duplicate).
    # Actually, auto-approved listings can't be reviewed (409). So test with
    # a pending listing created by duplication.
    png2 = _make_png()
    char_a = registry.register_generated_character("A", png2)
    ta = _valid_token({"face": "a"})
    registry.mark_consented(char_a.id, consent.token_face_hash(ta))
    client.post("/api/marketplace/publish", json={
        "character_id": char_a.id, "publisher_id": "a", "consent_token": ta,
    })
    char_b = registry.register_generated_character("B", png2)
    tb = _valid_token({"face": "b"})
    registry.mark_consented(char_b.id, consent.token_face_hash(tb))
    pub_b = client.post("/api/marketplace/publish", json={
        "character_id": char_b.id, "publisher_id": "b", "consent_token": tb,
    })
    pending_id = pub_b.json()["listing_id"]
    assert pub_b.json()["review_status"] == "pending"

    # Can't install a pending listing.
    resp = client.post(f"/api/marketplace/{pending_id}/install")
    assert resp.status_code == 403


# --------------------------------------------------------------------------- production-path test
def test_phash_production_path_not_faked():
    """Production-path test (lesson from _resolve_poser / get_converter):
    exercise the REAL pHash computation + REAL duplicate checker, not
    injected fakes. This is the path that runs in production when someone
    publishes a listing."""
    # Real pHash on a real image.
    png = _make_png((180, 120, 90))
    h = phash.compute_phash(png)
    assert isinstance(h, str)
    assert len(h) == 16  # 64-bit hex

    # Real duplicate checker against the real (empty) store.
    checker = mreview.get_duplicate_checker()
    assert isinstance(checker, mreview.RealDuplicateChecker)
    dupes = checker.find_near_duplicates(h)
    assert dupes == []  # no existing listings -> no dupes


def test_phash_is_deterministic():
    """Same image -> same hash. Critical for duplicate detection."""
    png = _make_png((100, 50, 200))
    assert phash.compute_phash(png) == phash.compute_phash(png)


def test_phash_robust_to_resize():
    """pHash should be robust to resizing — that's the point of using DCT
    low frequencies rather than exact pixel comparison."""
    small = _make_png((100, 50, 200))
    big_img = Image.open(io.BytesIO(small)).resize((512, 512))
    buf = io.BytesIO()
    big_img.save(buf, format="PNG")
    big = buf.getvalue()
    h_small = phash.compute_phash(small)
    h_big = phash.compute_phash(big)
    # Should be near-duplicate (low Hamming distance).
    assert phash.is_near_duplicate(h_small, h_big), (
        f"pHash should be robust to resize; got distance "
        f"{phash.hamming_distance(h_small, h_big)}"
    )
