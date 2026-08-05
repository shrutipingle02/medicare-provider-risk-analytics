"use client";

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
export const STEP = [
  "var(--seq-1)",
  "var(--seq-2)",
  "var(--seq-3)",
  "var(--seq-4)",
  "var(--seq-5)",
];

// A two-letter label only fits inside the larger states.
const LABEL_AREA = 900;

export default function Map({
  stats,
  bins,
  year,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  stats: Record<string, StateStat>;
  bins: Bin[];
  year: number;
  hovered: string | null;
  selected: string | null;
  onHover: (code: string | null) => void;
  onSelect: (code: string) => void;
}) {
  const { shapes, width, height } = geo;

  const binOf = (rate: number) => {
    const i = bins.findIndex((b) => rate <= b.to);
    return i === -1 ? bins.length - 1 : i;
  };

  const fillOf = (code: string) => {
    const s = stats[code];
    if (!s || s.rate === null) return "var(--seq-none)";
    return STEP[binOf(s.rate)];
  };

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label={`Share of each state's ${year} Medicare providers appearing in the worklist. Every figure is also in the ranked list on this page.`}
    >
      <g>
        {shapes.map((s) => {
          const stat = stats[s.code];
          /* Selection outranks hover: a pinned state has to stay marked while
             the pointer wanders over its neighbours. */
          const pinned = selected === s.code;
          const on = pinned || hovered === s.code;
          return (
            <path
              key={s.code}
              d={s.d}
              /* These must be CSS properties, not SVG presentation
                 attributes: `fill="var(--seq-1)"` is not valid as an
                 attribute value and silently renders black. The stroke is a
                 plane-coloured gap so neighbouring states never bleed into
                 one another. */
              style={{
                fill: fillOf(s.code),
                stroke: pinned
                  ? "var(--accent)"
                  : on
                    ? "var(--ink-primary)"
                    : "var(--plane)",
                strokeWidth: on ? 2 : 1,
              }}
              className="cursor-pointer transition-[stroke] duration-100"
              onMouseEnter={() => onHover(s.code)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(s.code)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(s.code)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(s.code);
                }
              }}
              tabIndex={0}
              role="button"
              aria-pressed={pinned}
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
              /* Outlined in the plane colour so a label stays legible over
                 both the palest and the darkest step of the ramp. */
              style={{
                fill: "var(--ink-primary)",
                stroke: "var(--plane)",
                strokeWidth: 2.5,
                paintOrder: "stroke",
              }}
            >
              {s.code}
            </text>
          ))}
      </g>
    </svg>
  );
}
