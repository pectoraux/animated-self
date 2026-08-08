# animated-self

An AI-native "animated self" app for creators who don't want to show their real
face on camera. A creator's webcam expressions/voice drive a real-time
anime-style avatar in place of their real face, delivered to the **OBS Virtual
Camera** (live) or a rendered MP4 (async quality mode).

**Core technical decision (non-negotiable):** skip traditional character
rigging. Use neural reenactment — a model takes one reference character image
plus a driving signal (webcam pose or audio) and synthesizes each output frame.
No bones, no mesh, no Live2D layer-tagging.

- **Live path:** Talking-Head-Anime-3-style poser (single anime image + pose
  vector → animated frame), distilled for 30+ FPS on consumer GPUs.
- **Async / quality path:** diffusion-based audio-driven reenactment
  (AniPortrait-style), offline only.

## Repo layout

```
animated-self/
├── src/                      # Next.js 16 control panel + architecture hub (the / route)
│   └── app/page.tsx
├── engine/                   # Python: real-time + async inference (Phase 1 MVP)
│   ├── app.py                # FastAPI: /ws/live, /api/characters, /api/session, /api/render, /api/consent
│   ├── config.py
│   ├── models.py             # Pydantic API contracts (source of truth)
│   ├── pipeline/             # pose mapping, live loop, render pipeline
│   ├── backends/             # THA3 poser + diffusion renderer (Phase 3 stub)
│   ├── sinks/                # pyvirtualcam + mp4 writers
│   └── characters/           # stock character registry + manifest
├── contracts/                # API schema mirrored for TS + OpenAPI
│   ├── types.ts
│   └── openapi.yaml
├── docs/reality-check.md     # honest flags on what OSS models can't do yet
└── ARCHITECTURE.md           # full system design (rendered in the web app)
```

## What runs where

| Layer | Where | Why |
|---|---|---|
| Webcam/mic capture + landmark extraction | **Browser** (MediaPipe Tasks WASM) | Lowest latency; we send a ~250-byte pose vector, not video. |
| Neural reenactment (THA3) | **Local Python on a CUDA GPU** | Model needs CUDA; no WASM port exists or is feasible. |
| OBS Virtual Camera output | **Local Python** (`pyvirtualcam`) | The primary distribution channel for creators. |
| Control panel + architecture hub | **Next.js 16** (this repo's `/`) | Web UI creators expect; hosts MediaPipe Tasks JS. |

> The reenactment model **cannot run in this sandbox** (no GPU, no virtual cam
> driver). The Python engine is real, runnable code you take to a GPU box. The
> Next.js app at `/` is the control panel + a full architecture document.

## Phase 1 status

- [x] System architecture + data flow (live + async)
- [x] Repo structure
- [x] Phase 1 MVP scaffolded: webcam → landmark → THA3 → OBS virtual cam
- [x] API contracts (capture / inference / output) stable for later phases
- [x] Phased roadmap (Phase 2–5)
- [x] Reality-check flags
- [ ] THA3 weights bundled (not redistributable — user supplies checkpoint)
- [ ] Diffusion quality mode (Phase 3, stubbed)

## Run the control panel / architecture hub

```bash
bun run dev      # Next.js on :3000 — the / route is the architecture doc + control panel
```

## Run the engine (on a GPU box)

See `engine/README.md`.

## Phased roadmap (outline)

- **Phase 2 — Custom character generation.** BYOK image-gen; text→character and
  selfie→anime routes; generated PNGs drop into the same registry; consent/
  liveness binding enforced for custom chars.
- **Phase 3 — Diffusion quality mode.** AniPortrait-style audio-driven
  reenactment behind the existing `/api/render` contract; render queue +
  storage; live path unchanged.
- **Phase 4 — Voice conversion.** Optional RVC-style mic→avatar-voice stage;
  ~20–40ms added to live; BYOK for cloud voice models.
- **Phase 5 — Marketplace.** Discoverable stock + creator-published character
  packs; consent-bound; lightweight review pipeline for non-consensual
  likeness uploads; inference stack untouched.

See `docs/reality-check.md` for the honest gaps.
