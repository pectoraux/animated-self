"""Tests for LivePipeline staleness + stats logic (finding #4).

Uses dependency injection: a FakePoser + FakeSink so these run without CUDA,
torch, or a virtual-cam driver. Covers:
  * stale pose (>max_pose_age_ms) is dropped, increments dropped_stale, returns None.
  * fresh pose is rendered and sent to the sink.
  * FrameStats is emitted at most once per second.
  * budget_warning flips when avg infer exceeds the frame budget.
"""
from __future__ import annotations

import time

import numpy as np
import pytest

from models import PoseVector, HeadPose, EyeState, MouthState
from pipeline.live_pipeline import LivePipeline


class FakePoser:
    """Stand-in for the THA3 backend. Records calls; returns a fixed frame."""
    def __init__(self, infer_ms: float = 5.0):
        self.loaded = True
        self._infer_ms = infer_ms
        self.sources: dict[str, str] = {}
        self.renders: list[tuple[str, dict[str, float]]] = []

    def set_source(self, character_id: str, image_rgb: np.ndarray) -> str:
        h = f"src-{character_id}"
        self.sources[character_id] = h
        return h

    def render(self, character_id: str, pose: dict[str, float]) -> np.ndarray:
        # Simulate inference time so budget_warning is testable.
        if self._infer_ms > 0:
            time.sleep(self._infer_ms / 1000.0)
        self.renders.append((character_id, pose))
        return np.zeros((64, 64, 3), dtype=np.uint8)


class FakeSink:
    def __init__(self):
        self.frames: list[np.ndarray] = []
        self.started = False
        self.stopped = False

    def start(self): self.started = True
    def send(self, frame): self.frames.append(frame)
    def stop(self): self.stopped = True


def _pose(ts_ms: int | None = None) -> PoseVector:
    return PoseVector(
        ts_ms=ts_ms if ts_ms is not None else int(time.monotonic() * 1000),
        head=HeadPose(), left_eye=EyeState(), right_eye=EyeState(), mouth=MouthState(),
    )


def test_start_refuses_unloaded_model():
    poser = FakePoser()
    poser.loaded = False
    pipe = LivePipeline("s1", "stock-aoi", poser=poser, sink=FakeSink())
    with pytest.raises(RuntimeError, match="model not loaded"):
        pipe.start(np.zeros((64, 64, 3), dtype=np.uint8))


def test_start_caches_source_and_opens_sink():
    poser = FakePoser()
    sink = FakeSink()
    pipe = LivePipeline("s1", "stock-aoi", poser=poser, sink=sink)
    pipe.start(np.zeros((64, 64, 3), dtype=np.uint8))
    assert sink.started
    assert "stock-aoi" in poser.sources
    pipe.stop()
    assert sink.stopped


def test_stale_pose_dropped_not_rendered():
    poser = FakePoser()
    sink = FakeSink()
    pipe = LivePipeline("s1", "stock-aoi", poser=poser, sink=sink)
    pipe.start(np.zeros((64, 64, 3), dtype=np.uint8))
    # Pose timestamped 1 second in the past -> well past max_pose_age_ms (120ms).
    stale = _pose(ts_ms=int(time.monotonic() * 1000) - 1000)
    result = pipe.push(stale)
    assert result is None
    assert len(poser.renders) == 0          # never rendered
    assert len(sink.frames) == 0            # never sent to sink
    assert pipe._dropped_stale == 1


def test_fresh_pose_rendered_and_sent():
    poser = FakePoser()
    sink = FakeSink()
    pipe = LivePipeline("s1", "stock-aoi", poser=poser, sink=sink)
    pipe.start(np.zeros((64, 64, 3), dtype=np.uint8))
    pipe.push(_pose())  # fresh
    assert len(poser.renders) == 1
    assert len(sink.frames) == 1


def test_stats_emitted_at_most_once_per_second():
    poser = FakePoser(infer_ms=0)
    sink = FakeSink()
    pipe = LivePipeline("s1", "stock-aoi", poser=poser, sink=sink)
    pipe.start(np.zeros((64, 64, 3), dtype=np.uint8))
    # Push several within the same second -> at most one stats return.
    stats_seen = 0
    for _ in range(5):
        if pipe.push(_pose()) is not None:
            stats_seen += 1
    assert stats_seen <= 1


def test_budget_warning_when_infer_exceeds_frame_budget():
    # Frame budget at 30fps = ~33ms. Fake 50ms inference -> warning.
    poser = FakePoser(infer_ms=50)
    sink = FakeSink()
    pipe = LivePipeline("s1", "stock-aoi", poser=poser, sink=sink)
    pipe.start(np.zeros((64, 64, 3), dtype=np.uint8))
    # Force the stats snapshot path by rewinding _last_stats_at.
    pipe._last_stats_at = time.monotonic() - 2.0
    stats = pipe.push(_pose())
    assert stats is not None
    assert stats.infer_ms >= 40
    assert stats.budget_warning is True


def test_dropped_stale_counter_accumulates_across_frames():
    poser = FakePoser()
    sink = FakeSink()
    pipe = LivePipeline("s1", "stock-aoi", poser=poser, sink=sink)
    pipe.start(np.zeros((64, 64, 3), dtype=np.uint8))
    for _ in range(3):
        pipe.push(_pose(ts_ms=int(time.monotonic() * 1000) - 1000))
    assert pipe._dropped_stale == 3
    assert len(sink.frames) == 0
