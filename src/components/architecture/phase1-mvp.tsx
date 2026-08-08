import { Section, Surface } from "./section";
import { CodeViewer } from "./code-viewer";
import { LatencyBudget } from "./latency-budget";
import { codeSnippets } from "@/lib/code-snippets";
import { Quote, Terminal } from "lucide-react";

const stackRows: { concern: string; choice: string; why: string }[] = [
  {
    concern: "Model runtime",
    choice: "PyTorch + CUDA",
    why: "THA3 is PyTorch; no WASM/JS port exists or is feasible; needs a GPU.",
  },
  {
    concern: "Server",
    choice: "FastAPI",
    why: "One process serves the live WS (/ws/live) and REST (/api/*); async-native.",
  },
  {
    concern: "Landmark extraction",
    choice: "MediaPipe Tasks (browser)",
    why: "Runs in-browser via WASM/WebGL; we send a ~250-byte pose vector per frame, NOT video — the single biggest latency win.",
  },
  {
    concern: "Virtual cam",
    choice: "pyvirtualcam",
    why: "Canonical bridge to OBS Virtual Camera (Win/Mac) and v4l2loopback (Linux).",
  },
  {
    concern: "Control panel",
    choice: "Next.js 16",
    why: "Already the project base; creators expect a web UI; MediaPipe Tasks has a first-class JS API.",
  },
];

const runCommands = `cd engine
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Install OBS (provides OBS Virtual Camera); Linux: sudo modprobe v4l2loopback video_nr=99
export THA3_CHECKPOINT=./checkpoints/tha3.pt
uvicorn app:app --host 127.0.0.1 --port 3031`;

/**
 * Section 5 — Phase 1 MVP: stack table, the "no cloud" quote, latency budget,
 * tabbed code viewer, and run instructions.
 */
export function Phase1Mvp() {
  return (
    <Section
      id="phase-1"
      eyebrow="Phase 1 MVP"
      title="What ships now, and why."
      lede="Phase 1 is the live video-driven path only. The model can't run in the browser; the browser only captures and extracts pose. All neural inference is local Python on a CUDA GPU."
    >
      {/* Stack table */}
      <Surface className="overflow-hidden">
        <div className="border-b border-neutral-800 bg-neutral-950/40 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
            Stack choice
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 font-medium">Concern</th>
                <th className="px-5 py-3 font-medium">Choice</th>
                <th className="px-5 py-3 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {stackRows.map((row) => (
                <tr
                  key={row.concern}
                  className="border-b border-neutral-800/60 last:border-0"
                >
                  <td className="px-5 py-3 align-top font-medium text-neutral-200">
                    {row.concern}
                  </td>
                  <td className="px-5 py-3 align-top">
                    <code className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-xs text-rose-200">
                      {row.choice}
                    </code>
                  </td>
                  <td className="px-5 py-3 align-top text-neutral-400">
                    {row.why}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Surface>

      {/* The "no cloud" quote */}
      <Surface className="mt-6 border-rose-500/20 bg-gradient-to-br from-rose-500/[0.07] to-transparent p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <Quote className="mt-0.5 size-5 shrink-0 text-rose-400" />
          <blockquote className="text-base leading-relaxed text-neutral-100 sm:text-lg">
            The reenactment model cannot run in the browser. The browser only
            captures webcam/mic and extracts the pose; all neural inference is
            local Python on a CUDA GPU.{" "}
            <span className="font-semibold text-rose-200">
              There is no cloud round-trip in the live path.
            </span>
          </blockquote>
        </div>
      </Surface>

      {/* Latency budget */}
      <div className="mt-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          Latency budget
        </h3>
        <LatencyBudget />
      </div>

      {/* Code excerpts */}
      <div className="mt-10">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          Code excerpts
        </h3>
        <p className="mb-4 text-sm text-neutral-400">
          Curated from the real engine source. These are the files that matter —
          the FastAPI surface, the hot loop, the model wrapper, the pose mapping,
          the virtual-cam sink, and the wire contract.
        </p>
        <CodeViewer snippets={codeSnippets} defaultId="app" />
      </div>

      {/* How to run */}
      <div className="mt-10">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          How to run
        </h3>
        <Surface className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-950/60 px-4 py-2.5">
            <Terminal className="size-3.5 text-rose-300" />
            <span className="font-mono text-xs text-neutral-500">
              engine/ · uvicorn
            </span>
          </div>
          <pre className="overflow-auto p-4 font-mono text-xs leading-relaxed text-neutral-300 sm:text-[13px] [scrollbar-width:thin]">
            <code>{runCommands}</code>
          </pre>
        </Surface>
      </div>
    </Section>
  );
}
