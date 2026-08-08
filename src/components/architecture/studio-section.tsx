import { Section, Surface } from "./section";
import { StudioPanel } from "@/components/studio/studio-panel";
import { CreateCharacter } from "@/components/studio/create-character";
import { AsyncRender } from "@/components/studio/async-render";
import { VoicePanel } from "@/components/studio/voice-panel";

/**
 * Section 10 — the interactive Studio control panel mockup + the Phase 2
 * Create Character panel + the Phase 3 Async Render panel + the Phase 4
 * Voice Conversion panel.
 *
 * Order: Create Character first (because created chars appear in the picker
 * below), then Studio (which reads the same shared character store), then
 * Async Render (which reads the same store and reuses the same liveness
 * dialog for bound-char re-consent), then Voice Conversion (same store,
 * same liveness dialog, async file-in file-out instead of MP4 job).
 */
export function StudioSection() {
  return (
    <Section
      id="studio"
      eyebrow="Control panel"
      title="Studio — interactive mockup."
      lede="The live-mode UX. Create a character (Phase 2 — text / selfie / upload, with consent binding), then drive it live (Phase 1), render offline (Phase 3 — async queue + MP4 download), or convert audio to the avatar's voice (Phase 4 — async file-in, WAV out). In this sandbox there's no GPU and no virtual-cam driver, so the panels probe /api/health and fall back to demo mode with simulated stats. Run the Python engine and they light up green."
    >
      <CreateCharacter />

      <div className="mt-6">
        <StudioPanel />
      </div>

      <div className="mt-6">
        <AsyncRender />
      </div>

      <div className="mt-6">
        <VoicePanel />
      </div>

      <Surface className="mt-6 bg-neutral-950/40 p-5">
        <p className="text-xs leading-relaxed text-neutral-500">
          <span className="font-semibold text-neutral-300">Note:</span> in demo
          mode the panels use three stock characters (Aoi, Ren, Yuki) and
          synthesize FPS/latency readouts. When the real engine responds at{" "}
          <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-rose-200">
            /api/health?XTransformPort=3031
          </code>
          , the badge turns green and the panels pull the real character list
          from{" "}
          <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-amber-200">
            /api/characters
          </code>
          . Generated characters created above appear here automatically —
          locked until liveness is complete. The async render panel polls{" "}
          <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-rose-200">
            /api/render/{`{job_id}`}
          </code>{" "}
          every 500ms and serves the MP4 from{" "}
          <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-rose-200">
            /api/render/{`{job_id}`}/file
          </code>
          . The voice panel POSTs{" "}
          <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-rose-200">
            /api/voice/convert
          </code>{" "}
          and serves the WAV from{" "}
          <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-rose-200">
            /api/voice/{`{out_id}`}/download
          </code>{" "}
          — both consent-gated for bound characters via the shared liveness
          dialog.
        </p>
      </Surface>
    </Section>
  );
}
