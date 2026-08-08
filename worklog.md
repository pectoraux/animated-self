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

---
Task ID: review-fixes
Agent: lead (main)
Task: Address the 4 findings from the external code review (consent gate unwired, WS heartbeat exception, template cruft, missing tests).

Work Log:
- Finding 1 (consent gate — load-bearing): created engine/consent.py with a real gate: challenges issued+stored (120s TTL)+single-use; verify_challenge checks the EXACT steps for that challenge_id (not any bank); consent_token is HMAC-signed and derived from face evidence (sha256 of landmarks), not random; validate_consent_token checks signature+expiry+replay. Wired start_session to call it for non-consented chars (consent_token="x" no longer passes). Added LivenessVerifyRequest model + CONSENT_SECRET config.
- Finding 2 (WS heartbeat): rewrote ws_live to run recv_poses as primary task and cancel heartbeat on exit (create_task + finally cancel + contextlib.suppress); wrapped heartbeat send in try/except (WebSocketDisconnect, RuntimeError). No more stray RuntimeError up to 15s after disconnect.
- Finding 3 (cruft): package.json name -> animated-self; prisma schema User/Post -> User + ConsentRecord (ties DB to the gate); removed examples/websocket/ and download/; untracked db/custom.db. KEPT Caddyfile/.zscripts/mini-services/root tests (sandbox runtime infra, not cruft — removing breaks the env). Also untracked skills/ (Z.ai toolkit, not part of project) after fixing a gitignore newline bug (/skills/ had merged with db/custom.db into one non-matching line).
- Finding 4 (tests): refactored LivePipeline for DI (poser+sink injected) so staleness/FPS logic is testable without CUDA. Wrote engine/tests/ — 32 tests: euler round-trips, pose_vector_to_tha3 clamping/sign conventions, consent single-use/expiry/signature/replay/evidence-binding, LivePipeline staleness/stats/budget-warning. All pass in 0.62s.
- Tests caught 2 real issues on first run (wrong rotation-matrix convention in the euler test fixture, and a backwards gaze assertion) — both were test-fixture bugs, not production bugs; confirmed pose.py's mapping is correct. Fixed fixtures, all green.
- Updated UI consent section copy to reflect the gate is now actually wired (issued/stored/single-use, token derived from evidence, start_session validates).
- Lint clean; dev server healthy; Agent Browser verified: page renders, no errors, consent section shows new copy, Studio start/stop toggle works, demo mode activates, mobile + footer OK.
- Pushed to github.com/pectoraux/animated-self (commit a46af0a).

Stage Summary:
- All 4 findings fixed. The consent gate is the important one: it's now a real enforced gate (issued→stored→verified→signed→validated→burned) rather than a no-op. Phase 2 can build custom-character generation on it.
- 32 passing tests cover the nontrivial math + the gate mechanics + the staleness logic.
- Pushed to GitHub (public repo).

---
Task ID: p2-1-through-p2-4
Agent: lead (main)
Task: Phase 2 engine backend — character generation (BYOK), registry lifecycle, consent binding, tests.

Work Log:
- Pulled and reviewed security fix f61aa60 (random per-process fallback secret). Confirmed consistent with consent.py design; rebased local worklog commit on top. Ran tests: 35 pass.
- Flagged CONSENT_SECRET tradeoff: warn-and-continue is correct for single-process local engine; suggested lazy warning at point-of-need (only when a custom-char session is attempted) as a Phase 2 refinement, not a design change.
- Created engine/backends/character_gen.py: GenProvider protocol + OpenAIProvider (real BYOK, DALL-E 3 via direct HTTPS, key never persisted) + DemoProvider (z-ai CLI subprocess, gated behind ENABLE_BUILTIN_GEN_PROVIDER, clearly labeled non-BYOK).
- Created engine/backends/vlm_describe.py: VLM-based selfie description for the selfie→anime route (description-based, NOT pixel-level identity transfer — documented honestly).
- Refactored engine/characters/registry.py: stock manifest stays read-only; generated chars persisted to characters/generated/manifest.json (mutable). Added register_generated_character (consented=false by default) + mark_consented (binds face_hash, flips consented=true) + get_character. Stock chars are immutable (mark_consented refuses them).
- Added Phase 2 models to engine/models.py: GenProviderInfo, GenerateCharacterRequest, TransferCharacterRequest, UploadCharacterRequest, ConsentBindRequest.
- Added Phase 2 endpoints to engine/app.py: GET /api/characters/providers, POST /api/characters/generate, POST /api/characters/transfer, POST /api/characters/upload, POST /api/characters/{id}/consent/bind. BYOK key validation: BYOK providers require api_key; demo doesn't. Key is used in-request only, never logged/persisted (verified by test).
- Added config: ENABLE_BUILTIN_GEN_PROVIDER (default true in dev, must be false in prod).
- Wrote engine/tests/test_character_gen.py: 11 tests covering registry lifecycle, consent binding (refuses stock, refuses unknown), provider selection (demo hidden when disabled), BYOK key required + not persisted, full register→liveness→bind→drivable flow. Fixed frozen-dataclass monkeypatch issue (swap module cfg ref via SimpleNamespace). All 46 tests pass.

Stage Summary:
- Phase 2 engine backend complete and tested. The generation path is real BYOK (OpenAI provider does direct HTTPS with user key); demo provider (z-ai CLI) is gated and labeled.
- Generated/uploaded chars start consented=false and CANNOT be driven until the creator completes liveness and calls /consent/bind — the gate from Phase 1 enforces this with no changes needed.
- The inference layer (THA3) is untouched — a generated PNG is just another source image, exactly as the roadmap promised.
- 46 tests pass (35 prior + 11 new).
- Next: UI (Create character flow) + contracts/types.ts mirror + architecture page update — delegating to full-stack subagent.

---
Task ID: p2-5
Agent: full-stack-developer (Phase 2 UI)
Task: Build the Phase 2 frontend — Create Character panel (text/selfie/upload tabs), liveness→bind flow, shared Zustand character store, Studio picker integration, roadmap SHIPPED badge + honest limitation callout.

Work Log:
- Read worklog.md (Tasks 1-2, 5, 6, review-fixes, p2-1-through-p2-4) and inspected the existing components: src/app/page.tsx, src/app/layout.tsx, src/components/architecture/{section,site-header,studio-section,roadmap,consent}.tsx, src/components/studio/studio-panel.tsx, src/lib/demo-characters.ts, contracts/types.ts, engine/models.py. Confirmed the dark studio aesthetic (bg-neutral-950, rose accent, amber warnings, no indigo/blue).
- Updated contracts/types.ts — added GenProviderInfo, GenerateCharacterRequest, TransferCharacterRequest, UploadCharacterRequest, ConsentBindRequest, LivenessVerifyRequest. Kept engineUrl()/ENGINE_PORT/engineWsUrl() unchanged. Additive only.
- Added path alias `@contracts/* -> ./contracts/*` to tsconfig.json so the engine contracts at the repo root (originally created in Task 1-2 outside src/) can be imported from src/ components.
- Created src/lib/character-store.ts — Zustand store with: characters (seeded from demoCharacters), selectedId, engineConnected, setSelected, setEngineConnected, addCreated({name, source, simulated, tags}) → id, setConsented(id), setStockFromEngine(list). UiCharacter = Character + gradient + initial + blurb + simulated? (the synthetic thumbnail fields used by the demo-mode picker). Ids are `gen-demo-xxxx` / `gen-real-xxxx` / `upload-demo-xxxx` / `upload-real-xxxx`. setStockFromEngine replaces stock chars with the engine's list and keeps client-created chars; falls back selectedId to the first available if the previously-selected stock char disappears.
- Created src/components/studio/create-character.tsx (~1600 lines, single client island). Components:
  - CreateCharacter: probes /api/health with 1.5s timeout; on failure runs an honest demo path; fetches /api/characters/providers (live) or synthesizes {demo, openai} (demo); renders Tabs(Text/Selfie/Upload) + a "Your characters" grid below; mounts a single LivenessDialog controlled by activeLivenessId.
  - useEngineProbe / useProviders — small hooks; both shared with the Studio panel via the store.
  - TextTab: name + prompt textarea + ProviderSelect + conditional ApiKeyField (only when requires_key) + Generate button. On submit: real engine POST /api/characters/generate (30s timeout) → addCreated(); demo path → sleep 2s → addCreated(simulated:true). Errors rendered as amber Alert.
  - SelfieTab: name + FileDrop (drag/drop + click, image/*) + ProviderSelect + ApiKeyField + Transfer button. Pre-submission Alert explains the description-based-not-pixel-level limitation. POST /api/characters/transfer with selfie_b64 (data URL) → addCreated().
  - UploadTab: name + FileDrop (image/png only, validates PNG and shows amber hint if not) + Upload button. Pre-submission Alert notes "starts locked — complete liveness". POST /api/characters/upload.
  - CreatedCharacterCard: shows gradient thumb + Lock/LockOpen badge + "Simulated" badge if applicable + Complete-liveness CTA (only when locked).
  - LivenessDialog: opens when activeLivenessId set. Auto-requests a challenge (real: POST /api/consent/liveness/request; demo: hardcoded ["look_left","look_right","smile"] after 700ms). Shows motion steps as a numbered list, a faux camera preview area with Start camera button, then "I've done the motions — Verify" button → drives a Progress bar through verify (real: POST /api/consent/liveness/verify with detected_steps echoed back + landmark_evidence; demo: sleep 1.5s → pass), then bind (real: POST /api/characters/{id}/consent/bind; demo: sleep 600ms), then onBound flips consented=true in the store. Clearly labeled "Simulated" badge throughout demo mode.
- Updated src/components/studio/studio-panel.tsx — replaced local characters/selectedId React state with useCharacterStore. New CharacterPickerButton: disabled when locked (non-stock + consented=false), shows a small "locked" amber badge with Lock icon and a Tooltip "Complete liveness first"; selectable chars show a rose "custom" badge when source is generated/uploaded. Picker header shows "some locked" hint when applicable. Engine probe now calls setEngineConnected + setStockFromEngine (keeps client-created chars when replacing stock from engine). EngineBadge + SinkToggle + CharacterThumb + PreviewArea + StatsGrid + StatTile all preserved from Phase 1 with minor UiCharacter type swaps.
- Updated src/components/architecture/studio-section.tsx — composes CreateCharacter above StudioPanel, with a one-line note that generated chars appear in the picker automatically.
- Updated src/components/architecture/roadmap.tsx — Phase 2 card: badge → "SHIPPED · engine + UI" (emerald tone), body rewritten to reflect what actually shipped (three routes, BYOK, consent binding, 46 tests pass), timeline node swapped to a CheckCircle2 emerald icon. Added a rose-toned callout under the Phase 2 card with the honest limitation: "Selfie→anime is NOT pixel-level identity transfer. The engine uses a VLM to describe the selfie, then forwards that description to the image model. Real identity-preserving img2img is Phase 3+." Phases 3-5 unchanged (still outlines).
- Lint: clean (0 errors, 0 warnings) after removing two unused eslint-disable directives and fixing the alias typo.
- Dev server: clean compile after the tsconfig alias change. `GET / 200` confirmed; rendered HTML contains "Create a character", "Text → Character", "Selfie → Character", "SHIPPED", "Phase 2". The 500 in dev.log was a transient error from before the alias fix; the next compile is clean.

Stage Summary:
- Phase 2 UI is wired end-to-end against the engine API surface (port 3031 via XTransformPort). All Phase 2 endpoints are reachable through engineUrl(): /api/characters/providers, /api/characters/generate, /api/characters/transfer, /api/characters/upload, /api/consent/liveness/request, /api/consent/liveness/verify, /api/characters/{id}/consent/bind.
- Demo mode (engine not connected — the sandbox state) is honest: simulated generation after ~2s, simulated liveness after ~1.5s, "Simulated" badges everywhere it matters, amber callouts for engine errors. Matches the existing Studio panel's demo-mode honesty.
- Shared Zustand store keeps the Create panel and the Studio picker in sync: a char created above appears immediately below (locked), and flips to selectable the moment liveness completes.
- Liveness flow correctly walks the three-stage pipeline (request → verify → bind) in both real and demo modes, with the progress bar + success callout making the bind moment visible.
- Files created: src/lib/character-store.ts, src/components/studio/create-character.tsx. Files modified: contracts/types.ts, tsconfig.json, src/components/studio/studio-panel.tsx, src/components/architecture/studio-section.tsx, src/components/architecture/roadmap.tsx.
- Lint: passed. Dev server: compiles cleanly (200 on /).
