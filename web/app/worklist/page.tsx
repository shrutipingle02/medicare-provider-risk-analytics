import type { Metadata } from "next";
import Link from "next/link";
import { EyeOff, Gauge, ListOrdered, ScrollText, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Divider,
  Kicker,
  Lead,
  PageHeader,
  Panel,
  Reveal,
  Section,
} from "@/components/story";
import { getProviders, getSummary, num, pct } from "@/lib/data";

export const metadata: Metadata = {
  title: "The worklist — Medicare Provider Risk Analytics",
  description:
    "The ranked list itself: the providers whose billing is most unusual for their specialty, each with its reasons.",
};

/* How many rows the page shows. The ranking is 5,000 long; this is the top of
   it, sized to be read in one look rather than searched through. */
const PREVIEW = 12;

export default async function WorklistPage() {
  const [providers, summary] = await Promise.all([
    getProviders(),
    getSummary(),
  ]);
  const { data, published_scores: scores, metrics } = summary;

  const traits = [
    {
      icon: <ListOrdered className="h-5 w-5" />,
      t: "Prioritised, not exhaustive",
      d: `The goal is to make the reviewable slice as dense with real signal as possible, not to catch everything. ${pct(metrics.recall_at_1pct[0])} of known fraud lands in the top 1%.`,
    },
    {
      icon: <Users className="h-5 w-5" />,
      t: "Peer-aware",
      d: `Every provider is judged against their own specialty in the same year — ${data.specialties} of them. Billing a lot is a big practice, not a crime, so volume alone never lists anyone.`,
    },
    {
      icon: <ScrollText className="h-5 w-5" />,
      t: "Explained by design",
      d: "No row arrives bare. Each carries its own reasons in plain words, drawn from where that provider sits against their peer group, so a human can judge it in seconds.",
    },
    {
      icon: <EyeOff className="h-5 w-5" />,
      t: "Anonymous by design",
      d: "No NPI, no names — refused in code, not just left out. State is dropped wherever a specialty and state together describe fewer than 11 people.",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="The worklist"
        title={
          <>
            What an investigator{" "}
            <span className="text-[var(--accent)]">opens first.</span>
          </>
        }
        lead={
          <>
            Not a verdict — a starting point. The{" "}
            {num(scores.providers_ranked)} providers who billed Medicare in{" "}
            {scores.ranking_year}, narrowed to the{" "}
            {num(scores.worklist_size)} whose billing is most unusual for their
            specialty, each carrying its own reason.
          </>
        }
      />

      <Section className="pt-4">
        <div className="grid gap-5 md:grid-cols-2">
          {traits.map((s, i) => (
            <Reveal key={s.t} delay={70 * i}>
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

      <Section id="list">
        <Reveal>
          <Kicker icon={<Gauge className="h-4 w-4" />}>The list</Kicker>
          <h2 className="mt-4">Ranked, one calendar year at a time.</h2>
        </Reveal>
        <Reveal delay={100}>
          <Lead>{scores.ranking_note}</Lead>
        </Reveal>

        {/* The disclaimer sits against the list it qualifies, not one page
            away. It is the last thing read before the first row. */}
        <Reveal delay={150}>
          <Panel className="my-10">
            <p className="text-sm">
              <strong className="font-medium">
                No provider on this list is accused of anything.
              </strong>{" "}
              <span className="text-[var(--ink-secondary)]">
                A high rank means the billing pattern is unusual for the
                specialty, nothing more. Unusual billing has many innocent
                explanations, and most high-scoring providers have no exclusion
                record at all.{" "}
                <Link
                  href="/how-it-works#limits"
                  className="underline underline-offset-2"
                >
                  Read the limits
                </Link>
                .
              </span>
            </p>
          </Panel>
        </Reveal>

        {/* A preview of the top of the ranking, not the ranking. Twelve rows
            is what fits in one look, which is the point being made: this is
            what an investigator opens, not a database to go trawling. */}
        <Reveal delay={200}>
          <ul className="overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] text-left">
            {providers.slice(0, PREVIEW).map((p) => (
              <li
                key={p.rank}
                className="flex items-start gap-4 border-b border-[var(--gridline)] px-5 py-4 transition-colors last:border-0 hover:bg-[var(--surface-raised)]"
              >
                <span className="w-8 shrink-0 font-heading text-lg text-[var(--accent)] tnum">
                  {p.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {p.specialty}{" "}
                    <span className="text-[var(--ink-secondary)]">
                      {/* State withheld where the specialty x state cell was
                          too small to publish without identifying anyone. */}
                      &middot;{" "}
                      {p.state ?? (
                        <span className="text-[var(--ink-muted)]">
                          state withheld
                        </span>
                      )}{" "}
                      &middot; {p.year}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-secondary)]">
                    {p.reasons.join(" · ")}
                  </p>
                </div>
                {p.known_exclusion && (
                  <Badge
                    variant="outline"
                    className="mt-0.5 shrink-0 gap-1 font-normal"
                  >
                    <span aria-hidden="true">&#9873;</span> on the exclusion
                    list
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Reveal>
      </Section>
    </>
  );
}
