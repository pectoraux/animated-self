"""Sinks package."""
from .virtual_cam import VirtualCamSink, PreviewSink, NullSink
from .file_sink import Mp4Sink

__all__ = ["VirtualCamSink", "PreviewSink", "NullSink", "Mp4Sink"]
