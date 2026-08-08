"""VLM-based face description for the selfie→anime route.

Uses the z-ai vision CLI to describe a selfie's visible features (hair, eyes,
face shape) so the character-gen provider can build an anime prompt. This is
honestly description-based, NOT pixel-level identity preservation — real
identity-preserving img2img needs a BYOK model that accepts image input
(Phase 3+).
"""
from __future__ import annotations

import base64
import json
import subprocess
import tempfile
from pathlib import Path


def describe_face_for_anime(selfie_rgb_bytes: bytes) -> str:
    """Return a concise description of visible facial features suitable for
    building an anime character prompt."""
    # Write to a temp file and call the z-ai vision CLI.
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(selfie_rgb_bytes)
        img_path = tmp.name
    try:
        result = subprocess.run(
            [
                "z-ai", "vision",
                "--prompt",
                "Describe this person's visible features for an anime character "
                "design: hair color and style, eye color, skin tone, face shape, "
                "and any distinctive features. Be concise (one sentence). Do not "
                "describe clothing or background.",
                "--image", img_path,
            ],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            return "a person with neutral features"
        # The CLI prints a JSON response; extract the content.
        out = result.stdout
        try:
            # Try to parse the JSON blob the CLI emits.
            data = json.loads(out[out.index("{"):])
            return data["choices"][0]["message"]["content"].strip()
        except (ValueError, KeyError, json.JSONDecodeError):
            # Fall back to raw stdout if parsing fails.
            return out.strip()[:200] or "a person with neutral features"
    finally:
        Path(img_path).unlink(missing_ok=True)
