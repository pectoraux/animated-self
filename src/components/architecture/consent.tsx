import { Section, Surface } from "./section";
import { ShieldCheck, ShieldAlert } from "lucide-react";

const steps: { title: string; body: string }[] = [
  {
    title: "Grant + selfie",
    body: "Creator grants webcam/mic and records a 5-second selfie video.",
  },
  {
    title: "Randomized motion challenge",
    body: "Performs a randomized motion challenge (e.g. \u201Clook left, then smile\u201D) — proves liveness, not a photo.",
  },
  {
    title: "Face embedding bound",
    body: "App extracts the creator's face embedding from the challenge video; stores a hash binding {creator_account → face_embedding_hash}.",
  },
  {
    title: "Custom-char binding (Phase 2)",
    body: "For custom characters, the reference is cryptographically tied to the liveness embedding — you can only generate/drive an avatar whose consent hash matches the live face currently on camera. Stock characters (Phase 1) bypass this (not a real person's likeness) but still log consent.",
  },
  {
    title: "What it verifies",
    body: "(a) liveness via random challenge; (b) binding between creator account and a real face; (c) for custom chars, that the reference was derived from that same face.",
  },
];

/**
 * Section 7 — Consent & liveness: the anti-deepfake gate.
 * Numbered list + an honest caveat callout.
 */
export function Consent() {
  return (
    <Section
      id="consent"
      eyebrow="Consent & liveness"
      title="The anti-deepfake gate."
      lede="A deterrent plus an audit trail. Not a cryptographic proof — that's stated honestly below — but it defeats the obvious misuse (casual 'drive someone else's avatar') and creates accountability."
    >
      <Surface className="overflow-hidden">
        <ol className="divide-y divide-neutral-800">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-4 p-5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10 font-mono text-xs text-rose-200">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-neutral-100">
                  {s.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-neutral-400">
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Surface>

      <Surface className="mt-6 border-amber-500/30 bg-amber-500/[0.06] p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-400" />
          <div>
            <h3 className="text-sm font-semibold text-amber-200">
              Honest caveat
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-300">
              This is a deterrent + audit trail, not a cryptographic proof.
              Liveness defeats static-photo spoofing; face-embedding binding
              defeats casual &ldquo;drive someone else&apos;s avatar.&rdquo; It
              does <span className="font-semibold text-amber-200">NOT</span>{" "}
              defeat a determined adversary who deepfakes a real-time selfie
              back at the check. Paired with abuse reporting (Phase 5).
            </p>
          </div>
        </div>
      </Surface>

      <Surface className="mt-6 border-emerald-500/20 bg-emerald-500/[0.04] p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-400" />
          <div>
            <h3 className="text-sm font-semibold text-emerald-200">
              Why it&apos;s still worth shipping
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-300">
              Every consent event is logged with a challenge video hash + a
              landmark hash. That audit trail is what makes abuse reporting
              (Phase 5) actionable — without it, you&apos;re just trusting the
              uploader.
            </p>
          </div>
        </div>
      </Surface>
    </Section>
  );
}
