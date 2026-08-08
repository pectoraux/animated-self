import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Info } from "lucide-react";
import { Section, Surface } from "./section";

interface Phase {
  num: string;
  title: string;
  badge: string;
  badgeTone: string;
  body: string;
  shipped?: boolean;
  callout?: {
    icon: "info" | "warning";
    title: string;
    body: string;
  };
}

const phases: Phase[] = [
  {
    num: "2",
    title: "Custom character generation",
    badge: "SHIPPED · engine + UI",
    badgeTone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    body:
      "BYOK LLM/image-gen (user supplies an OpenAI key; the app never bills). Three routes — text prompt → anime character sheet, selfie → anime character (description-based), and raw PNG upload. Generated characters start consented=false and cannot be driven until the creator completes a liveness challenge and binds the avatar to their face via /api/characters/{id}/consent/bind. The generated PNG drops into the same characters/ registry and uses the identical THA3 pipeline — no inference-layer change. 46 engine tests pass.",
    shipped: true,
    callout: {
      icon: "info",
      title: "Honest limitation — selfie is description-based, not identity-preserving",
      body:
        "Selfie→anime is NOT pixel-level identity transfer. The engine uses a VLM to describe the selfie (hair, palette, framing), then forwards that description to the image model. Two different selfies of the same person will produce two different anime characters. Real identity-preserving img2img is Phase 3+.",
    },
  },
  {
    num: "3",
    title: "Diffusion quality mode (async)",
    badge: "outline",
    badgeTone: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    body:
      "Integrate an AniPortrait-style audio-driven reenactment model behind the existing POST /api/render contract. Higher fidelity than THA3 (lip-sync, subtle expression), minutes-per-second, offline only. Adds a render queue and storage; control panel shows job progress. Real-time path unchanged.",
  },
  {
    num: "4",
    title: "Voice conversion",
    badge: "outline",
    badgeTone: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    body:
      "Optional audio pipeline: creator's mic → RVC-style voice converter → avatar's voice. Inserted between capture and OBS audio output. BYOK for cloud voice models; local RVC for low latency. Live mode adds ~20–40ms.",
  },
  {
    num: "5",
    title: "Marketplace",
    badge: "outline",
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
            <span
              className={`absolute -left-[1.95rem] flex size-8 items-center justify-center rounded-full border font-mono text-sm font-semibold ${
                p.shipped
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/40 bg-neutral-950 text-rose-300"
              }`}
            >
              {p.shipped ? (
                <CheckCircle2 className="size-4" />
              ) : (
                p.num
              )}
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
              {p.callout ? (
                <div
                  className={`mt-4 flex items-start gap-3 rounded-lg border p-3 ${
                    p.callout.icon === "warning"
                      ? "border-amber-500/30 bg-amber-500/[0.06]"
                      : "border-rose-500/30 bg-rose-500/[0.06]"
                  }`}
                >
                  <Info
                    className={`mt-0.5 size-4 shrink-0 ${
                      p.callout.icon === "warning"
                        ? "text-amber-400"
                        : "text-rose-300"
                    }`}
                  />
                  <div>
                    <p
                      className={`text-xs font-semibold ${
                        p.callout.icon === "warning"
                          ? "text-amber-200"
                          : "text-rose-200"
                      }`}
                    >
                      {p.callout.title}
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-neutral-400">
                      {p.callout.body}
                    </p>
                  </div>
                </div>
              ) : null}
            </Surface>
          </li>
        ))}
      </ol>
    </Section>
  );
}
