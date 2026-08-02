"use client";

import { useState } from "react";
import geo from "@/lib/us-states.json";
import type { StateStat } from "@/lib/data";

/* The geometry is imported here rather than passed down from the page. Handing
   it across the server/client boundary as props serialized all 165 KB of paths
   a second time into the flight payload, on top of the rendered SVG — 423 KB
   for one page. Imported inside the client component it lands in a JS chunk the
   browser caches instead. */

export type Bin = { from: number; to: number };

/* Sequential encoding: one hue, five steps, low to high. The steps are CSS
   variables so light and dark can run the ramp in opposite directions — on a
   dark surface the LIGHTEST step is the one that stands out. */
const STEP = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)"];

// A two-letter label only fits inside the larger states.
const LABEL_AREA = 900;

export default function Map({
  stats,
  bins,
  year,
}: {
  stats: Record<string, StateStat>;
  bins: Bin[];
  year: number;
}) {
  const { shapes, width, height } = geo;
  const [active, setActive] = useState<string | null>(null);

  const binOf = (rate: number) => {
    const i = bins.findIndex((b) => rate <= b.to);
    return i === -1 ? bins.length - 1 : i;
  };

  const fillOf = (code: string) => {
    const s = stats[code];
    if (!s || s.rate === null) return "var(--seq-none)";
    return STEP[binOf(s.rate)];
  };

  const current = active ? stats[active] : null;
  const currentShape = active ? shapes.find((s) => s.code === active) : null;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

  return (
    <figure className="m-0">
      <div className="relative rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          role="img"
          aria-label={`Share of each state's ${year} Medicare providers appearing in the worklist. Full figures are in the table below.`}
        >
          <g>
            {shapes.map((s) => {
              const stat = stats[s.code];
              const on = active === s.code;
              return (
                <path
                  key={s.code}
                  d={s.d}
                  /* These must be CSS properties, not SVG presentation
                     attributes: `fill="var(--seq-1)"` is not valid as an
                     attribute value and silently renders black. The stroke is a
                     surface-coloured gap so neighbouring states never bleed
                     into one another. */
                  style={{
                    fill: fillOf(s.code),
                    stroke: on ? "var(--ink-primary)" : "var(--surface)",
                    strokeWidth: on ? 2 : 1,
                  }}
                  className="cursor-pointer transition-[stroke] duration-100"
                  onMouseEnter={() => setActive(s.code)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(s.code)}
                  onBlur={() => setActive(null)}
                  tabIndex={0}
                  role="button"
                  aria-label={
                    stat && stat.rate !== null
                      ? `${s.name}: ${pct(stat.rate)} of providers listed`
                      : `${s.name}: too few providers to report a rate`
                  }
                />
              );
            })}
          </g>
          <g aria-hidden="true" className="pointer-events-none">
            {shapes
              .filter((s) => s.area >= LABEL_AREA)
              .map((s) => (
                <text
                  key={s.code}
                  x={s.cx}
                  y={s.cy}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-[11px] font-semibold"
                  /* Outlined in the surface colour so a label stays legible
                     over both the palest and the darkest step of the ramp. */
                  style={{
                    fill: "var(--ink-primary)",
                    stroke: "var(--surface)",
                    strokeWidth: 2.5,
                    paintOrder: "stroke",
                  }}
                >
                  {s.code}
                </text>
              ))}
          </g>
        </svg>

        {/* Tooltip. Values live here rather than on every state, so the map
            stays readable. */}
        {current && currentShape && (
          <div
            className="pointer-events-none absolute left-3 top-3 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2 text-sm shadow-sm"
            role="status"
          >
            <p className="font-medium">{currentShape.name}</p>
            {current.rate === null ? (
              <p className="text-[var(--ink-secondary)]">
                Too few providers to report a rate
              </p>
            ) : (
              <p className="tnum text-[var(--ink-secondary)]">
                {pct(current.rate)} listed &middot;{" "}
                {current.listed.toLocaleString("en-US")} of{" "}
                {current.providers.toLocaleString("en-US")}
              </p>
            )}
          </div>
        )}
      </div>

      <figcaption className="mt-3 text-xs text-[var(--ink-secondary)]">
        <span className="block">
          Share of a state&apos;s providers on the worklist
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="flex items-center gap-2">
            <span className="tnum">{pct(bins[0].from)}</span>
            {/* A hairline ring keeps the palest step visible: at the low end
                the ramp is meant to recede toward the surface, which is right
                on the map and unreadable in a legend. */}
            <span className="flex rounded-sm ring-1 ring-[var(--hairline)]">
              {STEP.map((c, i) => (
                <span
                  key={i}
                  className="h-3.5 w-7 first:rounded-l-sm last:rounded-r-sm"
                  style={{ background: c }}
                />
              ))}
            </span>
            <span className="tnum">{pct(bins[bins.length - 1].to)}</span>
          </span>
          <span className="flex items-center gap-2">
            <span
              className="h-3.5 w-7 rounded-sm ring-1 ring-[var(--hairline)]"
              style={{ background: "var(--seq-none)" }}
            />
            too few to say
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
