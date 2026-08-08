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
├── engine/                   # Python: real-time + async inference
│   ├── app.py                # FastAPI: /ws/live, /api/characters, /api/session, /api/render, /api/consent
│   ├── config.py
│   ├── consent.py            # liveness challenge/verify + HMAC consent tokens
│   ├── models.py             # Pydantic API contracts (source of truth)
│   ├── pipeline/             # pose mapping, live loop, render pipeline
│   ├── backends/             # THA3 poser + character-gen (BYOK) + diffusion renderer
│   ├── sinks/                # pyvirtualcam + mp4 writers
│   └── characters/           # stock + generated character registry
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

## Status

- [x] Phase 1 — live path: webcam → landmark → THA3 → OBS virtual cam
- [x] Phase 1 — API contracts (capture / inference / output) stable for later phases
- [x] Phase 2 — custom character generation (BYOK text→character, selfie→anime,
      raw upload) + consent/liveness binding, re-checked on every session start
      and every render, not just once (see docs/reality-check.md and the
      commit history for the audit trail on getting this right)
- [x] Phase 3 — async diffusion quality mode: `/api/render` actually runs a
      background render job against a user-configured external renderer
      command (see `engine/backends/diffusion_renderer.py`) and serves the
      resulting MP4 at `/api/render/{job_id}/file`
- [ ] THA3 weights bundled (not redistributable — user supplies checkpoint)
- [ ] A real audio-driven anime diffusion checkpoint wired up (the render
      *pipeline* is real and tested; you still have to point
      `DIFFUSION_RENDER_CMD` at an actual renderer — none is bundled, same
      reason THA3 weights aren't)
- [ ] Phase 4 (voice conversion), Phase 5 (marketplace)

## Run the control panel / architecture hub

```bash
bun run dev      # Next.js on :3000 — the / route is the architecture doc + control panel
```

## Run the engine (on a GPU box)

See `engine/README.md`.

## Phased roadmap (outline)

- **Phase 2 — Custom character generation. Shipped.** BYOK image-gen;
  text→character and selfie→anime routes; generated PNGs drop into the same
  registry; consent/liveness binding enforced for custom chars on every
  session start, not just the first one after binding.
- **Phase 3 — Diffusion quality mode. Shipped (pipeline; bring your own
  renderer).** Audio-driven reenactment behind the existing `/api/render`
  contract: a background job runs an operator-configured external command
  (`DIFFUSION_RENDER_CMD`) — see `engine/backends/diffusion_renderer.py` for
  why this is a command contract rather than a hardcoded integration with one
  specific research repo — and the finished MP4 is served back over the API.
  The same consent gate as live sessions applies. Live path unchanged.
- **Phase 4 — Voice conversion.** Optional RVC-style mic→avatar-voice stage;
  ~20–40ms added to live; BYOK for cloud voice models.
- **Phase 5 — Marketplace.** Discoverable stock + creator-published character
  packs; consent-bound; lightweight review pipeline for non-consensual
  likeness uploads; inference stack untouched.

See `docs/reality-check.md` for the honest gaps.
