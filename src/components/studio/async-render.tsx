"use client";

/**
 * Phase 3 — Async Render panel.
 *
 * The high-fidelity / offline path. The user picks a character (same shared
 * store as the Studio picker), supplies an audio or video driver, picks a
 * quality tier, and submits a render job to POST /api/render. The panel polls
 * GET /api/render/{job_id} every 500ms and shows status / progress / download.
 *
 * Consent gate (same as live): a bound custom character (consented=true,
 * source=generated/uploaded) requires a fresh consent_token from liveness.
 * The panel surfaces a "Re-run liveness to render" CTA that opens the shared
 * LivenessDialog; on success the captured token is sent with the render
 * request. Stock characters need no token.
 *
 * Demo mode (engine not connected — the sandbox state): the panel shares
 * `engineConnected` from the Zustand store (set by the Studio + Create panel
 * probes). When false, the Render button still works but simulates the entire
 * job lifecycle (queued → running → rendering → done) over ~3s with a
 * "Simulated" badge, and the download button is disabled with an honest note.
 */
import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  AudioLines,
  CheckCircle2,
  CircleAlert,
  Download,
  Film,
  FileVideo,
  Loader2,
  Lock,
  ScanFace,
  Sparkles,
  Upload,
  Video,
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
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useCharacterStore, type UiCharacter } from "@/lib/character-store";
import { LivenessDialog } from "@/components/studio/liveness-dialog";
import {
  engineUrl,
  renderJobUrl,
  renderDownloadUrl,
} from "@contracts/types";
import type { RenderJob, RenderJobStatus, RenderRequest } from "@contracts/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DriverKind = "audio" | "video";
type DriverMode = "upload" | "url";
type Quality = "draft" | "high";

interface ActiveJob {
  jobId: string;
  status: RenderJobStatus;
  progress: number; // 0..1
  error: string | null;
  startedAt: number;
  /** Wall-clock ms from job start to terminal state; null while in flight. */
  elapsedMs: number | null;
  /** True when running the demo-mode simulation (engine not connected). */
  demo: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AsyncRender() {
  const characters = useCharacterStore((s) => s.characters);
  const selectedId = useCharacterStore((s) => s.selectedId);
  const setSelected = useCharacterStore((s) => s.setSelected);
  const engineConnected = useCharacterStore((s) => s.engineConnected);

  const [driverKind, setDriverKind] = React.useState<DriverKind>("audio");
  const [driverMode, setDriverMode] = React.useState<DriverMode>("url");
  const [driverFile, setDriverFile] = React.useState<File | null>(null);
  const [driverUrl, setDriverUrl] = React.useState("");
  const [quality, setQuality] = React.useState<Quality>("draft");

  /** Fresh consent_token from liveness; required to render a bound char. */
  const [consentToken, setConsentToken] = React.useState<string | null>(null);
  const [activeLiveness, setActiveLiveness] = React.useState(false);

  const [job, setJob] = React.useState<ActiveJob | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const demoTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Derive the effective driver_url from the active sub-mode.
  const driverUrlValue =
    driverMode === "upload"
      ? driverFile
        ? `upload://${driverFile.name}`
        : ""
      : driverUrl.trim();

  const selected =
    characters.find((c) => c.id === selectedId) ?? characters[0]!;

  const isLocked = selected.source !== "stock" && !selected.consented;
  const isBoundCustom =
    selected.source !== "stock" && selected.consented;
  const needsLiveness = isBoundCustom && !consentToken;

  const jobInFlight =
    job !== null &&
    (job.status === "queued" ||
      job.status === "running" ||
      job.status === "rendering");

  const canRender =
    !busy &&
    !jobInFlight &&
    driverUrlValue.length > 0 &&
    !isLocked &&
    !needsLiveness;

  // Clear the captured token + error when the user picks a different
  // character — the token is face-specific, not char-specific, but clearing
  // keeps the mental model simple ("re-run liveness per render session").
  React.useEffect(() => {
    setConsentToken(null);
    setError(null);
  }, [selectedId]);

  // --- Polling for live jobs ---------------------------------------------
  React.useEffect(() => {
    if (!job || job.demo) return;
    if (job.status === "done" || job.status === "failed") return;

    const id = job.jobId;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(renderJobUrl(id));
        if (!res.ok) {
          throw new Error(`poll returned ${res.status}`);
        }
        const j = (await res.json()) as RenderJob;
        setJob((prev) => {
          if (!prev || prev.jobId !== id) return prev;
          const terminal =
            j.status === "done" || j.status === "failed";
          return {
            ...prev,
            status: j.status,
            progress: j.progress,
            error: j.error ?? null,
            elapsedMs: terminal ? Date.now() - prev.startedAt : prev.elapsedMs,
          };
        });
      } catch {
        // Transient network hiccup — keep the last known state. The next
        // tick will retry.
      }
    }, 500);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [job?.jobId, job?.status, job?.demo]);

  // --- Cleanup on unmount -------------------------------------------------
  React.useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (demoTimerRef.current) clearInterval(demoTimerRef.current);
    },
    [],
  );

  // --- Actions ------------------------------------------------------------

  const onRender = async () => {
    if (!canRender) return;
    setError(null);
    setBusy(true);
    setJob(null);

    // Clear any prior demo timer before starting fresh.
    if (demoTimerRef.current) {
      clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
    }

    const body: RenderRequest = {
      character_id: selected.id,
      driver: driverKind,
      driver_url: driverUrlValue,
      quality,
      consent_token: isBoundCustom ? consentToken : null,
    };

    if (!engineConnected) {
      // --- Demo simulation ---
      const demoJobId = `demo-${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = Date.now();
      setJob({
        jobId: demoJobId,
        status: "queued",
        progress: 0,
        error: null,
        startedAt,
        elapsedMs: null,
        demo: true,
      });
      setBusy(false);

      // Walk the lifecycle: queued -> running -> rendering -> done over ~3s.
      setTimeout(() => {
        setJob((prev) =>
          prev && prev.demo
            ? { ...prev, status: "running", progress: 0.05 }
            : prev,
        );
      }, 350);
      setTimeout(() => {
        setJob((prev) =>
          prev && prev.demo
            ? { ...prev, status: "rendering", progress: 0.2 }
            : prev,
        );
      }, 750);

      demoTimerRef.current = setInterval(() => {
        setJob((prev) => {
          if (!prev || !prev.demo) return prev;
          const next = Math.min(
            1,
            prev.progress + 0.05 + Math.random() * 0.04,
          );
          if (next >= 1) {
            if (demoTimerRef.current) {
              clearInterval(demoTimerRef.current);
              demoTimerRef.current = null;
            }
            return {
              ...prev,
              progress: 1,
              status: "done",
              elapsedMs: Date.now() - prev.startedAt,
            };
          }
          return { ...prev, progress: next };
        });
      }, 160);
      return;
    }

    // --- Live render ---
    try {
      const res = await fetch(engineUrl("/api/render"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(
          `Engine returned ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ""}`,
        );
      }
      const j = (await res.json()) as RenderJob;
      setJob({
        jobId: j.job_id,
        status: j.status,
        progress: j.progress,
        error: j.error ?? null,
        startedAt: Date.now(),
        elapsedMs: null,
        demo: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onLivenessBound = (_id: string, token: string) => {
    setConsentToken(token);
    setActiveLiveness(false);
  };

  const onResetJob = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (demoTimerRef.current) {
      clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
    }
    setJob(null);
    // Require fresh liveness for the next render (tokens expire).
    setConsentToken(null);
  };

  // --- Render -------------------------------------------------------------
  return (
    <Card className="overflow-hidden border-neutral-800 bg-neutral-900/60">
      <CardHeader className="border-b border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-neutral-50">
              <Film className="size-5 text-rose-300" />
              Async render — quality mode
            </CardTitle>
            <CardDescription className="text-neutral-400">
              Phase 3 — offline diffusion-grade renders. Submit a job, watch
              the queue, download the MP4 when it&rsquo;s done.
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
                const locked =
                  !c.consented && c.source !== "stock";
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

          {/* Driver input */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Driver
            </h3>
            <Tabs
              value={driverKind}
              onValueChange={(v) => setDriverKind(v as DriverKind)}
              className="gap-3"
            >
              <TabsList className="bg-neutral-950/60">
                <TabsTrigger
                  value="audio"
                  className="data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-200"
                >
                  <AudioLines className="size-3.5" />
                  Audio
                </TabsTrigger>
                <TabsTrigger
                  value="video"
                  className="data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-200"
                >
                  <Video className="size-3.5" />
                  Video
                </TabsTrigger>
              </TabsList>

              <TabsContent value="audio" className="space-y-3">
                <DriverInputRow
                  kind="audio"
                  mode={driverMode}
                  onModeChange={setDriverMode}
                  file={driverFile}
                  onFile={setDriverFile}
                  url={driverUrl}
                  onUrl={setDriverUrl}
                />
                <p className="text-[11px] leading-relaxed text-neutral-500">
                  Audio-driven lip-sync. The engine runs whatever renderer you
                  configure via <code className="text-neutral-400">DIFFUSION_RENDER_CMD</code>
                  (an AniPortrait-style setup, or anything honoring the same
                  reference-image + audio-in, MP4-out contract). No model is
                  bundled — see <code className="text-neutral-400">docs/reality-check.md</code>.
                </p>
              </TabsContent>

              <TabsContent value="video" className="space-y-3">
                <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4 text-center">
                  <p className="text-sm text-neutral-400">
                    Video re-drive is not implemented yet.
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    The engine currently accepts <code className="text-neutral-400">driver="audio"</code> only.
                    Video re-drive (transferring pose + expression from a recorded
                    video) is scoped for a later phase.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Quality selector */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Quality
            </h3>
            <div className="inline-flex rounded-lg border border-neutral-800 bg-neutral-950/60 p-1">
              <QualityToggle
                active={quality === "draft"}
                onClick={() => setQuality("draft")}
                label="Draft"
                hint="fast"
              />
              <QualityToggle
                active={quality === "high"}
                onClick={() => setQuality("high")}
                label="High"
                hint="diffusion"
              />
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              The quality field is reserved for when multiple renderer backends
              exist. Currently all renders go through the single{" "}
              <code className="text-neutral-400">DIFFUSION_RENDER_CMD</code>{" "}
              command regardless of this setting.
            </p>
          </div>

          {/* Action area */}
          <div className="space-y-3">
            {isLocked ? (
              <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
                <Lock className="size-4" />
                <AlertTitle>Character is locked</AlertTitle>
                <AlertDescription className="text-amber-100/80">
                  Complete liveness for this character in the Create Character
                  panel above before you can render it.
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
                    Async renders for a bound character require a fresh
                    consent_token. Liveness tokens expire, so re-run the check
                    to mint a new one for this render.
                  </AlertDescription>
                </Alert>
                <Button
                  type="button"
                  size="lg"
                  onClick={() => setActiveLiveness(true)}
                  className="w-full bg-rose-500 text-white hover:bg-rose-400"
                >
                  <ScanFace className="size-4" />
                  Re-run liveness to render
                </Button>
                {consentToken ? (
                  <p className="text-[11px] text-emerald-300">
                    Token captured — you can now render.
                  </p>
                ) : null}
              </div>
            ) : consentToken ? (
              <div className="space-y-2">
                <Button
                  type="button"
                  size="lg"
                  onClick={onRender}
                  disabled={!canRender}
                  className="w-full bg-rose-500 text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Film className="size-4" />
                  )}
                  {busy ? "Submitting…" : "Render with captured token"}
                </Button>
                <p className="text-[11px] text-emerald-300">
                  Liveness verified — consent_token ready.
                </p>
              </div>
            ) : (
              <Button
                type="button"
                size="lg"
                onClick={onRender}
                disabled={!canRender}
                className="w-full bg-rose-500 text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Film className="size-4" />
                )}
                {busy ? "Submitting…" : "Render"}
              </Button>
            )}

            {!engineConnected ? (
              <p className="text-[11px] text-amber-200/80">
                Demo mode — clicking Render simulates a job (queued → running →
                rendering → done over ~3s). No real file is produced.
              </p>
            ) : null}
          </div>

          {/* Error */}
          {error ? (
            <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
              <CircleAlert className="size-4" />
              <AlertTitle>Render failed</AlertTitle>
              <AlertDescription className="text-amber-100/80">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        {/* RIGHT — job progress / download */}
        <div className="space-y-4">
          <JobPanel
            job={job}
            onReset={onResetJob}
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
        Engine connected · live render queue
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

function QualityToggle({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-neutral-100 text-neutral-900"
          : "text-neutral-400 hover:text-neutral-200",
      )}
    >
      {label}
      <span
        className={cn(
          "font-mono text-[9px] uppercase",
          active ? "text-neutral-500" : "text-neutral-600",
        )}
      >
        {hint}
      </span>
    </button>
  );
}

/**
 * The driver input row — an Upload/URL sub-toggle plus either a file drop
 * zone or a URL text field. Used inside both the Audio and Video tabs.
 */
function DriverInputRow({
  kind,
  mode,
  onModeChange,
  file,
  onFile,
  url,
  onUrl,
}: {
  kind: DriverKind;
  mode: DriverMode;
  onModeChange: (m: DriverMode) => void;
  file: File | null;
  onFile: (f: File | null) => void;
  url: string;
  onUrl: (v: string) => void;
}) {
  const accept = kind === "audio" ? "audio/*" : "video/*";
  const inputId = `driver-${kind}-url`;

  return (
    <div className="space-y-3">
      {/* sub-toggle: Upload vs URL */}
      <div className="inline-flex rounded-md border border-neutral-800 bg-neutral-950/60 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => onModeChange("upload")}
          aria-pressed={mode === "upload"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors",
            mode === "upload"
              ? "bg-neutral-100 text-neutral-900"
              : "text-neutral-400 hover:text-neutral-200",
          )}
        >
          <Upload className="size-3" />
          Upload
        </button>
        <button
          type="button"
          onClick={() => onModeChange("url")}
          aria-pressed={mode === "url"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors",
            mode === "url"
              ? "bg-neutral-100 text-neutral-900"
              : "text-neutral-400 hover:text-neutral-200",
          )}
        >
          URL
        </button>
      </div>

      {mode === "upload" ? (
        <FileDrop
          accept={accept}
          file={file}
          onPick={onFile}
          kind={kind}
        />
      ) : (
        <div className="grid gap-2">
          <Label htmlFor={inputId} className="text-neutral-300">
            {kind === "audio" ? "Audio URL" : "Video URL"}
          </Label>
          <Input
            id={inputId}
            type="url"
            placeholder={
              kind === "audio"
                ? "https://example.com/voice.mp3"
                : "https://example.com/clip.mp4"
            }
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            className="bg-neutral-950/40 font-mono text-sm"
          />
          <p className="text-[11px] text-neutral-500">
            A local filesystem path on the engine host (e.g.{" "}
            <code className="text-neutral-400">/tmp/voiceover.wav</code>). Remote
            http(s) URLs are rejected for security — the engine doesn&rsquo;t fetch
            arbitrary URLs.
          </p>
        </div>
      )}
    </div>
  );
}

function FileDrop({
  accept,
  file,
  onPick,
  kind,
}: {
  accept: string;
  file: File | null;
  onPick: (f: File | null) => void;
  kind: DriverKind;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onPick(f);
  };

  const Icon = kind === "audio" ? AudioLines : FileVideo;

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
        aria-label={kind === "audio" ? "Pick an audio file" : "Pick a video file"}
        className={cn(
          "relative grid place-items-center rounded-lg border-2 border-dashed p-5 text-center transition-colors",
          dragOver
            ? "border-rose-400 bg-rose-500/10"
            : "border-neutral-700 bg-neutral-950/40 hover:border-neutral-600 hover:bg-neutral-900/40",
        )}
      >
        {file ? (
          <div className="flex flex-col items-center gap-2">
            <Icon className="size-6 text-rose-300" />
            <p className="text-sm text-neutral-200">{file.name}</p>
            <p className="text-[11px] text-neutral-500">
              {formatBytes(file.size)} · click to replace
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-neutral-400">
            <Icon className="size-6 text-neutral-500" />
            <p className="text-sm text-neutral-300">
              Drop {kind === "audio" ? "an audio" : "a video"} file or click to
              choose
            </p>
            <p className="text-[11px] text-neutral-500">
              Accepts {kind === "audio" ? "audio/*" : "video/*"}
            </p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = "";
          }}
        />
      </button>
      <p className="text-[11px] leading-relaxed text-amber-200/70">
        Upload isn&rsquo;t wired to the engine yet — the file&rsquo;s name is
        used as a placeholder <code>driver_url</code>. In live mode, host the
        file at a URL and switch to the URL tab.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job progress panel
// ---------------------------------------------------------------------------

function JobPanel({
  job,
  onReset,
  engineConnected,
}: {
  job: ActiveJob | null;
  onReset: () => void;
  engineConnected: boolean;
}) {
  if (!job) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 p-6 text-center">
        <Film className="mx-auto size-6 text-neutral-600" />
        <p className="mt-2 text-sm text-neutral-500">
          No render job yet. Pick a character, supply a driver, and hit Render.
        </p>
        <p className="mt-1 text-[11px] text-neutral-600">
          The job queue runs in the Python engine; progress is polled every
          500ms.
        </p>
      </div>
    );
  }

  const pct = Math.round(job.progress * 100);
  const terminal = job.status === "done" || job.status === "failed";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/60"
    >
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800 p-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          {job.demo ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/15 text-[10px] text-amber-200"
            >
              Simulated
            </Badge>
          ) : null}
        </div>
        <span className="font-mono text-[10px] text-neutral-500">
          {job.demo ? "demo job" : `job ${job.jobId.slice(0, 12)}`}
        </span>
      </div>

      <div className="space-y-4 p-4">
        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-neutral-400">
            <span>
              {job.status === "queued"
                ? "Waiting for a worker…"
                : job.status === "running"
                  ? "Initializing renderer…"
                  : job.status === "rendering"
                    ? "Rendering frames…"
                    : job.status === "done"
                      ? "Done."
                      : "Failed."}
            </span>
            <span className="font-mono">{pct}%</span>
          </div>
          <Progress
            value={pct}
            className={cn(
              "h-2 bg-neutral-800",
              job.status === "failed" && "[&>div]:bg-amber-500",
              job.status === "done" && "[&>div]:bg-emerald-500",
            )}
          />
        </div>

        {/* Failure detail */}
        {job.status === "failed" && job.error ? (
          <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
            <AlertCircle className="size-4" />
            <AlertTitle>Job failed</AlertTitle>
            <AlertDescription className="break-words font-mono text-[11px] text-amber-100/80">
              {job.error}
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Done — download + timing */}
        {job.status === "done" ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3 text-emerald-100">
              <CheckCircle2 className="mt-0.5 size-4 text-emerald-300" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-emerald-200">
                  Render complete
                </p>
                <p className="mt-0.5 text-[11px] text-neutral-300">
                  {job.elapsedMs !== null
                    ? `Completed in ${formatMs(job.elapsedMs)}.`
                    : "Completed."}
                </p>
              </div>
            </div>

            {job.demo || !engineConnected ? (
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
                  In demo mode no real file is produced. Run the Python engine
                  to render actual MP4s.
                </p>
              </div>
            ) : (
              <Button
                type="button"
                asChild
                className="w-full bg-emerald-500 text-white hover:bg-emerald-400"
              >
                <a
                  href={renderDownloadUrl(job.jobId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="size-4" />
                  Download MP4
                </a>
              </Button>
            )}
          </div>
        ) : null}

        {/* In-flight hint */}
        {!terminal ? (
          <p className="text-[11px] leading-relaxed text-neutral-500">
            {job.demo
              ? "Simulated — the demo mode walks the lifecycle so the UX is demonstrable without a GPU."
              : "Polling GET /api/render/{job_id} every 500ms."}
          </p>
        ) : null}

        {terminal ? (
          <Button
            type="button"
            variant="outline"
            onClick={onReset}
            className="w-full border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
          >
            Render again
          </Button>
        ) : null}
      </div>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: RenderJobStatus }) {
  const map: Record<
    RenderJobStatus,
    { label: string; className: string; icon: React.ReactNode }
  > = {
    queued: {
      label: "Queued",
      className: "border-neutral-600 bg-neutral-800/50 text-neutral-300",
      icon: <Loader2 className="size-3 animate-spin" />,
    },
    running: {
      label: "Running",
      className: "border-sky-500/30 bg-sky-500/10 text-sky-200",
      icon: <Loader2 className="size-3 animate-spin" />,
    },
    rendering: {
      label: "Rendering",
      className: "border-rose-500/30 bg-rose-500/10 text-rose-200",
      icon: <Loader2 className="size-3 animate-spin" />,
    },
    done: {
      label: "Done",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
      icon: <CheckCircle2 className="size-3" />,
    },
    failed: {
      label: "Failed",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-200",
      icon: <AlertCircle className="size-3" />,
    },
  };
  const s = map[status];
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 text-[10px]", s.className)}
    >
      {s.icon}
      {s.label}
    </Badge>
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
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}
