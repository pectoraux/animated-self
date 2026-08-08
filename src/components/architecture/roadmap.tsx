import { Badge } from "@/components/ui/badge";
import { Section, Surface } from "./section";

interface Phase {
  num: string;
  title: string;
  badge: string;
  badgeTone: string;
  body: string;
}

const phases: Phase[] = [
  {
    num: "2",
    title: "Custom character generation",
    badge: "BYOK · image-gen",
    badgeTone: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    body:
      "BYOK LLM/image-gen (user supplies an OpenAI/Stability/etc key; app never bills). Two routes: (a) text prompt → anime character sheet; (b) upload a selfie → anime-style transfer with identity preservation. Generated characters go through the liveness/consent binding. The generated PNG drops into the same characters/ registry and uses the identical THA3 pipeline — no inference-layer change.",
  },
  {
    num: "3",
    title: "Diffusion quality mode (async)",
    badge: "audio-driven",
    badgeTone: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    body:
      "Integrate an AniPortrait-style audio-driven reenactment model behind the existing POST /api/render contract. Higher fidelity than THA3 (lip-sync, subtle expression), minutes-per-second, offline only. Adds a render queue and storage; control panel shows job progress. Real-time path unchanged.",
  },
  {
    num: "4",
    title: "Voice conversion",
    badge: "audio",
    badgeTone: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    body:
      "Optional audio pipeline: creator's mic → RVC-style voice converter → avatar's voice. Inserted between capture and OBS audio output. BYOK for cloud voice models; local RVC for low latency. Live mode adds ~20–40ms.",
  },
  {
    num: "5",
    title: "Marketplace",
    badge: "distribution",
    badgeTone: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    body:
      "Discoverable stock + creator-published character packs (consent-bound). Distribution, licensing, and a lightweight review pipeline to reject non-consensual likeness uploads. Characters are just registry entries + signed consent artifacts; the inference stack is untouched.",
  },
];

/**
 * Section 8 — phased roadmap after Phase 1, as a vertical timeline.
 */
export function Roadmap() {
  return (
    <Section
      id="roadmap"
      eyebrow="Roadmap"
      title="After Phase 1."
      lede="Each phase is additive: it reuses the existing contracts and the THA3 inference stack. No phase rearchitects a previous one."
    >
      <ol className="relative space-y-6 border-l border-neutral-800 pl-6">
        {phases.map((p) => (
          <li key={p.num} className="relative">
            {/* timeline node */}
            <span className="absolute -left-[1.95rem] flex size-8 items-center justify-center rounded-full border border-rose-500/40 bg-neutral-950 font-mono text-sm font-semibold text-rose-300">
              {p.num}
            </span>
            <Surface className="p-5 sm:p-6">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-neutral-100">
                  Phase {p.num} — {p.title}
                </h3>
                <Badge variant="outline" className={`text-[10px] ${p.badgeTone}`}>
                  {p.badge}
                </Badge>
              </div>
              <p className="text-sm leading-relaxed text-neutral-400">
                {p.body}
              </p>
            </Surface>
          </li>
        ))}
      </ol>
    </Section>
  );
}
