"""Review pipeline for marketplace listings (Phase 5).

Two stages:
  1. Automated pHash near-duplicate flag at publish time (phash.py).
  2. Manual approve/reject by a reviewer (review queue endpoint).

Honesty boundary (see docs/reality-check.md #11):
  pHash catches near-duplicate IMAGES (same PNG re-uploaded, minor edits).
  It does NOT catch: stylistic copies, different art of the same character,
  or likeness-of-real-person detection. The manual queue is where judgment
  calls happen. This is NOT automated moderation — it's automated flagging
  + human review.

DI pattern: the duplicate-checker is injectable so tests can swap it without
touching the file store. A production-path test exercises the real pHash
comparison (the lesson from _resolve_poser and get_converter).
"""
from __future__ import annotations

from typing import Protocol

from . import phash, store


class DuplicateChecker(Protocol):
    """Check a new listing's pHash against existing approved listings."""
    def find_near_duplicates(self, new_phash: str) -> list[tuple[str, int]]: ...
        # Returns [(listing_id, hamming_distance), ...] for near-duplicates.


class RealDuplicateChecker:
    """Production duplicate checker: compares against the file-based store."""
    def find_near_duplicates(self, new_phash: str) -> list[tuple[str, int]]:
        out = []
        for listing_id, existing_phash in store.list_all_with_phash():
            dist = phash.hamming_distance(new_phash, existing_phash)
            if dist <= phash.HAMMING_THRESHOLD:
                out.append((listing_id, dist))
        return out


_default_checker: DuplicateChecker | None = None


def get_duplicate_checker() -> DuplicateChecker:
    """Returns the production duplicate checker. Tests inject their own."""
    global _default_checker
    if _default_checker is None:
        _default_checker = RealDuplicateChecker()
    return _default_checker


def flag_at_publish(new_phash: str, checker: DuplicateChecker | None = None) -> tuple[bool, str | None]:
    """Check a new listing's pHash against existing approved listings.

    Returns (flagged, reason). If flagged, the listing needs manual review.
    Unflagged listings auto-approve (a human can still reject later).
    """
    c = checker or get_duplicate_checker()
    dupes = c.find_near_duplicates(new_phash)
    if not dupes:
        return False, None
    closest_id, closest_dist = min(dupes, key=lambda x: x[1])
    return True, (
        f"Near-duplicate of approved listing {closest_id} "
        f"(Hamming distance {closest_dist} <= {phash.HAMMING_THRESHOLD}). "
        f"Manual review required."
    )


def auto_approve_unflagged(listing: dict) -> str:
    """If a listing wasn't flagged, auto-approve it. Returns the final status."""
    if not listing.get("flagged"):
        return "approved"
    return "pending"
