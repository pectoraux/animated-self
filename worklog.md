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

---
Task ID: p3-merge + p3-ui-recovery
Agent: lead (main)
Task: Resolve conflict between my Phase 3 and upstream af7b47d (independent Phase 3 by payswapdotorg); add production-path DI tests; recover + reconcile UI.

Work Log:
- Built my own Phase 3 (render_queue.py + DemoRenderer + DiffusionRenderer stub + 10 tests + UI via subagent). Push was rejected — upstream af7b47d landed first with a DIFFERENT Phase 3 implementation.
- Reviewed af7b47d: external-command renderer (DIFFUSION_RENDER_CMD) instead of my DemoRenderer; shared _enforce_consent_gate helper; input validation rejecting remote URLs; DI-rewritten render_pipeline.py; 61 tests. Their approach is more production-real and better-thought-out than mine — external-command is how you'd actually deploy, my DemoRenderer was a demo crutch.
- Decision: took upstream as the base (git reset --hard origin/main), salvaged only my independently-valuable non-conflicting work:
  * The 3 production-path DI tests for _resolve_poser (instruction #3 from 80e1088 audit). Upstream didn't have them. Verified they catch the regression by temporarily reverting the fix. 64 tests total (61 + 3).
  * The Phase 3 UI (upstream was engine-only): recovered async-render.tsx, liveness-dialog.tsx, roadmap SHIPPED badge, contracts helpers, studio-section composition from my previous commit.
- Reconciled UI with upstream's API: download endpoint is /file (upstream) not /download (mine); updated renderDownloadUrl() and driver URL help text to reflect upstream's remote-URL rejection.
- Lint clean; 64 engine tests pass; Agent Browser verified: page renders all three panels (Create Character, Async Render, Studio) + Phase 3 SHIPPED badge, no errors.
- Pushed (126a3d3).

Stage Summary:
- Two independent Phase 3 implementations collided; took the better one (upstream's external-command pattern) and layered my production-path tests + UI on top.
- The 80e1088 audit's instruction #3 (test the non-injected production path for DI components) is now satisfied: 3 tests guard _resolve_poser's fallback branch, verified to catch the exact AttributeError regression.
- 64 tests pass. Phase 3 is shipped end-to-end (engine + UI). The consent gate is consistently enforced across live + async paths.
- Honest framing preserved: the diffusion model itself is bring-your-own (external command), same as THA3's weights. No open-source model reliably hits anime-style audio-driven lip-sync yet.

---
Task ID: verify-a8e4154 + p4-1
Agent: lead (main)
Task: Pull/review a8e4154 (stale DemoRenderer copy fix), scrub remaining stale refs, then build Phase 4 engine (voice conversion).

Work Log:
- Pulled a8e4154 (docs fix by payswapdotorg). Reviewed: removed fabricated DemoRenderer claim from roadmap.tsx (my stale copy from discarded parallel Phase 3 — the class never existed in shipped code), fixed /download → /file endpoint in studio-section.tsx. Fair criticism: I recovered the UI from my previous commit without scrubbing copy that described discarded code.
- Applied the lesson: grepped for ALL stale references, not just the two the reviewer caught. Found 3 more in async-render.tsx: (1) "demo renderer produces a placeholder video" copy, (2) Video tab offering a feature the engine rejects with 400, (3) Draft/High quality selector with fabricated "Draft uses THA3" / "research-stage stub" descriptions. Fixed all three honestly. Committed as afcef44.
- 64 tests pass, lint clean, Agent Browser verified fixed copy renders.
- Built Phase 4 engine (p4-1):
  * backends/voice_converter.py: VoiceConverter protocol + ExternalCommandConverter (VOICE_CONVERT_CMD, same pattern as DIFFUSION_RENDER_CMD — operator configures an RVC CLI, we define the contract) + CloudConverter (BYOK, e.g. ElevenLabs speech-to-speech via direct HTTPS, key never persisted). get_converter() returns None when unconfigured — NOT faked. No demo converter.
  * app.py: POST /api/voice/convert (async file conversion, consent-gated via _enforce_consent_gate — same helper as live + render, no parallel check) + GET /api/voice/{id}/download. 503 when unconfigured, not silent bypass.
  * models.py: VoiceConvertRequest + VoiceConvertResult.
  * tests/test_voice_conversion.py: 13 tests — converter selection (None when unconfigured, external when cmd set), external command runs/fails/missing-output, consent gate (refuses locked char, refuses unrelated token, accepts matching token, stock no token), 503 unconfigured, download endpoint, production-path test (get_converter with real cp command, not a fake).
  * docs/reality-check.md: 2 new honest limitations — #9 live voice needs virtual audio device (same driver problem as virtual cam), #10 RVC quality depends on the model you bring.
- 77 tests pass (64 + 13). Lint clean.

Stage Summary:
- Phase 4 engine shipped honestly. Voice conversion follows the exact same pattern as diffusion: external command (operator configures), BYOK cloud (user key per-request), no bundled/fake model, clear 503 when unconfigured.
- Consent gate reuses _enforce_consent_gate — zero new consent code. Converting audio to sound like someone's avatar is identity-affecting, so it goes through the same bound_face_hash check as live sessions and async renders.
- Live voice path (/ws/voice) is scoped but not wired — honestly documented in reality-check.md #9 (needs virtual audio device for OBS, same driver problem as virtual cam). Async path is real and tested.
- 77 tests pass. Next: Phase 4 UI (voice settings panel).

---
Task ID: p4-2
Agent: lead (Phase 4 UI)
Task: Build the Phase 4 voice conversion UI — a Studio panel mounted below Async Render, an additive update to contracts/types.ts, and an honest update to the roadmap card. Engine is shipped; this is the frontend.

Work Log:
- Read worklog, docs/reality-check.md, engine/backends/voice_converter.py, engine/app.py (/api/voice/convert + /api/voice/{out_id}/download + _enforce_consent_gate), engine/models.py (VoiceConvertRequest/Result), engine/tests/test_voice_conversion.py. Read async-render.tsx + liveness-dialog.tsx + character-store.ts to mirror the existing dark-studio aesthetic and the shared consent flow.
- Verified every engine claim before writing UI copy:
  * get_converter() priority cmd > cloud > none (voice_converter.py:215-219).
  * ExternalCommandConverter.convert ignores api_key (signature comment, line 91).
  * CloudConverter.convert raises ValueError if api_key missing → app.py:492-493 catches → HTTP 400.
  * app.py:466-471 returns 503 with "Voice conversion not configured" when both env vars unset.
  * _enforce_consent_gate is the SAME function used by start_session and create_render (app.py:447-449).
  * test_voice_convert_refuses_unrelated_token asserts 403 "does not match" (face_hash check).
  * Live /ws/voice is mentioned only in a comment (app.py:460), not wired. reality-check.md #9 spells out the VB-Cable / BlackHole / pulseaudio null sink requirement.
  * Counted tests with pytest --collect-only: 77 total (13 in test_voice_conversion.py). Matches the previous agent's claim and the task description.
- Additive types (contracts/types.ts): added VoiceConvertRequest, VoiceConvertResult, voiceConvertUrl(), voiceDownloadUrl(outId). Mirrors engine/models.py exactly. Doc-comment notes the engine raises HTTPException (503/403/502/400) rather than returning ok=false in the body, so callers must read the HTTP status — the panel does.
- Built src/components/studio/voice-panel.tsx (Client Component, 'use client'). Mirrors async-render.tsx structure: Card with rose-accent header + EngineBadge, two-column lg grid (controls left, result right). Reuses the shared Zustand store for characters + engineConnected + the shared LivenessDialog for bound-char re-consent. Same CharacterPickerButton / CharacterThumb pattern as async-render (locked chars disabled, stock + consented custom chars selectable). Audio file drop reads as base64 (strips data URI prefix) and POSTs to voiceConvertUrl().
- Flow:
  * Demo mode (engineConnected=false): amber alert "Engine not connected — voice conversion requires VOICE_CONVERT_CMD or VOICE_CLOUD_PROVIDER to be set on the engine. In demo mode, clicking Convert simulates a successful conversion." Convert button simulates a successful conversion after ~2s with a "Simulated" badge. Download button is disabled with note: "In demo mode no real file is produced. Run the Python engine with VOICE_CONVERT_CMD set to convert actual audio."
  * Live mode: shows a neutral info card explaining cmd > cloud > none selection priority and that the panel can't tell which is active without trying the request. Always shows an optional BYOK API key field (the engine validates per-request — ignored by ExternalCommandConverter, required by CloudConverter). Convert POSTs {character_id, audio_b64, consent_token?, api_key?}. Surfaces HTTP status honestly:
      - 200 → "Download WAV" link via voiceDownloadUrl(outId)
      - 503 → "Voice conversion not configured on the engine" + remediation hint
      - 403 → "Consent gate refused the request" + re-run-liveness hint
      - 502 → "The converter returned an error" + stderr hint
      - 400 → "Cloud converter needs an API key"
- Consent: bound custom char (source=generated/uploaded, consented=true) shows "Re-run liveness to convert" CTA → opens shared LivenessDialog → captures consent_token via onBound → enables Convert. Stock chars convert immediately. The consent_token's face_hash is checked by _enforce_consent_gate, so the same token from liveness works for /api/voice/convert.
- Cleanup: clearTimeout(demoTimerRef) on unmount and on every Convert click. consentToken + result state reset when the user picks a different character (the token is face-specific). Result state resets when the audio file changes.
- Mounted VoicePanel in studio-section.tsx below AsyncRender (CreateCharacter → StudioPanel → AsyncRender → VoicePanel). Updated the section note to mention /api/voice/convert + /api/voice/{out_id}/download and that both consent-gated via the shared liveness dialog.
- Updated roadmap.tsx Phase 4 card: badge from "outline" → "SHIPPED · engine + UI", shipped=true, body describes async voice conversion, two real backends (external command + BYOK cloud), consent gate, 13 voice tests, 77 total. Added honest-limitation callout matching Phase 2/3 pattern: VOICE_CONVERT_CMD unset by default → 503 until operator configures; no model bundled (same reason as THA3 weights / DIFFUSION_RENDER_CMD); live /ws/voice defined but not wired in v1 (needs virtual audio device for OBS, same driver problem as virtual cam).
- Bonus honesty pass on the architecture docs: added the two voice endpoints to api-contracts.tsx endpoint table, and added the voice paths + VoiceConvertRequest/Result schemas to contracts/openapi.yaml (the 503/403/502/400 responses are spelled out).
- Lint: bun run lint exit 0 (after removing one unused Upload import from lucide-react).
- Dev server: tail of /home/z/my-project/dev.log shows clean compiles ("✓ Compiled in …") and GET / 200 responses. No errors. /api/health?XTransformPort=3031 returns 404 (expected — Python engine not running in this sandbox; the panel correctly falls into demo mode).
- Claim audit (the lesson from a8e4154 — don't ship copy you haven't verified): walked through every technical claim in voice-panel.tsx + roadmap.tsx Phase 4 entry against engine code. 32+ specific claims verified, including:
  * "Selection priority is cmd > cloud > none" → voice_converter.py:get_converter lines 215-219
  * "ExternalCommandConverter runs VOICE_CONVERT_CMD (an RVC CLI or anything honoring the audio-in, audio-out contract — no model is bundled or verified)" → voice_converter.py:7-13 docstring + reality-check.md #10
  * "CloudConverter does BYOK HTTPS (ElevenLabs speech-to-speech today, api_key per-request, never persisted)" → voice_converter.py:117-127 docstring + _convert_elevenlabs uses urllib.request.urlopen on /v1/speech-to-speech/{voice_id}
  * "converting audio to sound like someone's avatar is identity-affecting" → literal quote from app.py:449
  * "the /ws/voice contract is defined but the live audio path needs a virtual audio device (VB-Cable / BlackHole / pulseaudio null sink)" → app.py:460 comment + reality-check.md #9 (exact match on the three drivers)
  * "in-process store; durable storage is Phase 5" → app.py:_voice_outputs dict + comment "Phase 5 moves this to durable storage"
  * "13 engine tests … total engine test count is now 77" → pytest --collect-only = 77 total, 13 in test_voice_conversion.py
  The panel never calls the converter a "demo" or "stub" — it's a real external-command/BYOK converter. The only "Simulated" badges describe the client-side demo mode when the engine isn't connected, exactly as async-render.tsx does.

Stage Summary:
- Phase 4 UI shipped. The voice conversion panel matches the existing dark-studio aesthetic, reuses the shared Zustand store + LivenessDialog, handles engine-not-connected demo mode honestly, and surfaces every engine error case (503/403/502/400) with a specific remediation hint.
- Every technical claim in the new UI copy was verified against engine/app.py, engine/backends/voice_converter.py, engine/models.py, engine/tests/test_voice_conversion.py, and docs/reality-check.md before the file was written. The panel deliberately does NOT claim live voice conversion works (the /ws/voice contract is defined but unwired in v1), and does NOT claim a specific RVC model is bundled.
- Lint clean, dev server clean. Route / only — no new routes added.
- Phase 4 is now end-to-end shipped (engine + UI). Phase 5 (marketplace + durable voice output storage) is the next phase.

---
Task ID: p4-verify + push
Agent: lead (main)
Task: Verify Phase 4 end-to-end with Agent Browser, push to GitHub.

Work Log:
- Reviewed a8e4154 (stale DemoRenderer copy fix by payswapdotorg). Confirmed correct — the fabricated DemoRenderer claim was my stale copy from the discarded parallel Phase 3, left in the UI when I recovered it without scrubbing.
- Applied the lesson: grepped for ALL stale references, not just the two the reviewer caught. Found 3 more in async-render.tsx (demo renderer copy, non-functional Video tab, fabricated Draft/High quality descriptions). Fixed all three honestly. Committed as afcef44.
- Built Phase 4 engine (voice conversion): ExternalCommandConverter (VOICE_CONVERT_CMD) + CloudConverter (BYOK ElevenLabs) + consent gate via _enforce_consent_gate (same helper, no parallel check) + 13 tests (incl. production-path test for converter resolution). 77 tests total.
- Delegated Phase 4 UI to subagent with explicit instruction to verify every UI claim against engine code (the a8e4154 lesson). Subagent confirmed 32+ claims cross-checked against engine source.
- Agent Browser verification (mandatory): voice panel renders, Phase 4 SHIPPED badge present. Verified honest copy: no "stub" fabrications (hasStub:false), no "demo renderer" claims (hasDemoRenderer:false), correctly mentions VOICE_CONVERT_CMD requirement (hasNotConfigured:true). Copy honestly describes external-command + BYOK cloud, and clearly labels demo-mode simulation.
- 77 tests pass, lint clean. Pushed to github.com/pectoraux/animated-self (afb3600).

Stage Summary:
- Phase 4 shipped and browser-verified. Voice conversion follows the established pattern exactly: external command (operator configures), BYOK cloud (user key per-request), no bundled/fake model, clear 503 when unconfigured, consent-gated via the same _enforce_consent_gate.
- The a8e4154 lesson was applied twice: (1) I grepped for stale refs and found 3 more the reviewer didn't catch, (2) the subagent verified every UI claim against engine code before writing it.
- 77 tests pass. Live voice path (/ws/voice) is scoped but not wired — honestly documented in reality-check.md #9 (needs virtual audio device for OBS).

---
Task ID: verify-397257a + p5-1
Agent: lead (main)
Task: Pull/review 397257a (shell=True fix), then build Phase 5 engine (marketplace).

Work Log:
- Reviewed 397257a: dropped shell=True from ExternalCommandConverter (matching DiffusionRenderer's shlex.split pattern), fixed VoiceConverter Protocol to declare api_key param. Both fair — shell=True was a latent risk and pattern inconsistency. Added regression test for shell-metacharacter payload. 78 tests pass.
- Phase 5 design decisions (stated explicitly before coding):
  1. Consent gate threats: the binding is per-creator, not per-character. Installing a marketplace char strips the binding (installer gets unconsented copy, must run their own liveness). "Bound to a face that isn't theirs" is the existing Phase 2 liveness limitation (reality-check #7) — marketplace makes bound_face_hash public/auditable but doesn't prevent spoofing. "Republishing someone else's char" is caught by pHash near-duplicate detection + manual review.
  2. Review pipeline: pHash near-duplicate flag at publish time + manual approve/reject queue. NOT automated moderation — pHash catches exact/near-duplicate images, not stylistic copies or likeness-of-real-person. Documented honestly in reality-check #11.
  3. Persistence: file-based JSON store (marketplace/listings.json), consistent with characters/generated/manifest.json pattern. NOT Prisma — v1 is still a registry problem; Prisma is for multi-tenant scale/search, not before. ConsentRecord model stays for Phase 2's future face-embedding hardening.
- Built Phase 5 engine:
  * marketplace/phash.py: DCT-based perceptual hash (Pillow+numpy, no extra dep). 64-bit hash, Hamming distance, threshold tuned for low false negatives (flag for review, don't auto-reject).
  * marketplace/store.py: file-based JSON listing store. Listings are immutable after publish; character image + metadata copied in; bound_face_hash recorded as audit trail.
  * marketplace/review.py: DI-injectable duplicate checker + flag_at_publish + auto_approve_unflagged. Production-path test exercises the real pHash + real checker.
  * app.py: POST /api/marketplace/publish (consent-gated via _enforce_consent_gate — same helper, no parallel check), GET /api/marketplace (approved), GET /api/marketplace/pending (review queue), GET /api/marketplace/{id}/thumbnail, POST /api/marketplace/{id}/install (creates NEW unconsented char — binding does NOT transfer), POST /api/marketplace/{id}/review (manual approve/reject).
  * models.py: MarketplaceListing, PublishRequest, ReviewActionRequest.
  * tests/test_marketplace.py: 12 tests — publish consent gate (matching token required, wrong token refused, unconsented refused), install does NOT transfer binding, pHash identical/different/resize-robust/deterministic, duplicate image flagged for review, manual review approve/reject, install refused for non-approved, production-path pHash test.
  * docs/reality-check.md: 2 new honest limitations — #11 (review is flagging + manual, not automated moderation), #12 (consent gate can't prevent republishing someone else's likeness — that's a likeness-IP problem, not identity-binding).
- 90 tests pass (78 + 12). Inference stack untouched (THA3, diffusion, voice converter all unchanged — marketplace is purely registry/distribution).

Stage Summary:
- Phase 5 engine shipped. Marketplace follows established patterns: file-based store (consistent with registry), consent gate via _enforce_consent_gate (same helper, no parallel check), DI with production-path test, honest reality-check entries.
- The three threat-model questions are answered concretely: (1) publish requires matching consent_token, (2) install strips binding, (3) pHash catches duplicate images + manual review for judgment calls.
- 90 tests pass. Next: Phase 5 UI.

---
Task ID: p5-2
Agent: lead (Phase 5 UI)
Task: Build the Phase 5 marketplace UI — a Studio panel mounted below Voice Conversion, an additive update to contracts/types.ts, the openapi.yaml mirror, an honest update to the roadmap card, and the endpoint-table update. Engine is shipped (p5-1); this is the frontend.

Work Log:
- Read worklog (phases 1-5 engine shipped). Read engine/marketplace/store.py, engine/marketplace/phash.py, engine/marketplace/review.py, engine/app.py (marketplace endpoints), engine/models.py (MarketplaceListing/PublishRequest/ReviewActionRequest), engine/tests/test_marketplace.py (12 tests), docs/reality-check.md (#11 automated flagging + manual review, NOT automated moderation; #12 consent gate can't prevent republishing someone else's likeness). Read existing UI components (voice-panel.tsx, liveness-dialog.tsx, character-store.ts, studio-section.tsx, roadmap.tsx, api-contracts.tsx) to mirror the dark-studio aesthetic and reuse the shared Zustand store + shared LivenessDialog.
- Verified every engine claim before writing UI copy:
  * _enforce_consent_gate is at app.py:248 and is the SAME helper used by start_session (282), create_render (402), voice convert (480), and marketplace_publish (561). Confirmed by grep — no parallel check anywhere.
  * Publish: app.py:558-560 returns 404 if character not found; app.py:561 calls _enforce_consent_gate (raises 403 for wrong/no token); app.py:564-569 encodes the character PNG via cv2.imencode; app.py:572-574 computes pHash + runs flag_at_publish; app.py:586-589 auto-approves unflagged listings via set_review_status("approved", "system-auto").
  * Listing shape: app.py:533-546 _listing_to_response returns {listing_id, publisher_id, character_name, character_tags, thumbnail_url="/api/marketplace/{id}/thumbnail", review_status, flagged, flag_reason, published_at, reviewed_at, reviewer_id}. Matches models.py:274-289.
  * Install: app.py:614-635 returns 404 if listing missing, 403 if not approved, 404 if image missing; calls register_generated_character with source=CharacterSource.UPLOADED and tags=listing.character_tags + ["marketplace"]. registry.py:138-139 docstring confirms new chars default consented=False.
  * Review: app.py:638-649 returns 404 if not found, 409 if not pending ("listing already {status}"), else set_review_status and return updated listing.
  * pHash: phash.py:34 HASH_BITS=64, phash.py:35 HAMMING_THRESHOLD=10, phash.py:21-23 standard DCT-based pHash, phash.py:59 returns format(h, "016x") (16-char hex / 64 bits).
  * pHash catches: phash.py:7-9 — exact re-uploads, resized/recompressed copies, minor edits (brightness, cropping). pHash does NOT catch: phash.py:11-14 — stylistic copies, likeness-of-real-person, proof of authorship.
  * Review pipeline framing: review.py:7-12 — "pHash catches near-duplicate IMAGES (same PNG re-uploaded, minor edits). It does NOT catch: stylistic copies, different art of the same character, or likeness-of-real-person detection. The manual queue is where judgment calls happen. This is NOT automated moderation — it's automated flagging + human review."
  * Listing immutability: store.py:8-10 — "the listing is immutable once published — editing a listing means publishing a new one."
  * bound_face_hash transfer: store.py:12-14 + app.py:617-619 — publisher's bound_face_hash recorded as audit trail but does NOT transfer; install creates a new unconsented char.
  * Tests: pytest --collect-only = 90 total, 12 in test_marketplace.py (test_publish_requires_matching_consent_token, test_publish_unconsented_character_refused, test_install_creates_unconsented_character, test_phash_identical_images_flagged_as_near_duplicate, test_phash_different_images_not_flagged, test_publish_duplicate_image_flagged_for_review, test_manual_review_approve, test_review_pending_listing, test_install_refused_for_non_approved, test_phash_production_path_not_faked, test_phash_is_deterministic, test_phash_robust_to_resize). Matches p5-1's claim.
- Additive types (contracts/types.ts): added MarketplaceReviewStatus, MarketplaceListing, PublishRequest, ReviewActionRequest. Added marketplaceUrl(), marketplacePendingUrl(), marketplacePublishUrl(), marketplaceThumbnailUrl(thumbnailOrListingId), marketplaceInstallUrl(listingId), marketplaceReviewUrl(listingId). All re-use engineUrl() for gateway-safe paths. Doc-comments cite engine/models.py and explain the 403/404/409 error semantics.
- Built src/components/studio/marketplace-panel.tsx (Client Component, 'use client'). Mirrors voice-panel.tsx structure: Card with rose-accent header + EngineBadge, three-tab Tabs (Browse / Publish / Moderator) using shadcn/ui Tabs.
  - Browse tab: GET /api/marketplace → approved listings grid (3 simulated listings in demo mode with gradient thumbnails + "Simulated" badge; live mode fetches the real listing array and renders the thumbnail PNG via marketplaceThumbnailUrl()). Each listing card has Install button → POST /api/marketplace/{id}/install. On success, the response Character is mirrored into the shared Zustand store via addCreated({source:"uploaded", tags:character.tags}) — which always sets consented=false (matching the engine's behavior). Install result banner explicitly says: "Installed characters start locked — complete liveness to drive them. The engine returns the new character with consented=false and a marketplace tag (see app.py:marketplace_install)." Error states surface 403 (not approved) and 404 (not found) honestly.
  - Publish tab: picker filters the shared character store to ONLY consented custom chars (source=generated|uploaded AND consented=true) — stock chars and unconsented chars are not eligible (the engine's _enforce_consent_gate refuses them). Publisher ID input (free text, recorded as audit-trail string). Publish button requires a fresh consent_token → opens the shared LivenessDialog → onBound captures the token → enables the actual Publish POST. Result panel shows review_status honestly:
      * approved → green "Published — auto-approved" + "No near-duplicate found — the listing is live in Browse"
      * pending+flagged → amber "Published — flagged for review" + the engine's actual flag_reason rendered verbatim in a mono-font box, plus the honest framing: "The pHash flagger caught a near-duplicate image — same PNG re-uploaded, resized/recompressed, or with minor edits. pHash does NOT catch stylistic copies or likeness-of-real-person (that needs a face-embedding model this project doesn't have). The manual review queue is where the judgment call happens."
    Error states surface 403 (consent gate) and 404 (character not found) with specific remediation hints.
  - Moderator tab: GET /api/marketplace/pending → review queue (1 simulated pending listing in demo mode, flagged with a near-duplicate reason that matches the engine's f-string format). Reviewer ID input. Each pending listing row has Approve (emerald) + Reject (rose-outline) buttons → POST /api/marketplace/{id}/review with {status, reviewer_id, reason:null}. Reviewed listings are removed from the local list (they're no longer pending). Error states surface 409 (already reviewed) and 404 (not found). The tab header has a prominent amber Alert: "This is manual review — not automated moderation. The pHash near-duplicate check at publish time is automated flagging — it catches the same PNG re-uploaded (resized, recompressed, minor edits). It does NOT catch stylistic copies, likeness-of-real-person, or proof of original authorship. This queue is where the judgment calls happen. See docs/reality-check.md #11."
  - Demo mode (engineConnected=false): every tab falls back to simulated state with "Simulated" badges — Browse shows 3 fake listings, Publish simulates the whole flow including the LivenessDialog (which itself simulates liveness), Moderator shows 1 fake pending listing. All timers cleaned up on unmount (demoTimerRef / loadTimerRef / reviewTimerRef / publishTimerRef).
- Mounted MarketplacePanel in studio-section.tsx below VoicePanel (CreateCharacter → StudioPanel → AsyncRender → VoicePanel → MarketplacePanel). Updated the section note to mention the four marketplace endpoints with their honest behavior (publish consent-gated via same liveness dialog, install creates NEW unconsented character — binding does NOT transfer, review is manual approve/reject — pHash catches near-duplicate images at publish time, judgment calls happen in the queue).
- Updated roadmap.tsx Phase 5 card: badge from "outline" → "SHIPPED · engine + UI", shipped=true. Body describes the publish/browse/install/review API surface, consent gate via _enforce_consent_gate (same helper, no parallel check), immutable listings with bound_face_hash audit trail, install stripping the binding (NEW unconsented char), 64-bit DCT pHash with Hamming ≤ 10 threshold, auto-approve unflagged + manual review for flagged, 12 marketplace tests + 90 total. Honest-limitation callout: "pHash catches near-duplicate IMAGES only; manual review is where moderation happens" + the consent-gate-can't-prevent-republishing-someone-else's-likeness explanation (install strips binding, attacker re-binds to own face, republishes; pHash catches the duplicate image, consent gate cannot) — references docs/reality-check.md #11 and #12.
- Bonus honesty pass on api-contracts.tsx endpoint table: added 6 marketplace endpoints with their honest purpose strings (publish "consent-gated via _enforce_consent_gate", install "creates a NEW unconsented character — binding does NOT transfer", review "manual approve/reject a pending listing"). Updated contracts/openapi.yaml: added the 6 marketplace paths + MarketplaceListing/PublishRequest/ReviewActionRequest schemas with their 403/404/409 responses spelled out.
- Lint: bun run lint exit 0 (had to remove one unused eslint-disable for @next/next/no-img-element — the <img> tag in ListingThumb didn't trigger the rule because the rule only fires for unoptimized next/image cases that aren't whitelisted).
- Dev server: tail of /home/z/my-project/dev.log shows clean compiles ("✓ Compiled in …") and GET / 200 responses. No errors. /api/health?XTransformPort=3031 returns 404 (expected — Python engine not running in this sandbox; the panel correctly falls into demo mode and shows the amber "Demo mode — engine not connected" badge).
- Claim audit (the lesson from a8e4154 — don't ship copy you haven't verified against the codebase). Walked through every technical claim in marketplace-panel.tsx + roadmap.tsx Phase 5 entry + api-contracts.tsx marketplace rows + contracts/types.ts marketplace helpers + openapi.yaml marketplace schemas against engine code. Verified, including:
  * "_enforce_consent_gate (same helper as live, async render, and voice — no parallel check)" → app.py:248 def, called at 282 (start_session), 402 (create_render), 480 (voice convert), 561 (marketplace_publish). No other consent gate exists.
  * "Only the creator who bound it can publish it" → app.py:551-557 docstring + _enforce_consent_gate:266-270 face_hash check.
  * "the character PNG + metadata are COPIED into an immutable listing" → store.py:8-10 "the listing is immutable once published" + app.py:576-585 create_listing copies image + name + tags.
  * "the publisher's bound_face_hash is recorded as an audit trail but does NOT transfer to installers" → store.py:12-14 docstring + app.py:617-619 install docstring "Creates a NEW unconsented character — the publisher's bound_face_hash does NOT transfer."
  * "POST /api/marketplace/{id}/install creates a NEW unconsented character" → app.py:614-635 + registry.py:138-139 "New chars are consented=False by default" + test_install_creates_unconsented_character asserts installed_char["consented"] is False and get_bound_face_hash(installed_char["id"]) is None.
  * "the new character is registered with source=uploaded and an extra 'marketplace' tag" → app.py:629-634 (CharacterSource.UPLOADED, tags + ["marketplace"]).
  * "computes a 64-bit perceptual hash (DCT-based)" → phash.py:34 HASH_BITS=64, phash.py:21-23 "standard DCT-based pHash".
  * "compares it against every approved listing via the duplicate checker" → review.py:33-39 RealDuplicateChecker.find_near_duplicates iterates store.list_all_with_phash() (store.py:121-127 returns only approved listings).
  * "Hamming distance ≤ 10" → phash.py:35 HAMMING_THRESHOLD=10.
  * "flagged listings stay pending for manual review, unflagged auto-approve" → review.py:71-75 auto_approve_unflagged + app.py:586-589 calls set_review_status("approved", "system-auto") when not flagged.
  * "pHash catches the same PNG re-uploaded (resized, recompressed, minor edits)" → phash.py:7-9 "What pHash catches: exact re-uploads, resized/recompressed copies, minor edits (brightness, cropping)" + test_phash_robust_to_resize + test_phash_identical_images_flagged_as_near_duplicate.
  * "pHash does NOT catch stylistic copies or likeness-of-real-person" → phash.py:11-14 "What pHash does NOT catch: stylistic copies, likeness-of-real-person detection, proof of original authorship."
  * "This is NOT automated moderation — it's automated flagging + human review" → review.py:7-12 exact quote.
  * "the consent gate cannot prevent republishing someone else's likeness" → reality-check.md #98-107 — install strips binding, attacker re-binds to own face, republishes with different bound_face_hash but same image; pHash catches the image, consent gate cannot.
  * "engine returns 409 if listing isn't currently pending" → app.py:644-645 raise HTTPException(409, f"listing already {listing['review_status']}").
  * "engine returns 403 if listing not approved for install" → app.py:624-625 raise HTTPException(403, "listing not approved for install") + test_install_refused_for_non_approved asserts 403.
  * "12 engine tests cover the consent gate / install stripping / pHash identical/different/resize/deterministic / duplicate-image flagging / manual review / install refused / production-path pHash" → pytest --collect-only tests/test_marketplace.py = 12 tests, names match exactly.
  * "total engine test count is now 90" → pytest --collect-only -q = 90 tests collected.
  * Demo flag_reason format `"Near-duplicate of approved listing mp-demo-aoi (Hamming distance 4 <= 10). Manual review required."` → matches engine f-string at review.py:64-68 exactly (ASCII `<=`, same wording).
  The panel never calls the review pipeline a "demo" or "stub" — the engine is shipped (p5-1, 12 tests pass). The only "Simulated" badges describe the client-side demo mode when the Python engine isn't reachable in this sandbox, exactly as voice-panel.tsx and async-render.tsx do.

Stage Summary:
- Phase 5 UI shipped. The marketplace panel matches the existing dark-studio aesthetic, reuses the shared Zustand store + shared LivenessDialog, handles engine-not-connected demo mode honestly (3 simulated Browse listings + simulated publish flow + 1 simulated pending listing with honest "Simulated" badges), and surfaces every engine error case (403/404/409) with a specific remediation hint.
- Every technical claim in the new UI copy was verified against engine/app.py, engine/marketplace/{store,phash,review}.py, engine/models.py, engine/tests/test_marketplace.py, engine/characters/registry.py, and docs/reality-check.md BEFORE the file was written — then re-grepped after writing. The panel deliberately does NOT call the review pipeline "automated moderation" (engine calls it automated flagging + manual review), does NOT claim pHash catches stylistic copies or likeness-of-real-person (phash.py spells out exactly what it does NOT catch), and does NOT claim the consent gate prevents republishing someone else's likeness (reality-check #12).
- Lint clean, dev server clean. Route / only — no new routes added. The shared Zustand store + shared LivenessDialog were reused unchanged (zero churn to the consent flow).
- Phase 5 is now end-to-end shipped (engine + UI). All five phases (1: live, 2: character gen, 3: async render, 4: voice, 5: marketplace) are green on the roadmap.
