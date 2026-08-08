"""Async render pipeline (Phase 3).

Live path is video-driven (webcam -> pose -> THA3). Async path is
audio-driven -> diffusion -> mp4. They share the character registry and the
consent gate, but use different model backends.

The renderer is injected (same reasoning as pipeline/live_pipeline.py's
PoserLike DI: unit tests should be able to exercise this without a real
diffusion checkpoint, AND at least one test should exercise the actual
production resolution path, not just the injected fake — that's the gap that
let a real bug through in the live pipeline).
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Protocol

import numpy as np

from characters.registry import get_character_image


class RendererLike(Protocol):
    """The slice of the diffusion backend the render pipeline needs."""
    loaded: bool

    def render_audio(
        self, reference_rgb: np.ndarray, audio_path: str, out_mp4: Path,
        progress: Callable[[float], None] | None,
    ) -> Path: ...


class RenderPipeline:
    def __init__(self, renderer: RendererLike | None = None) -> None:
        self._renderer = renderer

    def _resolve_renderer(self) -> RendererLike:
        if self._renderer is not None:
            return self._renderer
        from backends import renderer as _renderer_mod
        return _renderer_mod

    def render(
        self,
        character_id: str,
        driver_url: str,
        driver_type: str,
        out_mp4: Path,
        progress: Callable[[float], None] | None = None,
    ) -> Path:
        renderer = self._resolve_renderer()
        if not renderer.loaded:
            raise RuntimeError(
                "Diffusion renderer not configured (DIFFUSION_RENDER_CMD unset)."
            )
        reference_rgb = get_character_image(character_id)
        if driver_type != "audio":
            raise RuntimeError(f"Unsupported render driver type: {driver_type}")
        return renderer.render_audio(reference_rgb, driver_url, out_mp4, progress)


render_pipeline = RenderPipeline()
