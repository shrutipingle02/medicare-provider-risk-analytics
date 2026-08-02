import { readFile } from "node:fs/promises";
import path from "node:path";

/* The pipeline's three exports. Read from public/ at build time so the pages
   render statically; the full worklist is also fetched client-side from the
   same files for search, which is why they live under public/ rather than
   somewhere private. Regenerate with `npm run sync-data`. */

export type Provider = {
  rank: number;
  score: number;
  percentile: number;
  year: number;
  specialty: string;
  /* null when the specialty x state cell was too small to publish without
     identifying the provider. See score_providers.py, MIN_CELL. */
  state: string | null;
  state_suppressed: boolean;
  known_exclusion: boolean;
  reasons: string[];
};

export type StateStat = {
  state: string;
  providers: number;
  listed: number;
  /* null when the state has too few ranked providers for a stable rate. */
  rate: number | null;
};

export type Summary = {
  generated: string;
  leie_snapshot: string;
  states: StateStat[];
  states_note: string;
  data: {
    provider_years: number;
    providers: number;
    years: [number, number];
    fraud_provider_years: number;
    fraud_providers: number;
    prevalence_providers: number;
    specialties: number;
  };
  published_scores: {
    method: string;
    note: string;
    ranking_year: number;
    ranking_note: string;
    providers_scored: number;
    providers_ranked: number;
    worklist_size: number;
  };
  metrics: {
    note: string;
    seeds: number[];
    roc_auc: [number, number];
    recall_at_1pct: [number, number];
    recall_at_5pct: [number, number];
    recall_at_1pct_range: [number, number];
    precision_at_1pct: number;
  };
  caveats: string[];
};

export type Importance = {
  rank: number;
  feature: string;
  label: string;
  mean_abs_shap: number;
  share: number;
};

export type AuditRow = {
  feature: string;
  label: string;
  concern: string;
  rank: number;
  share: number;
  value_vs_shap_spearman: number;
  mean_shap_top_decile: number;
  mean_shap_bottom_decile: number;
  flagged: boolean;
};

export type Model = {
  model: string;
  n_features: number;
  note: string;
  importance: Importance[];
  bias_audit: AuditRow[];
};

async function load<T>(file: string): Promise<T> {
  const full = path.join(process.cwd(), "public", "data", file);
  return JSON.parse(await readFile(full, "utf8")) as T;
}

export const getSummary = () => load<Summary>("summary.json");
export const getModel = () => load<Model>("model.json");
export const getProviders = () => load<Provider[]>("providers.json");

export const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
export const num = (n: number) => n.toLocaleString("en-US");
