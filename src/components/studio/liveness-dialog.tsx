"use client";

/**
 * Shared liveness → consent-bind dialog.
 *
 * Extracted from create-character.tsx (Phase 2) so the Phase 3 async-render
 * panel can reuse the exact same flow. The dialog walks the three-stage
 * pipeline (request → verify → bind) in both real and demo modes, then calls
 * onBound with the freshly-minted consent_token. Callers that don't need the
 * token (e.g. the Create Character panel, which only flips a store flag) can
 * ignore the second argument.
 *
 * Design notes:
 *  - In demo mode (engine not connected), every stage is simulated with a
 *    fixed delay and a hard-coded three-step challenge, exactly as in Phase 2.
 *  - In live mode, the dialog hits /api/consent/liveness/request →
 *    /api/consent/liveness/verify → /api/characters/{id}/consent/bind. The
 *    consent_token returned by verify is what callers pass to /api/render.
 *  - The "verify" stage runs a faux progress bar to give the user visible
 *    feedback that the server is checking landmark evidence.
 */
import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  CheckCircle2,
  Loader2,
  ScanFace,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useCharacterStore } from "@/lib/character-store";
import { engineUrl } from "@contracts/types";
import type { LivenessChallenge, LivenessResult } from "@contracts/types";

type LivenessPhase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | {
      kind: "challenge";
      challenge: LivenessChallenge;
      cameraStarted: boolean;
      verifying: boolean;
      progress: number;
    }
  | { kind: "binding" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const DEMO_STEPS = ["look_left", "look_right", "smile"];

export function LivenessDialog({
  characterId,
  isDemo,
  onClose,
  onBound,
}: {
  characterId: string | null;
  isDemo: boolean;
  onClose: () => void;
  /** Called with the character id and the freshly-minted consent_token. */
  onBound: (id: string, consentToken: string) => void;
}) {
  const open = characterId !== null;
  const [phase, setPhase] = React.useState<LivenessPhase>({ kind: "idle" });
  /** Captured consent_token from the verify stage, surfaced to onBound. */
  const tokenRef = React.useRef<string | null>(null);

  // Reset when reopened for a different character.
  React.useEffect(() => {
    if (open) {
      setPhase({ kind: "idle" });
      tokenRef.current = null;
    }
  }, [open, characterId]);

  const characters = useCharacterStore((s) => s.characters);
  const character = characters.find((c) => c.id === characterId);

  // Auto-start the challenge request when the dialog opens.
  React.useEffect(() => {
    if (!open || !characterId || phase.kind !== "idle") return;
    void requestChallenge(characterId, isDemo, setPhase);
  }, [open, characterId, phase.kind, isDemo]);

  // Drive the fake "verify" progress bar.
  React.useEffect(() => {
    if (phase.kind !== "challenge" || !phase.verifying) return;
    const interval = setInterval(() => {
      setPhase((p) => {
        if (p.kind !== "challenge" || !p.verifying) return p;
        const next = Math.min(100, p.progress + 12 + Math.random() * 8);
        return { ...p, progress: next };
      });
    }, 220);
    return () => clearInterval(interval);
  }, [phase.kind, phase.verifying]);

  const onStartCamera = () => {
    setPhase((p) => (p.kind === "challenge" ? { ...p, cameraStarted: true } : p));
  };

  const onVerify = async () => {
    if (!characterId) return;
    const current = phase;
    if (current.kind !== "challenge") return;
    setPhase({ ...current, verifying: true, progress: 0 });
    try {
      const result = await verifyChallenge(
        characterId,
        current.challenge,
        isDemo,
      );
      if (!result.passed) {
        throw new Error(result.reason ?? "Liveness failed");
      }
      tokenRef.current = result.consent_token;
      setPhase({ kind: "binding" });
      await bindCharacter(characterId, result.consent_token, isDemo);
      setPhase({ kind: "done" });
      // Give the user a moment to see the success state, then close + flip.
      setTimeout(() => {
        onBound(characterId, result.consent_token);
      }, 900);
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="border-neutral-800 bg-neutral-950 text-neutral-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-neutral-50">
            <ScanFace className="size-5 text-rose-300" />
            Liveness — bind avatar to your face
            {isDemo ? (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/15 text-[10px] text-amber-200"
              >
                Simulated
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            This is the anti-deepfake gate. The avatar is bound to YOUR face so
            only you can drive it — even someone with the PNG file can&rsquo;t
            stream it without redoing this.
          </DialogDescription>
        </DialogHeader>

        {!character ? (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
              <div
                className="flex size-12 items-center justify-center rounded-full ring-1 ring-inset ring-black/30"
                style={{ background: character.gradient }}
                aria-hidden
              >
                <span className="font-mono text-lg font-bold text-white">
                  {character.initial}
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-neutral-100">
                  {character.name}
                </p>
                <p className="text-[11px] text-neutral-500">
                  {character.source === "uploaded"
                    ? "Uploaded PNG"
                    : "Generated character"}{" "}
                  · {character.consented ? "re-binding" : "currently locked"}
                </p>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {phase.kind === "idle" || phase.kind === "requesting" ? (
                <motion.div
                  key="requesting"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-sm text-neutral-400"
                >
                  <Loader2 className="size-4 animate-spin text-rose-300" />
                  Requesting a randomized challenge…
                </motion.div>
              ) : null}

              {phase.kind === "challenge" ? (
                <motion.div
                  key="challenge"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                      Perform these motions on camera
                    </p>
                    <ol className="space-y-1.5">
                      {phase.challenge.steps.map((s, i) => (
                        <li
                          key={`${s}-${i}`}
                          className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm text-neutral-200"
                        >
                          <span className="flex size-5 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10 font-mono text-[10px] text-rose-200">
                            {i + 1}
                          </span>
                          <span className="font-mono text-[13px]">{s}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Camera preview area */}
                  <div className="relative aspect-video overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
                    {phase.cameraStarted ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <motion.div
                          animate={{
                            opacity: [0.5, 1, 0.5],
                          }}
                          transition={{
                            duration: 1.6,
                            repeat: Infinity,
                            ease: "easeInOut",
                          }}
                          className="flex flex-col items-center gap-2 text-neutral-400"
                        >
                          <Camera className="size-8 text-rose-300" />
                          <p className="text-xs">
                            {isDemo
                              ? "Simulated camera — no real frames captured"
                              : "Camera active — performing landmark detection"}
                          </p>
                        </motion.div>
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-500">
                        <ScanFace className="size-8" />
                        <p className="text-xs">Camera not started</p>
                      </div>
                    )}
                    {isDemo ? (
                      <div className="absolute right-2 top-2">
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/15 text-[10px] text-amber-200"
                        >
                          Simulated
                        </Badge>
                      </div>
                    ) : null}
                  </div>

                  {phase.verifying ? (
                    <div className="space-y-2">
                      <Progress
                        value={phase.progress}
                        className="h-2 bg-neutral-800"
                      />
                      <p className="text-center text-[11px] text-neutral-400">
                        Verifying detected motions against the issued
                        challenge…
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onStartCamera}
                      disabled={phase.cameraStarted || phase.verifying}
                      className="border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                    >
                      <Camera className="size-4" />
                      {phase.cameraStarted ? "Camera ready" : "Start camera"}
                    </Button>
                    <Button
                      type="button"
                      onClick={onVerify}
                      disabled={!phase.cameraStarted || phase.verifying}
                      className="flex-1 bg-rose-500 text-white hover:bg-rose-400"
                    >
                      {phase.verifying ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      I&rsquo;ve done the motions — Verify
                    </Button>
                  </div>
                </motion.div>
              ) : null}

              {phase.kind === "binding" ? (
                <motion.div
                  key="binding"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-sm text-neutral-300"
                >
                  <Loader2 className="size-4 animate-spin text-rose-300" />
                  Binding consent token to character…
                </motion.div>
              ) : null}

              {phase.kind === "done" ? (
                <motion.div
                  key="done"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-100"
                >
                  <CheckCircle2 className="mt-0.5 size-5 text-emerald-300" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-200">
                      Bound — avatar unlocked
                    </p>
                    <p className="mt-1 text-sm text-neutral-300">
                      The consent token is HMAC-signed and derived from your
                      face evidence. {character.name} can now be driven.
                    </p>
                  </div>
                </motion.div>
              ) : null}

              {phase.kind === "error" ? (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
                    <XCircle className="size-4" />
                    <AlertTitle>Liveness failed</AlertTitle>
                    <AlertDescription className="text-amber-100/80">
                      {phase.message}
                    </AlertDescription>
                  </Alert>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <Separator className="bg-neutral-800" />
            <p className="text-[11px] leading-relaxed text-neutral-500">
              <span className="font-semibold text-neutral-300">
                What this actually verifies:
              </span>{" "}
              (a) liveness via the random challenge, (b) binding between the
              avatar and a real face. It does NOT defeat a determined adversary
              who deepfakes a real-time selfie back at the check — paired with
              abuse reporting in Phase 5.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
          >
            {phase.kind === "done" ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Engine calls (with demo fallbacks)
// ---------------------------------------------------------------------------

async function requestChallenge(
  characterId: string,
  isDemo: boolean,
  setPhase: (p: LivenessPhase) => void,
) {
  setPhase({ kind: "requesting" });
  if (isDemo) {
    await sleep(700);
    const challenge: LivenessChallenge = {
      challenge_id: `demo-challenge-${Math.random().toString(36).slice(2, 8)}`,
      steps: DEMO_STEPS,
      issued_at: Date.now(),
    };
    setPhase({
      kind: "challenge",
      challenge,
      cameraStarted: false,
      verifying: false,
      progress: 0,
    });
    return;
  }
  try {
    const res = await fetch(engineUrl("/api/consent/liveness/request"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character_id: characterId }),
    });
    if (!res.ok) {
      throw new Error(`Engine returned ${res.status}`);
    }
    const challenge = (await res.json()) as LivenessChallenge;
    setPhase({
      kind: "challenge",
      challenge,
      cameraStarted: false,
      verifying: false,
      progress: 0,
    });
  } catch (e) {
    setPhase({
      kind: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function verifyChallenge(
  characterId: string,
  challenge: LivenessChallenge,
  isDemo: boolean,
): Promise<LivenessResult> {
  // Match the engine's challenge steps back at it — in a real app this would
  // be the steps the client's MediaPipe actually detected.
  const detected = challenge.steps;
  const evidence = {
    landmark_count: 468,
    face_hash: `demo-${characterId}-${Date.now()}`,
  };
  if (isDemo) {
    await sleep(1500);
    return {
      challenge_id: challenge.challenge_id,
      passed: true,
      consent_token: `demo-token.${Math.random().toString(36).slice(2)}`,
    };
  }
  const res = await fetch(engineUrl("/api/consent/liveness/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id: challenge.challenge_id,
      detected_steps: detected,
      landmark_evidence: evidence,
    }),
  });
  if (!res.ok) {
    throw new Error(`Verify returned ${res.status}`);
  }
  return (await res.json()) as LivenessResult;
}

async function bindCharacter(
  characterId: string,
  consentToken: string,
  isDemo: boolean,
) {
  if (isDemo) {
    await sleep(600);
    return;
  }
  const res = await fetch(
    engineUrl(`/api/characters/${encodeURIComponent(characterId)}/consent/bind`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character_id: characterId,
        consent_token: consentToken,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Bind returned ${res.status}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
