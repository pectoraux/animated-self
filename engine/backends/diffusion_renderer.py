"""Diffusion reenactment backend (Phase 3).

This is the async / quality-mode path: audio + reference image -> high-fidelity
anime video, AniPortrait-style. It is explicitly NOT real-time (minutes per
second of output) — see docs/reality-check.md item 4 — which is why the spec
splits live (THA3, video-pose-driven) from async (diffusion, audio-driven).

Why a subprocess contract instead of a Python API:
Audio-driven anime-style diffusion reenactment (AniPortrait, EchoMimic,
SadTalker-v2) ships as research repos run via CLI scripts, not stable pip
packages with a documented Python import surface, and the exact flags drift
release to release. Rather than hardcode one specific repo's invocation
(which we can't verify without a real checkout + checkpoint to test against —
guessing would just be a confident-sounding fabrication), we define OUR OWN
stable contract: a command template the operator points at whatever
renderer they've actually set up. This is the same pattern tha_poser.py uses
for THA3 — the wrapper and orchestration are real, runnable code; the model
artifact is supplied externally, because we can't bundle or verify it here.

Set DIFFUSION_RENDER_CMD to a template with {reference} {audio} {output}
{size} placeholders, e.g. if you've set up a local AniPortrait-style
checkout with a script that accepts these arguments:

    DIFFUSION_RENDER_CMD="python /path/to/renderer/audio2vid.py \
        --ref_image {reference} --audio {audio} --output {output} \
        --resolution {size}"

Adjust the flags to whatever your actual checkout accepts. The contract we
guarantee on our side: we write the reference image to {reference} as a PNG,
point {audio} at the driver audio file, expect an MP4 to exist at {output}
when the process exits 0, and treat any other exit code as failure (stderr
surfaced in the RenderJob's error field).
"""
from __future__ import annotations

import logging
import shlex
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

import numpy as np

from config import cfg

log = logging.getLogger("animated-self.diffusion")


class DiffusionRenderer:
    @property
    def loaded(self) -> bool:
        """True if an external renderer command is configured. There's no
        checkpoint to "load" on our side — the subprocess owns its own model
        lifecycle — so this just reflects whether the contract is wired up.
        Read from cfg dynamically (not snapshotted at init) so tests can
        monkeypatch it without reconstructing the module-level singleton."""
        return bool(cfg.diffusion_render_cmd)

    def render_audio(
        self,
        reference_rgb: np.ndarray,
        audio_path: str,
        out_mp4: Path,
        progress: Callable[[float], None] | None = None,
    ) -> Path:
        cmd_template = cfg.diffusion_render_cmd
        if not cmd_template:
            raise RuntimeError(
                "DIFFUSION_RENDER_CMD is not set — Phase 3 quality mode needs "
                "an external audio-driven diffusion renderer configured. See "
                "engine/backends/diffusion_renderer.py for the contract."
            )
        if not Path(audio_path).exists():
            raise RuntimeError(f"audio driver file not found: {audio_path}")

        out_mp4.parent.mkdir(parents=True, exist_ok=True)
        if progress:
            progress(0.05)

        with tempfile.TemporaryDirectory() as tmp:
            ref_path = Path(tmp) / "reference.png"
            import cv2
            cv2.imwrite(str(ref_path), reference_rgb[:, :, ::-1])

            cmd_str = cmd_template.format(
                reference=str(ref_path),
                audio=str(audio_path),
                output=str(out_mp4),
                size=cfg.output_size,
            )
            log.info("diffusion render: %s", cmd_str)
            try:
                result = subprocess.run(
                    shlex.split(cmd_str),
                    capture_output=True,
                    text=True,
                    timeout=cfg.diffusion_render_timeout_s,
                )
            except subprocess.TimeoutExpired as e:
                raise RuntimeError(
                    f"diffusion render exceeded {cfg.diffusion_render_timeout_s}s timeout"
                ) from e
            if result.returncode != 0:
                raise RuntimeError(
                    f"diffusion renderer failed (exit {result.returncode}): "
                    f"{result.stderr.strip()[-500:]}"
                )
        if not out_mp4.exists():
            raise RuntimeError(
                "diffusion renderer exited 0 but did not produce the expected "
                f"output file: {out_mp4}"
            )
        if progress:
            progress(1.0)
        return out_mp4

    def render_video(
        self,
        reference_rgb: np.ndarray,
        driver_video: str,
        out_mp4: Path,
        progress: Callable[[float], None] | None = None,
    ) -> Path:
        # Video re-drive (higher-fidelity re-render from a recorded
        # performance rather than live audio) is a separate model/pipeline
        # concern from audio-driven synthesis above, and isn't part of the
        # Phase 3 roadmap scope ("AniPortrait-style audio-driven
        # reenactment"). Left as a stub rather than guessed at.
        raise NotImplementedError(
            "Video re-drive quality mode is not scoped in Phase 3 (audio-driven "
            "only). The API contract (RenderRequest.driver='video') exists for "
            "a future phase."
        )


renderer = DiffusionRenderer()
