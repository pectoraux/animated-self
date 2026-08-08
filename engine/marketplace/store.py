"""Marketplace listing store (Phase 5).

File-based JSON store, consistent with characters/registry.py's generated-
character manifest pattern. NOT Prisma — see design decision in worklog:
the marketplace is still a registry/distribution problem at v1 scale, and
the existing JSON pattern works. Prisma is the right move when we need
multi-tenant scale/search, not before.

A listing is a published character pack. The character's image + metadata
are copied into the listing at publish time (the listing is immutable once
published — editing a listing means publishing a new one). The publisher's
bound_face_hash is recorded as an audit trail (who published this), but it
does NOT transfer to installers: installing a listing creates a new
unconsented character that the installer must bind to their own face.

Review pipeline: new listings start status=pending. The pHash flagger
(run at publish time) sets flagged=True if a near-duplicate exists. Flagged
listings need manual approval; unflagged ones auto-approve (a real human
can still reject later via the review endpoint). See review.py.
"""
from __future__ import annotations

import json
import logging
import secrets
import time
from pathlib import Path
from typing import Any

from config import cfg

log = logging.getLogger("animated-self.marketplace")


def _store_dir() -> Path:
    d = cfg.root / "marketplace"
    d.mkdir(parents=True, exist_ok=True)
    (d / "images").mkdir(exist_ok=True)
    return d


def _manifest_path() -> Path:
    return _store_dir() / "listings.json"


def _load() -> dict[str, Any]:
    p = _manifest_path()
    if p.exists():
        return json.loads(p.read_text())
    return {"version": 1, "listings": []}


def _save(data: dict[str, Any]) -> None:
    _manifest_path().write_text(json.dumps(data, indent=2))


def _to_listing(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a raw manifest entry. Returns a plain dict (not a Pydantic
    model — listings are internal; the API layer converts to a response model)."""
    return raw


# --------------------------------------------------------------------------- public API
def create_listing(
    publisher_id: str,
    character_name: str,
    character_image_png: bytes,
    character_tags: list[str],
    bound_face_hash: str,
    phash: str,
    flagged: bool,
    flag_reason: str | None,
) -> dict[str, Any]:
    """Create a new marketplace listing.

    The character image + metadata are COPIED into the listing — the listing
    is independent of the source character after publish. bound_face_hash is
    the publisher's face hash (audit trail, does NOT transfer to installers).
    """
    listing_id = f"mp-{secrets.token_hex(6)}"
    image_path = _store_dir() / "images" / f"{listing_id}.png"
    image_path.write_bytes(character_image_png)

    entry = {
        "listing_id": listing_id,
        "publisher_id": publisher_id,
        "character_name": character_name,
        "character_image": f"marketplace/images/{listing_id}.png",
        "character_tags": list(character_tags),
        "bound_face_hash": bound_face_hash,
        "phash": phash,
        "review_status": "pending",
        "flagged": flagged,
        "flag_reason": flag_reason,
        "published_at": int(time.time() * 1000),
        "reviewed_at": None,
        "reviewer_id": None,
    }
    data = _load()
    data.setdefault("listings", []).append(entry)
    _save(data)
    log.info("created listing %s (publisher=%s, flagged=%s)", listing_id, publisher_id, flagged)
    return entry


def get_listing(listing_id: str) -> dict[str, Any] | None:
    for l in _load().get("listings", []):
        if l["listing_id"] == listing_id:
            return l
    return None


def list_approved() -> list[dict[str, Any]]:
    return [l for l in _load().get("listings", []) if l["review_status"] == "approved"]


def list_pending() -> list[dict[str, Any]]:
    return [l for l in _load().get("listings", []) if l["review_status"] == "pending"]


def list_all_with_phash() -> list[tuple[str, str]]:
    """All approved listings' (listing_id, phash) — for near-duplicate check."""
    return [
        (l["listing_id"], l["phash"])
        for l in _load().get("listings", [])
        if l["review_status"] == "approved" and l.get("phash")
    ]


def set_review_status(
    listing_id: str, status: str, reviewer_id: str, reason: str | None = None,
) -> dict[str, Any] | None:
    """Approve or reject a listing. Returns the updated entry, or None if not found."""
    data = _load()
    entry = next((l for l in data.get("listings", []) if l["listing_id"] == listing_id), None)
    if entry is None:
        return None
    entry["review_status"] = status
    entry["reviewed_at"] = int(time.time() * 1000)
    entry["reviewer_id"] = reviewer_id
    if reason:
        entry["review_reason"] = reason
    _save(data)
    log.info("listing %s -> %s (reviewer=%s)", listing_id, status, reviewer_id)
    return entry


def get_listing_image(listing_id: str) -> Path | None:
    entry = get_listing(listing_id)
    if entry is None:
        return None
    p = cfg.root / entry["character_image"]
    return p if p.exists() else None


def reset_for_tests() -> None:
    """Clear the store — test-only."""
    p = _manifest_path()
    if p.exists():
        p.unlink()
