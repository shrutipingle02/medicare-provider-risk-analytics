import type { Metadata } from "next";
import Dashboard, { type Atlas, type TopProvider } from "./dashboard";
import type { Bin } from "./map";
import geo from "@/lib/us-states.json";
import { getProviders, getSummary, type StateStat } from "@/lib/data";

export const metadata: Metadata = {
  title: "The atlas — Medicare Provider Risk Analytics",
  description:
    "Where the worklist concentrates geographically, as a share of each state's providers rather than a raw count.",
};

const BIN_COUNT = 5;
const HIST_BINS = 10;
const TOP_SPECIALTIES = 7;
const TOP_PROVIDERS = 8;

export default async function AtlasPage() {
  const [summary, providers] = await Promise.all([
    getSummary(),
    getProviders(),
  ]);
  const year = summary.published_scores.ranking_year;

  const stats: Record<string, StateStat> = Object.fromEntries(
    summary.states.map((s) => [s.state, s]),
  );

  /* Bin over the states the map can actually draw. Including Puerto Rico here
     would stretch the scale far enough to flatten every mainland difference —
     it is four times the next highest rate and albersUsa cannot place it, so
     it is left to the ranked list instead. */
  const drawable = geo.shapes
    .map((s) => stats[s.code]?.rate)
    .filter((r): r is number => typeof r === "number");
  const lo = Math.min(...drawable);
  const hi = Math.max(...drawable);
  const width = (hi - lo) / BIN_COUNT;
  const bins: Bin[] = Array.from({ length: BIN_COUNT }, (_, i) => ({
    from: lo + width * i,
    to: i === BIN_COUNT - 1 ? hi : lo + width * (i + 1),
  }));

  /* The ranked list carries every state with a rate, including the ones the
     projection cannot draw. Ranking by rate, not by count: a big state lists
     more providers because it has more providers. */
  const ranked = summary.states
    .filter((s) => s.rate !== null)
    .sort((a, b) => (b.rate as number) - (a.rate as number));

  const tally = <T extends string>(values: T[]) => {
    const m = new Map<T, number>();
    for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };

  const bySpecialty = [...tally(providers.map((p) => p.specialty))]
    .map(([specialty, count]) => ({ specialty, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_SPECIALTIES);

  /* Fixed 0–1 bins rather than min–max. The published list only reaches down
     to about 0.28, and stretching the axis to fit that would hide the fact
     that every provider on it scores high. */
  const scoreHist = Array.from({ length: HIST_BINS }, () => 0);
  for (const p of providers) {
    const i = Math.min(HIST_BINS - 1, Math.floor(p.score * HIST_BINS));
    scoreHist[i] += 1;
  }

  const topSpecialtyByState: Record<string, string> = {};
  for (const s of summary.states) {
    const inState = providers.filter((p) => p.state === s.state);
    if (inState.length === 0) continue;
    const [top] = [...tally(inState.map((p) => p.specialty))].sort(
      (a, b) => b[1] - a[1],
    );
    if (top) topSpecialtyByState[s.state] = top[0];
  }

  const topProviders: TopProvider[] = providers
    .slice(0, TOP_PROVIDERS)
    .map((p) => ({
      rank: p.rank,
      specialty: p.specialty,
      state: p.state,
      score: p.score,
      known_exclusion: p.known_exclusion,
    }));

  const atlas: Atlas = {
    year,
    bins,
    stats,
    ranked,
    bySpecialty,
    scoreHist,
    topSpecialtyByState,
    topProviders,
    kpis: {
      listed: summary.published_scores.worklist_size,
      known: providers.filter((p) => p.known_exclusion).length,
      states: summary.states.length,
      specialties: summary.data.specialties,
    },
  };

  return <Dashboard atlas={atlas} />;
}
