import type { Metadata } from "next";
import { getModel, getSummary, pct } from "@/lib/data";

export const metadata: Metadata = {
  title: "How it works — Medicare Provider Risk Analytics",
  description:
    "What drives the model, and the bias audit that removed two features from it.",
};

const TOP_N = 12;

export default async function HowItWorks() {
  const [model, summary] = await Promise.all([getModel(), getSummary()]);
  const top = model.importance.slice(0, TOP_N);
  const max = top[0].share;
  const flagged = model.bias_audit.filter((r) => r.flagged);

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-20 space-y-32">
      <header>
        <h1>How it works</h1>
        <p className="mt-3 max-w-2xl text-[var(--ink-secondary)]">
          Gradient-boosted trees over {model.n_features} features, trained to
          separate providers who were later excluded by the OIG from those who
          were not. Every score is produced by a model that never saw that
          provider during training.
        </p>
      </header>

      <section>
        <h2>
          What the model actually uses
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ink-secondary)]">
          Mean absolute SHAP contribution, as a share of the total. Higher means
          the feature moves scores more. Showing the top {TOP_N} of{" "}
          {model.n_features}.
        </p>

        {/* Twelve features that all carry meaning: a table with inline bars,
            rather than a chart with a number floating over every mark. */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-lg border-collapse text-sm">
            <caption className="sr-only">
              Feature importance by mean absolute SHAP contribution
            </caption>
            <thead>
              <tr className="text-left text-[var(--ink-muted)]">
                <th scope="col" className="py-2 pr-3 font-normal w-8">
                  #
                </th>
                <th scope="col" className="py-2 pr-4 font-normal">
                  Feature
                </th>
                <th scope="col" className="py-2 pr-3 font-normal w-full">
                  Share of total weight
                </th>
                <th scope="col" className="py-2 text-right font-normal w-16">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {top.map((f) => (
                <tr
                  key={f.feature}
                  className="border-t border-[var(--gridline)]"
                >
                  <td className="py-2 pr-3 tnum text-[var(--ink-muted)]">
                    {f.rank}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{f.label}</td>
                  <td className="py-2 pr-3">
                    <div
                      className="h-2 w-full rounded-sm bg-[var(--series-track)]"
                      role="presentation"
                    >
                      <div
                        className="h-2 rounded-r-sm bg-[var(--series)]"
                        style={{ width: `${(f.share / max) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="py-2 text-right tnum">{pct(f.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>
          The bias audit
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ink-secondary)]">
          A feature can be useful to a model and still be the wrong thing to
          judge a provider on. These are checked on every run: how much weight
          each carries, and whether it pushes scores consistently in one
          direction. Both together are what makes a feature a problem.
        </p>

        <ul className="mt-7 space-y-4">
          {model.bias_audit.map((row) => (
            <li
              key={row.feature}
              className="rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-7"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {/* Status never rides on color alone: icon + label + color. */}
                <span
                  className="inline-flex items-center gap-1.5 text-xs font-medium"
                  style={{
                    color: row.flagged
                      ? "var(--status-warning)"
                      : "var(--status-good)",
                  }}
                >
                  <span aria-hidden="true">{row.flagged ? "▲" : "●"}</span>
                  {row.flagged ? "Flagged" : "Cleared"}
                </span>
                <h3 className="font-medium">{row.label}</h3>
                <span className="tnum text-xs text-[var(--ink-muted)]">
                  rank {row.rank} · {pct(row.share)} of weight · r ={" "}
                  {row.value_vs_shap_spearman >= 0 ? "+" : "−"}
                  {Math.abs(row.value_vs_shap_spearman).toFixed(2)}
                </span>
              </div>
              <p className="mt-2 text-sm text-[var(--ink-secondary)]">
                {row.concern}. Higher values push the score{" "}
                {row.value_vs_shap_spearman >= 0 ? "up" : "down"}.
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-sm text-[var(--ink-secondary)]">
          {flagged.length === 0
            ? "Nothing is currently both influential and directional."
            : `${flagged.length} feature${flagged.length === 1 ? " is" : "s are"} flagged. Flagged does not mean broken — it means the feature earned a decision rather than a default, and the decision is recorded below.`}
        </p>
      </section>

      <section>
        <h2>
          What the audit changed
        </h2>
        <div className="mt-4 space-y-4 text-sm text-[var(--ink-secondary)] max-w-2xl">
          <p>
            <strong className="font-medium text-[var(--ink-primary)]">
              Two features were removed.
            </strong>{" "}
            Peer group size — how many providers share a specialty — is a fact
            about how the data was built, not about any provider. Average
            patient risk score rose with the model&apos;s output, meaning sicker
            patient panels looked more like fraud. Both sat in the top four by
            importance. Removing them cost 0.9 points of top-1% recall, well
            inside the run-to-run spread, so nothing measurable was traded away.
          </p>
          <p>
            <strong className="font-medium text-[var(--ink-primary)]">
              Patient age was kept, and the original worry was wrong.
            </strong>{" "}
            The concern was that geriatric and hospice practices would be
            flagged for their patient mix. The audit found the opposite: older
            patients push the score down, not up. It is protective here.
          </p>
          <p>
            <strong className="font-medium text-[var(--ink-primary)]">
              Patient risk relative to peers was kept deliberately.
            </strong>{" "}
            It is still flagged above, because the audit cannot tell a real
            signal from a proxy. The difference is that this one has a
            mechanism: a panel recorded as sicker than same-specialty peers is
            the signature of upcoding, which is billing behaviour rather than
            patient mix.
          </p>
          <p>
            Scores are published from {summary.published_scores.method}, so no
            provider was ever scored by a model that had seen them.
          </p>
        </div>
      </section>
    </div>
  );
}
