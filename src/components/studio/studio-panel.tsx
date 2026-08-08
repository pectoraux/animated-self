"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Activity,
  Camera,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Gauge,
  Lock,
  MonitorPlay,
  Play,
  Radio,
  Square,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCharacterStore, type UiCharacter } from "@/lib/character-store";
import type { Character } from "@contracts/types";

const ENGINE_PORT = 3031;
const HEALTH_TIMEOUT_MS = 1500;

type SinkKind = "virtual_cam" | "preview";

type EngineState =
  | { status: "probing" }
  | { status: "demo"; reason: string }
  | { status: "live"; capabilities: Record<string, boolean> };

type StreamState = "idle" | "streaming" | "stopping";

interface LiveStats {
  fpsIn: number;
  fpsOut: number;
  latencyMs: number;
  inferMs: number;
}

const baseStats: LiveStats = {
  fpsIn: 30,
  fpsOut: 29,
  latencyMs: 74,
  inferMs: 28,
};

/**
 * The Studio control panel mockup.
 *
 * Phase 2 update: now reads/writes the shared Zustand character store so that
 * characters created in the Create Character panel appear here too. Generated
 * characters start consented=false and render as locked / non-selectable;
 * after a successful liveness bind (driven from the Create panel) they flip
 * to selectable here.
 *
 * Behavior:
 *  - On mount, probes GET /api/health?XTransformPort=3031 with a short
 *    timeout. On success, switches to "live" mode and tries to fetch the
 *    real character list (stock + generated, per the Phase 2 /api/characters
 *    response). On failure, falls back to the 3 stock characters (Aoi / Ren
 *    / Yuki) and clearly labels "Demo mode".
 *  - "Start stream" transitions to a streaming state with a faux avatar
 *    preview (CSS-animated pulsing card with the character initial),
 *    simulated FPS / latency readouts jittered by ±3ms, and a Stop button.
 */
export function StudioPanel() {
  const [engine, setEngine] = React.useState<EngineState>({
    status: "probing",
  });
  const characters = useCharacterStore((s) => s.characters);
  const selectedId = useCharacterStore((s) => s.selectedId);
  const setSelected = useCharacterStore((s) => s.setSelected);
  const setStockFromEngine = useCharacterStore((s) => s.setStockFromEngine);
  const setEngineConnected = useCharacterStore((s) => s.setEngineConnected);

  const [sink, setSink] = React.useState<SinkKind>("virtual_cam");
  const [streamState, setStreamState] = React.useState<StreamState>("idle");
  const [stats, setStats] = React.useState<LiveStats>(baseStats);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Engine probe ------------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);

    fetch(`/api/health?XTransformPort=${ENGINE_PORT}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { ok?: boolean; capabilities?: Record<string, boolean> }) => {
        if (cancelled) return;
        setEngine({
          status: "live",
          capabilities: data.capabilities ?? {},
        });
        setEngineConnected(true);
        // Try to pull the real character list (stock + generated per Phase 2).
        return fetch(`/api/characters?XTransformPort=${ENGINE_PORT}`, {
          signal: ctrl.signal,
        })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((list: Character[]) => {
            if (cancelled || !Array.isArray(list) || list.length === 0) return;
            // Replace stock with the engine's list; keep client-created chars.
            setStockFromEngine(list);
          })
          .catch(() => {
            /* keep current characters */
          });
      })
      .catch(() => {
        if (cancelled) return;
        setEngine({
          status: "demo",
          reason:
            "Engine not connected — run the Python engine to go live.",
        });
        setEngineConnected(false);
      })
      .finally(() => {
        clearTimeout(timer);
      });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [setStockFromEngine, setEngineConnected]);

  // --- Streaming stat jitter --------------------------------------------
  React.useEffect(() => {
    if (streamState !== "streaming") {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      setStats((prev) => {
        const jitter = (n: number, range: number) =>
          Math.max(0, n + (Math.random() * 2 - 1) * range);
        return {
          fpsIn: Math.round(jitter(30, 0.4)),
          fpsOut: Math.round(jitter(29, 0.5)),
          latencyMs: Math.round(jitter(baseStats.latencyMs, 3)),
          inferMs: Math.round(jitter(baseStats.inferMs, 2)),
        };
      });
    }, 600);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [streamState]);

  const selected =
    characters.find((c) => c.id === selectedId) ?? characters[0]!;
  const isDemo = engine.status === "demo";
  const isLive = engine.status === "live";
  const cuda = isLive ? engine.capabilities?.cuda === true : null;

  const onStart = () => {
    if (streamState === "idle") setStreamState("streaming");
  };
  const onStop = () => {
    setStreamState("stopping");
    // tiny delay so the exit animation is visible
    setTimeout(() => setStreamState("idle"), 250);
  };

  return (
    <Card className="overflow-hidden border-neutral-800 bg-neutral-900/60">
      <CardHeader className="border-b border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-neutral-50">
              <MonitorPlay className="size-5 text-rose-300" />
              Studio
            </CardTitle>
            <CardDescription className="text-neutral-400">
              Live-mode control panel — pick a character, pick a sink, start
              streaming.
            </CardDescription>
          </div>
          <EngineBadge engine={engine} cuda={cuda} />
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

          {/* Sink selector */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Output sink
            </h3>
            <div className="inline-flex rounded-lg border border-neutral-800 bg-neutral-950/60 p-1">
              <SinkToggle
                active={sink === "virtual_cam"}
                onClick={() => setSink("virtual_cam")}
                icon={<Radio className="size-3.5" />}
                label="OBS Virtual Cam"
              />
              <SinkToggle
                active={sink === "preview"}
                onClick={() => setSink("preview")}
                icon={<Camera className="size-3.5" />}
                label="In-app preview"
              />
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {sink === "virtual_cam"
                ? "Frames go to pyvirtualcam → OBS Virtual Camera. Pick it up as a Video Capture Device in OBS."
                : "Frames held in PreviewSink; poll /api/session/{id}/preview.jpg. Never blocks inference."}
            </p>
          </div>

          {/* Action button */}
          <div className="flex items-center gap-3">
            <AnimatePresence mode="wait" initial={false}>
              {streamState === "idle" ? (
                <motion.div
                  key="start"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="w-full"
                >
                  <Button
                    type="button"
                    onClick={onStart}
                    className="w-full bg-rose-500 text-white hover:bg-rose-400"
                    size="lg"
                  >
                    <Play className="size-4" />
                    Start stream
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="stop"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="w-full"
                >
                  <Button
                    type="button"
                    onClick={onStop}
                    variant="outline"
                    className="w-full border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100"
                    size="lg"
                  >
                    <Square className="size-4" />
                    Stop
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* OBS hint */}
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <p className="text-xs text-neutral-400">
              <span className="font-semibold text-neutral-200">OBS setup:</span>{" "}
              add a <span className="text-neutral-200">Video Capture Device</span>{" "}
              and select{" "}
              <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-rose-200">
                OBS Virtual Camera
              </code>
              .
            </p>
          </div>
        </div>

        {/* RIGHT — preview / stats */}
        <div className="space-y-4">
          <PreviewArea
            character={selected}
            streaming={streamState === "streaming"}
            sink={sink}
            isDemo={isDemo}
          />
          <StatsGrid
            stats={stats}
            streaming={streamState === "streaming"}
            isDemo={isDemo}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function EngineBadge({
  engine,
  cuda,
}: {
  engine: EngineState;
  cuda: boolean | null;
}) {
  if (engine.status === "probing") {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-neutral-700 bg-neutral-900 text-neutral-300"
      >
        <Wifi className="size-3.5 animate-pulse" />
        Probing engine…
      </Badge>
    );
  }
  if (engine.status === "live") {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      >
        <CheckCircle2 className="size-3.5" />
        Engine connected
        {cuda !== null && (
          <span className="ml-1 text-emerald-400/70">
            · {cuda ? "CUDA" : "CPU"}
          </span>
        )}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-300"
    >
      <WifiOff className="size-3.5" />
      Demo mode — {engine.reason}
    </Badge>
  );
}

function SinkToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
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
      {icon}
      {label}
    </button>
  );
}

/**
 * A character picker tile. Generated/uploaded chars that haven't completed
 * liveness render as locked (disabled) with a tooltip explaining why.
 */
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
        {locked ? (
          <Lock className="size-3 text-amber-300" />
        ) : null}
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

function PreviewArea({
  character,
  streaming,
  sink,
  isDemo,
}: {
  character: UiCharacter;
  streaming: boolean;
  sink: SinkKind;
  isDemo: boolean;
}) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      {/* gradient backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: character.gradient, opacity: 0.35 }}
        aria-hidden
      />

      <AnimatePresence mode="wait">
        {streaming ? (
          <motion.div
            key="streaming"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
          >
            {/* pulsing faux avatar */}
            <motion.div
              animate={{
                scale: [1, 1.05, 1],
                boxShadow: [
                  "0 0 0 0 rgba(244,63,94,0.45)",
                  "0 0 0 18px rgba(244,63,94,0)",
                  "0 0 0 0 rgba(244,63,94,0)",
                ],
              }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              className="flex size-24 items-center justify-center rounded-full"
              style={{ background: character.gradient }}
            >
              <span className="font-mono text-3xl font-bold text-white drop-shadow">
                {character.initial}
              </span>
            </motion.div>
            <Badge
              variant="outline"
              className="border-rose-500/40 bg-rose-500/15 text-rose-200"
            >
              <span className="mr-1 size-1.5 animate-pulse rounded-full bg-rose-400" />
              LIVE · {sink === "virtual_cam" ? "OBS Virtual Cam" : "Preview"}
            </Badge>
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-500"
          >
            <Camera className="size-8" />
            <p className="text-xs">Preview idle — press Start</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Demo watermark */}
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

      <div className="absolute bottom-2 left-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">
          {character.name}
        </span>
      </div>
    </div>
  );
}

function StatsGrid({
  stats,
  streaming,
  isDemo,
}: {
  stats: LiveStats;
  streaming: boolean;
  isDemo: boolean;
}) {
  const withinBudget = stats.latencyMs < 100;
  return (
    <div className="grid grid-cols-2 gap-2">
      <StatTile
        icon={<Gauge className="size-3.5" />}
        label="Latency"
        value={streaming ? `${stats.latencyMs}ms` : "—"}
        tone={
          streaming
            ? withinBudget
              ? "text-emerald-300"
              : "text-amber-300"
            : "text-neutral-500"
        }
        sub={streaming ? "glass-to-glass" : undefined}
      />
      <StatTile
        icon={<Cpu className="size-3.5" />}
        label="THA3 infer"
        value={streaming ? `${stats.inferMs}ms` : "—"}
        tone={streaming ? "text-rose-300" : "text-neutral-500"}
        sub={streaming ? "per frame" : undefined}
      />
      <StatTile
        icon={<Activity className="size-3.5" />}
        label="FPS in"
        value={streaming ? `${stats.fpsIn}` : "—"}
        tone={streaming ? "text-neutral-200" : "text-neutral-500"}
        sub={streaming ? "pose stream" : undefined}
      />
      <StatTile
        icon={<Activity className="size-3.5" />}
        label="FPS out"
        value={streaming ? `${stats.fpsOut}` : "—"}
        tone={streaming ? "text-neutral-200" : "text-neutral-500"}
        sub={streaming ? "to virtual cam" : undefined}
      />

      {isDemo && streaming ? (
        <div className="col-span-2 mt-1 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-200">
          <CircleAlert className="size-3.5 shrink-0" />
          Simulated stats — start the Python engine to get real FrameStats over
          the WS.
        </div>
      ) : null}
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-neutral-500">
        {icon}
        {label}
      </div>
      <p className={cn("mt-1 font-mono text-lg font-semibold", tone)}>
        {value}
      </p>
      {sub ? (
        <p className="text-[10px] text-neutral-600">{sub}</p>
      ) : null}
    </div>
  );
}
