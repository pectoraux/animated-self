"""Diffusion reenactment backend (Phase 3 — RESEARCH STAGE).

This is the async / quality-mode path: audio + reference image -> high-fidelity
anime video, AniPortrait-style. It is explicitly NOT real-time (minutes per
second of output) and is why the spec splits live vs. async.

Why it's a stub now:
  * No open-source model reliably hits anime-style, audio-driven, lip-synced
    reenactment at interactive speed. AniPortrait / EchoMimic / SadTalker are
    the closest but are (a) not anime-native without fine-tuning and (b) far
    too slow for live. We ship the *contract* (RenderRequest/RenderJob) in
    Phase 1 so the control panel and engine API don't change when this lands.

When Phase 3 lands, implement:
  * load()  -> load diffusion checkpoint, scheduler
  * render_audio(reference_image, audio_path, out_mp4, progress_cb)
  * render_video(reference_image, driver_video, out_mp4, progress_cb)
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

import numpy as np


class DiffusionRenderer:
    def __init__(self) -> None:
        self._loaded = False

    def load(self) -> None:
        # Phase 3: torch.load(cfg.diffusion_checkpoint), build pipeline.
        self._loaded = False

    @property
    def loaded(self) -> bool:
        return self._loaded

    def render_audio(
        self,
        reference_rgb: np.ndarray,
        audio_path: str,
        out_mp4: Path,
        progress: Callable[[float], None] | None = None,
    ) -> Path:
        raise NotImplementedError(
            "Diffusion quality mode ships in Phase 3. The API contract is stable; "
            "see engine/models.py::RenderRequest."
        )

    def render_video(
        self,
        reference_rgb: np.ndarray,
        driver_video: str,
        out_mp4: Path,
        progress: Callable[[float], None] | None = None,
    ) -> Path:
        raise NotImplementedError(
            "Video re-drive quality mode ships in Phase 3."
        )


renderer = DiffusionRenderer()
