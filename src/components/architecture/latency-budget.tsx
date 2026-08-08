import * as React from "react";
import { Surface } from "./section";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Segment {
  label: string;
  ms: number;
  note: string;
  color: string; // tailwind bg class
}

const segments: Segment[] = [
  {
    label: "Browser",
    ms: 27,
    note: "getUserMedia ~16ms + MediaPipe ~8–12ms + pose math ~1ms",
    color: "bg-rose-500/80",
  },
  {
    label: "WS localhost",
    ms: 1,
    note: "send PoseVector over /ws/live",
    color: "bg-rose-400/60",
  },
  {
    label: "Engine (THA3 + sink)",
    ms: 26,
    note: "THA3 forward ~20–35ms (RTX 3060+) + pyvirtualcam ~1ms",
    color: "bg-amber-500/80",
  },
  {
    label: "OBS pulls virtual cam",
    ms: 33,
    note: "≤ one frame at 30fps",
    color: "bg-amber-400/60",
  },
];

const TOTAL_MS = 90; // typical upper bound shown
const TARGET_MS = 100;

const breakers: string[] = [
  "No CUDA / integrated GPU → THA3 on CPU ~200ms+ (unusable for live).",
  "Sending video instead of a pose vector blows the budget instantly.",
  "OBS frame-pull alignment can add up to one frame (~33ms) of slack.",
];

/**
 * Latency budget — a horizontal stacked bar (built with plain divs, no chart
 * dependency) plus the segment legend and a "what breaks <100ms" warning.
 */
export function LatencyBudget() {
  return (
    <div className="space-y-5">
      <Surface className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
            Glass-to-glass latency budget
          </h3>
          <div className="text-right">
            <p className="font-mono text-lg font-semibold text-emerald-300">
              ~65–90ms
            </p>
            <p className="text-[10px] uppercase tracking-wider text-neutral-500">
              typical · target &lt;100ms
            </p>
          </div>
        </div>

        {/* The bar */}
        <div
          className="relative flex h-9 w-full overflow-hidden rounded-md border border-neutral-800 bg-neutral-950"
          role="img"
          aria-label="Latency budget breakdown stacked bar"
        >
          {segments.map((s) => {
            const pct = (s.ms / TOTAL_MS) * 100;
            return (
              <div
                key={s.label}
                className={cn("flex items-center justify-center", s.color)}
                style={{ width: `${pct}%` }}
                title={`${s.label}: ~${s.ms}ms`}
              >
                <span className="truncate px-1.5 text-[10px] font-mono font-medium text-neutral-950">
                  {s.ms}ms
                </span>
              </div>
            );
          })}
          {/* target marker at 100ms */}
          <div
            className="absolute top-0 bottom-0 w-px bg-emerald-400/70"
            style={{ left: `${(TARGET_MS / TOTAL_MS) * 100}%` }}
            aria-hidden
          >
            <span className="absolute -top-0 right-0 translate-x-full whitespace-nowrap text-[9px] font-mono text-emerald-300">
              100ms
            </span>
          </div>
        </div>

        {/* Legend */}
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {segments.map((s) => (
            <li
              key={s.label}
              className="flex items-start gap-2 text-xs text-neutral-400"
            >
              <span className={cn("mt-1 size-2.5 shrink-0 rounded-sm", s.color)} />
              <span>
                <span className="font-semibold text-neutral-200">
                  {s.label}
                </span>{" "}
                · {s.ms}ms
                <span className="block text-neutral-500">{s.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </Surface>

      {/* Warning callout */}
      <Surface className="border-amber-500/30 bg-amber-500/[0.06] p-5">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-amber-200">
              What breaks &lt;100ms
            </p>
            <ul className="mt-2 space-y-1 text-sm text-neutral-300">
              {breakers.map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-mono text-xs text-amber-300/80">
                    {i + 1}.
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Surface>
    </div>
  );
}
