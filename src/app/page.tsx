import { SiteHeader } from "@/components/architecture/site-header";
import { Hero } from "@/components/architecture/hero";
import { DecisionCallout } from "@/components/architecture/decision-callout";
import { SystemArchitecture } from "@/components/architecture/system-architecture";
import { RepoTree } from "@/components/architecture/repo-tree";
import { Phase1Mvp } from "@/components/architecture/phase1-mvp";
import { ApiContracts } from "@/components/architecture/api-contracts";
import { Consent } from "@/components/architecture/consent";
import { Roadmap } from "@/components/architecture/roadmap";
import { RealityCheck } from "@/components/architecture/reality-check";
import { StudioSection } from "@/components/architecture/studio-section";
import { Github, Heart } from "lucide-react";

/**
 * animated-self — single-page architecture document + control-panel mockup.
 *
 * The page is a Server Component that composes section components. The only
 * client islands are: the sticky header (active-section highlight), the code
 * viewer (react-syntax-highlighter), the latency bar (no, that's actually
 * server-safe but kept as a client comp for stylistic consistency), and the
 * Studio panel (engine probe + simulated state).
 *
 * Dark studio aesthetic, mobile-first, sticky header + sticky footer.
 */
export default function Page() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <SiteHeader />

      <main className="flex-1">
        <Hero />
        <DecisionCallout />
        <SystemArchitecture />
        <RepoTree />
        <Phase1Mvp />
        <ApiContracts />
        <Consent />
        <Roadmap />
        <RealityCheck />
        <StudioSection />
      </main>

      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer
      className="mt-auto border-t border-neutral-800 bg-neutral-950"
      aria-labelledby="footer-heading"
    >
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-rose-500/15 font-mono text-rose-300">
              a
            </span>
            <div>
              <p className="text-sm font-semibold text-neutral-200">
                animated-self
              </p>
              <p className="text-xs text-neutral-500">
                Neural reenactment for creators who won&apos;t show their face.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-neutral-500">
            <a
              href="#hero"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-neutral-200"
            >
              <Github className="size-3.5" />
              repo
            </a>
            <span className="inline-flex items-center gap-1.5">
              <Heart className="size-3.5 text-rose-400" />
              phase 1 MVP · no cloud round-trip
            </span>
          </div>
        </div>
        <p className="mt-6 text-[11px] leading-relaxed text-neutral-600">
          The browser captures webcam/mic and extracts pose; all neural
          inference is local Python on a CUDA GPU. Source of truth for the API
          is{" "}
          <code className="rounded bg-neutral-900 px-1 py-0.5 font-mono text-neutral-400">
            engine/models.py
          </code>
          , mirrored in{" "}
          <code className="rounded bg-neutral-900 px-1 py-0.5 font-mono text-neutral-400">
            contracts/types.ts
          </code>{" "}
          and{" "}
          <code className="rounded bg-neutral-900 px-1 py-0.5 font-mono text-neutral-400">
            contracts/openapi.yaml
          </code>
          .
        </p>
      </div>
    </footer>
  );
}
