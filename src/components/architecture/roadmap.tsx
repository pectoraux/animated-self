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
    badge: "SHIPPED · engine + UI",
    badgeTone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    body:
      "Real async render queue + worker behind the existing POST /api/render contract. Jobs transition queued → running → rendering → done (or failed) with progress polling every 500ms, and the finished MP4 is served from GET /api/render/{job_id}/file. The consent gate applies to async renders too — a bound character's face_hash is checked on every render request, matching the live path. DiffusionRenderer runs whatever audio-driven reenactment command you configure via DIFFUSION_RENDER_CMD (an AniPortrait-style setup, or anything honoring the same reference-image + audio-in, MP4-out contract) — there is no bundled default model, for the same reason THA3's weights aren't bundled: we can't verify or redistribute either one here. 64 engine tests pass, covering the queue/job lifecycle, the consent gate, and the subprocess contract itself (using a stand-in command, not a real model). The control panel surfaces the queue as an Async Render card with status badges, a progress bar, and a Download MP4 button.",
    shipped: true,
    callout: {
      icon: "warning",
      title:
        "Honest limitation — no renderer is bundled; you configure one",
      body:
        "The render pipeline (queue, consent gate, progress tracking, MP4 delivery) is real and tested end to end. What it drives is not: DIFFUSION_RENDER_CMD is unset by default, so /api/render fails clearly until you point it at a real audio-driven diffusion renderer you've set up yourself. No open-source model reliably hits anime-style audio-driven lip-sync at usable quality yet — see docs/reality-check.md.",
    },
  },
  {
    num: "4",
    title: "Voice conversion",
    badge: "SHIPPED · engine + UI",
    badgeTone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    body:
      "Async voice conversion (file in, file out) behind POST /api/voice/convert — the creator's mic audio is base64-encoded, the engine runs the configured converter on a temp file, and the converted WAV is served from GET /api/voice/{out_id}/download (in-process store; durable storage is Phase 5). The consent gate applies for bound custom characters via the same _enforce_consent_gate as live sessions and async renders — converting audio to sound like someone's avatar is identity-affecting. Two real backends, same pattern as the diffusion renderer: ExternalCommandConverter runs VOICE_CONVERT_CMD (an RVC CLI or anything honoring the audio-in, audio-out contract — no model is bundled or verified), and CloudConverter does BYOK HTTPS (ElevenLabs speech-to-speech today, api_key per-request, never persisted). Selection priority is cmd > cloud > none. If neither env var is set, /api/voice/convert returns 503 — voice conversion is genuinely unavailable, not faked. 13 engine tests cover selection, the subprocess contract, the consent gate (locked / unrelated-token / matching-token / stock), the 503 unconfigured case, and the download endpoint; total engine test count is now 77. The control panel surfaces this as a Voice Conversion card with character picker, audio upload, optional BYOK API key field, and a result panel that distinguishes live-success (Download WAV), demo-simulated (disabled button + honest note), and the 503/403/502/400 error cases.",
    shipped: true,
    callout: {
      icon: "warning",
      title:
        "Honest limitation — live /ws/voice is not wired; no model is bundled",
      body:
        "The async path (POST /api/voice/convert) is real and tested end to end with a stand-in command. What it drives is not: VOICE_CONVERT_CMD is unset by default, so /api/voice/convert returns 503 until you point it at a real RVC setup you've configured yourself — we don't bundle or verify a specific model, for the same reason THA3's weights and DIFFUSION_RENDER_CMD aren't bundled (see docs/reality-check.md). The live voice path (/ws/voice) is defined as a contract but not wired in v1 — live voice needs a virtual audio device (VB-Cable on Windows, BlackHole on macOS, pulseaudio null sink on Linux) for OBS to pick up the converted stream, the same class of driver-install requirement as the virtual camera. Async is the v1 path; live voice is a future phase.",
    },
  },
  {
    num: "5",
    title: "Marketplace",
    badge: "SHIPPED · engine + UI",
    badgeTone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    body:
      "Discoverable character packs behind a real publish / browse / install / review API. POST /api/marketplace/publish (consent-gated via the same _enforce_consent_gate as live, async render, and voice — the consent_token's face_hash must match the character's bound_face_hash) copies the character PNG + metadata into an immutable listing and records the publisher's bound_face_hash as an audit trail. GET /api/marketplace returns approved listings; GET /api/marketplace/pending returns the review queue. POST /api/marketplace/{id}/install creates a NEW unconsented character in the local registry — the publisher's binding does NOT transfer (the installer must run their own liveness to drive it). At publish time the engine computes a 64-bit DCT perceptual hash of the character PNG and compares it against every approved listing (Hamming distance ≤ 10 = near-duplicate); flagged listings stay pending for manual review, unflagged ones auto-approve. POST /api/marketplace/{id}/review is manual approve/reject — the judgment calls happen here, not in code. The inference stack is untouched — a marketplace character is just a registry entry + a copied PNG. 12 engine tests cover the consent gate (matching/wrong/no token), install stripping the binding, pHash identical/different/resize-robust/deterministic, duplicate-image flagging, manual review, install refused for non-approved, and a production-path test that runs the real pHash + real duplicate checker (not injected fakes). Total engine test count is now 90. The control panel surfaces this as a Marketplace card with Browse (approved grid + Install), Publish (consented-char picker + liveness + publisher ID + result panel that shows review_status and the honest flag_reason when flagged), and Moderator (pending queue + Approve/Reject) tabs.",
    shipped: true,
    callout: {
      icon: "warning",
      title:
        "Honest limitation — pHash catches near-duplicate IMAGES only; manual review is where moderation happens",
      body:
        "The pHash near-duplicate check at publish time is automated flagging, NOT automated moderation. It catches the same PNG re-uploaded (resized, recompressed, minor brightness edits) because the DCT hash is robust to those transforms. It does NOT catch: stylistic copies (different art of a similar-looking character), likeness-of-real-person detection (that needs a face-embedding model this project doesn't have), or proof of original authorship (an IP/DMCA problem). The manual review queue is where the real moderation happens. Separately, the consent gate cannot prevent republishing someone else's likeness: an attacker can install a marketplace character (which strips the binding), re-bind it to their own face via their own liveness, and republish — the new listing has a different bound_face_hash but the same image. pHash catches the duplicate image; the consent gate cannot. This is the honest boundary between identity-binding (what the consent gate does) and likeness-IP (what the review queue + takedown do). See docs/reality-check.md #11 and #12.",
    },
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
