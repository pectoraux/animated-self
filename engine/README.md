# animated-self — Inference Engine

Local Python service that turns a creator's webcam pose / audio into a real-time
anime avatar frame, delivered to the **OBS Virtual Camera** (live) or rendered
to an MP4 file (async quality mode).

This is the **Phase 1 MVP**. It implements the live, video-driven (pose) path
end-to-end with a stock character registry. Custom character generation,
voice conversion, and the diffusion quality mode are stubbed behind the same
API contracts so later phases drop in without re-architecting this layer.

## Stack choice (and why)

| Concern | Choice | Why |
|---|---|---|
| Model runtime | **PyTorch + CUDA** | THA3 is PyTorch. There is no WASM/JS port and none is feasible — the model needs a GPU. |
| Server | **FastAPI** | One process serves the live WebSocket (`/ws/live`) and the REST surface (`/api/*`). Async-native. |
| Landmark extraction | **MediaPipe Tasks (browser)** | Runs in the control panel via WASM/WebGL. We send a ~250-byte **pose vector** per frame, **not video**. This is the single biggest latency win and the reason <100ms is reachable. |
| Virtual cam | **`pyvirtualcam`** | Canonical bridge to OBS Virtual Camera (Win/Mac) and v4l2loopback (Linux). Built for exactly this use case. |
| Control panel | **Next.js 16** (sibling `src/`) | Already the project base; creators expect a web UI; MediaPipe Tasks has a first-class JS API. |

> The reenactment model **cannot run in the browser**. The browser only captures
> webcam/mic and extracts the pose; all neural inference is local Python on a
> CUDA GPU. There is no cloud round-trip in the live path.

## Latency budget (live, glass-to-glass)

```
Browser: getUserMedia ~16ms + MediaPipe FaceLandmarker ~8-12ms + pose math ~1ms  ≈ 27ms
WS localhost send:                                                                  ≈ 1ms
Engine:  THA3 forward ~20-35ms (RTX 3060+) + pyvirtualcam.send ~1ms                ≈ 26ms
OBS:     pulls virtual cam at 30/60fps                                             ≤ 33ms
                                                       ─────────────────────────────────
                                                       Total typical:           ≈ 65-90ms
```

**What breaks the <100ms bar** (see `docs/reality-check.md`):
- No CUDA / integrated GPU → THA3 on CPU is ~200ms+ (unusable live).
- Sending video frames instead of a pose vector (naive design) blows the budget on encode + bandwidth. We send pose.
- OBS frame-pull alignment adds up to one frame of display latency.

## Run (on a GPU box)

```bash
cd engine
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1. Install OBS (provides the "OBS Virtual Camera" on Win/Mac).
#    On Linux: sudo modprobe v4l2loopback video_nr=99 exclusive_caps=1.

# 2. Provide THA3 weights. Either clone talking-head-anime-3-demo and export
#    a model, or drop a .pt at engine/checkpoints/tha3.pt and point config at it.
export THA3_CHECKPOINT=./checkpoints/tha3.pt

# 3. Start the engine.
uvicorn app:app --host 127.0.0.1 --port 3031
```

Then open the Next.js control panel (`bun run dev` at the repo root), pick a
stock character, and start streaming. The panel talks to `127.0.0.1:3031`
(over the gateway: `/api/...?XTransformPort=3031`, `/ws/live?XTransformPort=3031`).

## Layout

```
engine/
├── app.py                 # FastAPI: /ws/live, /api/characters, /api/session, /api/render, /api/consent
├── config.py              # env-driven config (ports, checkpoint paths, fps, resolution)
├── models.py              # Pydantic API contracts (source of truth, mirrored in contracts/)
├── pipeline/
│   ├── pose.py            # MediaPipe blendshapes/transformation_matrix → THA3 pose dict
│   ├── live_pipeline.py   # pose → THA3 → pyvirtualcam  (the hot loop)
│   └── render_pipeline.py # audio → diffusion → mp4  (Phase 3 stub)
├── backends/
│   ├── tha_poser.py       # THA3 model wrapper (load, source-cache, infer)
│   └── diffusion_renderer.py  # AniPortrait-style wrapper (Phase 3 stub)
├── sinks/
│   ├── virtual_cam.py     # pyvirtualcam sink (live)
│   └── file_sink.py       # mp4 writer (async)
└── characters/
    ├── registry.py        # stock character loader (id → source image + metadata)
    └── manifest.json      # stock character list
```

## What is runnable now vs research-stage

- **Runnable (Phase 1):** landmark→pose mapping, live pipeline, virtual-cam sink,
  character registry, FastAPI surface, session/render/consent contracts.
- **Requires external assets to actually run:** the THA3 model weights
  (`backends/tha_poser.py` loads from `THA3_CHECKPOINT`). Code is real; weights
  are not redistributable here.
- **Stubbed (later phases):** `diffusion_renderer.py` (Phase 3),
  `render_pipeline.py` audio path. The contracts exist; the implementation is
  a `NotImplementedError` placeholder so the surface is stable.
