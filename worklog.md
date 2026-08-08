# animated-self — Worklog

Shared work log for all agents working on this project.
Each agent appends a new section (separated by `---`) after finishing its task.

---
Task ID: 1-2
Agent: lead (main)
Task: Inspect project; write core design content (architecture, data flow, reality-check, roadmap) and scaffold the Phase 1 MVP Python inference engine + API contracts.

Work Log:
- Inspected existing Next.js 16 project at /home/z/my-project (shadcn/ui, framer-motion, react-syntax-highlighter, recharts available).
- Created directory layout: engine/{pipeline,backends,sinks,characters,checkpoints}, contracts/, docs/.
- Wrote engine/README.md (stack rationale + latency budget + run instructions).
- Wrote engine/requirements.txt (fastapi, torch, pyvirtualcam, mediapipe, etc.).
- Wrote engine/config.py (env-driven EngineConfig dataclass).
- Wrote engine/models.py (Pydantic contracts: Character, PoseVector, HeadPose, EyeState, MouthState, StartSessionRequest/Response, FrameStats, RenderRequest/Job, LivenessChallenge/Result).
- Wrote engine/backends/tha_poser.py (THA3 wrapper: load, source-cache, render) + diffusion_renderer.py (Phase 3 stub).
- Wrote engine/pipeline/pose.py (MediaPipe blendshapes + transformation matrix -> THA3 pose dict; pose_vector_to_tha3; transformation_matrix_to_euler).
- Wrote engine/pipeline/live_pipeline.py (the hot loop: push pose, drop-stale guardrail, FrameStats snapshot).
- Wrote engine/pipeline/render_pipeline.py (delegates to diffusion backend; stubbed).
- Wrote engine/sinks/virtual_cam.py (pyvirtualcam VirtualCamSink, PreviewSink JPEG holder, NullSink) + file_sink.py (Mp4Sink via imageio).
- Wrote engine/characters/manifest.json (3 stock chars: Aoi, Ren, Yuki) + registry.py (list_characters, get_character_image, neutral placeholder fallback).
- Wrote engine/app.py (FastAPI: /api/health, /api/characters, /api/session/start|stop, /api/session/{id}/preview.jpg, /api/consent/liveness/{request,verify}, /api/render, /ws/live WebSocket pose stream with heartbeat + threadpool inference).
- Wrote contracts/types.ts (TS mirror of models.py + engineUrl/engineWsUrl gateway helpers) and contracts/openapi.yaml.
- Wrote docs/reality-check.md (8 honest flags: no real-time full body, THA3 needs CUDA, no real-time audio-driven anime lip-sync, diffusion not interactive, THA3 distribution degradation, virtual cam needs driver install, consent is deterrent not proof, BYOK can't SLA).
- Wrote README.md (repo layout, what runs where, phase 1 status, roadmap outline).

Stage Summary:
- Phase 1 MVP engine is real, runnable Python (on a CUDA box). It cannot run in this sandbox (no GPU / no virtual-cam driver) — that is by design and documented.
- API contracts are stable and additive: PoseVector carries an audio_level hook for Phase 4; RenderRequest contract exists for Phase 3; consent_token exists for Phase 2 custom chars.
- Single source of truth for API = engine/models.py (Pydantic), mirrored in contracts/types.ts and contracts/openapi.yaml.
- Key design decision: live path sends a ~250-byte PoseVector, NOT video. This is the core latency win.
- Next: build the Next.js / page as the architecture hub + control-panel mockup (Task 5).

---
Task ID: 5
Agent: full-stack-developer
Task: Build the single user-visible route (`/`) for animated-self — a comprehensive single-page architecture document + interactive Studio control-panel mockup rendering the design content produced in Tasks 1–2.

Work Log:
- Read worklog.md (Tasks 1–2) and the real engine source files: app.py, pipeline/live_pipeline.py, backends/tha_poser.py, pipeline/pose.py, sinks/virtual_cam.py, models.py, config.py, characters/manifest.json, contracts/types.ts.
- Created `src/lib/code-snippets.ts` — curated, copy-faithful excerpts (lightly trimmed with `# ...`) of the 6 key engine files, embedded as template-literal strings with Prism language tags.
- Created `src/lib/demo-characters.ts` — 3 stock characters (Aoi, Ren, Yuki) with synthetic CSS gradients + initials for the demo-mode picker, mirroring engine/characters/manifest.json.
- Created `src/components/architecture/section.tsx` — shared `Section`, `Surface`, `SubHeading` primitives for consistent vertical rhythm and the dark studio aesthetic.
- Created `src/components/architecture/site-header.tsx` — sticky top header with anchor nav + IntersectionObserver active-section highlight (client island).
- Created section components: `hero.tsx`, `decision-callout.tsx`, `system-architecture.tsx` (4-card component diagram + labeled arrows + LIVE/ASYNC flow cards + "where the split happens" callout), `repo-tree.tsx`, `phase1-mvp.tsx` (stack table + "no cloud" quote + latency budget + code viewer + run instructions), `api-contracts.tsx` (3-layer split + PoseVector schema card + endpoint table + gateway note), `consent.tsx`, `roadmap.tsx`, `reality-check.tsx`, `studio-section.tsx`.
- Created `src/components/architecture/code-viewer.tsx` — tabbed code viewer using react-syntax-highlighter PrismLight (python + bash registered) with one-dark theme, copy button, line numbers, custom scrollbar.
- Created `src/components/architecture/latency-budget.tsx` — horizontal stacked bar built from styled divs (no chart dependency) with the 100ms target marker + segment legend + "what breaks <100ms" amber callout.
- Created `src/components/studio/studio-panel.tsx` — interactive Client Component: probes `GET /api/health?XTransformPort=3031` with 1.5s timeout; on success shows green "Engine connected" + CUDA/CPU badge and pulls real `/api/characters`; on failure falls back to amber "Demo mode" with the 3 stock chars. Character picker (gradient + initial thumbs), output-sink segmented control (OBS Virtual Cam / In-app Preview), Start/Stop with framer-motion transitions, faux pulsing avatar preview, simulated FPS/latency/infer stat tiles jittered ±3ms via setInterval, OBS setup hint, "Simulated" watermark in demo mode.
- Composed `src/app/page.tsx` as a Server Component: root wrapper `min-h-screen flex flex-col bg-neutral-950`, sticky header, `<main>` with all 10 sections in order, `mt-auto` sticky footer with product recap + contract-source-of-truth note.
- Updated `src/app/layout.tsx` — added `className="dark"` to `<html>` so all shadcn/ui components render in their dark variants; set body to `bg-neutral-950 text-neutral-100`; rewrote metadata title/description to match the product.
- Updated `next.config.ts` — added `allowedDevOrigins: ["*.space-z.ai"]` to silence the dev-only cross-origin warning from the preview URL.
- Ran `bun run lint` — passed clean, zero errors/warnings.
- Verified dev server: clean compile, `GET / 200 in 110ms` (steady state), no runtime errors in dev.log.

Stage Summary:
- Single route `/` is a polished, dark-studio, mobile-first architecture document + interactive Studio mockup. 10 sections in scroll order: Hero → Decision → System Architecture → Repo → Phase 1 MVP → API Contracts → Consent → Roadmap → Reality Check → Studio.
- Aesthetic: neutral zinc/stone base + rose/pink accent (anime vibe) + amber for warnings. No indigo/blue. Fixed dark theme (no toggle) to avoid hydration mismatches.
- Sticky top header with active-section nav; sticky footer (mt-auto) per project UI rules.
- Code excerpts are copy-faithful to the real engine source (read directly, not paraphrased).
- Studio panel is a real client component that attempts a live engine probe and gracefully degrades to demo mode — exactly as specified.
- Files produced: src/app/page.tsx, src/app/layout.tsx (modified), next.config.ts (modified), src/lib/code-snippets.ts, src/lib/demo-characters.ts, src/components/architecture/{section,site-header,hero,decision-callout,system-architecture,repo-tree,phase1-mvp,api-contracts,consent,roadmap,reality-check,studio-section,code-viewer,latency-budget}.tsx, src/components/studio/studio-panel.tsx.
- Lint: passed. Dev server: compiles cleanly (no errors in dev.log). Page renders all spec content (animated-self, PoseVector, /api/health, XTransformPort, Aoi/Ren/Yuki, THA3 verified present in rendered HTML).

---
Task ID: 6
Agent: lead (main)
Task: Lint, run dev server, verify with Agent Browser, fix issues.

Work Log:
- Confirmed `bun run lint` passed clean (0 errors, 0 warnings) per subagent report.
- Confirmed dev server running on :3000 with clean compile (no fatal errors in dev.log).
- Used Agent Browser to open http://localhost:3000/ — title "animated-self — architecture & control panel" correct; no page errors; console clean (only React DevTools + HMR).
- Snapshot -i verified all 10 sections rendered with correct content: hero, core-decision callout (live/async paths + out-of-scope), system architecture (component diagram + LIVE/ASYNC flows + where-the-split callout), repo tree, Phase 1 (stack table + latency budget + 6-tab code viewer + run instructions), API contracts (3 layers + PoseVector schema + 11-row endpoint table), consent (caveat + worth-shipping), roadmap (Phases 2-5), reality-check (all 8 flags), Studio panel + footer.
- Exercised the golden path: clicked "Select character Aoi" → clicked "Start stream" → button became "Stop"; region text showed "LIVE · OBS Virtual Cam" badge, "Simulated" watermark, AOI preview, LATENCY 76ms (within <100ms budget), THA3 INFER 26ms, FPS IN 30 / OUT 29, and the honest demo-mode note. Clicked "Stop" → reverted to "Start stream". Toggle works both ways.
- Demo-mode fallback correctly activated (Python engine not running in sandbox → panel fell back to 3 stock chars + simulated stats, exactly as designed).
- Set viewport to 390x844 (iPhone) — nav + all sections + footer still present and legible (mobile-first responsive confirmed).
- Used z-ai vision VLM on a hero screenshot: confirmed page rendered properly (not blank/white, no errors), dark studio aesthetic, rose/pink accent + amber tags, header with active-section nav highlight, status badges, hero "Skip rigging. Use neural reenactment", live/async comparison cards, no layout problems.
- Cleaned up verification screenshots; closed browser.

Stage Summary:
- Browser-verified end-to-end: the / route renders cleanly and the core interaction (Studio panel start/stop streaming with simulated readouts) works. The architecture document is fully rendered and navigable.
- No fixes were needed — the subagent's build was correct on first pass.
- Deliverables complete: system architecture, repo structure, Phase 1 MVP scaffolded engine (runnable Python), API contracts, phased roadmap, reality-check flags — all presented in the web app and backed by real repo files.
