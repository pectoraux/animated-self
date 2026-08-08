"""Character registry — stock + generated characters.

Phase 1 shipped a static stock manifest. Phase 2 adds generated/uploaded
characters, which are persisted in a separate mutable store
(``characters/generated/manifest.json``) so the stock manifest stays read-only.

A character is an opaque `id` the engine resolves to an HxWx3 RGB reference
image. The inference layer (THA3) is identical for stock and generated chars —
a generated PNG is just another source image.

Consent binding: generated/uploaded chars start `consented=false`. After the
creator completes the liveness challenge, `mark_consented()` flips them to
`consented=true` and records the bound face_hash. The session-start gate
(``consent.validate_consent_token``) enforces this — a non-consented char
cannot be driven without a valid consent_token.
"""
from __future__ import annotations

import json
import logging
import secrets
from pathlib import Path
from typing import Any

import numpy as np

from config import cfg
from models import Character, CharacterSource

log = logging.getLogger("animated-self.characters")

_STOCK_MANIFEST: dict[str, Any] | None = None


def _stock_manifest_path() -> Path:
    return cfg.characters_dir / "manifest.json"


def _generated_dir() -> Path:
    d = cfg.characters_dir / "generated"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _generated_manifest_path() -> Path:
    return _generated_dir() / "manifest.json"


def _load_stock_manifest() -> dict[str, Any]:
    global _STOCK_MANIFEST
    if _STOCK_MANIFEST is None:
        path = _stock_manifest_path()
        if path.exists():
            _STOCK_MANIFEST = json.loads(path.read_text())
        else:
            _STOCK_MANIFEST = {"version": 0, "characters": []}
    return _STOCK_MANIFEST


def _load_generated_manifest() -> dict[str, Any]:
    """Generated chars are re-read from disk each call (they're mutable)."""
    path = _generated_manifest_path()
    if path.exists():
        return json.loads(path.read_text())
    return {"version": 1, "characters": []}


def _save_generated_manifest(data: dict[str, Any]) -> None:
    _generated_manifest_path().write_text(json.dumps(data, indent=2))


def _all_raw() -> list[dict[str, Any]]:
    """Merge stock + generated raw entries."""
    stock = _load_stock_manifest().get("characters", [])
    gen = _load_generated_manifest().get("characters", [])
    return list(stock) + list(gen)


def list_characters() -> list[Character]:
    out: list[Character] = []
    for raw in _all_raw():
        out.append(_to_character(raw))
    return out


def get_character(character_id: str) -> Character | None:
    raw = next((c for c in _all_raw() if c["id"] == character_id), None)
    return _to_character(raw) if raw else None


def _to_character(raw: dict[str, Any]) -> Character:
    return Character(
        id=raw["id"],
        name=raw["name"],
        source=CharacterSource(raw.get("source", "stock")),
        thumbnail_url=f"/api/characters/{raw['id']}/thumbnail",
        consented=bool(raw.get("consented", True)),
        tags=list(raw.get("tags", [])),
    )


def get_character_image(character_id: str) -> np.ndarray:
    """Resolve a character id to an HxWx3 uint8 RGB reference image."""
    raw = next((c for c in _all_raw() if c["id"] == character_id), None)
    if raw is None:
        raise KeyError(f"Unknown character: {character_id}")

    rel = raw.get("thumbnail", "")
    # Generated chars store an absolute-ish path relative to characters_dir.
    img_path = cfg.characters_dir / rel
    if not img_path.exists():
        log.warning("Character image missing (%s); using neutral placeholder.", img_path)
        return _placeholder(cfg.output_size)

    import cv2
    bgr = cv2.imread(str(img_path), cv2.IMREAD_COLOR)
    if bgr is None:
        return _placeholder(cfg.output_size)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


# --------------------------------------------------------------------------- generated char lifecycle
def register_generated_character(
    name: str,
    image_png_bytes: bytes,
    source: CharacterSource = CharacterSource.GENERATED,
    tags: list[str] | None = None,
) -> Character:
    """Persist a generated/uploaded character image + manifest entry.

    New chars are consented=False by default — they cannot be driven until the
    creator completes liveness and `mark_consented()` binds them.
    """
    char_id = f"gen-{secrets.token_hex(6)}"
    img_path = _generated_dir() / f"{char_id}.png"
    img_path.write_bytes(image_png_bytes)

    data = _load_generated_manifest()
    entry = {
        "id": char_id,
        "name": name,
        "source": source.value,
        "thumbnail": f"generated/{char_id}.png",
        "consented": False,
        "tags": tags or [],
        "bound_face_hash": None,  # set by mark_consented()
    }
    data.setdefault("characters", []).append(entry)
    _save_generated_manifest(data)
    log.info("registered generated character %s (%s)", char_id, name)
    return _to_character(entry)


def mark_consented(character_id: str, face_hash: str) -> Character:
    """Bind a generated character to a face_hash after liveness. Only works
    for generated/uploaded chars (stock are pre-consented and immutable)."""
    data = _load_generated_manifest()
    entry = next((c for c in data.get("characters", []) if c["id"] == character_id), None)
    if entry is None:
        raise KeyError(
            f"Cannot consent-bind stock or unknown character: {character_id}. "
            "Only generated/uploaded chars are eligible."
        )
    entry["consented"] = True
    entry["bound_face_hash"] = face_hash
    _save_generated_manifest(data)
    log.info("character %s consent-bound to face_hash %s", character_id, face_hash[:12])
    return _to_character(entry)


def _placeholder(size: int) -> np.ndarray:
    """A neutral grey-ish bust so the pipeline runs without real art assets."""
    img = np.full((size, size, 3), 200, dtype=np.uint8)
    import cv2
    cv2.circle(img, (size // 2, int(size * 0.42)), int(size * 0.18), (230, 210, 200), -1)
    cv2.ellipse(img, (size // 2, int(size * 0.78)), (int(size * 0.28), int(size * 0.16)),
                0, 0, 360, (120, 90, 120), -1)
    return img
