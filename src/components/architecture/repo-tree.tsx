import { Section, Surface } from "./section";

const tree = `animated-self/
├── src/                      # Next.js 16 control panel + architecture hub (the / route)
│   └── app/page.tsx
├── engine/                   # Python: real-time + async inference (Phase 1 MVP)
│   ├── app.py                # FastAPI: /ws/live, /api/characters, /api/session, /api/render, /api/consent
│   ├── config.py             # env-driven config
│   ├── models.py             # Pydantic API contracts (source of truth)
│   ├── pipeline/             # pose mapping, live loop, render pipeline
│   │   ├── pose.py           # MediaPipe → THA3 pose dict
│   │   ├── live_pipeline.py  # the hot loop (pose → THA3 → virtual cam)
│   │   └── render_pipeline.py# audio → diffusion → mp4 (Phase 3 stub)
│   ├── backends/             # THA3 poser + diffusion renderer
│   │   ├── tha_poser.py      # THA3 wrapper (load, source-cache, infer)
│   │   └── diffusion_renderer.py  # Phase 3 stub
│   ├── sinks/                # pyvirtualcam + mp4 writers
│   │   ├── virtual_cam.py    # OBS Virtual Camera / v4l2loopback
│   │   └── file_sink.py      # mp4 writer (async)
│   └── characters/           # stock character registry + manifest
├── contracts/                # API schema mirrored for TS + OpenAPI
│   ├── types.ts
│   └── openapi.yaml
├── docs/reality-check.md
└── README.md`;

/**
 * Section 4 — repo structure as a styled monospace tree.
 */
export function RepoTree() {
  return (
    <Section
      id="repo"
      eyebrow="Repo structure"
      title="What lives where."
      lede="One Next.js route for the control panel + architecture hub. One Python package for inference. One shared contract package so TS and Python stay in lockstep."
    >
      <Surface className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-950/60 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-rose-400/70" />
          <span className="size-2.5 rounded-full bg-amber-400/70" />
          <span className="size-2.5 rounded-full bg-neutral-600" />
          <span className="ml-2 font-mono text-xs text-neutral-500">
            tree -L 3
          </span>
        </div>
        <pre className="max-h-[28rem] overflow-auto p-4 font-mono text-xs leading-relaxed text-neutral-300 sm:text-[13px] [scrollbar-width:thin]">
          <code>{tree}</code>
        </pre>
      </Surface>
    </Section>
  );
}
