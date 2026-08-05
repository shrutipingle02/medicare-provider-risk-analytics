import type { Metadata } from "next";
import { AlertTriangle, BarChart3, ScaleIcon, ShieldCheck } from "lucide-react";
import {
  Divider,
  Kicker,
  Lead,
  PageHeader,
  Panel,
  Reveal,
  Section,
} from "@/components/story";
import RangePicker from "@/components/viz/range-picker";
import { getModel, getSummary, pct } from "@/lib/data";

export const metadata: Metadata = {
  title: "How it works — Medicare Provider Risk Analytics",
  description:
    "What drives the model, the bias audit that removed two features from it, and what it cannot tell you.",
};

/* Eight, not the full 46. Past the eighth the shares are within a rounding
   step of each other and the bars stop saying anything. */
const TOP_N = 8;

const JUMP = [
  { href: "#uses", label: "What it uses" },
  { href: "#audit", label: "The bias audit" },
  { href: "#limits", label: "The limits" },
];

export default async function HowItWorks() {
  const [model, summary] = await Promise.all([getModel(), getSummary()]);
  const top = model.importance.slice(0, TOP_N);
  const max = top[0].share;
  const { data, metrics, published_scores: scores, caveats } = summary;

  /* One test split holds out a quarter of the providers — the protocol's own
     figure, not a guess: 1,668,394 x 0.25 gives the 417,099 per split it
     reports. So the slice reviewed at the top 1% is 4,171 providers.

     The labelled fraud in that slice is NOT a quarter of the 486. The grouped
     split does not divide positives exactly in proportion, and assuming it did
     put this two providers too high. Deriving it from the published precision
     and recall instead lands on the ~120 the protocol reports, and keeps the
     readout consistent with the two metrics printed beside it:

         positives = precision@1% x reviewed / recall@1% */
  const TEST_FRACTION = 0.25;
  const reviewed = data.providers * TEST_FRACTION * 0.01;
  const testPositives =
    (metrics.precision_at_1pct * reviewed) / metrics.recall_at_1pct[0];

  return (
    <>
      <PageHeader
        eyebrow="How it works"
        title={
          <>
            What the model uses, and what it{" "}
            <span className="text-[var(--accent)]">refuses to.</span>
          </>
        }
        lead={
          <>
            Gradient-boosted trees over {model.n_features} features. Every score
            comes from a model that never saw that provider in training — and
            every feature had to earn its place.
          </>
        }
      />

      {/* Three sections is few enough to list, and a reader who came for the
          limits should not have to scroll past the bars to find them. */}
      <nav
        aria-label="On this page"
        className="mx-auto flex max-w-5xl flex-wrap justify-center gap-2 px-5"
      >
        {JUMP.map((j) => (
          <a
            key={j.href}
            href={j.href}
            className="rounded-full border border-[var(--hairline)] px-4 py-1.5 text-xs text-[var(--ink-secondary)] transition-colors hover:border-[var(--baseline)] hover:text-[var(--ink-primary)]"
          >
            {j.label}
          </a>
        ))}
      </nav>

      {/* ===== WHAT IT USES ============================================= */}
      <Section id="uses">
        <Reveal>
          <Kicker icon={<BarChart3 className="h-4 w-4" />}>
            What it uses
          </Kicker>
          <h2 className="mt-4">The top {TOP_N} of {model.n_features} features.</h2>
        </Reveal>
        <Reveal delay={100}>
          <Lead>
            How much each feature moves a score, as a share of all the movement
            in the model. Longer bar, bigger say.
          </Lead>
        </Reveal>

        <Reveal delay={150}>
          <Panel className="mt-10">
            <ul className="space-y-4">
              {top.map((f) => (
                <li key={f.feature}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm">
                      <span className="mr-2 tnum text-[var(--ink-muted)]">
                        {f.rank}
                      </span>
                      {f.label}
                    </span>
                    <span className="tnum shrink-0 text-sm text-[var(--accent)]">
                      {pct(f.share)}
                    </span>
                  </div>
                  <div
                    role="presentation"
                    className="mt-2 h-2 w-full rounded-sm bg-[var(--series-track)]"
                  >
                    <div
                      className="h-2 rounded-sm bg-[var(--series-1)]"
                      style={{ width: `${(f.share / max) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </Reveal>
      </Section>

      <Divider />

      {/* ===== THE BIAS AUDIT =========================================== */}
      <Section id="audit">
        <Reveal>
          <Kicker icon={<ScaleIcon className="h-4 w-4" />}>
            The bias audit
          </Kicker>
          <h2 className="mt-4">
            A feature can be useful and still be the{" "}
            <span className="text-[var(--accent)]">wrong thing</span> to judge
            someone on.
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <Lead>
            Each of these is checked on every run: how much weight it carries,
            and whether it pushes scores consistently one way. Both together are
            what makes a feature a problem.
          </Lead>
        </Reveal>

        <ul className="mt-10 grid gap-4 md:grid-cols-2">
          {model.bias_audit.map((row, i) => (
            <Reveal key={row.feature} delay={70 * i}>
              <Panel className="h-full">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {/* Status never rides on colour alone: icon + label + colour. */}
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
                  <h3 className="text-base">{row.label}</h3>
                </div>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
                  rank {row.rank} &middot; {pct(row.share)} of weight &middot;
                  pushes scores{" "}
                  {row.value_vs_shap_spearman >= 0 ? "up" : "down"}
                </p>
                <p className="mt-2.5 text-sm text-[var(--ink-secondary)]">
                  {row.concern}.
                </p>
              </Panel>
            </Reveal>
          ))}
        </ul>

        <Reveal delay={200}>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {[
              {
                t: "Two features removed",
                d: "Peer group size and raw patient risk score. Both were in the top four by importance. Removing them cost 0.9 points of top-1% recall — inside the run-to-run spread, so nothing measurable was traded away.",
              },
              {
                t: "Patient age kept",
                d: "The worry was that geriatric and hospice practices would be flagged for their patient mix. The audit found the opposite: older patients push the score down. It protects them.",
              },
              {
                t: "One flag kept on purpose",
                d: "Patient risk versus peers stays flagged. The difference is it has a mechanism — a panel recorded as sicker than its peers is the signature of upcoding, which is billing behaviour.",
              },
            ].map((c) => (
              <Panel key={c.t} className="h-full">
                <h3 className="text-base">{c.t}</h3>
                <p className="mt-2 text-sm text-[var(--ink-secondary)]">
                  {c.d}
                </p>
              </Panel>
            ))}
          </div>
        </Reveal>
      </Section>

      <Divider />

      {/* ===== THE LIMITS =============================================== */}
      <Section id="limits">
        <Reveal>
          <Kicker icon={<AlertTriangle className="h-4 w-4" />}>
            The limits
          </Kicker>
          <h2 className="mt-4">What this cannot tell you.</h2>
        </Reveal>
        <Reveal delay={100}>
          <Lead>
            The more useful half. Measured over {metrics.seeds.length}{" "}
            independent splits, reported as mean ± standard deviation, never a
            single run.
          </Lead>
        </Reveal>

        {/* The range, drawn. The page says "report the range, not the point
            estimate" — printing it as two numbers in a row was asking the
            reader to do that conversion themselves. */}
        <Reveal delay={150}>
          <Panel className="mt-10">
            <h3 className="text-base">
              Known fraud found in the top 1%, across{" "}
              {metrics.seeds.length} splits
            </h3>
            <RangePicker
              points={[
                {
                  key: "low",
                  label: "Worst of the splits",
                  blurb:
                    "The split where the model did least well. This is the honest floor.",
                  value: metrics.recall_at_1pct_range[0],
                },
                {
                  key: "mean",
                  label: `Average across ${metrics.seeds.length} splits`,
                  blurb:
                    "The headline figure, and the only one worth quoting on its own.",
                  value: metrics.recall_at_1pct[0],
                },
                {
                  key: "high",
                  label: "Best of the splits",
                  blurb:
                    "The split that flattered it. Quoting this one alone would be cherry-picking.",
                  value: metrics.recall_at_1pct_range[1],
                },
              ]}
              reviewed={reviewed}
              positives={testPositives}
              seeds={metrics.seeds.length}
            />
            <p className="mt-5 text-sm text-[var(--ink-secondary)]">
              One number would have read as precision this does not have. The
              spread is driven by having only about {Math.round(testPositives)}{" "}
              labelled fraud providers in each test split.
            </p>
          </Panel>
        </Reveal>

        <ul className="mt-4 grid gap-4 md:grid-cols-2">
          {caveats.map((c, i) => (
            <Reveal key={c} delay={50 * i}>
              <Panel className="h-full">
                <p className="text-sm text-[var(--ink-secondary)]">
                  <span className="mr-2 font-mono text-xs text-[var(--ink-muted)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {c}
                </p>
              </Panel>
            </Reveal>
          ))}
        </ul>

        <Reveal delay={200}>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Panel className="h-full">
              <h3 className="flex items-center gap-2 text-base">
                <ShieldCheck
                  className="h-4 w-4 text-[var(--status-warning)]"
                  aria-hidden
                />
                It partly learned <em>when</em>, not just <em>who</em>
              </h3>
              <p className="mt-2 text-sm text-[var(--ink-secondary)]">
                The calendar year was withheld. The model reconstructed it
                anyway and scores 2019 billing about twice as high as{" "}
                {scores.ranking_year}, even on providers with no exclusion
                record. That is why the list ranks a single year — the bias is
                then identical for everyone on it and drops out of the order.
              </p>
            </Panel>
            <Panel className="h-full">
              <h3 className="flex items-center gap-2 text-base">
                <ShieldCheck
                  className="h-4 w-4 text-[var(--status-warning)]"
                  aria-hidden
                />
                Predicting forward is harder
              </h3>
              <p className="mt-2 text-sm text-[var(--ink-secondary)]">
                Trained only on providers caught by 2022 and tested on people
                caught later, it finds 11.7% of them in the top 1%, against{" "}
                {pct(metrics.recall_at_1pct[0])} on random splits. Still about
                twelve times better than chance — but the headline figure
                flatters it.
              </p>
            </Panel>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
