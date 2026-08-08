import { Badge } from "@/components/ui/badge";
import { Section, Surface } from "./section";
import { Cpu, Sparkles, Ban } from "lucide-react";

/**
 * Section 2 — the core technical decision: skip rigging, use neural
 * reenactment. Prominent callout + two sub-bullets + out-of-scope list.
 */
export function DecisionCallout() {
  return (
    <Section
      id="decision"
      eyebrow="Core technical decision"
      title="Skip rigging. Use neural reenactment."
      lede="One reference image + a driving signal (webcam pose or audio) → each output frame synthesized directly. No bones, no mesh, no Live2D layer-tagging."
    >
      <Surface className="overflow-hidden border-rose-500/20">
        <div className="border-b border-neutral-800 bg-gradient-to-br from-rose-500/10 via-transparent to-transparent p-6 sm:p-8">
          <p className="text-base leading-relaxed text-neutral-100 sm:text-lg">
            <span className="font-semibold text-rose-300">
              Skip traditional character rigging.
            </span>{" "}
            Use neural reenactment: one reference image + a driving signal (webcam
            pose or audio) → each output frame synthesized directly.{" "}
            <span className="text-neutral-400">
              No bones, no mesh, no Live2D layer-tagging.
            </span>
          </p>
        </div>

        <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-5">
            <div className="mb-2 flex items-center gap-2">
              <Cpu className="size-4 text-rose-300" />
              <h3 className="text-sm font-semibold text-neutral-100">
                Live path
              </h3>
              <Badge
                variant="outline"
                className="ml-auto border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-200"
              >
                THA3
              </Badge>
            </div>
            <p className="text-sm leading-relaxed text-neutral-400">
              Talking-Head-Anime-3-style poser (single anime image + pose vector
              → frame), distilled for 30+ FPS on consumer GPUs.
            </p>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-5">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="size-4 text-amber-300" />
              <h3 className="text-sm font-semibold text-neutral-100">
                Async quality path
              </h3>
              <Badge
                variant="outline"
                className="ml-auto border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-200"
              >
                Diffusion
              </Badge>
            </div>
            <p className="text-sm leading-relaxed text-neutral-400">
              Diffusion-based audio-driven reenactment (AniPortrait-style),
              offline only. Higher fidelity, minutes-per-second.
            </p>
          </div>
        </div>

        <div className="border-t border-neutral-800 bg-neutral-950/40 p-6 sm:px-8 sm:py-5">
          <div className="flex items-start gap-2 text-sm text-neutral-400">
            <Ban className="mt-0.5 size-4 shrink-0 text-neutral-500" />
            <p>
              <span className="font-semibold text-neutral-300">
                Out of scope for v1:
              </span>{" "}
              full 3D avatars, full-body movement beyond head/shoulders, manual
              Live2D rigging tools.
            </p>
          </div>
        </div>
      </Surface>
    </Section>
  );
}
