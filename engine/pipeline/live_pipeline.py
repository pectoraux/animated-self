"""Live pipeline — the hot loop: PoseVector -> THA3 frame -> virtual cam.

One LivePipeline per active session. Owns:
  * the character's cached source tensor (set on start),
  * the output sink (virtual cam / preview),
  * drop-too-stale enforcement (latency guardrail).

Dependency injection (finding #4): the poser and sink are injected via the
constructor so the staleness/FPS logic is unit-testable without CUDA or a
virtual-cam driver. `app.py` passes the real `poser` singleton; tests pass a
`FakePoser` and a `FakeSink`.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

from config import cfg
from models import PoseVector, FrameStats
from pipeline.pose import pose_vector_to_tha3
from sinks.virtual_cam import VirtualCamSink, PreviewSink, NullSink


class PoserLike(Protocol):
    """The slice of the THA3 backend the live loop needs. Lets tests inject
    a fake without depending on torch."""
    loaded: bool

    def set_source(self, character_id: str, image_rgb: np.ndarray) -> str: ...
    def render(self, character_id: str, pose: dict[str, float]) -> np.ndarray: ...


@dataclass
class LivePipeline:
    session_id: str
    character_id: str
    output_kind: str = "virtual_cam"
    # Injected (finding #4). Defaults to None and resolved in start() so app.py
    # doesn't have to pass them explicitly; tests pass concrete fakes.
    poser: PoserLike | None = None
    sink: object | None = None
    # diagnostics
    _in_times: list[float] = field(default_factory=list)
    _out_times: list[float] = field(default_factory=list)
    _infer_ms: list[float] = field(default_factory=list)
    _dropped_stale: int = 0
    _last_stats_at: float = 0.0

    def _resolve_poser(self) -> PoserLike:
        if self.poser is not None:
            return self.poser
        # Late import so importing this module doesn't drag torch in for tests.
        from backends import poser as _poser_mod
        return _poser_mod.poser

    def start(self, reference_rgb: np.ndarray) -> None:
        """Cache the source image and open the output sink."""
        poser = self._resolve_poser()
        if not getattr(poser, "loaded", False):
            raise RuntimeError("THA3 model not loaded — cannot start live session.")
        poser.set_source(self.character_id, reference_rgb)
        if self.sink is None:
            self.sink = self._make_sink()
        self.sink.start()
        self._last_stats_at = time.monotonic()

    def _make_sink(self) -> object:
        if self.output_kind == "virtual_cam":
            return VirtualCamSink(cfg.output_size, cfg.target_fps)
        if self.output_kind == "preview":
            return PreviewSink()
        return NullSink()

    def push(self, pose: PoseVector) -> FrameStats | None:
        """Process one pose. Returns FrameStats occasionally (<=1/sec)."""
        now = time.monotonic() * 1000.0
        age = now - pose.ts_ms
        if age > cfg.max_pose_age_ms:
            # Stale: better to skip than to accumulate lag.
            self._dropped_stale += 1
            return None

        tha3_pose = pose_vector_to_tha3(pose)
        poser = self._resolve_poser()
        t0 = time.perf_counter()
        frame = poser.render(self.character_id, tha3_pose)
        infer_ms = (time.perf_counter() - t0) * 1000.0

        assert self.sink is not None
        self.sink.send(frame)

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
            self.sink.stop()
            self.sink = None
