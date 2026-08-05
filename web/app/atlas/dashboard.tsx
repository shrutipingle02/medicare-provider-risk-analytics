"use client";

import { useState } from "react";
import {
  Activity,
  BarChart3,
  Flame,
  MapPin,
  Radar,
  ShieldAlert,
} from "lucide-react";
import Map, { STEP, type Bin } from "./map";
import geo from "@/lib/us-states.json";
import type { StateStat } from "@/lib/data";

export type TopProvider = {
  rank: number;
  specialty: string;
  state: string | null;
  score: number;
  known_exclusion: boolean;
};

export type Atlas = {
  year: number;
  bins: Bin[];
  stats: Record<string, StateStat>;
  /* States that carry a rate, highest first. Rate rather than count: a big
     state lists more providers because it has more providers. */
  ranked: StateStat[];
  bySpecialty: { specialty: string; count: number }[];
  scoreHist: number[];
  topSpecialtyByState: Record<string, string>;
  topProviders: TopProvider[];
  kpis: { listed: number; known: number; states: number; specialties: number };
};

/* Names come from the geometry, which only covers what albersUsa can draw.
   Puerto Rico is the highest rate anywhere and heads the ranked list, so the
   territories are named here rather than left as bare postal codes. */
const OFF_MAP: Record<string, string> = {
  PR: "Puerto Rico",
  VI: "U.S. Virgin Islands",
  GU: "Guam",
  AS: "American Samoa",
  MP: "Northern Mariana Islands",
  FM: "Micronesia",
  AA: "Armed Forces Americas",
  AE: "Armed Forces Europe",
  AP: "Armed Forces Pacific",
};

const NAMES: Record<string, string> = {
  ...OFF_MAP,
  ...Object.fromEntries(geo.shapes.map((s) => [s.code, s.name])),
};

const pct = (n: number, d = 2) => `${(n * 100).toFixed(d)}%`;
const num = (n: number) => n.toLocaleString("en-US");

export default function Dashboard({ atlas }: { atlas: Atlas }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  /* Hover is a preview, the pin is the commitment — so hover wins while the
     pointer is on a state and the pin takes over the moment it leaves. */
  const shownCode = hovered ?? pinned;
  const shown = shownCode ? atlas.stats[shownCode] : null;

  const maxState = atlas.ranked[0]?.rate ?? 1;
  const maxSpecialty = atlas.bySpecialty[0]?.count ?? 1;
  const maxHist = Math.max(1, ...atlas.scoreHist);

  return (
    <main className="relative lg:h-[calc(100dvh-60px)] lg:overflow-hidden">
      {/* MAP. Fixed height on small screens where the rails stack beneath it,
          and the whole plane on large ones where they float over it. */}
      <div className="h-[46vh] px-4 pt-4 sm:h-[56vh] lg:absolute lg:inset-0 lg:h-full lg:p-0">
        <Map
          stats={atlas.stats}
          bins={atlas.bins}
          year={atlas.year}
          hovered={hovered}
          selected={pinned}
          onHover={setHovered}
          onSelect={(code) => setPinned((c) => (c === code ? null : code))}
        />
      </div>

      {/* Vignette, so the floating panels have something to sit against. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden lg:block"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 40%, transparent 55%, rgba(10,10,12,0.72) 100%)",
        }}
      />

      {/* TOP BAR */}
      <div className="pointer-events-none z-20 flex items-center justify-between px-5 py-4 lg:absolute lg:inset-x-0 lg:top-0">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.35em] text-[var(--accent)]">
          <MapPin className="h-3.5 w-3.5" aria-hidden /> The atlas
        </p>
        <p className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--ink-muted)] md:block">
          CMS Part B + OIG LEIE &middot; {atlas.year} worklist
        </p>
      </div>

      {/* LEFT RAIL */}
      <div className="z-10 flex flex-col gap-3 p-4 lg:absolute lg:left-0 lg:top-14 lg:h-[calc(100%-3.5rem)] lg:w-72 lg:overflow-y-auto">
        <Panel>
          <h1 className="text-2xl">Where the worklist concentrates.</h1>
          <p className="mt-2 text-xs text-[var(--ink-secondary)]">
            States lighten with the share of their providers that reached the
            top {num(atlas.kpis.listed)}. Hover to inspect, click to pin.
          </p>
        </Panel>

        <Panel title="The spread" icon={<Activity className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Listed" value={num(atlas.kpis.listed)} tone="accent" />
            <Kpi label="Known exclusions" value={num(atlas.kpis.known)} />
            <Kpi label="States" value={num(atlas.kpis.states)} />
            <Kpi label="Specialties" value={num(atlas.kpis.specialties)} />
          </div>
        </Panel>

        <Panel
          title="Worklist by specialty"
          icon={<BarChart3 className="h-3.5 w-3.5" />}
        >
          <ul className="space-y-2">
            {atlas.bySpecialty.map((t) => (
              <li key={t.specialty}>
                <div className="flex justify-between gap-2 text-[11px]">
                  <span className="truncate text-[var(--ink-secondary)]">
                    {t.specialty}
                  </span>
                  <span className="tnum shrink-0 text-[var(--accent)]">
                    {num(t.count)}
                  </span>
                </div>
                <Bar pct={(t.count / maxSpecialty) * 100} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Score distribution"
          icon={<Radar className="h-3.5 w-3.5" />}
        >
          <div className="flex h-20 items-end gap-1">
            {atlas.scoreHist.map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm bg-[var(--series-1)]"
                style={{ height: `${Math.max(2, (v / maxHist) * 100)}%` }}
                title={`${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}: ${num(v)} providers`}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[9px] text-[var(--ink-muted)]">
            <span>0.0</span>
            <span>model score</span>
            <span>1.0</span>
          </div>
        </Panel>
      </div>

      {/* RIGHT RAIL */}
      <div className="z-10 flex flex-col gap-3 p-4 lg:absolute lg:right-0 lg:top-14 lg:h-[calc(100%-3.5rem)] lg:w-80 lg:overflow-y-auto">
        <Panel
          title="Top states by rate"
          icon={<ShieldAlert className="h-3.5 w-3.5" />}
        >
          <ul className="space-y-2">
            {atlas.ranked.slice(0, 10).map((s, i) => (
              <li key={s.state}>
                <button
                  onClick={() =>
                    setPinned((c) => (c === s.state ? null : s.state))
                  }
                  aria-pressed={pinned === s.state}
                  className="block w-full cursor-pointer text-left"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate">
                      <span className="mr-2 tnum text-[var(--ink-muted)]">
                        {i + 1}
                      </span>
                      {NAMES[s.state] ?? s.state}
                    </span>
                    <span className="tnum shrink-0 text-[var(--accent)]">
                      {pct(s.rate as number)}
                    </span>
                  </div>
                  <Bar pct={((s.rate as number) / maxState) * 100} />
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Selected" icon={<MapPin className="h-3.5 w-3.5" />}>
          {shown && shownCode ? (
            <div>
              <h2 className="text-lg">
                {NAMES[shownCode] ?? shownCode}{" "}
                <span className="text-xs text-[var(--ink-muted)]">
                  ({shownCode})
                </span>
              </h2>
              <dl className="mt-2.5 space-y-1.5 text-xs">
                <Row k="Providers in the state" v={num(shown.providers)} />
                <Row k="On the worklist" v={num(shown.listed)} />
                <Row
                  k="Rate"
                  v={shown.rate === null ? "too few to say" : pct(shown.rate)}
                  accent
                />
                <Row
                  k="Most-listed specialty"
                  v={atlas.topSpecialtyByState[shownCode] ?? "—"}
                />
              </dl>
            </div>
          ) : (
            <p className="text-xs text-[var(--ink-secondary)]">
              Pick a state on the map or in the list above.
            </p>
          )}
        </Panel>

        <Panel
          title="Highest-ranked providers"
          icon={<Flame className="h-3.5 w-3.5" />}
        >
          <ul className="space-y-1.5">
            {atlas.topProviders.map((p) => (
              <li
                key={p.rank}
                className="flex items-center gap-2 border-b border-[var(--gridline)] pb-1.5 text-[11px] last:border-0 last:pb-0"
              >
                <span className="w-5 shrink-0 tnum text-[var(--ink-muted)]">
                  {p.rank}
                </span>
                <p className="min-w-0 flex-1 truncate">
                  {p.specialty}{" "}
                  <span className="text-[var(--ink-muted)]">
                    &middot; {p.state ?? "withheld"}
                  </span>
                </p>
                <span className="tnum shrink-0 text-[var(--accent)]">
                  {p.score.toFixed(2)}
                </span>
                {p.known_exclusion && (
                  <span
                    className="shrink-0 text-[var(--status-warning)]"
                    title="On the OIG exclusion list"
                    aria-label="On the OIG exclusion list"
                  >
                    &#9873;
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* LEGEND */}
      <div className="z-10 flex justify-center px-4 pb-6 lg:pointer-events-none lg:absolute lg:bottom-4 lg:left-1/2 lg:-translate-x-1/2 lg:p-0">
        <div className="flex items-center gap-3 rounded-full border border-[var(--hairline)] bg-[var(--surface)]/80 px-4 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--ink-secondary)] backdrop-blur">
          <span className="tnum">{pct(atlas.bins[0].from)}</span>
          <span className="flex rounded-full ring-1 ring-[var(--hairline)]">
            {STEP.map((c, i) => (
              <span
                key={i}
                className="h-2 w-6 first:rounded-l-full last:rounded-r-full"
                style={{ background: c }}
              />
            ))}
          </span>
          <span className="tnum">
            {pct(atlas.bins[atlas.bins.length - 1].to)} listed
          </span>
        </div>
      </div>
    </main>
  );
}

/* The floating glass panel the rails are built from. Sits on the surface
   colour at 80% with a blur behind, so the map stays faintly visible through
   it rather than being boxed out. */
function Panel({
  children,
  title,
  icon,
}: {
  children: React.ReactNode;
  title?: string;
  icon?: React.ReactNode;
}) {
  return (
    <section className="pointer-events-auto rounded-xl border border-[var(--hairline)] bg-[var(--surface)]/80 p-3.5 backdrop-blur-md">
      {title && (
        <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--accent)]">
          <span aria-hidden>{icon}</span> {title}
        </p>
      )}
      {children}
    </section>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "accent";
}) {
  return (
    <div className="rounded-lg border border-[var(--hairline)] bg-[var(--plane)]/50 p-2">
      <div
        className={`font-heading text-xl tnum ${
          tone === "accent" ? "text-[var(--accent)]" : "text-[var(--ink-primary)]"
        }`}
      >
        {value}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-widest text-[var(--ink-muted)]">
        {label}
      </div>
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--series-track)]">
      <div
        className="h-full rounded-full bg-[var(--series-1)]"
        style={{ width: `${Math.max(2, pct)}%` }}
      />
    </div>
  );
}

function Row({
  k,
  v,
  accent,
}: {
  k: string;
  v: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--ink-secondary)]">{k}</dt>
      <dd
        className={
          accent
            ? "tnum text-[var(--accent)]"
            : "tnum text-right text-[var(--ink-primary)]"
        }
      >
        {v}
      </dd>
    </div>
  );
}
