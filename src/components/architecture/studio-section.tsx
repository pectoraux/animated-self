import { Section, Surface } from "./section";
import { StudioPanel } from "@/components/studio/studio-panel";

/**
 * Section 10 — the interactive Studio control panel mockup.
 * The StudioPanel is a client component (engine probe + simulated state).
 */
export function StudioSection() {
  return (
    <Section
      id="studio"
      eyebrow="Control panel"
      title="Studio — interactive mockup."
      lede="The live-mode UX. In this sandbox there's no GPU and no virtual-cam driver, so the panel probes /api/health and falls back to demo mode with simulated stats. Run the Python engine and it lights up green."
    >
      <StudioPanel />

      <Surface className="mt-6 bg-neutral-950/40 p-5">
        <p className="text-xs leading-relaxed text-neutral-500">
          <span className="font-semibold text-neutral-300">Note:</span> in demo
          mode the panel uses three stock characters (Aoi, Ren, Yuki) and
          synthesizes FPS/latency readouts. When the real engine responds at{" "}
          <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-rose-200">
            /api/health?XTransformPort=3031
          </code>
          , the badge turns green and the panel pulls the real character list
          from{" "}
          <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-amber-200">
            /api/characters
          </code>
          .
        </p>
      </Surface>
    </Section>
  );
}
