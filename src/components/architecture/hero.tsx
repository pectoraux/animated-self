import { Badge } from "@/components/ui/badge";
import { Gauge, Webcam, KeyRound } from "lucide-react";

/**
 * Hero — product name, tagline, one paragraph, three stat chips.
 */
export function Hero() {
  return (
    <section
      id="hero"
      aria-labelledby="hero-title"
      className="relative overflow-hidden border-b border-neutral-800/80"
    >
      {/* ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, rgba(244,63,94,0.18) 0%, rgba(244,63,94,0) 60%), radial-gradient(40% 40% at 80% 30%, rgba(245,158,11,0.10) 0%, rgba(245,158,11,0) 60%)",
        }}
      />
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-mono uppercase tracking-[0.2em] text-rose-300">
          <span className="size-1.5 rounded-full bg-rose-400 animate-pulse" />
          architecture doc · phase 1 MVP
        </p>
        <h1
          id="hero-title"
          className="text-5xl font-semibold tracking-tight text-neutral-50 sm:text-7xl"
        >
          animated<span className="text-rose-400">-</span>self
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-neutral-300 sm:text-xl">
          An AI-native animated self for creators who won&apos;t show their face
          on camera.
        </p>
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-neutral-400 sm:text-base">
          Webcam expressions and voice drive a real-time anime avatar in place of
          the creator&apos;s real face, delivered to the OBS Virtual Camera (live)
          or a rendered MP4 (async). Built on neural reenactment — no rigging,
          no Live2D.
        </p>

        <div className="mt-8 flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 border-rose-500/30 bg-rose-500/10 px-3 py-1 text-rose-200"
          >
            <Gauge className="size-3.5" />
            Live &lt;100ms glass-to-glass
          </Badge>
          <Badge
            variant="outline"
            className="gap-1.5 border-neutral-700 bg-neutral-900 px-3 py-1 text-neutral-200"
          >
            <Webcam className="size-3.5" />
            OBS Virtual Cam out
          </Badge>
          <Badge
            variant="outline"
            className="gap-1.5 border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-200"
          >
            <KeyRound className="size-3.5" />
            BYOK (no model billing)
          </Badge>
        </div>
      </div>
    </section>
  );
}
