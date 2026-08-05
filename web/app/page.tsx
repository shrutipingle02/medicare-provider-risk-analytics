import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Database,
  Layers,
  ListOrdered,
  ScrollText,
  ShieldAlert,
  Users,
} from "lucide-react";
import DotField from "@/components/viz/dot-field";
import TextCycle from "@/components/viz/text-cycle";
import Typewriter from "@/components/viz/typewriter";
import {
  Divider,
  Kicker,
  Lead,
  Panel,
  Reveal,
  Section,
} from "@/components/story";
import { getSummary, num, pct } from "@/lib/data";

/* The floor the model is measured against, from models/baseline_metrics.json
   and the XGBoost row of models/metrics.json. All four are provider-year
   top-1% recall, so the ladder compares like with like.

   These are the only figures on this page not read from summary.json — the
   pipeline does not publish the baselines to the site. If baseline.py is rerun
   with different columns, update them here. */
const LADDER = [
  { label: "Picking at random", value: 0.01 },
  { label: "Best raw column — payment per patient", value: 0.056 },
  { label: "Best peer-relative column", value: 0.094 },
  { label: "The full model", value: 0.175, lit: true },
];

export default async function Home() {
  const summary = await getSummary();
  const { data, published_scores: scores, metrics } = summary;

  return (
    <>
      {/* ===== HERO =====================================================
          Centred, and led by a claim rather than by a figure. The count of
          providers is not lost — it opens THE PROBLEM immediately below,
          where it has a sentence around it to mean something.

          The dot field stays: it is this project's one piece of scenery, and
          it is made of the data rather than laid over it. */}
      <section className="relative flex min-h-[92vh] flex-col items-center justify-center overflow-hidden px-5 text-center">
        <DotField
          total={data.providers}
          listed={scores.worklist_size}
          className="absolute inset-0 h-full w-full"
        />
        {/* Vignette so the field recedes behind the type rather than competing
            with it. Without this the dots fight every line of text. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 50% 45%, rgba(10,10,12,0) 0%, rgba(10,10,12,0.72) 55%, var(--plane) 100%)",
          }}
        />

        <div className="relative z-10 flex w-full max-w-3xl flex-col items-center py-16">
          <p className="animate-in fade-in fill-mode-both duration-700 font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)] motion-reduce:animate-none">
            Medicare Part B &nbsp;&middot;&nbsp; {data.years[0]}&ndash;
            {data.years[1]}
          </p>

          <h1 className="animate-in fade-in slide-in-from-bottom-6 fill-mode-both delay-150 duration-1000 mt-7 text-5xl leading-[1.04] sm:text-6xl lg:text-7xl motion-reduce:animate-none">
            We rank the billing
            <br />
            that{" "}
            <TextCycle
              words={[
                "doesn’t fit.",
                "stands out.",
                "breaks pattern.",
                "bills alone.",
              ]}
              className="text-[var(--accent)]"
            />
          </h1>

          <p className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both delay-300 duration-1000 mt-8 max-w-xl text-lg text-[var(--ink-secondary)] motion-reduce:animate-none">
            Six years of real Medicare billing, ranked into a short, explained
            list of who to check first. Every flag states its reason against
            that provider&apos;s specialty peers, and nobody is named.
          </p>

          <div className="animate-in fade-in fill-mode-both delay-500 duration-1000 mt-11 flex flex-col items-center gap-6 motion-reduce:animate-none">
            <Typewriter
              phrases={[
                "reading real Medicare billing…",
                "ranking by peer deviation…",
                "explaining every flag.",
              ]}
              className="font-mono text-xs tracking-wider text-[var(--ink-muted)]"
            />

            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/worklist"
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--series-1)] px-7 py-3.5 text-sm font-medium text-[#06070a] transition-colors hover:bg-[var(--accent)]"
              >
                See the worklist <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/how-it-works#limits"
                className="rounded-lg border border-[var(--hairline)] px-7 py-3.5 text-sm text-[var(--ink-secondary)] transition-colors hover:border-[var(--baseline)] hover:text-[var(--ink-primary)]"
              >
                Read the limits first
              </Link>
            </div>

            <a
              href="#problem"
              aria-label="Skip to the first section"
              className="text-[var(--ink-muted)] transition-colors hover:text-[var(--accent)]"
            >
              <ArrowDown
                className="h-5 w-5 animate-bounce motion-reduce:animate-none"
                aria-hidden
              />
            </a>
          </div>
        </div>
      </section>

      {/* ===== THE PROBLEM ============================================== */}
      <Section id="problem">
        <Reveal>
          <Kicker icon={<ShieldAlert className="h-4 w-4" />}>
            The problem
          </Kicker>
          <h2 className="mt-4">
            Nobody can review{" "}
            <span className="text-[var(--accent)]">
              {num(data.providers)}
            </span>{" "}
            providers.
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <Lead>
            Across six years of Medicare billing, {num(data.fraud_providers)}{" "}
            providers carry an exclusion for billing fraud. That is{" "}
            {pct(data.prevalence_providers, 3)} — roughly three in every ten
            thousand. Finding them by hand means reading{" "}
            {num(data.provider_years)} provider-years, and an investigator can
            only ever open a case on a handful.
          </Lead>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {[
            { v: num(data.providers), l: "providers to watch" },
            {
              v: num(data.fraud_providers),
              l: "carry a billing-fraud exclusion",
            },
            {
              v: pct(data.prevalence_providers, 3),
              l: "of them — the rate you are hunting in",
            },
          ].map((s, i) => (
            <Reveal key={s.l} delay={100 * i}>
              <Panel className="h-full text-center">
                <p className="font-heading text-4xl font-medium text-[var(--accent)] tnum">
                  {s.v}
                </p>
                <p className="mt-2 text-sm text-[var(--ink-secondary)]">
                  {s.l}
                </p>
              </Panel>
            </Reveal>
          ))}
        </div>
      </Section>

      <Divider />

      {/* ===== THE IDEA ================================================= */}
      <Section>
        <Reveal>
          <Kicker icon={<ListOrdered className="h-4 w-4" />}>The idea</Kicker>
          <h2 className="mt-4">
            Don&apos;t try to catch all fraud. Decide{" "}
            <span className="text-[var(--accent)]">who to check first.</span>
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <Lead>
            An investigator has a fixed budget and can only ever look at a small
            fraction of providers. So the useful question is not who is guilty —
            it is which few hundred are worth opening first, and why. That
            reframing drives every technical choice here.
          </Lead>
        </Reveal>
        <Reveal delay={150}>
          <Panel className="mt-10 max-w-2xl">
            <p className="text-sm text-[var(--ink-secondary)]">
              <strong className="font-medium text-[var(--ink-primary)]">
                Accuracy is not reported anywhere on this site.
              </strong>{" "}
              At a rate of {pct(data.prevalence_providers, 3)}, a model can be
              99.97% accurate by calling everyone clean. The measure that
              matters is how much known fraud lands in the top slice a person
              can actually review.
            </p>
          </Panel>
        </Reveal>
      </Section>

      {/* ===== HOW IT WORKS ============================================= */}
      <Section>
        <Reveal>
          <Kicker icon={<Database className="h-4 w-4" />}>How it works</Kicker>
          <h2 className="mt-4">Four steps, from raw billing to a worklist.</h2>
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {[
            {
              icon: <Database className="h-5 w-5" />,
              t: "1. Start from real records",
              d: `Public CMS Part B billing for ${data.years[0]}–${data.years[1]}, labelled against the government's own exclusion list on NPI. ${num(data.provider_years)} provider-years, nothing synthetic.`,
            },
            {
              icon: <Users className="h-5 w-5" />,
              t: "2. Compare like with like",
              d: `Billing a lot is not fraud, it is a big practice. Every measure is recomputed against the provider's own specialty in the same year — ${data.specialties} specialties, each judged only against itself.`,
            },
            {
              icon: <ListOrdered className="h-5 w-5" />,
              t: "3. Rank, don't accuse",
              d: `Gradient-boosted trees over 46 features score every provider and put them in order. The output is a queue, not a verdict.`,
            },
            {
              icon: <ScrollText className="h-5 w-5" />,
              t: "4. State a reason for every flag",
              d: `No black box. Each listed provider arrives with its own reasons in plain words — "unusually high payment per patient (98th percentile of its peer group)".`,
            },
          ].map((s, i) => (
            <Reveal key={s.t} delay={80 * i}>
              <Panel className="flex h-full gap-4">
                <span
                  aria-hidden
                  className="mt-1 shrink-0 text-[var(--series-1)]"
                >
                  {s.icon}
                </span>
                <div>
                  <h3>{s.t}</h3>
                  <p className="mt-2 text-sm text-[var(--ink-secondary)]">
                    {s.d}
                  </p>
                </div>
              </Panel>
            </Reveal>
          ))}
        </div>
      </Section>

      <Divider />

      {/* ===== AT A GLANCE ============================================== */}
      <Section>
        <Reveal>
          <Kicker icon={<Layers className="h-4 w-4" />}>At a glance</Kicker>
          <h2 className="mt-4">What it actually delivers.</h2>
        </Reveal>
        <Reveal delay={100}>
          <Lead>
            Measured over {metrics.seeds.length} independent train/test splits,
            reported as mean ± standard deviation. Never a single run.
          </Lead>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              v: `${pct(metrics.recall_at_1pct[0])}`,
              l: `of known fraud found in the top 1% — against ${pct(0.01, 0)} if you picked at random`,
            },
            {
              v: `${pct(metrics.recall_at_5pct[0])}`,
              l: "found in the top 5%",
            },
            {
              v: metrics.roc_auc[0].toFixed(3),
              l: `ROC-AUC, ± ${metrics.roc_auc[1].toFixed(3)} across splits`,
            },
            {
              v: num(scores.worklist_size),
              l: `published and ranked, out of ${num(scores.providers_ranked)} who billed in ${scores.ranking_year}`,
            },
            {
              v: `${data.specialties}`,
              l: "specialties, each compared only against itself",
            },
            {
              v: "0",
              l: "names or identifiers published, enforced in code",
            },
          ].map((s, i) => (
            <Reveal key={s.l} delay={60 * i}>
              <Panel className="h-full">
                <p className="font-heading text-3xl font-medium text-[var(--accent)] tnum">
                  {s.v}
                </p>
                <p className="mt-2 text-sm leading-snug text-[var(--ink-secondary)]">
                  {s.l}
                </p>
              </Panel>
            </Reveal>
          ))}
        </div>
        <Reveal delay={200}>
          <p className="mt-6 max-w-2xl text-sm text-[var(--ink-muted)]">
            Read the range, not the point estimate: top-1% recall spans{" "}
            {pct(metrics.recall_at_1pct_range[0])} to{" "}
            {pct(metrics.recall_at_1pct_range[1])} across the{" "}
            {metrics.seeds.length} splits.{" "}
            <Link
              href="/how-it-works#limits"
              className="underline underline-offset-2 hover:text-[var(--ink-secondary)]"
            >
              Why that spread exists
            </Link>
            .
          </p>
        </Reveal>
      </Section>

      <Divider />

      {/* ===== THE BREAKTHROUGH ========================================= */}
      <Section>
        <Reveal>
          <Kicker icon={<Users className="h-4 w-4" />}>
            The breakthrough
          </Kicker>
          <h2 className="mt-4">
            We stopped judging a provider against{" "}
            <span className="text-[var(--accent)]">everyone.</span>
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <Lead>
            Raw totals mostly measure how big a practice is. A dermatologist
            billing like a dermatologist looks ordinary; a dermatologist billing
            like nobody else in dermatology does not. So every headline measure
            is recomputed against that provider&apos;s own specialty in the same
            year — as a z-score, a percentile, and a ratio to the peer median.
            That single change is what stops the model from simply flagging
            large practices.
          </Lead>
        </Reveal>

        {/* Each rung roughly doubles the one below it. A bar per rung, because
            the point is the size of the gaps, not the four numbers. */}
        <Reveal delay={150}>
          <Panel className="mt-12">
            <h3 className="text-base">
              Known fraud caught in the top 1%, one step at a time
            </h3>
            <ul className="mt-7 space-y-5">
              {LADDER.map((r) => (
                <li key={r.label}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span
                      className={
                        r.lit
                          ? "text-sm font-medium text-[var(--ink-primary)]"
                          : "text-sm text-[var(--ink-secondary)]"
                      }
                    >
                      {r.label}
                    </span>
                    <span
                      className={
                        r.lit
                          ? "tnum text-sm font-medium text-[var(--accent)]"
                          : "tnum text-sm text-[var(--ink-secondary)]"
                      }
                    >
                      {pct(r.value)}
                    </span>
                  </div>
                  <div
                    role="presentation"
                    className="mt-2 h-2 w-full rounded-sm bg-[var(--series-track)]"
                  >
                    <div
                      className="h-2 rounded-sm"
                      style={{
                        width: `${(r.value / LADDER[LADDER.length - 1].value) * 100}%`,
                        background: r.lit
                          ? "var(--accent)"
                          : "var(--series-1)",
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-7 text-sm text-[var(--ink-secondary)]">
              Each layer roughly doubles the one below it. The finished model is{" "}
              <strong className="font-medium text-[var(--ink-primary)]">
                3.1&times;
              </strong>{" "}
              the best single-column rule, and{" "}
              <strong className="font-medium text-[var(--ink-primary)]">
                17&times;
              </strong>{" "}
              picking at random.
            </p>
          </Panel>
        </Reveal>

        <Reveal delay={200}>
          <div className="mt-12 flex flex-wrap items-center gap-4">
            <Link
              href="/worklist"
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--series-1)] px-6 py-3 text-sm font-medium text-[#06070a] transition-colors hover:bg-[var(--accent)]"
            >
              See the {num(scores.worklist_size)} providers
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/how-it-works"
              className="rounded-lg border border-[var(--hairline)] px-6 py-3 text-sm text-[var(--ink-secondary)] transition-colors hover:border-[var(--baseline)] hover:text-[var(--ink-primary)]"
            >
              What drives the model
            </Link>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
