import Link from "next/link";
import Worklist from "./worklist";
import CountUp from "@/components/viz/count-up";
import DotField from "@/components/viz/dot-field";
import { getProviders, getSummary, num, pct } from "@/lib/data";

export default async function Home() {
  const [providers, summary] = await Promise.all([getProviders(), getSummary()]);
  const { data, published_scores: scores, metrics } = summary;

  const stats = [
    {
      value: num(scores.providers_ranked),
      label: `billed Medicare in ${scores.ranking_year}`,
    },
    { value: num(scores.worklist_size), label: "ranked highest, shown below" },
    {
      value: pct(metrics.recall_at_1pct[0]),
      label: "of known fraud sits in the top 1%",
    },
    {
      value: `${data.specialties}`,
      label: "specialties, each compared only against itself",
    },
  ];

  return (
    <>
      {/* Hero. The background is the dataset: one point per sampled provider,
          quiet, with the flagged few lit. The headline figure counts up into
          place. Proportional figures here — tabular is for columns that have
          to align, not for a number standing on its own. */}
      <section className="relative flex min-h-[88vh] items-center overflow-hidden px-5">
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
        <div className="relative mx-auto w-full max-w-5xl py-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--ink-muted)]">
            Medicare Part B &nbsp;&middot;&nbsp; {data.years[0]}&ndash;
            {data.years[1]}
          </p>
          <p className="mt-6 text-6xl font-semibold leading-none tracking-tighter sm:text-8xl lg:text-9xl">
            <CountUp to={data.providers} />
          </p>
          <h1 className="mt-6 max-w-3xl text-2xl font-medium leading-snug sm:text-4xl">
            providers scored.{" "}
            <span className="text-[var(--accent)]">
              {num(scores.worklist_size)}
            </span>{" "}
            bill the most unusually for their specialty.
          </h1>
          <div
            aria-hidden
            className="mt-8 h-px w-24 bg-[var(--accent)]"
          />
          <p className="mt-8 max-w-xl leading-relaxed text-[var(--ink-secondary)]">
            Each point above is a provider. Almost all of them look ordinary for
            the work they do. Every flag below states its reason against that
            provider&apos;s specialty peers, and nobody is named.
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-5xl px-5 pb-10">
      {/* KPI row: the figures that give the hero number its meaning. */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4"
          >
            <dt className="sr-only">{s.label}</dt>
            <dd className="text-2xl font-semibold">{s.value}</dd>
            <p className="mt-1 text-xs leading-snug text-[var(--ink-secondary)]">
              {s.label}
            </p>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-sm text-[var(--ink-secondary)]">
        {scores.ranking_note}{" "}
        <Link href="/how-it-works" className="underline underline-offset-2">
          Why that matters
        </Link>
        , or see{" "}
        <Link href="/atlas" className="underline underline-offset-2">
          where it concentrates by state
        </Link>
        .
      </p>

      <hr className="my-8 border-[var(--hairline)]" />

      {/* The disclaimer sits against the list it qualifies, not one page away. */}
      <p className="mb-8 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 text-sm">
        <strong className="font-medium">
          No provider on this list is accused of anything.
        </strong>{" "}
        <span className="text-[var(--ink-secondary)]">
          A high rank means the billing pattern is unusual for the specialty,
          nothing more. Unusual billing has many innocent explanations, and most
          high-scoring providers have no exclusion record at all. Names and
          identifiers are deliberately excluded.{" "}
          <Link href="/method" className="underline underline-offset-2">
            Read the limits
          </Link>
          .
        </span>
      </p>

      {/* Only the first page ships in the HTML. The filter options come from
          the whole list, so narrowing offers every real choice even before the
          rest of the rows arrive. */}
        <Worklist
          initial={providers.slice(0, 50)}
          total={providers.length}
          specialties={[...new Set(providers.map((p) => p.specialty))].sort()}
          states={[
            ...new Set(
              providers
                .map((p) => p.state)
                .filter((s): s is string => s !== null),
            ),
          ].sort()}
        />
      </div>
    </>
  );
}
