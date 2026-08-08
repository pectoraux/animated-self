"use client";

/**
 * Phase 4 — Voice Conversion panel.
 *
 * Async, file-in / file-out: pick a character, upload an audio clip, and POST
 * it to /api/voice/convert. The engine runs whatever converter the operator
 * configured — an external command (VOICE_CONVERT_CMD, typically an RVC CLI)
 * or a BYOK cloud provider (VOICE_CLOUD_PROVIDER, e.g. ElevenLabs). If
 * neither env var is set the engine returns 503 "not configured" — we surface
 * that honestly, we do NOT fake a successful conversion in live mode.
 *
 * Consent gate (same shared _enforce_consent_gate as live + async render):
 * a bound custom character (consented=true, source=generated/uploaded)
 * requires a fresh consent_token from liveness. Stock characters convert
 * immediately. The panel surfaces a "Re-run liveness to convert" CTA that
 * opens the shared LivenessDialog; on success the captured token is sent with
 * the convert request.
 *
 * Demo mode (engine not connected — the sandbox state): the panel shares
 * `engineConnected` from the Zustand store. When false, the Convert button
 * simulates a successful conversion after ~2s with a "Simulated" badge, and
 * the download button is disabled with an honest note that no real file is
 * produced.
 *
 * What this panel deliberately does NOT claim:
 *  - It does not claim live voice conversion works. The /ws/voice contract is
 *    defined (see engine/app.py comments) but the live audio path is not wired
 *    in v1 — live voice needs a virtual audio device for OBS, same class of
 *    driver-install requirement as the virtual camera (see docs/reality-check.md).
 *  - It does not claim a specific RVC model is bundled. The operator points
 *    VOICE_CONVERT_CMD at whatever they have set up.
 */
import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  AudioLines,
  CheckCircle2,
  CircleAlert,
  Download,
  KeyRound,
  Loader2,
  Lock,
  Mic,
  ScanFace,
  Sparkles,
  Waves,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useCharacterStore, type UiCharacter } from "@/lib/character-store";
import { LivenessDialog } from "@/components/studio/liveness-dialog";
import { voiceConvertUrl, voiceDownloadUrl } from "@contracts/types";
import type { VoiceConvertRequest, VoiceConvertResult } from "@contracts/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConvertState =
  | { kind: "idle" }
  | { kind: "converting"; demo: boolean }
  | {
      kind: "done";
      demo: boolean;
      outId: string | null; // null in demo mode (no real file)
      elapsedMs: number;
    }
  | { kind: "error"; message: string; status?: number };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoicePanel() {
  const characters = useCharacterStore((s) => s.characters);
  const selectedId = useCharacterStore((s) => s.selectedId);
  const setSelected = useCharacterStore((s) => s.setSelected);
  const engineConnected = useCharacterStore((s) => s.engineConnected);

  const [audioFile, setAudioFile] = React.useState<File | null>(null);
  /**
   * BYOK cloud API key. The engine doesn't tell us whether it's configured
   * for the external-command converter (which ignores the key) or the cloud
   * converter (which requires it) — we surface the field in live mode and
   * let the operator decide. The engine validates per-request.
   */
  const [apiKey, setApiKey] = React.useState("");

  /** Fresh consent_token from liveness; required to convert a bound char. */
  const [consentToken, setConsentToken] = React.useState<string | null>(null);
  const [activeLiveness, setActiveLiveness] = React.useState(false);

  const [state, setState] = React.useState<ConvertState>({ kind: "idle" });
  const [busy, setBusy] = React.useState(false);

  const demoTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = characters.find((c) => c.id === selectedId) ?? characters[0]!;

  const isLocked = selected.source !== "stock" && !selected.consented;
  const isBoundCustom =
    selected.source !== "stock" && selected.consented;
  const needsLiveness = isBoundCustom && !consentToken;

  const canConvert =
    !busy &&
    audioFile !== null &&
    !isLocked &&
    !needsLiveness;

  // Clear the captured token + state when the user picks a different
  // character — the token is face-specific; clearing keeps the mental model
  // simple ("re-run liveness per convert session").
  React.useEffect(() => {
    setConsentToken(null);
    setState({ kind: "idle" });
  }, [selectedId]);

  // Clear the result when the audio file changes — the new file isn't
  // converted yet.
  React.useEffect(() => {
    setState({ kind: "idle" });
  }, [audioFile]);

  // --- Cleanup on unmount -------------------------------------------------
  React.useEffect(
    () => () => {
      if (demoTimerRef.current) {
        clearTimeout(demoTimerRef.current);
        demoTimerRef.current = null;
      }
    },
    [],
  );

  // --- Actions ------------------------------------------------------------

  const onConvert = async () => {
    if (!canConvert || !audioFile) return;
    setState({ kind: "idle" });
    setBusy(true);

    // --- Demo simulation (engine not connected) ---
    if (!engineConnected) {
      setState({ kind: "converting", demo: true });
      const startedAt = Date.now();
      demoTimerRef.current = setTimeout(() => {
        setState({
          kind: "done",
          demo: true,
          outId: null,
          elapsedMs: Date.now() - startedAt,
        });
        setBusy(false);
      }, 2000);
      return;
    }

    // --- Live convert ---
    setState({ kind: "converting", demo: false });
    try {
      const audioB64 = await fileToBase64(audioFile);
      const body: VoiceConvertRequest = {
        character_id: selected.id,
        audio_b64: audioB64,
        consent_token: isBoundCustom ? consentToken : null,
        api_key: apiKey.trim() ? apiKey.trim() : null,
      };
      const res = await fetch(voiceConvertUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let message = `Engine returned ${res.status}`;
        try {
          // FastAPI HTTPException returns {"detail": "..."} — surface that.
          const parsed = JSON.parse(txt) as { detail?: string };
          if (parsed.detail) message = parsed.detail;
        } catch {
          if (txt) message = txt.slice(0, 200);
        }
        setState({ kind: "error", message, status: res.status });
        setBusy(false);
        return;
      }
      const result = (await res.json()) as VoiceConvertResult;
      const outId = extractOutId(result.download_url);
      setState({
        kind: "done",
        demo: false,
        outId,
        elapsedMs: 0,
      });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const onLivenessBound = (_id: string, token: string) => {
    setConsentToken(token);
    setActiveLiveness(false);
  };

  const onReset = () => {
    if (demoTimerRef.current) {
      clearTimeout(demoTimerRef.current);
      demoTimerRef.current = null;
    }
    setState({ kind: "idle" });
    setConsentToken(null);
  };

  // --- Render -------------------------------------------------------------
  return (
    <Card className="overflow-hidden border-neutral-800 bg-neutral-900/60">
      <CardHeader className="border-b border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-neutral-50">
              <Mic className="size-5 text-rose-300" />
              Voice conversion — async mic → avatar voice
            </CardTitle>
            <CardDescription className="text-neutral-400">
              Phase 4 — upload an audio clip, run it through the configured
              converter, download the WAV. Stock characters convert
              immediately; bound custom characters require a fresh liveness
              token.
            </CardDescription>
          </div>
          <EngineBadge connected={engineConnected} />
        </div>
      </CardHeader>

      <CardContent className="grid gap-6 p-6 lg:grid-cols-[1fr_minmax(0,360px)]">
        {/* LEFT — controls */}
        <div className="space-y-6">
          {/* Character picker */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Character
              </h3>
              <span className="font-mono text-[11px] text-neutral-500">
                {characters.length} available
                {characters.some((c) => !c.consented && c.source !== "stock")
                  ? " · some locked"
                  : ""}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {characters.map((c) => {
                const active = c.id === selected.id;
                const locked = !c.consented && c.source !== "stock";
                return (
                  <CharacterPickerButton
                    key={c.id}
                    character={c}
                    active={active}
                    locked={locked}
                    onPick={() => {
                      if (!locked) setSelected(c.id);
                    }}
                  />
                );
              })}
            </div>
            {characters.some((c) => !c.consented && c.source !== "stock") ? (
              <p className="mt-2 text-[11px] text-amber-200/80">
                Locked characters need a liveness check first — use the Create
                Character panel above to unlock them.
              </p>
            ) : null}
          </div>

          {/* Audio input */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Source audio
            </h3>
            <AudioFileDrop file={audioFile} onPick={setAudioFile} />
          </div>

          {/* Provider info / API key */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Converter
            </h3>
            {!engineConnected ? (
              <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
                <CircleAlert className="size-4" />
                <AlertTitle>Engine not connected</AlertTitle>
                <AlertDescription className="text-amber-100/80">
                  Voice conversion requires{" "}
                  <code className="rounded bg-amber-500/10 px-1 py-0.5 font-mono text-[11px] text-amber-100">
                    VOICE_CONVERT_CMD
                  </code>{" "}
                  (external command) or{" "}
                  <code className="rounded bg-amber-500/10 px-1 py-0.5 font-mono text-[11px] text-amber-100">
                    VOICE_CLOUD_PROVIDER
                  </code>{" "}
                  (BYOK cloud) to be set on the engine. In demo mode, clicking
                  Convert simulates a successful conversion.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4 text-[12px] leading-relaxed text-neutral-400">
                  The engine selects its converter at startup — priority is{" "}
                  <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-rose-200">
                    VOICE_CONVERT_CMD
                  </code>{" "}
                  (external RVC-style command) over{" "}
                  <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-rose-200">
                    VOICE_CLOUD_PROVIDER
                  </code>{" "}
                  (BYOK cloud, e.g. ElevenLabs). The control panel can&rsquo;t
                  tell which one is active without trying the request — if
                  neither is set, the engine returns 503 and the result panel
                  will say so.
                </div>
                <div className="grid gap-2">
                  <Label
                    htmlFor="voice-api-key"
                    className="flex items-center gap-1.5 text-neutral-300"
                  >
                    <KeyRound className="size-3.5 text-rose-300" />
                    API key <span className="text-neutral-500">(BYOK, cloud only)</span>
                  </Label>
                  <Input
                    id="voice-api-key"
                    type="password"
                    autoComplete="off"
                    placeholder="Leave blank for external-command converter"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="bg-neutral-950/40 font-mono text-sm"
                  />
                  <p className="text-[11px] leading-relaxed text-neutral-500">
                    Required only when the engine is configured for cloud
                    conversion (ElevenLabs speech-to-speech). The engine
                    forwards the key per-request and never persists it. For an
                    external-command converter (RVC CLI), the key is ignored.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Action area */}
          <div className="space-y-3">
            {isLocked ? (
              <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
                <Lock className="size-4" />
                <AlertTitle>Character is locked</AlertTitle>
                <AlertDescription className="text-amber-100/80">
                  Complete liveness for this character in the Create Character
                  panel above before you can convert audio as its voice.
                </AlertDescription>
              </Alert>
            ) : needsLiveness ? (
              <div className="space-y-3">
                <Alert className="border-rose-500/30 bg-rose-500/[0.06] text-rose-100">
                  <ScanFace className="size-4 text-rose-300" />
                  <AlertTitle className="text-rose-200">
                    This character is bound to your face
                  </AlertTitle>
                  <AlertDescription className="text-neutral-300">
                    Voice conversion for a bound character requires a fresh
                    consent_token — converting audio to sound like someone&rsquo;s
                    avatar is identity-affecting. Re-run liveness to mint a
                    token for this conversion.
                  </AlertDescription>
                </Alert>
                <Button
                  type="button"
                  size="lg"
                  onClick={() => setActiveLiveness(true)}
                  className="w-full bg-rose-500 text-white hover:bg-rose-400"
                >
                  <ScanFace className="size-4" />
                  Re-run liveness to convert
                </Button>
                {consentToken ? (
                  <p className="text-[11px] text-emerald-300">
                    Token captured — you can now convert.
                  </p>
                ) : null}
              </div>
            ) : consentToken ? (
              <div className="space-y-2">
                <Button
                  type="button"
                  size="lg"
                  onClick={onConvert}
                  disabled={!canConvert}
                  className="w-full bg-rose-500 text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Waves className="size-4" />
                  )}
                  {busy ? "Converting…" : "Convert with captured token"}
                </Button>
                <p className="text-[11px] text-emerald-300">
                  Liveness verified — consent_token ready.
                </p>
              </div>
            ) : (
              <Button
                type="button"
                size="lg"
                onClick={onConvert}
                disabled={!canConvert}
                className="w-full bg-rose-500 text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Waves className="size-4" />
                )}
                {busy ? "Converting…" : "Convert"}
              </Button>
            )}

            {!engineConnected ? (
              <p className="text-[11px] text-amber-200/80">
                Demo mode — clicking Convert simulates a successful conversion
                (~2s). No real file is produced.
              </p>
            ) : null}
          </div>
        </div>

        {/* RIGHT — result panel */}
        <div className="space-y-4">
          <ResultPanel
            state={state}
            onReset={onReset}
            engineConnected={engineConnected}
          />
        </div>
      </CardContent>

      <LivenessDialog
        characterId={activeLiveness ? selected.id : null}
        isDemo={!engineConnected}
        onClose={() => setActiveLiveness(false)}
        onBound={onLivenessBound}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EngineBadge({ connected }: { connected: boolean }) {
  if (connected) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      >
        <CheckCircle2 className="size-3.5" />
        Engine connected · live conversion
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-300"
    >
      <CircleAlert className="size-3.5" />
      Demo mode — engine not connected
    </Badge>
  );
}

function CharacterPickerButton({
  character,
  active,
  locked,
  onPick,
}: {
  character: UiCharacter;
  active: boolean;
  locked: boolean;
  onPick: () => void;
}) {
  const isCustom =
    character.source === "generated" || character.source === "uploaded";
  const button = (
    <button
      type="button"
      onClick={onPick}
      disabled={locked}
      aria-pressed={active}
      aria-disabled={locked}
      aria-label={
        locked
          ? `${character.name} — locked, complete liveness first`
          : `Select character ${character.name}`
      }
      className={cn(
        "group relative flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-all",
        locked
          ? "cursor-not-allowed border-neutral-800/60 bg-neutral-950/30 opacity-60"
          : active
            ? "border-rose-500/60 bg-rose-500/10"
            : "border-neutral-800 bg-neutral-950/40 hover:border-neutral-700 hover:bg-neutral-900",
      )}
    >
      <CharacterThumb character={character} active={active && !locked} />
      <span
        className={cn(
          "flex items-center gap-1 text-xs font-medium",
          active && !locked ? "text-rose-200" : "text-neutral-300",
        )}
      >
        {locked ? <Lock className="size-3 text-amber-300" /> : null}
        {character.name}
      </span>
      {isCustom && !locked ? (
        <Badge
          variant="outline"
          className="absolute right-1 top-1 border-rose-500/40 bg-rose-500/15 px-1 py-0 text-[9px] text-rose-200"
        >
          <Sparkles className="size-2.5" />
          custom
        </Badge>
      ) : null}
      {isCustom && locked ? (
        <Badge
          variant="outline"
          className="absolute right-1 top-1 border-amber-500/40 bg-amber-500/15 px-1 py-0 text-[9px] text-amber-200"
        >
          <Lock className="size-2.5" />
          locked
        </Badge>
      ) : null}
    </button>
  );

  if (!locked) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="border border-neutral-700 bg-neutral-900 text-neutral-100"
      >
        Complete liveness first
      </TooltipContent>
    </Tooltip>
  );
}

function CharacterThumb({
  character,
  active,
}: {
  character: UiCharacter;
  active: boolean;
}) {
  return (
    <span
      className="relative flex size-12 items-center justify-center overflow-hidden rounded-full ring-1 ring-inset ring-black/30"
      style={{ background: character.gradient }}
      aria-hidden
    >
      <span className="font-mono text-lg font-bold text-white/95 drop-shadow">
        {character.initial}
      </span>
      {active ? (
        <span className="absolute inset-0 rounded-full ring-2 ring-rose-300/80 ring-offset-2 ring-offset-neutral-900" />
      ) : null}
    </span>
  );
}

function AudioFileDrop({
  file,
  onPick,
}: {
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onPick(f);
  };

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        aria-label="Pick an audio file"
        className={cn(
          "relative grid place-items-center rounded-lg border-2 border-dashed p-5 text-center transition-colors",
          dragOver
            ? "border-rose-400 bg-rose-500/10"
            : "border-neutral-700 bg-neutral-950/40 hover:border-neutral-600 hover:bg-neutral-900/40",
        )}
      >
        {file ? (
          <div className="flex flex-col items-center gap-2">
            <AudioLines className="size-6 text-rose-300" />
            <p className="text-sm text-neutral-200">{file.name}</p>
            <p className="text-[11px] text-neutral-500">
              {formatBytes(file.size)} · click to replace
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-neutral-400">
            <AudioLines className="size-6 text-neutral-500" />
            <p className="text-sm text-neutral-300">
              Drop an audio file or click to choose
            </p>
            <p className="text-[11px] text-neutral-500">
              Accepts audio/* — the file is read as base64 and POSTed to
              /api/voice/convert
            </p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = "";
          }}
        />
      </button>
      <p className="text-[11px] leading-relaxed text-neutral-500">
        The engine writes the bytes to a temporary file on the engine host,
        runs the configured converter on it, and serves the result as a WAV
        from{" "}
        <code className="text-neutral-400">/api/voice/{`{out_id}`}/download</code>{" "}
        (valid for the engine process&rsquo;s lifetime — not yet durable
        storage, that&rsquo;s Phase 5).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result panel
// ---------------------------------------------------------------------------

function ResultPanel({
  state,
  onReset,
  engineConnected,
}: {
  state: ConvertState;
  onReset: () => void;
  engineConnected: boolean;
}) {
  if (state.kind === "idle") {
    return (
      <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 p-6 text-center">
        <Mic className="mx-auto size-6 text-neutral-600" />
        <p className="mt-2 text-sm text-neutral-500">
          No conversion yet. Pick a character, upload an audio clip, and hit
          Convert.
        </p>
        <p className="mt-1 text-[11px] text-neutral-600">
          The engine runs the configured converter (external command or BYOK
          cloud) and returns a WAV download URL.
        </p>
      </div>
    );
  }

  if (state.kind === "converting") {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/60"
      >
        <div className="flex items-center justify-between gap-2 border-b border-neutral-800 p-3">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1.5 border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-200"
            >
              <Loader2 className="size-3 animate-spin" />
              Converting
            </Badge>
            {state.demo ? (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/15 text-[10px] text-amber-200"
              >
                Simulated
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm text-neutral-300">
            <Loader2 className="size-4 animate-spin text-rose-300" />
            {state.demo
              ? "Simulating conversion…"
              : "Running the configured converter on the engine…"}
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            {state.demo
              ? "Demo mode walks the lifecycle so the UX is demonstrable without the Python engine. No real audio is processed."
              : "POST /api/voice/convert — the engine writes the bytes to a temp file, runs the converter (subprocess or HTTPS call), and serves the result as a WAV."}
          </p>
        </div>
      </motion.div>
    );
  }

  if (state.kind === "error") {
    const isNotConfigured = state.status === 503;
    const isConsent = state.status === 403;
    const isConversionFail = state.status === 502;
    const isMissingKey = state.status === 400;
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/60"
      >
        <div className="flex items-center justify-between gap-2 border-b border-neutral-800 p-3">
          <Badge
            variant="outline"
            className="gap-1.5 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-200"
          >
            <AlertCircle className="size-3" />
            {isNotConfigured
              ? "Not configured"
              : isConsent
                ? "Consent required"
                : isConversionFail
                  ? "Conversion failed"
                  : isMissingKey
                    ? "Missing API key"
                    : "Error"}
          </Badge>
          {state.status ? (
            <span className="font-mono text-[10px] text-neutral-500">
              HTTP {state.status}
            </span>
          ) : null}
        </div>
        <div className="space-y-3 p-4">
          <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
            <AlertCircle className="size-4" />
            <AlertTitle>
              {isNotConfigured
                ? "Voice conversion not configured on the engine"
                : isConsent
                  ? "Consent gate refused the request"
                  : isConversionFail
                    ? "The converter returned an error"
                    : isMissingKey
                      ? "Cloud converter needs an API key"
                      : "Conversion failed"}
            </AlertTitle>
            <AlertDescription className="break-words font-mono text-[11px] text-amber-100/80">
              {state.message}
            </AlertDescription>
          </Alert>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            {isNotConfigured
              ? "Set VOICE_CONVERT_CMD (external command, e.g. an RVC CLI) or VOICE_CLOUD_PROVIDER (BYOK cloud, e.g. ElevenLabs) on the engine, then retry."
              : isConsent
                ? "A bound character requires a consent_token whose face_hash matches the character. Re-run liveness to mint a fresh token."
                : isConversionFail
                  ? "The engine ran the converter but it failed (non-zero exit, missing output file, or a cloud API error). The engine log has the full stderr."
                  : isMissingKey
                    ? "When the engine is configured for cloud conversion, an api_key is required per request (BYOK — the engine never persists it)."
                    : "Unexpected error from the engine."}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={onReset}
            className="w-full border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
          >
            Try again
          </Button>
        </div>
      </motion.div>
    );
  }

  // state.kind === "done"
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/60"
    >
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800 p-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300"
          >
            <CheckCircle2 className="size-3" />
            Done
          </Badge>
          {state.demo ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/15 text-[10px] text-amber-200"
            >
              Simulated
            </Badge>
          ) : null}
        </div>
        {state.outId ? (
          <span className="font-mono text-[10px] text-neutral-500">
            out {state.outId.slice(0, 12)}
          </span>
        ) : (
          <span className="font-mono text-[10px] text-neutral-500">demo</span>
        )}
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3 text-emerald-100">
          <CheckCircle2 className="mt-0.5 size-4 text-emerald-300" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-emerald-200">
              {state.demo ? "Conversion simulated" : "Conversion complete"}
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-300">
              {state.demo
                ? `Simulated in ${formatMs(state.elapsedMs)}. No real file was produced.`
                : "The engine ran the configured converter and stored the WAV."}
            </p>
          </div>
        </div>

        {state.demo || !engineConnected ? (
          <div className="space-y-2">
            <Button
              type="button"
              disabled
              className="w-full border-neutral-700 bg-neutral-900 text-neutral-500"
              variant="outline"
            >
              <Download className="size-4" />
              Download (demo)
            </Button>
            <p className="text-[11px] leading-relaxed text-amber-200/70">
              In demo mode no real file is produced. Run the Python engine with{" "}
              <code className="rounded bg-amber-500/10 px-1 py-0.5 font-mono text-[10px] text-amber-100">
                VOICE_CONVERT_CMD
              </code>{" "}
              (or{" "}
              <code className="rounded bg-amber-500/10 px-1 py-0.5 font-mono text-[10px] text-amber-100">
                VOICE_CLOUD_PROVIDER
              </code>
              ) set to convert actual audio.
            </p>
          </div>
        ) : state.outId ? (
          <Button
            type="button"
            asChild
            className="w-full bg-emerald-500 text-white hover:bg-emerald-400"
          >
            <a
              href={voiceDownloadUrl(state.outId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download className="size-4" />
              Download WAV
            </a>
          </Button>
        ) : (
          <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
            <AlertCircle className="size-4" />
            <AlertTitle>No download URL returned</AlertTitle>
            <AlertDescription className="text-[11px] text-amber-100/80">
              The engine reported success but did not return a download_url.
              This should not happen — check the engine log.
            </AlertDescription>
          </Alert>
        )}

        <p className="text-[11px] leading-relaxed text-neutral-500">
          This panel converts audio asynchronously. Live voice conversion (mic
          → convert → OBS in real time) is not wired in v1 — the{" "}
          <code className="text-neutral-400">/ws/voice</code> contract is
          defined but the live audio path needs a virtual audio device
          (VB-Cable / BlackHole / pulseaudio null sink), the same class of
          driver-install requirement as the virtual camera. See{" "}
          <code className="text-neutral-400">docs/reality-check.md</code>.
        </p>

        <Button
          type="button"
          variant="outline"
          onClick={onReset}
          className="w-full border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
        >
          Convert again
        </Button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return `${s.toFixed(1)} s`;
}

/** Read a File as a base64 string suitable for the engine's audio_b64 field. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      // Strip the data URI prefix — the engine accepts raw base64.
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * The engine returns `/api/voice/{out_id}/download`. Extract out_id so we
 * can route the download through the gateway via voiceDownloadUrl().
 */
function extractOutId(downloadUrl: string | null | undefined): string | null {
  if (!downloadUrl) return null;
  const match = downloadUrl.match(/\/api\/voice\/([^/]+)\/download/);
  return match ? match[1]! : null;
}
