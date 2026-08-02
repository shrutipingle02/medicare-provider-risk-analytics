import type { Metadata } from "next";
import Map, { type Bin } from "./map";
import geo from "@/lib/us-states.json";
import { getSummary, num, pct, type StateStat } from "@/lib/data";

export const metadata: Metadata = {
  title: "By state — Medicare Provider Risk Analytics",
  description:
    "Where the worklist concentrates geographically, as a share of each state's providers rather than a raw count.",
};

const BIN_COUNT = 5;

export default async function Atlas() {
  const summary = await getSummary();
  const year = summary.published_scores.ranking_year;

  const stats: Record<string, StateStat> = Object.fromEntries(
    summary.states.map((s) => [s.state, s]),
  );

  /* Bin over the states the map can actually draw. Including Puerto Rico here
     would stretch the scale far enough to flatten every mainland difference —
     it is four times the next highest rate and albersUsa cannot place it, so it
     is reported in the table instead. */
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

  const offMap = summary.states
    .filter((s) => s.rate !== null && !geo.shapes.some((g) => g.code === s.state))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

  const table = [...summary.states].sort((a, b) => {
    if (a.rate === null && b.rate === null) return a.state.localeCompare(b.state);
    if (a.rate === null) return 1;
    if (b.rate === null) return -1;
    return b.rate - a.rate;
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          Where the worklist concentrates
        </h1>
        <p className="mt-3 max-w-2xl text-[var(--ink-secondary)]">
          The share of each state&apos;s {year} Medicare providers that reach the
          top {num(summary.published_scores.worklist_size)}. This is a rate, not
          a count &mdash; California lists the most providers simply because
          California has the most providers.
        </p>
      </header>

      {/* geo is used here only to work out the bins and which states the
          projection can draw; the map imports the geometry itself. */}
      <Map stats={stats} bins={bins} year={year} />

      {offMap.length > 0 && (
        <section className="rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
          <h2 className="font-medium">Not on the map</h2>
          <p className="mt-2 text-sm text-[var(--ink-secondary)]">
            The projection used here insets Alaska and Hawaii but has no place
            for the territories. They are not omitted from the analysis, and one
            of them is the highest rate anywhere:{" "}
            {offMap.map((s, i) => (
              <span key={s.state}>
                {i > 0 && ", "}
                <strong className="font-medium text-[var(--ink-primary)]">
                  {s.state} at {pct(s.rate as number, 2)}
                </strong>{" "}
                ({num(s.listed)} of {num(s.providers)})
              </span>
            ))}
            . Read it with the same caution as any other single figure here.
          </p>
        </section>
      )}

      <section>
        <h2 className="text-xl font-semibold tracking-tight">Every state</h2>
        <p className="mt-2 text-sm text-[var(--ink-secondary)]">
          {summary.states_note}
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-md border-collapse text-sm">
            <caption className="sr-only">
              Worklist rate by state, highest first
            </caption>
            <thead>
              <tr className="text-left text-[var(--ink-muted)]">
                <th scope="col" className="py-2 pr-4 font-normal">
                  State
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">
                  Providers
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">
                  On the worklist
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  Rate
                </th>
              </tr>
            </thead>
            <tbody>
              {table.map((s) => (
                <tr key={s.state} className="border-t border-[var(--gridline)]">
                  <td className="py-2 pr-4">{s.state}</td>
                  <td className="py-2 pr-4 text-right tnum">
                    {num(s.providers)}
                  </td>
                  <td className="py-2 pr-4 text-right tnum">{num(s.listed)}</td>
                  <td className="py-2 text-right tnum">
                    {s.rate === null ? (
                      <span className="text-[var(--ink-muted)]">
                        too few
                      </span>
                    ) : (
                      pct(s.rate, 2)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="max-w-2xl text-sm text-[var(--ink-secondary)]">
        A darker state does not mean more fraud there. It means more of its
        providers bill unusually for their specialty, and specialty mix varies
        by state &mdash; a state weighted toward the specialties this model
        flags will rank higher whatever its providers are doing.
      </p>
    </div>
  );
}
