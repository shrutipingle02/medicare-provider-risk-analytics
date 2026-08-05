import type { Metadata } from "next";
import {
  BookOpen,
  Code2,
  Database,
  ExternalLink,
  ShieldCheck,
  User,
} from "lucide-react";
import {
  Divider,
  Kicker,
  Lead,
  PageHeader,
  Panel,
  Reveal,
  Section,
} from "@/components/story";
import { getSummary, num } from "@/lib/data";

export const metadata: Metadata = {
  title: "About — Medicare Provider Risk Analytics",
  description:
    "Who built this, what it is made of, and the rules it was built under.",
};

const REPO = "https://github.com/shrutipingle02/medicare-provider-risk-analytics";

export default async function AboutPage() {
  const summary = await getSummary();
  const { data, leie_snapshot } = summary;

  return (
    <>
      <PageHeader eyebrow="About" title="About this project" />

      {/* ===== WHO BUILT IT ============================================= */}
      <Section className="pt-4">
        <Reveal>
          <Kicker icon={<User className="h-4 w-4" />}>The build</Kicker>
        </Reveal>
        <Reveal delay={100}>
          <Panel className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-center">
            <span
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[var(--accent)]/40 font-heading text-xl text-[var(--accent)]"
            >
              SP
            </span>
            <div className="flex-1">
              <h2 className="text-xl">Shruti Pingle</h2>
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--accent)] transition-colors hover:text-[var(--ink-primary)]"
              >
                <ExternalLink className="h-3 w-3" aria-hidden /> View the
                repository
              </a>
            </div>
          </Panel>
        </Reveal>
      </Section>

      <Divider />

      {/* ===== WHAT IT IS MADE OF ======================================= */}
      <Section>
        <Reveal>
          <Kicker icon={<Database className="h-4 w-4" />}>The material</Kicker>
          <h2 className="mt-4">Open records, nothing synthetic.</h2>
        </Reveal>
        <Reveal delay={100}>
          <Lead>
            {num(data.provider_years)} provider-years across{" "}
            {num(data.providers)} providers and {data.specialties} specialties,
            labelled against the government&apos;s own exclusion list.
          </Lead>
        </Reveal>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Reveal>
            <Panel className="h-full">
              <h3 className="text-base">Features</h3>
              <p className="mt-2 text-sm text-[var(--ink-secondary)]">
                CMS Medicare Physician &amp; Other Practitioners, by Provider,{" "}
                {data.years[0]}&ndash;{data.years[1]}.
              </p>
              <a
                href="https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--accent)] transition-colors hover:text-[var(--ink-primary)]"
              >
                <ExternalLink className="h-3 w-3" aria-hidden /> data.cms.gov
              </a>
            </Panel>
          </Reveal>
          <Reveal delay={80}>
            <Panel className="h-full">
              <h3 className="text-base">Labels</h3>
              <p className="mt-2 text-sm text-[var(--ink-secondary)]">
                HHS OIG List of Excluded Individuals/Entities, joined on NPI.
                Snapshot {leie_snapshot} — the list refreshes monthly, so every
                figure here is tied to that date.
              </p>
              <a
                href="https://oig.hhs.gov/exclusions/"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--accent)] transition-colors hover:text-[var(--ink-primary)]"
              >
                <ExternalLink className="h-3 w-3" aria-hidden /> oig.hhs.gov
              </a>
            </Panel>
          </Reveal>
        </div>
      </Section>

      <Divider />

      {/* ===== THE RULES ================================================ */}
      <Section>
        <Reveal>
          <Kicker icon={<ShieldCheck className="h-4 w-4" />}>
            The rules it was built under
          </Kicker>
          <h2 className="mt-4">Three that were never bent.</h2>
        </Reveal>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            {
              icon: <ShieldCheck className="h-5 w-5" />,
              t: "Nobody is named",
              d: "No NPI and no provider names are published, and the writer refuses a file carrying an identifying column. State is dropped wherever a specialty and state together describe fewer than 11 people — the same threshold CMS applies to the files this comes from.",
            },
            {
              icon: <BookOpen className="h-5 w-5" />,
              t: "The seed list never moves",
              d: "Ten fixed, published seeds. They are never changed to improve a result — if they ever change, every reported number is regenerated. Metrics are the mean and spread across all ten, never a single run.",
            },
            {
              icon: <Code2 className="h-5 w-5" />,
              t: "Everything regenerates",
              d: "No data and no model binaries are committed. The split, the undersample draw and the model are all seeded, so a seed reproduces a model exactly, and eight scripts rebuild the whole thing from the raw downloads.",
            },
          ].map((c, i) => (
            <Reveal key={c.t} delay={70 * i}>
              <Panel className="h-full">
                <span aria-hidden className="text-[var(--series-1)]">
                  {c.icon}
                </span>
                <h3 className="mt-3 text-base">{c.t}</h3>
                <p className="mt-2 text-sm text-[var(--ink-secondary)]">
                  {c.d}
                </p>
              </Panel>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200}>
          <div className="mt-12 text-center">
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--series-1)] px-7 py-3.5 text-sm font-medium text-[#06070a] transition-colors hover:bg-[var(--accent)]"
            >
              <Code2 className="h-4 w-4" aria-hidden /> View the repository
            </a>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
