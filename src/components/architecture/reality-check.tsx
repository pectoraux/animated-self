import { Section, Surface } from "./section";
import { AlertTriangle } from "lucide-react";

interface Flag {
  num: number;
  title: string;
  body: string;
  severity: "amber" | "red";
}

const flags: Flag[] = [
  {
    num: 1,
    title: "No real-time full-body neural reenactment",
    body:
      "Out of scope, and not close. THA3 drives head+shoulders only; full-body at 30fps doesn't exist in open source at usable quality.",
    severity: "red",
  },
  {
    num: 2,
    title: "THA3 live needs a discrete GPU",
    body:
      "Integrated graphics miss the budget. On CPU THA3 is ~200ms+ (unusable). <100ms is only achievable on CUDA. We surface this via /api/health → capabilities.cuda.",
    severity: "red",
  },
  {
    num: 3,
    title: "No real-time audio-driven anime lip-sync in open source",
    body:
      "SadTalker/Wav2Lip approach real-time but aren't anime-native and quality is below THA3. So v1 live is video-driven; audio-driven is async-only.",
    severity: "amber",
  },
  {
    num: 4,
    title: "Diffusion anime reenactment is NOT interactive speed",
    body:
      "AniPortrait/EchoMimic are minutes-per-second. Anyone claiming real-time diffusion anime reenactment is misrepresenting throughput. Phase 3 is explicitly offline.",
    severity: "red",
  },
  {
    num: 5,
    title: "THA3 degrades outside training distribution",
    body:
      "Large head yaw/pitch (>~0.5 rad), hands in frame, extreme expressions → artifacts. Async diffusion is the quality escape hatch.",
    severity: "amber",
  },
  {
    num: 6,
    title: "Virtual camera requires a driver install",
    body:
      "Win/Mac need OBS Studio; Linux needs v4l2loopback. No pure-software workaround.",
    severity: "amber",
  },
  {
    num: 7,
    title: "Consent/liveness is a deterrent, not a cryptographic proof",
    body: "See the consent section — a determined adversary can still spoof the check.",
    severity: "amber",
  },
  {
    num: 8,
    title: "BYOK means the app can't SLA character-generation quality",
    body: "Generation latency/quality vary per user's key.",
    severity: "amber",
  },
];

const severityClasses: Record<Flag["severity"], string> = {
  amber: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/[0.05]",
    icon: "text-amber-400",
    num: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  },
  red: {
    border: "border-red-500/30",
    bg: "bg-red-500/[0.05]",
    icon: "text-red-400",
    num: "border-red-500/40 bg-red-500/10 text-red-200",
  },
};

/**
 * Section 9 — Reality check. Honest flags about where open-source can't hit
 * the bar today. Mirrors docs/reality-check.md.
 */
export function RealityCheck() {
  return (
    <Section
      id="reality-check"
      eyebrow="Reality check"
      title="Where open-source can't hit the bar today."
      lede="An honest list of things this stack does NOT do, and why. The point is to set expectations on day one rather than discover them at launch."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {flags.map((f) => {
          const c = severityClasses[f.severity];
          return (
            <Surface key={f.num} className={`${c.border} ${c.bg} p-5`}>
              <div className="flex items-start gap-3">
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold ${c.num}`}
                >
                  {f.num}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`size-4 ${c.icon}`} />
                    <h3 className="text-sm font-semibold text-neutral-100">
                      {f.title}
                    </h3>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">
                    {f.body}
                  </p>
                </div>
              </div>
            </Surface>
          );
        })}
      </div>
    </Section>
  );
}
