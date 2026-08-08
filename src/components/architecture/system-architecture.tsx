import { Badge } from "@/components/ui/badge";
import { Section, Surface } from "./section";
import {
  ArrowRight,
  Camera,
  Cpu,
  MonitorPlay,
  Radio,
  Mic,
} from "lucide-react";
import type { ComponentType } from "react";

interface LayerCard {
  icon: ComponentType<{ className?: string }>;
  label: string;
  title: string;
  accent: string;
  bullets: string[];
}

const layers: LayerCard[] = [
  {
    icon: Camera,
    label: "Capture layer",
    title: "Browser",
    accent: "text-rose-300",
    bullets: [
      "Webcam getUserMedia → MediaPipe FaceLandmarker (WASM/WebGL)",
      "PoseVector (~250 bytes) out the door",
      "Mic → (Phase 4) voice conversion",
    ],
  },
  {
    icon: Cpu,
    label: "Inference layer",
    title: "Local Python · CUDA",
    accent: "text-amber-300",
    bullets: [
      "FastAPI, one process",
      "Live: THA3 poser (pose → frame)",
      "Async: diffusion renderer (audio → video, Phase 3)",
    ],
  },
  {
    icon: Radio,
    label: "Output layer",
    title: "pyvirtualcam",
    accent: "text-rose-300",
    bullets: [
      "OBS Virtual Camera (Win/Mac)",
      "v4l2loopback (Linux)",
      "Mp4 file (async)",
    ],
  },
  {
    icon: MonitorPlay,
    label: "Distribution",
    title: "OBS / Streamlabs",
    accent: "text-amber-300",
    bullets: [
      "Picks up the virtual camera",
      "Add as a Video Capture Device",
      "Stream / record like any webcam",
    ],
  },
];

const liveSteps: string[] = [
  "Browser: getUserMedia webcam → <video> element",
  "MediaPipe FaceLandmarker (in-browser, WASM) → 478 landmarks + blendshapes + head transform",
  "Browser math → PoseVector (~250 bytes, NOT video)",
  "WebSocket /ws/live?XTransformPort=3031 → Engine",
  "Engine: pose_vector_to_tha3() → THA3 poser.render(source, pose) → RGB frame",
  "pyvirtualcam.send(frame) → OBS Virtual Camera",
  "OBS reads the virtual cam at 30/60fps → stream",
];

const asyncSteps: string[] = [
  "Browser: upload audio/video file + pick character → POST /api/render",
  "Engine: extract audio (ffmpeg), queue render job",
  "Diffusion renderer (AniPortrait-style) → frames → ffmpeg → MP4 (minutes per second)",
  "GET /api/render/{job_id} poll → download URL",
];

export function SystemArchitecture() {
  return (
    <Section
      id="architecture"
      eyebrow="System architecture"
      title="Three layers, one local process, two paths."
      lede="The browser only captures and extracts pose. All neural inference is local Python on a CUDA GPU. The output is a virtual camera OBS already knows how to read."
    >
      {/* Component diagram */}
      <Surface className="p-4 sm:p-6">
        <div className="grid gap-3 lg:grid-cols-4">
          {layers.map((layer, i) => {
            const Icon = layer.icon;
            return (
              <div key={layer.label} className="contents">
                <div className="relative rounded-lg border border-neutral-800 bg-neutral-900/70 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className={`flex size-8 items-center justify-center rounded-md bg-neutral-950 ${layer.accent}`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <div>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                        {layer.label}
                      </p>
                      <p className="text-sm font-semibold text-neutral-100">
                        {layer.title}
                      </p>
                    </div>
                  </div>
                  <ul className="space-y-1.5">
                    {layer.bullets.map((b) => (
                      <li
                        key={b}
                        className="text-xs leading-relaxed text-neutral-400"
                      >
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                {i < layers.length - 1 ? (
                  <div
                    className="flex items-center justify-center text-neutral-600 lg:col-span-0"
                    aria-hidden
                  >
                    {/* horizontal on lg, vertical on mobile */}
                    <ArrowRight className="size-4 rotate-90 lg:rotate-0" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Captured signal legend */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-4 text-xs text-neutral-500">
          <Mic className="size-3.5" />
          <span>
            Pose (~250 bytes) and (Phase 4) audio ride the same WebSocket — never
            video. The single biggest latency win.
          </span>
        </div>
      </Surface>

      {/* Two data flows */}
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <FlowCard
          kind="live"
          title="LIVE path"
          subtitle="real-time · &lt;100ms target"
          steps={liveSteps}
        />
        <FlowCard
          kind="async"
          title="ASYNC path"
          subtitle="quality mode · offline"
          steps={asyncSteps}
        />
      </div>

      {/* Where the split happens */}
      <Surface className="mt-8 border-amber-500/20 bg-amber-500/[0.04] p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-300">
            <Radio className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-amber-200">
              Where the split happens.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-300">
              At the driver signal type and delivery deadline.{" "}
              <span className="text-amber-200">
                Live = video-driven pose, hard latency budget, neural
                reenactment (THA3).
              </span>{" "}
              <span className="text-rose-200">
                Async = audio-driven, no latency budget, diffusion
                (AniPortrait).
              </span>{" "}
              The split is a router in the engine:{" "}
              <code className="rounded bg-neutral-900 px-1 py-0.5 font-mono text-xs text-rose-200">
                /ws/live
              </code>{" "}
              (pose stream) vs{" "}
              <code className="rounded bg-neutral-900 px-1 py-0.5 font-mono text-xs text-amber-200">
                /api/render
              </code>{" "}
              (batch job). They share the reference-character registry and
              consent gate but use different model backends.
            </p>
          </div>
        </div>
      </Surface>
    </Section>
  );
}

function FlowCard({
  kind,
  title,
  subtitle,
  steps,
}: {
  kind: "live" | "async";
  title: string;
  subtitle: string;
  steps: string[];
}) {
  const isLive = kind === "live";
  return (
    <Surface
      className={
        isLive
          ? "border-rose-500/20 bg-rose-500/[0.03]"
          : "border-amber-500/20 bg-amber-500/[0.03]"
      }
    >
      <div className="flex items-center justify-between border-b border-neutral-800 p-5">
        <div>
          <h3 className="text-base font-semibold text-neutral-100">{title}</h3>
          <p
            className="text-xs text-neutral-400"
            dangerouslySetInnerHTML={{ __html: subtitle }}
          />
        </div>
        <Badge
          variant="outline"
          className={
            isLive
              ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
              : "border-amber-500/30 bg-amber-500/10 text-amber-200"
          }
        >
          {isLive ? "WS" : "REST"}
        </Badge>
      </div>
      <ol className="space-y-3 p-5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-mono ${
                isLive
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-200"
              }`}
            >
              {i + 1}
            </span>
            <p className="text-sm leading-relaxed text-neutral-300">{step}</p>
          </li>
        ))}
      </ol>
    </Surface>
  );
}
