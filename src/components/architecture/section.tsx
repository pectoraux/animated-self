import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Section wrapper — gives every section a stable anchor id, a consistent
 * eyebrow / title / lede, and uniform vertical rhythm on the page.
 */
export interface SectionProps {
  id: string;
  eyebrow?: string;
  title: string;
  lede?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
  className,
}: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("scroll-mt-24 py-16 sm:py-20", className)}
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {eyebrow ? (
          <p className="mb-2 text-xs font-mono uppercase tracking-[0.2em] text-rose-400/80">
            {eyebrow}
          </p>
        ) : null}
        <h2
          id={`${id}-title`}
          className="text-2xl font-semibold tracking-tight text-neutral-50 sm:text-3xl"
        >
          {title}
        </h2>
        {lede ? (
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-400 sm:text-base">
            {lede}
          </p>
        ) : null}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

/**
 * A surface card with the studio dark aesthetic baked in.
 */
export function Surface({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-xl border border-neutral-800 bg-neutral-900/60 backdrop-blur",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * A small heading used inside sections.
 */
export function SubHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "text-sm font-semibold uppercase tracking-wider text-neutral-300",
        className,
      )}
    >
      {children}
    </h3>
  );
}
