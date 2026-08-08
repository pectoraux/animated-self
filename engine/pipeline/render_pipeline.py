"""Async render pipeline (Phase 3 — contract stable, impl stubbed).

Live path is video-driven (webcam -> pose -> THA3). Async path is
audio/video-driven -> diffusion -> mp4. They share the character registry and
the consent gate, but use different model backends.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

from config import cfg
from backends import renderer
from characters.registry import get_character_image


class RenderPipeline:
    def render(
        self,
        character_id: str,
        driver_url: str,
        driver_type: str,
        out_mp4: Path,
        progress: Callable[[float], None] | None = None,
    ) -> Path:
        reference_rgb = get_character_image(character_id)
        if driver_type == "audio":
            return renderer.render_audio(reference_rgb, driver_url, out_mp4, progress)
        return renderer.render_video(reference_rgb, driver_url, out_mp4, progress)


render_pipeline = RenderPipeline()
