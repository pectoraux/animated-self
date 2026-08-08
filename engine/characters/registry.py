"""Stock character registry.

A character is just an opaque `id` that the engine resolves to a reference
RGB image. Phase 1 ships bundled PNGs; Phase 2 (custom generation) adds
entries to the same registry without changing the inference layer.

If a stock PNG is missing we synthesize a neutral placeholder so the engine
still runs end-to-end during development (clearly marked in logs).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np

from config import cfg
from models import Character, CharacterSource

log = logging.getLogger("animated-self.characters")
_MANIFEST: dict[str, Any] | None = None


def _manifest_path() -> Path:
    return cfg.characters_dir / "manifest.json"


def _load_manifest() -> dict[str, Any]:
    global _MANIFEST
    if _MANIFEST is None:
        path = _manifest_path()
        if path.exists():
            _MANIFEST = json.loads(path.read_text())
        else:
            _MANIFEST = {"version": 0, "characters": []}
    return _MANIFEST


def list_characters() -> list[Character]:
    out: list[Character] = []
    for raw in _load_manifest().get("characters", []):
        out.append(
            Character(
                id=raw["id"],
                name=raw["name"],
                source=CharacterSource(raw.get("source", "stock")),
                thumbnail_url=f"/api/characters/{raw['id']}/thumbnail",
                consented=bool(raw.get("consented", True)),
                tags=list(raw.get("tags", [])),
            )
        )
    return out


def get_character_image(character_id: str) -> np.ndarray:
    """Resolve a character id to an HxWx3 uint8 RGB reference image."""
    raw = next(
        (c for c in _load_manifest().get("characters", []) if c["id"] == character_id),
        None,
    )
    if raw is None:
        raise KeyError(f"Unknown character: {character_id}")

    rel = raw.get("thumbnail", "")
    img_path = cfg.characters_dir / rel
    if not img_path.exists():
        log.warning("Character image missing (%s); using neutral placeholder.", img_path)
        return _placeholder(cfg.output_size)

    import cv2
    bgr = cv2.imread(str(img_path), cv2.IMREAD_COLOR)
    if bgr is None:
        return _placeholder(cfg.output_size)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def _placeholder(size: int) -> np.ndarray:
    """A neutral grey-ish bust so the pipeline runs without real art assets."""
    img = np.full((size, size, 3), 200, dtype=np.uint8)
    # crude face circle
    import cv2
    cv2.circle(img, (size // 2, int(size * 0.42)), int(size * 0.18), (230, 210, 200), -1)
    cv2.ellipse(img, (size // 2, int(size * 0.78)), (int(size * 0.28), int(size * 0.16)),
                0, 0, 360, (120, 90, 120), -1)
    return img
