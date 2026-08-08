"""File sink for async renders — writes an MP4 via imageio/ffmpeg."""
from __future__ import annotations

from pathlib import Path

import numpy as np


class Mp4Sink:
    def __init__(self, path: Path, fps: int, size: int) -> None:
        self.path = path
        self.fps = fps
        self.size = size
        self._writer = None

    def start(self) -> None:
        import imageio.v2 as imageio
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._writer = imageio.get_writer(
            str(self.path), fps=self.fps, codec="libx264", quality=8, macro_block_size=1
        )

    def send(self, frame: np.ndarray) -> None:
        if self._writer is None:
            return
        import cv2
        if frame.shape[0] != self.size:
            frame = cv2.resize(frame, (self.size, self.size), interpolation=cv2.INTER_AREA)
        self._writer.append_data(frame[:, :, ::-1])  # RGB -> BGR for imageio

    def stop(self) -> None:
        if self._writer is not None:
            self._writer.close()
            self._writer = None
