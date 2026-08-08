"""Output sinks. The live pipeline writes to exactly one of these.

  * VirtualCamSink  -> OBS Virtual Camera / v4l2loopback (the real distribution channel)
  * PreviewSink     -> holds the latest frame for the in-app preview (JPEG polled)
  * NullSink        -> dev / no-op
"""
from __future__ import annotations

import io
import threading
from typing import Any

import numpy as np

from config import cfg


class NullSink:
    def start(self) -> None: ...
    def send(self, frame: np.ndarray) -> None: ...
    def stop(self) -> None: ...


class VirtualCamSink:
    """Writes frames to the OBS Virtual Camera via pyvirtualcam.

    Requires (documented in engine/README.md):
      * Windows/macOS: OBS Studio installed (provides "OBS Virtual Camera")
      * Linux: v4l2loopback kernel module loaded (e.g. /dev/video99)
    pyvirtualcam auto-selects the backend; override with cfg.virtual_cam_backend.
    """

    def __init__(self, size: int, fps: int) -> None:
        self.size = size
        self.fps = fps
        self._cam: Any = None

    def start(self) -> None:
        import pyvirtualcam

        self._cam = pyvirtualcam.Camera(
            width=self.size,
            height=self.size,
            fps=self.fps,
            device=cfg.virtual_cam_device,
            backend=cfg.virtual_cam_backend,
            fmt=pyvirtualcam.PixelFormat.RGB,
        )

    def send(self, frame: np.ndarray) -> None:
        if self._cam is None:
            return
        # pyvirtualcam wants contiguous uint8 RGB HxWx3
        if frame.shape[0] != self.size or frame.shape[1] != self.size:
            import cv2
            frame = cv2.resize(frame, (self.size, self.size), interpolation=cv2.INTER_AREA)
        self._cam.send(np.ascontiguousarray(frame.astype(np.uint8)))
        # Optional: self._cam.send_and_wait() to throttle to fps — we DON'T,
        # because the live pipeline is push-driven and we don't want to block
        # inference on the sink. pyvirtualcam internally double-buffers.

    def stop(self) -> None:
        if self._cam is not None:
            self._cam.close()
            self._cam = None


class PreviewSink:
    """Holds the latest rendered frame for an in-app preview endpoint.

    The control panel polls /api/session/{id}/preview.jpg (throttled) to show
    what the avatar looks like WITHOUT routing video back over the WS — that
    would eat the latency budget. Preview is opt-in and never blocks inference.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._frame: np.ndarray | None = None

    def start(self) -> None: ...

    def send(self, frame: np.ndarray) -> None:
        with self._lock:
            self._frame = frame.copy()

    def jpeg(self, quality: int = 60) -> bytes | None:
        with self._lock:
            if self._frame is None:
                return None
            import cv2
            ok, buf = cv2.imencode(".jpg", self._frame[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, quality])
            return buf.tobytes() if ok else None

    def stop(self) -> None:
        with self._lock:
            self._frame = None
