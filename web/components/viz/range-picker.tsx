"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/* The top-1% recall range, as three marks you can pick between.

   The page's own argument is "report the range, not the point estimate", and
   a static bar still leaves the reader to work out what the ends mean. Picking
   a mark answers it directly: at this recall, out of the fraud actually
   labelled in a test split, this many turn up in the slice you review. */

export type Point = {
  key: "low" | "mean" | "high";
  label: string;
  blurb: string;
  value: number;
};

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const num = (n: number) => Math.round(n).toLocaleString("en-US");

export default function RangePicker({
  points,
  reviewed,
  positives,
  seeds,
}: {
  points: Point[];
  /** Providers an investigator reviews at the top 1% of one test split. */
  reviewed: number;
  /** Labelled fraud providers present in one test split. */
  positives: number;
  seeds: number;
}) {
  const [key, setKey] = useState<Point["key"]>("mean");
  const active = points.find((p) => p.key === key) ?? points[1];

  const lo = Math.min(...points.map((p) => p.value));
  const hi = Math.max(...points.map((p) => p.value));
  // Axis runs 0 to the next whole 5% above the high end.
  const axis = (Math.ceil((hi * 100) / 5) * 5) / 100;
  const at = (v: number) => `${(v / axis) * 100}%`;

  return (
    <div>
      <div className="relative mt-12 mb-16 px-2">
        <div className="relative h-2 rounded-full bg-[var(--series-track)]">
          <span
            aria-hidden
            className="absolute top-0 h-2 rounded-full bg-[var(--series-1)]"
            style={{ left: at(lo), width: `${((hi - lo) / axis) * 100}%` }}
          />

          {points.map((p) => {
            const on = p.key === key;
            return (
              <button
                key={p.key}
                onClick={() => setKey(p.key)}
                aria-pressed={on}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer p-3"
                style={{ left: at(p.value) }}
              >
                <span className="sr-only">
                  {p.label}: {pct(p.value)}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "block rounded-full transition-all",
                    on
                      ? "h-5 w-1.5 bg-[var(--accent)]"
                      : "h-3.5 w-1 bg-[var(--ink-muted)] hover:bg-[var(--ink-secondary)]",
                  )}
                />
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-1/2 -translate-x-1/2 whitespace-nowrap tnum transition-colors",
                    on
                      ? "-top-7 text-sm font-medium text-[var(--accent)]"
                      : "top-9 text-xs text-[var(--ink-muted)]",
                  )}
                >
                  {pct(p.value)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* The readout. aria-live so a screen-reader user hears the change
          rather than having to go hunting for what moved. */}
      <div
        aria-live="polite"
        className="rounded-lg border border-[var(--hairline)] bg-[var(--plane)]/60 p-5"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--accent)]">
          {active.label}
        </p>
        <p className="mt-3 text-2xl tnum">
          {num(active.value * positives)}{" "}
          <span className="text-base font-normal text-[var(--ink-secondary)]">
            of about {num(positives)} labelled fraud providers found
          </span>
        </p>
        <p className="mt-2 text-sm text-[var(--ink-secondary)]">
          {active.blurb} At {pct(active.value)}, reviewing the top{" "}
          {num(reviewed)} providers of a test split turns up{" "}
          {num(active.value * positives)} of the fraud that split has labels
          for.
        </p>
      </div>

      <p className="mt-4 text-xs text-[var(--ink-muted)]">
        Pick a mark to see what it means. Figures are for one test split of{" "}
        {seeds} — a quarter of all providers, held out and never trained on.
      </p>
    </div>
  );
}
