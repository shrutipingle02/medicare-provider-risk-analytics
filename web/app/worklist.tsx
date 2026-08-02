"use client";

import { useCallback, useMemo, useState } from "react";
import { Search } from "lucide-react";
import FilterCombobox from "./filter-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Provider } from "@/lib/data";

const PAGE = 50;

/* Only the first page is server-rendered. Embedding all 5,000 providers in the
   HTML made the document 2.35 MB, nearly all of it rows nobody had asked to
   see. The rest is fetched once, from the same static file the pipeline wrote,
   the first time the reader searches, filters, or pages past the end. */
export default function Worklist({
  initial,
  total,
  specialties,
  states,
}: {
  initial: Provider[];
  total: number;
  specialties: string[];
  states: string[];
}) {
  const [all, setAll] = useState<Provider[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [state, setState] = useState("");
  const [shown, setShown] = useState(PAGE);

  const ensureLoaded = useCallback(async () => {
    if (all || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/data/providers.json");
      if (!res.ok) throw new Error(String(res.status));
      setAll((await res.json()) as Provider[]);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [all, loading]);

  const source = all ?? initial;
  const complete = all !== null;
  const filtering = Boolean(query || specialty || state);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !specialty && !state) return source;
    return source.filter(
      (p) =>
        (!specialty || p.specialty === specialty) &&
        (!state || p.state === state) &&
        (!q ||
          p.specialty.toLowerCase().includes(q) ||
          (p.state?.toLowerCase().includes(q) ?? false) ||
          p.reasons.some((r) => r.toLowerCase().includes(q))),
    );
  }, [source, query, specialty, state]);

  const visible = filtered.slice(0, shown);

  // Narrowing or paging both need the rows that were never sent.
  const onNarrow = (apply: () => void) => {
    void ensureLoaded();
    apply();
    setShown(PAGE);
  };

  const remaining = (complete ? filtered.length : total) - visible.length;

  return (
    <section>
      {/* Filters in one row above the list. */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-56">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => onNarrow(() => setQuery(e.target.value))}
            onFocus={() => void ensureLoaded()}
            placeholder="Search specialty, state, or reason"
            aria-label="Search the worklist"
            className="pl-9 bg-[var(--surface)]"
          />
        </div>
        <FilterCombobox
          label="Specialty"
          allLabel="All specialties"
          options={specialties}
          value={specialty}
          onChange={(next) => onNarrow(() => setSpecialty(next))}
          className="w-56"
        />
        <FilterCombobox
          label="State"
          allLabel="All states"
          options={states}
          value={state}
          onChange={(next) => onNarrow(() => setState(next))}
          className="w-40"
        />
      </div>

      <p
        className="text-sm text-[var(--ink-secondary)] mb-4 tnum"
        aria-live="polite"
      >
        {filtering
          ? `${filtered.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} providers`
          : `${total.toLocaleString("en-US")} providers`}
        {loading && " · loading the full list…"}
        {filtering && !complete && !loading && " · first page only so far"}
      </p>

      {failed && (
        <p className="mb-4 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-3 text-sm text-[var(--ink-secondary)]">
          The full list could not be loaded, so only the first {PAGE} providers
          are searchable here. Reloading usually fixes it.
        </p>
      )}

      {/* Not headings: fifty <h2>s reading "Internal Medicine" would give a
          screen-reader user a document outline made of repeated specialty
          names. The list carries the structure instead. */}
      <ul className="space-y-3" aria-label="Ranked providers">
        {visible.map((p) => (
          <li
            key={p.rank}
            className="rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="tnum text-sm text-[var(--ink-muted)] w-10 shrink-0">
                #{p.rank}
              </span>
              <span className="font-medium">{p.specialty}</span>
              <span className="text-sm text-[var(--ink-secondary)]">
                {/* State withheld where the specialty x state cell was too
                    small to publish without identifying the provider. */}
                {p.state ? (
                  <>{p.state} &middot; </>
                ) : (
                  <span
                    title="State withheld: too few providers in this specialty and state to publish without identifying them"
                    className="text-[var(--ink-muted)]"
                  >
                    state withheld &middot;{" "}
                  </span>
                )}
                {p.year}
              </span>
              {p.known_exclusion && (
                <Badge variant="outline" className="gap-1 font-normal">
                  <span aria-hidden="true">&#9873;</span> on the exclusion list
                </Badge>
              )}
            </div>

            <ul className="mt-3 space-y-1 text-sm text-[var(--ink-secondary)] sm:ml-13">
              {p.reasons.map((r) => (
                <li key={r} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--series-1)]"
                  />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {filtered.length === 0 && (
        <p className="rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--ink-secondary)]">
          Nothing matches those filters.
        </p>
      )}

      {remaining > 0 && (
        <Button
          variant="outline"
          onClick={() => {
            void ensureLoaded();
            setShown((n) => n + PAGE);
          }}
          disabled={loading}
          className="mt-6 h-11 w-full bg-[var(--surface)]"
        >
          {loading
            ? "Loading…"
            : `Show more — ${remaining.toLocaleString("en-US")} remaining`}
        </Button>
      )}
    </section>
  );
}
