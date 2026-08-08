import { Badge } from "@/components/ui/badge";
import { Section, Surface } from "./section";
import { Layers, Radio } from "lucide-react";

const poseSchema = `PoseVector {
  ts_ms: int
  head: { yaw, pitch, roll, x, y, z }
  left_eye:  { blink, pupil_x, pupil_y }
  right_eye: { blink, pupil_x, pupil_y }
  mouth: { open, smile, pucker }
  left_brow, right_brow: float
  audio_level?: float | null   // Phase 4 hook
}`;

const endpoints: {
  method: "GET" | "POST" | "WS";
  path: string;
  purpose: string;
}[] = [
  { method: "GET", path: "/api/health", purpose: "capability flags (cuda? model loaded?)" },
  { method: "GET", path: "/api/characters", purpose: "list reference characters" },
  { method: "GET", path: "/api/characters/{id}/thumbnail", purpose: "PNG" },
  { method: "POST", path: "/api/session/start", purpose: "bind char + output sink" },
  { method: "POST", path: "/api/session/{id}/stop", purpose: "teardown" },
  { method: "GET", path: "/api/session/{id}/preview.jpg", purpose: "latest frame JPEG (preview mode only)" },
  { method: "WS", path: "/ws/live?session_id=…", purpose: "pose stream in, FrameStats out (≤1/s)" },
  { method: "POST", path: "/api/consent/liveness/request", purpose: "issue motion challenge" },
  { method: "POST", path: "/api/consent/liveness/verify", purpose: "verify + issue consent_token" },
  { method: "POST", path: "/api/render", purpose: "queue async render (Phase 3)" },
  { method: "GET", path: "/api/render/{job_id}", purpose: "poll job" },
  { method: "POST", path: "/api/voice/convert", purpose: "convert audio → avatar voice (Phase 4, consent-gated, 503 if unconfigured)" },
  { method: "GET", path: "/api/voice/{out_id}/download", purpose: "download converted WAV (Phase 4)" },
];

const methodColor: Record<string, string> = {
  GET: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  POST: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  WS: "border-rose-500/30 bg-rose-500/10 text-rose-300",
};

const layerCards: { title: string; tone: string; body: string }[] = [
  {
    title: "Capture layer",
    tone: "text-rose-300",
    body: "Browser. Webcam + MediaPipe Tasks (WASM). Outputs a PoseVector over the WS, never video.",
  },
  {
    title: "Inference layer",
    tone: "text-amber-300",
    body: "Local Python on a CUDA GPU. FastAPI + THA3 (live) / diffusion (async).",
  },
  {
    title: "Output layer",
    tone: "text-rose-300",
    body: "pyvirtualcam → OBS Virtual Camera, or mp4 writer for async jobs.",
  },
];

/**
 * Section 6 — API contracts. Three-layer split, the PoseVector schema,
 * endpoint table, and the gateway note.
 */
export function ApiContracts() {
  return (
    <Section
      id="api"
      eyebrow="API contracts"
      title="Three layers, additive by design."
      lede="Capture / Inference / Output. The contracts are designed to be additive so Phase 2–4 don't rearchitect Phase 1 — a generated character (Phase 2) is just a new registry entry; audio (Phase 4) is an optional field on the same WS message."
    >
      {/* Three-layer split */}
      <div className="grid gap-3 sm:grid-cols-3">
        {layerCards.map((c, i) => (
          <Surface key={c.title} className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-xs text-neutral-500">
                0{i + 1}
              </span>
              <Layers className={`size-4 ${c.tone}`} />
              <h3 className="text-sm font-semibold text-neutral-100">
                {c.title}
              </h3>
            </div>
            <p className="text-xs leading-relaxed text-neutral-400">{c.body}</p>
          </Surface>
        ))}
      </div>

      {/* PoseVector schema card */}
      <Surface className="mt-6 overflow-hidden border-rose-500/20">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 bg-rose-500/[0.05] px-5 py-3">
          <div className="flex items-center gap-2">
            <Radio className="size-4 text-rose-300" />
            <h3 className="font-mono text-sm font-semibold text-rose-200">
              PoseVector
            </h3>
            <Badge
              variant="outline"
              className="border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-200"
            >
              THE live wire format
            </Badge>
          </div>
          <span className="font-mono text-xs text-neutral-500">
            ~250 bytes JSON · ~80 bytes packed
          </span>
        </div>
        <pre className="overflow-auto p-5 font-mono text-xs leading-relaxed text-neutral-200 sm:text-[13px] [scrollbar-width:thin]">
          <code>{poseSchema}</code>
        </pre>
        <div className="border-t border-neutral-800 bg-neutral-950/40 px-5 py-3 text-xs text-neutral-400">
          Sending this instead of a video frame is what keeps the live path
          under the 100ms budget.
        </div>
      </Surface>

      {/* Endpoint table */}
      <Surface className="mt-6 overflow-hidden">
        <div className="border-b border-neutral-800 bg-neutral-950/40 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
            Endpoints
          </h3>
        </div>
        <div className="max-h-[28rem] overflow-auto [scrollbar-width:thin]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-950">
              <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Method</th>
                <th className="px-5 py-3 font-medium">Path</th>
                <th className="px-5 py-3 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((e) => (
                <tr
                  key={`${e.method}-${e.path}`}
                  className="border-b border-neutral-800/60 last:border-0 hover:bg-neutral-900/40"
                >
                  <td className="px-5 py-3 align-top">
                    <span
                      className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${methodColor[e.method]}`}
                    >
                      {e.method}
                    </span>
                  </td>
                  <td className="px-5 py-3 align-top">
                    <code className="font-mono text-xs text-neutral-200">
                      {e.path}
                    </code>
                  </td>
                  <td className="px-5 py-3 align-top text-neutral-400">
                    {e.purpose}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Surface>

      {/* Gateway note */}
      <Surface className="mt-6 bg-neutral-950/40 p-5">
        <p className="text-sm leading-relaxed text-neutral-400">
          <span className="font-semibold text-neutral-200">Gateway:</span> All
          engine requests go through the gateway with{" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-rose-200">
            ?XTransformPort=3031
          </code>
          . Source of truth ={" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-amber-200">
            engine/models.py
          </code>{" "}
          (Pydantic), mirrored in{" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-amber-200">
            contracts/types.ts
          </code>{" "}
          and{" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-amber-200">
            contracts/openapi.yaml
          </code>
          .
        </p>
      </Surface>
    </Section>
  );
}
