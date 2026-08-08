"""Engine configuration.

All knobs are env-driven so the same image runs on any developer's box.
The control panel reads none of this directly — it discovers the engine via
the gateway (`?XTransformPort=3031`) and the REST surface in `app.py`.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


ENGINE_ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class EngineConfig:
    # --- Process ---
    host: str = os.getenv("ENGINE_HOST", "127.0.0.1")
    port: int = int(os.getenv("ENGINE_PORT", "3031"))

    # --- Model backend ---
    # Path to the THA3 poser checkpoint. In Phase 1 we expect a single exported
    # `.pt` produced by talking-head-anime-3-demo's `export_poser.py`.
    tha3_checkpoint: str = os.getenv(
        "THA3_CHECKPOINT", str(ENGINE_ROOT / "checkpoints" / "tha3.pt")
    )
    device: str = os.getenv("ENGINE_DEVICE", "cuda")  # "cuda" | "cpu" (cpu will miss the latency budget)
    # Model precision: "fp32" is safest for THA3; "fp16" halves VRAM and ~1.5x
    # faster on Ampere+ but can shimmer on some checkpoints.
    precision: str = os.getenv("ENGINE_PRECISION", "fp32")

    # --- Output frame ---
    # THA3 natively renders at 256x256 or 512x512. We render at 512 and let
    # pyvirtualcam upscale if the OBS scene wants 720/1080.
    output_size: int = int(os.getenv("ENGINE_OUTPUT_SIZE", "512"))  # square H=W
    target_fps: int = int(os.getenv("ENGINE_FPS", "30"))

    # --- Virtual camera sink ---
    # None = auto-select (OBS Virtual Camera on Win/Mac, v4l2loopback on Linux).
    # On Linux set to the v4l2loopback device, e.g. "/dev/video99".
    virtual_cam_device: str | None = os.getenv("VIRTUAL_CAM_DEVICE") or None
    virtual_cam_backend: str | None = os.getenv("VIRTUAL_CAM_BACKEND") or None  # "obs"|"v4l2loopback"|"unitycapture"

    # --- Async render path (Phase 3; stubbed now) ---
    diffusion_checkpoint: str | None = os.getenv("DIFFUSION_CHECKPOINT")
    render_output_dir: str = os.getenv(
        "RENDER_OUTPUT_DIR", str(ENGINE_ROOT / ".." / "render-output")
    )

    # --- Consent / liveness ---
    # Face-embedding model for the liveness/consent check. We use MediaPipe's
    # face landmark + a lightweight ArcFace-style embedding is NOT bundled;
    # Phase 1 logs the consent artifact (challenge video hash + landmark hash)
    # and stores it. Full identity binding ships in Phase 2.
    consent_store: str = os.getenv(
        "CONSENT_STORE", str(ENGINE_ROOT / "consent-store")
    )
    # HMAC secret for signing consent tokens. Set in prod so tokens survive
    # restarts. Empty in dev -> consent.py uses a fixed insecure dev key.
    consent_secret: str = os.getenv("CONSENT_SECRET", "")

    # --- Latency guardrails ---
    # If a frame's pose is older than this (ms) when it reaches inference, drop
    # it rather than render a stale frame — better to skip than to accumulate lag.
    max_pose_age_ms: int = int(os.getenv("MAX_POSE_AGE_MS", "120"))

    root: Path = ENGINE_ROOT
    characters_dir: Path = field(default_factory=lambda: ENGINE_ROOT / "characters")


cfg = EngineConfig()
