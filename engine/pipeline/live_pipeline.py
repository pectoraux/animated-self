"""Live pipeline — the hot loop: PoseVector -> THA3 frame -> virtual cam.

One LivePipeline per active session. Owns:
  * the character's cached source tensor (set on start),
  * the output sink (virtual cam / preview),
  * drop-too-stale enforcement (latency guardrail).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from config import cfg
from models import PoseVector, FrameStats
from backends import poser
from pipeline.pose import pose_vector_to_tha3
from sinks.virtual_cam import VirtualCamSink, PreviewSink, NullSink


@dataclass
class LivePipeline:
    session_id: str
    character_id: str
    output_kind: str = "virtual_cam"
    sink: object | None = None
    # diagnostics
    _in_times: list[float] = field(default_factory=list)
    _out_times: list[float] = field(default_factory=list)
    _infer_ms: list[float] = field(default_factory=list)
    _dropped_stale: int = 0
    _last_stats_at: float = 0.0

    def start(self, reference_rgb: np.ndarray) -> None:
        """Cache the source image and open the output sink."""
        if not poser.loaded:
            raise RuntimeError("THA3 model not loaded — cannot start live session.")
        poser.set_source(self.character_id, reference_rgb)
        if self.output_kind == "virtual_cam":
            self.sink = VirtualCamSink(cfg.output_size, cfg.target_fps)
        elif self.output_kind == "preview":
            self.sink = PreviewSink()
        else:
            self.sink = NullSink()
        self.sink.start()
        self._last_stats_at = time.monotonic()

    def push(self, pose: PoseVector) -> FrameStats | None:
        """Process one pose. Returns FrameStats occasionally (<=1/sec)."""
        now = time.monotonic() * 1000.0
        age = now - pose.ts_ms
        if age > cfg.max_pose_age_ms:
            # Stale: better to skip than to accumulate lag.
            self._dropped_stale += 1
            return None

        tha3_pose = pose_vector_to_tha3(pose)
        t0 = time.perf_counter()
        frame = poser.render(self.character_id, tha3_pose)
        infer_ms = (time.perf_counter() - t0) * 1000.0

        self.sink.send(frame)  # type: ignore[union-attr]

        self._in_times.append(now)
        self._out_times.append(time.monotonic() * 1000.0)
        self._infer_ms.append(infer_ms)
        # bounded history
        if len(self._in_times) > 120:
            self._in_times = self._in_times[-120:]
            self._out_times = self._out_times[-120:]
            self._infer_ms = self._infer_ms[-120:]

        if now - self._last_stats_at >= 1000.0:
            stats = self._snapshot()
            self._last_stats_at = now
            return stats
        return None

    def _snapshot(self) -> FrameStats:
        def fps(times: list[float]) -> float:
            if len(times) < 2:
                return 0.0
            span = (times[-1] - times[0]) / 1000.0
            return (len(times) - 1) / span if span > 0 else 0.0

        avg_infer = sum(self._infer_ms) / max(1, len(self._infer_ms))
        return FrameStats(
            fps_in=fps(self._in_times),
            fps_out=fps(self._out_times),
            infer_ms=avg_infer,
            queue_depth=0,
            dropped_stale=self._dropped_stale,
            budget_warning=avg_infer > (1000.0 / cfg.target_fps),
        )

    def stop(self) -> None:
        if self.sink is not None:
            self.sink.stop()  # type: ignore[union-attr]
            self.sink = None
