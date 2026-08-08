"""Voice conversion backends (Phase 4).

Transforms the creator's mic audio to sound like the avatar's voice.
Optional stage — if not configured, everything works without it.

Two backends, same pattern as diffusion_renderer.py:

  * ExternalCommandConverter — runs VOICE_CONVERT_CMD (an RVC CLI, or
    anything honoring the same audio-in, audio-out contract). The operator
    configures it; we don't bundle or verify a specific model. Same reasoning
    as DIFFUSION_RENDER_CMD: RVC and its forks ship as CLI scripts with flags
    that drift release to release, so we define our own stable contract.
  * CloudConverter — BYOK (e.g. ElevenLabs / Resemble). The user supplies an
    API key per-request; the engine never persists it. Same BYOK contract as
    character_gen.py's OpenAIProvider.

No "demo" converter that fakes output. If no converter is configured, voice
conversion is simply unavailable (loaded=False) — not silently bypassed, not
faked. This is deliberate: a fake voice converter would be dishonest on a
project whose pitch is not overclaiming.

Consent: voice conversion tied to a character goes through the same
_enforce_consent_gate in app.py as live sessions and async renders — no
parallel check. See app.py's /api/voice/convert and /ws/voice.
"""
from __future__ import annotations

import logging
import os
import shlex
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import Callable, Protocol

import numpy as np

from config import cfg

log = logging.getLogger("animated-self.voice")


class VoiceConverter(Protocol):
    """Transforms an audio file into a converted audio file."""
    loaded: bool

    def convert(
        self,
        input_audio: Path,
        output_audio: Path,
        progress: Callable[[float], None] | None = None,
        api_key: str | None = None,
    ) -> Path: ...


# --------------------------------------------------------------------------- ExternalCommandConverter
class ExternalCommandConverter:
    """Runs VOICE_CONVERT_CMD — an RVC CLI or anything honoring the contract.

    The command template receives:
      {input}  — path to the input audio file
      {output} — path where the converted audio must be written

    The command must produce a valid audio file at {output}. Non-zero exit or
    a missing output file both fail cleanly with the subprocess's stderr.

    Same pattern as DiffusionRenderer's DIFFUSION_RENDER_CMD: we can't verify
    a specific RVC fork's exact flags, so we define our own stable contract.
    """

    def __init__(self) -> None:
        self._cmd = os.getenv("VOICE_CONVERT_CMD", "")
        self._loaded = bool(self._cmd)

    def load(self) -> None:
        self._cmd = os.getenv("VOICE_CONVERT_CMD", "")
        self._loaded = bool(self._cmd)
        if self._loaded:
            log.info("ExternalCommandConverter loaded: %s", self._cmd[:80])
        else:
            log.info("VOICE_CONVERT_CMD unset — voice conversion unavailable")

    @property
    def loaded(self) -> bool:
        return self._loaded

    def convert(
        self,
        input_audio: Path,
        output_audio: Path,
        progress: Callable[[float], None] | None = None,
        api_key: str | None = None,  # ignored — external command doesn't need a key
    ) -> Path:
        if not self._loaded:
            raise RuntimeError(
                "Voice converter not configured (VOICE_CONVERT_CMD unset)."
            )
        cmd = self._cmd.format(input=str(input_audio), output=str(output_audio))
        log.info("running voice conversion: %s", cmd[:120])
        # No shell=True: input/output are engine-generated safe paths today,
        # but shell=True is a latent injection surface the moment anything
        # user-influenced ever gets threaded into this template. diffusion_
        # renderer.py made the same call for the same reason — keep both
        # external-command backends on the same footing.
        result = subprocess.run(
            shlex.split(cmd), capture_output=True, text=True, timeout=600,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"VOICE_CONVERT_CMD failed (exit {result.returncode}): "
                f"{result.stderr.strip()[:300]}"
            )
        if not output_audio.exists():
            raise RuntimeError(
                f"VOICE_CONVERT_CMD did not produce output at {output_audio}"
            )
        if progress:
            progress(1.0)
        return output_audio


# --------------------------------------------------------------------------- CloudConverter (BYOK)
class CloudConverter:
    """BYOK cloud voice conversion (e.g. ElevenLabs, Resemble).

    The user supplies an api_key per-request; the engine never persists it.
    Same BYOK contract as character_gen.py's OpenAIProvider.

    The provider is selected via VOICE_CLOUD_PROVIDER (elevenlabs|resemble|...).
    Each provider has its own request format; we implement the call directly
    rather than depending on a provider SDK (SDKs drift, and we can't verify
    them without real keys). The contract: audio in, audio out, key per-request.
    """

    def __init__(self) -> None:
        self._loaded = False

    def load(self) -> None:
        # Cloud converter is "loaded" when a provider is configured. The key
        # itself is per-request (BYOK), not at load time.
        self._provider = os.getenv("VOICE_CLOUD_PROVIDER", "")
        self._loaded = bool(self._provider)
        if self._loaded:
            log.info("CloudConverter loaded: provider=%s (BYOK key per-request)", self._provider)

    @property
    def loaded(self) -> bool:
        return self._loaded

    def convert(
        self,
        input_audio: Path,
        output_audio: Path,
        progress: Callable[[float], None] | None = None,
        api_key: str | None = None,
    ) -> Path:
        if not self._loaded:
            raise RuntimeError(
                "Cloud voice converter not configured (VOICE_CLOUD_PROVIDER unset)."
            )
        if not api_key:
            raise ValueError("Cloud voice conversion requires an api_key (BYOK).")
        if self._provider == "elevenlabs":
            return self._convert_elevenlabs(input_audio, output_audio, api_key, progress)
        raise RuntimeError(f"Unknown voice cloud provider: {self._provider}")

    def _convert_elevenlabs(
        self,
        input_audio: Path,
        output_audio: Path,
        api_key: str,
        progress: Callable[[float], None] | None,
    ) -> Path:
        """ElevenLabs voice conversion via direct HTTPS.

        Uses the speech-to-speech endpoint. The user's api_key is sent
        per-request and never persisted. We read the input audio, POST it,
        and write the response body to output_audio.
        """
        # ElevenLabs speech-to-speech: POST /v1/speech-to-speech/{voice_id}
        voice_id = os.getenv("ELEVENLABS_VOICE_ID", "")
        if not voice_id:
            raise RuntimeError("ELEVENLABS_VOICE_ID unset — required for ElevenLabs conversion")
        url = f"https://api.elevenlabs.io/v1/speech-to-speech/{voice_id}"
        audio_bytes = Path(input_audio).read_bytes()
        req = urllib.request.Request(
            url,
            data=audio_bytes,
            headers={
                "xi-api-key": api_key,
                "Content-Type": "audio/mpeg",
                "Accept": "audio/mpeg",
            },
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            output_audio.write_bytes(resp.read())
        if progress:
            progress(1.0)
        return output_audio


# --------------------------------------------------------------------------- selection
_CONVERTERS: dict[str, VoiceConverter] = {
    "external": ExternalCommandConverter(),
    "cloud": CloudConverter(),
}
_active: VoiceConverter | None = None


def get_converter() -> VoiceConverter | None:
    """Returns the configured converter, or None if voice conversion is off.

    Selection priority:
      1. VOICE_CONVERT_CMD set  -> ExternalCommandConverter
      2. VOICE_CLOUD_PROVIDER set -> CloudConverter
      3. Neither set -> None (voice conversion unavailable, not faked)
    """
    global _active
    if _active is not None:
        return _active
    if os.getenv("VOICE_CONVERT_CMD"):
        _active = _CONVERTERS["external"]
    elif os.getenv("VOICE_CLOUD_PROVIDER"):
        _active = _CONVERTERS["cloud"]
    else:
        _active = None
        return None
    try:
        _active.load()
    except Exception as e:  # noqa: BLE001
        log.warning("voice converter load failed: %s", e)
        _active = None
    return _active


# Backward-compat: module-level converter singleton (None if unconfigured).
converter = None  # resolved lazily via get_converter()
