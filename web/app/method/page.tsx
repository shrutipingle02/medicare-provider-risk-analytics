import type { Metadata } from "next";
import { getSummary, num, pct } from "@/lib/data";

export const metadata: Metadata = {
  title: "Method & limits — Medicare Provider Risk Analytics",
  description:
    "How the data was built and measured, and everything this model cannot tell you.",
};

export default async function Method() {
  const summary = await getSummary();
  const { data, metrics, published_scores: scores, caveats } = summary;

  const rows = [
    {
      label: "ROC-AUC",
      value: `${metrics.roc_auc[0].toFixed(3)} ± ${metrics.roc_auc[1].toFixed(3)}`,
    },
    {
      label: "Known fraud found in the top 1%",
      value: `${pct(metrics.recall_at_1pct[0])} ± ${pct(metrics.recall_at_1pct[1])}`,
    },
    {
      label: "Known fraud found in the top 5%",
      value: `${pct(metrics.recall_at_5pct[0])} ± ${pct(metrics.recall_at_5pct[1])}`,
    },
    {
      label: "Range across the 10 runs, top 1%",
      value: `${pct(metrics.recall_at_1pct_range[0])} – ${pct(metrics.recall_at_1pct_range[1])}`,
    },
    {
      label: "Precision in the top 1%",
      value: pct(metrics.precision_at_1pct, 2),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-20 space-y-32">
      <header>
        <h1>
          Method &amp; limits
        </h1>
        <p className="mt-3 max-w-2xl text-[var(--ink-secondary)]">
          What this is measured on, and — more usefully — what it cannot tell
          you.
        </p>
      </header>

      <section>
        <h2>The data</h2>
        <dl className="mt-7 grid gap-4 sm:grid-cols-3">
          {[
            { k: "Provider-years", v: num(data.provider_years) },
            { k: "Providers", v: num(data.providers) },
            { k: "Specialties", v: num(data.specialties) },
            {
              k: "Years covered",
              v: `${data.years[0]}–${data.years[1]}`,
            },
            { k: "Providers with an exclusion", v: num(data.fraud_providers) },
            {
              k: "That is a rate of",
              v: pct(data.prevalence_providers, 3),
            },
          ].map((s) => (
            <div
              key={s.k}
              className="rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-7"
            >
              <dt className="text-xs text-[var(--ink-secondary)]">{s.k}</dt>
              <dd className="mt-1 text-lg font-semibold tnum">{s.v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 max-w-2xl text-sm text-[var(--ink-secondary)]">
          A provider counts as fraud only if excluded under a billing-fraud
          statute and matchable by NPI. Licence-only revocations, patient abuse
          and controlled-substance convictions are deliberately excluded —
          losing a licence is not billing fraud, and a model trained on it would
          learn the wrong target.
        </p>
      </section>

      <section>
        <h2>
          How well it works
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ink-secondary)]">
          {metrics.note} Measured over {metrics.seeds.length} independent
          train/test splits, reported as mean ± standard deviation. Never a
          single run.
        </p>
        <dl className="mt-5 divide-y divide-[var(--gridline)] border-y border-[var(--gridline)]">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-4 py-3">
              <dt className="text-sm text-[var(--ink-secondary)]">{r.label}</dt>
              <dd className="text-sm font-medium tnum whitespace-nowrap">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 max-w-2xl text-sm text-[var(--ink-secondary)]">
          Top-1% recall is the number that matters: nobody can review{" "}
          {num(data.providers)} providers, but a top 1% is reviewable. Accuracy
          is not reported, because at this rate a model can be 99.97% accurate
          by calling everyone clean.
        </p>
      </section>

      <section>
        <h2>
          What this cannot tell you
        </h2>
        <ul className="mt-7 space-y-4">
          {caveats.map((c) => (
            <li
              key={c}
              className="rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-7 text-sm text-[var(--ink-secondary)]"
            >
              {c}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>
          Two findings worth stating plainly
        </h2>
        <div className="mt-4 space-y-4 max-w-2xl text-sm text-[var(--ink-secondary)]">
          <p>
            <strong className="font-medium text-[var(--ink-primary)]">
              The model partly learned <em>when</em>, not just <em>who</em>.
            </strong>{" "}
            The calendar year was deliberately withheld from it. It reconstructed
            the year anyway, through features that drift over time, and scores
            2019 billing roughly twice as high as {scores.ranking_year} billing
            even on providers with no exclusion record. That is why this list
            ranks a single year: within one year the bias is the same for
            everyone listed, so it drops out of the ordering.
          </p>
          <p>
            <strong className="font-medium text-[var(--ink-primary)]">
              Predicting forward is harder than the headline suggests.
            </strong>{" "}
            Trained only on providers caught by 2022 and tested on providers
            caught later — none of whom it had seen labelled — it finds 11.7% of
            them in the top 1%, against {pct(metrics.recall_at_1pct[0])} on
            random splits. Still roughly twelve times better than chance, but
            the random-split figure flatters it.
          </p>
        </div>
      </section>
    </div>
  );
}
