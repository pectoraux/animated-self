"""Character generation backends (Phase 2).

A "provider" turns either a text prompt or a selfie image into an anime-style
reference character image (PNG bytes). The engine is provider-agnostic; the
control panel selects a provider and supplies a key per-request.

BYOK is the contract: the app never holds or bills for model usage. Two
providers ship:

  * OpenAIProvider  — REAL BYOK. Calls DALL-E 3 with the user's API key via
    direct HTTPS. The engine never persists the key. Won't work in the
    sandbox without a real user key, but the code path is production-real.
  * DemoProvider    — NOT BYOK. Shells out to the `z-ai` CLI, which uses the
    platform's key. Exists so the demo is runnable without a user key.
    Gated behind ENABLE_BUILTIN_GEN_PROVIDER (default true in dev; must be
    false in prod). Clearly labeled in the UI as "demo (uses platform key)".

The selfie→anime route is description-based, not pixel-level identity transfer:
the provider uses a VLM to describe the selfie's features, then generates an
anime character matching that description. Honest about this — real identity-
preserving img2img (ControlNet) is a Phase 3+ concern and needs a BYOK model
that supports image input.
"""
from __future__ import annotations

import base64
import json
import logging
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import Protocol

from config import cfg

log = logging.getLogger("animated-self.char-gen")


class GenProvider(Protocol):
    """Turn a prompt or selfie into anime character PNG bytes."""
    id: str
    byok: bool  # True = user supplies key; False = demo/platform key

    def generate_from_prompt(self, prompt: str, key: str | None) -> bytes: ...
    def generate_from_selfie(self, selfie_rgb_bytes: bytes, key: str | None) -> bytes: ...


# --------------------------------------------------------------------------- helpers
def _anime_prompt(text: str) -> str:
    """Wrap a user prompt in anime-style framing for THA3-compatible output.

    THA3 expects a front-facing head-and-shoulders portrait; we bias the
    prompt toward that so the generated image drives well.
    """
    return (
        f"{text}, anime style, front-facing head and shoulders portrait, "
        f"neutral expression, clean simple background, high quality, "
        f"centered composition, suitable as an avatar reference image"
    )


# --------------------------------------------------------------------------- OpenAI (real BYOK)
class OpenAIProvider:
    """DALL-E 3 via direct HTTPS. The user's key is sent per-request and never
    persisted. This is the production BYOK path."""

    id = "openai"
    byok = True
    _URL = "https://api.openai.com/v1/images/generations"

    def generate_from_prompt(self, prompt: str, key: str | None) -> bytes:
        if not key:
            raise ValueError("OpenAI provider requires an API key (BYOK).")
        body = json.dumps({
            "model": "dall-e-3",
            "prompt": _anime_prompt(prompt),
            "n": 1,
            "size": "1024x1024",
            "response_format": "b64_json",
        }).encode()
        req = urllib.request.Request(
            self._URL,
            data=body,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        b64 = data["data"][0]["b64_json"]
        return base64.b64decode(b64)

    def generate_from_selfie(self, selfie_rgb_bytes: bytes, key: str | None) -> bytes:
        # DALL-E 3 doesn't accept image input; we describe the selfie via VLM
        # then generate. Honest limitation: this is description-based, not
        # pixel-level identity preservation.
        from backends.vlm_describe import describe_face_for_anime
        description = describe_face_for_anime(selfie_rgb_bytes)
        return self.generate_from_prompt(
            f"anime character based on: {description}", key
        )


# --------------------------------------------------------------------------- Demo (platform key, NOT BYOK)
class DemoProvider:
    """Uses the `z-ai` CLI (platform key). Runnable in the sandbox so the
    demo works without a user key. MUST be disabled in production via
    ENABLE_BUILTIN_GEN_PROVIDER=false — it violates the BYOK contract by
    design (the app bills for generation)."""

    id = "demo"
    byok = False

    def generate_from_prompt(self, prompt: str, key: str | None) -> bytes:
        return self._run_cli(_anime_prompt(prompt))

    def generate_from_selfie(self, selfie_rgb_bytes: bytes, key: str | None) -> bytes:
        from backends.vlm_describe import describe_face_for_anime
        description = describe_face_for_anime(selfie_rgb_bytes)
        return self._run_cli(_anime_prompt(f"anime character based on: {description}"))

    def _run_cli(self, prompt: str) -> bytes:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            out_path = tmp.name
        try:
            result = subprocess.run(
                ["z-ai", "image", "--prompt", prompt, "--output", out_path, "--size", "1024x1024"],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode != 0:
                raise RuntimeError(f"z-ai CLI failed: {result.stderr.strip()[:200]}")
            return Path(out_path).read_bytes()
        finally:
            Path(out_path).unlink(missing_ok=True)


# --------------------------------------------------------------------------- registry of providers
_PROVIDERS: dict[str, GenProvider] = {
    "openai": OpenAIProvider(),
    "demo": DemoProvider(),
}


def get_provider(provider_id: str) -> GenProvider:
    p = _PROVIDERS.get(provider_id)
    if p is None:
        raise KeyError(f"Unknown generation provider: {provider_id}")
    return p


def list_providers() -> list[dict[str, object]]:
    """Provider metadata for the control panel's provider selector."""
    demo_enabled = cfg.enable_builtin_gen_provider
    out = []
    for pid, p in _PROVIDERS.items():
        if pid == "demo" and not demo_enabled:
            continue
        out.append({
            "id": p.id,
            "byok": p.byok,
            "requires_key": p.byok,
            "label": "OpenAI DALL-E 3 (bring your key)" if p.byok else "Demo (platform key — dev only)",
        })
    return out
