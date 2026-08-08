"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { id: "hero", label: "Overview" },
  { id: "decision", label: "Decision" },
  { id: "architecture", label: "Architecture" },
  { id: "repo", label: "Repo" },
  { id: "phase-1", label: "Phase 1" },
  { id: "api", label: "API" },
  { id: "consent", label: "Consent" },
  { id: "roadmap", label: "Roadmap" },
  { id: "reality-check", label: "Reality" },
  { id: "studio", label: "Studio" },
];

/**
 * Sticky top header with anchor nav. Highlights the section in view using an
 * IntersectionObserver.
 */
export function SiteHeader() {
  const [active, setActive] = React.useState<string>("hero");

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          setActive(visible[0].target.id);
        }
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    for (const { id } of NAV) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-800/80 bg-neutral-950/85 backdrop-blur supports-[backdrop-filter]:bg-neutral-950/70">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <a
          href="#hero"
          className="flex items-center gap-2 text-sm font-semibold text-neutral-50"
        >
          <span className="flex size-6 items-center justify-center rounded-md bg-rose-500/15 font-mono text-rose-300">
            a
          </span>
          <span className="hidden sm:inline">animated-self</span>
        </a>
        <nav
          aria-label="Section navigation"
          className="ml-auto -mr-2 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex items-center gap-1 px-2">
            {NAV.map((item) => {
              const isActive = active === item.id;
              return (
                <li key={item.id} className="shrink-0">
                  <a
                    href={`#${item.id}`}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-rose-500/15 text-rose-200"
                        : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-100",
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
