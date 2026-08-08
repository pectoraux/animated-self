"""THA3 (Talking Head Anime 3) poser wrapper.

This is the neural reenactment backend for the LIVE path: one reference anime
image + a pose vector -> one animated frame.

It deliberately does NOT depend on the THA3 demo's GUI/Training code. You give
it a checkpoint exported by `talking-head-anime-3-demo`'s `export_poser.py`
(which produces a `Poser` `nn.Module` plus its `pose_param_names` list), and
this wrapper handles loading, source-image caching, and inference.

If you don't have a checkpoint, the engine will still start and serve the REST
surface; the live WS will return a clear "model not loaded" error so the
control panel can show a setup prompt rather than a 500.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import numpy as np

from config import cfg


# Canonical THA3 pose-parameter group names (subset). The exact ordered list
# lives in the exported checkpoint's `pose_param_names`; `pose.py` builds a
# dict keyed by these names and we look them up defensively.
THA3_POSE_KEYS: list[str] = [
    # eyes
    "eye_blink_left", "eye_blink_right",
    "eye_look_in_left", "eye_look_out_left",
    "eye_look_in_right", "eye_look_out_right",
    "eye_dilation_left", "eye_dilation_right",
    # brows
    "eyebrow_down_left", "eyebrow_down_right",
    "eyebrow_up_left", "eyebrow_up_right",
    "eyebrow_steep_left", "eyebrow_steep_right",
    # mouth
    "mouth_open", "mouth_smile", "mouth_frown", "mouth_pucker",
    "mouth_lower", "mouth_upper",
    # head rotation (radians)
    "head_pitch", "head_yaw", "head_roll",
]


class ThaPoser:
    """Thin, dependency-light wrapper around a THA3 `Poser` module."""

    def __init__(self) -> None:
        self._loaded = False
        self._poser: Any = None
        self._pose_param_names: list[str] = []
        self._device: str = cfg.device
        # source cache: character_id -> (source_tensor, image_hash)
        self._source_cache: dict[str, tuple[Any, str]] = {}

    # ------------------------------------------------------------------ load
    def load(self) -> None:
        ckpt_path = Path(cfg.tha3_checkpoint)
        if not ckpt_path.exists():
            # Not loaded, but not a crash — app.py surfaces this to the client.
            self._loaded = False
            return
        import torch

        ckpt = torch.load(str(ckpt_path), map_location=self._device, weights_only=False)
        # Expected export shape (see talking-head-anime-3-demo export_poser.py):
        #   {"poser": <nn.Module>, "pose_param_names": [...]}
        self._poser = ckpt["poser"] if isinstance(ckpt, dict) and "poser" in ckpt else ckpt
        self._pose_param_names = (
            ckpt.get("pose_param_names", THA3_POSE_KEYS)
            if isinstance(ckpt, dict) else THA3_POSE_KEYS
        )
        self._poser.to(self._device).eval()
        if cfg.precision == "fp16" and self._device.startswith("cuda"):
            self._poser.half()
        self._loaded = True

    @property
    def loaded(self) -> bool:
        return self._loaded

    @property
    def pose_param_names(self) -> list[str]:
        return self._pose_param_names

    # ----------------------------------------------------------- source image
    def set_source(self, character_id: str, image_rgb: np.ndarray) -> str:
        """Preprocess and cache the reference image for a character.

        THA3 expects a 256x256 (or 512) RGB image normalized to [-1, 1], NCHW.
        We run this ONCE at session start, never per frame.
        """
        import torch
        import cv2

        size = cfg.output_size
        img = cv2.resize(image_rgb, (size, size), interpolation=cv2.INTER_AREA)
        t = torch.from_numpy(img).float().permute(2, 0, 1) / 127.5 - 1.0  # [-1,1]
        t = t.unsqueeze(0).to(self._device)
        if cfg.precision == "fp16" and self._device.startswith("cuda"):
            t = t.half()
        h = hashlib.sha1(img.tobytes()).hexdigest()[:12]
        self._source_cache[character_id] = (t, h)
        return h

    def has_source(self, character_id: str) -> bool:
        return character_id in self._source_cache

    # ------------------------------------------------------------------ infer
    def render(self, character_id: str, pose: dict[str, float]) -> np.ndarray:
        """Run one forward pass. Returns an HxWx3 uint8 RGB frame.

        `pose` is a dict keyed by THA3 param names (see pose.py for the mapping
        from a PoseVector). Missing keys default to 0.0.
        """
        if not self._loaded:
            raise RuntimeError("THA3 model not loaded (checkpoint missing).")
        import torch

        source, _ = self._source_cache[character_id]
        # Build the pose vector in the model's canonical order.
        vec = torch.tensor(
            [[float(pose.get(k, 0.0)) for k in self._pose_param_names]],
            device=self._device,
            dtype=source.dtype,
        )
        with torch.inference_mode():
            out = self._poser(source, vec)
        # THA3 returns a list/tuple of tensors; index [0] is the final image.
        if isinstance(out, (list, tuple)):
            out = out[0]
        out = (out.clamp(-1, 1) * 127.5 + 127.5).to(torch.uint8)
        frame = out.squeeze(0).permute(1, 2, 0).cpu().numpy()
        return np.ascontiguousarray(frame)


# Module-level singleton; app.py constructs and loads it once at startup.
poser = ThaPoser()
