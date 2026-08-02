"""
Step 7 of the pipeline: score every provider and export the site's data files.

THE SCORING PROBLEM THIS SOLVES. A model that trained on a provider will score
that provider optimistically. The evaluation protocol avoids this by only ever
measuring on held-out rows, but a published worklist has to rank EVERYONE, and
there is no held-out set that contains everyone.

Grouped k-fold solves it. Each provider sits in exactly one fold; the model that
scores them was trained on the other four. Every published score therefore comes
from a model that never saw that provider, and every provider gets a score.

WHY NOT REUSE THE TEN PROTOCOL SEEDS. They are ten independent random 25%
splits, so a provider has a 0.75^10 = 5.6% chance of never landing in any test
set - roughly 93,000 providers with no honest score available. K-fold gives full
coverage in half the fits.

To be explicit about which regime governs what:

    reported metrics   ->  the ten-seed protocol, models/metrics.json
    published scores   ->  grouped k-fold, this script

These answer different questions and are not mixed. No number produced here is
quoted as a performance result.

WHAT THE WORKLIST RANKS. One calendar year, 2024 by default - not each
provider's worst year, and not each provider's most recent year.

The model scores 2019 rows about 2.2x higher than 2024 rows even on clean,
unlabeled providers, because the labels concentrate in early years and the raw
features drift with time (PROJECT.md limitation 6). Any ranking that lets
providers compete across years converts that bias into rank order: a worst-year
worklist comes out 37.8% year-2019 and 4.8% year-2024. Within a single year the
shift is the same for everyone listed, so it cancels.

"Most recent year per provider" fails the same test, because a provider who
stopped billing in 2020 would be ranked on a 2020 score. It has to be one
calendar year. Providers who no longer bill drop out, which is the correct loss
for a list meant to be acted on.

This mitigates the bias in the ordering. It does not remove it from the model,
and the caveats say so.

WHAT IT WRITES, all under --out-dir:

    providers.json   the worklist: top N providers, with reasons
    summary.json     dataset facts, headline metrics, and the caveats
    model.json       global SHAP importance and the bias audit

PRIVACY, IN TWO PARTS.

First, providers.json carries no NPI and no provider name. Almost every
high-scoring provider has no exclusion record, and a public page must not name
real doctors as likely fraudsters. The export asserts this rather than trusting
it: check_privacy refuses to write a file containing an identifying column.

Second, and less obvious: dropping the identifiers is not enough. Specialty plus
state is itself an identifier once the cell is small enough - there is exactly
one Oral Surgery (Dentist only) provider in New Mexico. So any row whose
specialty x state cell holds fewer than MIN_CELL providers is published without
its state. The row keeps its rank and its reasons; it loses the geography that
would pin it to a person.

Usage:
    python src/score_providers.py
    python src/score_providers.py --folds 5 --top 5000
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from explain_shap import bias_audit, global_importance, reasons_for, shap_matrix
from train_model import (
    DEFAULT_IN,
    GROUP,
    MODEL_DIR,
    TARGET,
    clean_matrix,
    feature_columns,
    make_xgboost,
    undersample,
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "site"

# The LEIE list refreshes monthly, so labels shift over time and any published
# number has to cite the snapshot it came from. Recorded in PROJECT.md section 2.
LEIE_SNAPSHOT = "2026-07-31"

# Columns that must never reach a published file.
FORBIDDEN = {"npi", "last_or_org_name", "first_name", "excl_year", "excluded_any"}

# Below this many ranked providers, a state's rate is too noisy to colour a map
# with, so it is published as null and drawn as "too few to say".
MIN_STATE_PROVIDERS = 500

# Smallest specialty x state cell allowed to keep its state on a published row.
#
# Dropping the NPI and the name does not by itself make a row anonymous. There
# is exactly one "Oral Surgery (Dentist only)" provider in New Mexico, so that
# pair names them as surely as the NPI would - and the claim attached to the row
# is that they bill more unusually than almost anyone in the country. Ten more
# rows sit in cells of two to four.
#
# 11 is CMS's own cell-suppression threshold for the public use files this data
# comes from, so the same rule the source applies is applied downstream.
MIN_CELL = 11


def kfold_scores(df: pd.DataFrame, features: list[str], n_folds: int,
                 neg_per_pos: int, seed: int):
    """Out-of-fold scores for every row, plus the model that produced each.

    GroupKFold takes no random_state because it is deterministic: the folds
    depend only on the grouping, so this is reproducible without a seed.
    """
    scores = np.zeros(len(df), dtype="float32")
    fold_of = np.full(len(df), -1, dtype="int8")
    models = []

    splitter = GroupKFold(n_splits=n_folds)
    for fold, (train_idx, test_idx) in enumerate(splitter.split(df, df[TARGET], df[GROUP])):
        train = df.iloc[train_idx]
        balanced = undersample(train, neg_per_pos, seed)
        model = make_xgboost(seed)
        model.fit(clean_matrix(balanced[features]), balanced[TARGET])

        held_out = df.iloc[test_idx]
        scores[test_idx] = model.predict_proba(clean_matrix(held_out[features]))[:, 1]
        fold_of[test_idx] = fold
        models.append(model)
        print(f"  fold {fold + 1}/{n_folds}: trained on {len(balanced):,} balanced rows, "
              f"scored {len(test_idx):,} held-out rows "
              f"({int(held_out[TARGET].sum())} known fraud)")

    assert (fold_of >= 0).all(), "some rows were never held out"
    return scores, fold_of, models


def explain_top(df: pd.DataFrame, top: pd.DataFrame, features: list[str],
                fold_of: np.ndarray, models: list, row_of: pd.Series) -> list[list[str]]:
    """Reasons for the top providers, each from the model that scored them.

    A provider's score came from one specific fold model, so the explanation has
    to come from that same model - otherwise the site would show reasons that do
    not correspond to the number beside them.
    """
    positions = row_of.loc[list(zip(top[GROUP], top["trigger_year"]))].to_numpy()
    reasons: list[list[str]] = [[] for _ in range(len(top))]

    for fold, model in enumerate(models):
        which = np.flatnonzero(fold_of[positions] == fold)
        if not len(which):
            continue
        rows = df.iloc[positions[which]]
        values = shap_matrix(model, rows[features])
        for slot, (i, (_, row)) in zip(which, enumerate(rows.iterrows())):
            reasons[slot] = reasons_for(values[i], row, features)
    return reasons


def model_card(df: pd.DataFrame, features: list[str], models: list,
               sample_size: int, seed: int) -> dict:
    """Global importance and the bias audit, averaged over the fold models.

    explain_shap.py runs this on a single protocol fit to answer "what did we
    build". Here it is recomputed across the models that actually produced the
    published scores, so the site's explanation describes the site's numbers.
    """
    per_fold, sampled = [], []
    for model in models:
        rows = df.sample(n=min(sample_size, len(df)), random_state=seed)
        per_fold.append(shap_matrix(model, rows[features]))
        sampled.append(rows)

    values = np.vstack(per_fold)
    combined = pd.concat(sampled)
    importance = global_importance(values, features)
    return {
        "importance": importance,
        "bias_audit": bias_audit(values, combined[features], features, importance),
    }


def check_privacy(records: list[dict]) -> None:
    """Refuse to write anything carrying an identifier.

    The union matters here, not the intersection. A guard built on the keys
    common to EVERY record would wave through a leak that affected only some of
    them, which is the more likely kind of accident and the one worth catching.
    """
    present: set[str] = set()
    present.update(*(set(r) for r in records)) if records else None
    leaked = FORBIDDEN & present
    if leaked:
        raise SystemExit(f"refusing to write: identifying columns present {sorted(leaked)}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Score all providers and export the site data.")
    ap.add_argument("--in", dest="in_path", default=str(DEFAULT_IN))
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT))
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--year", type=int, default=2024,
                    help="calendar year the worklist ranks; one year only, so that "
                         "the model's year bias cancels out of the ordering")
    ap.add_argument("--top", type=int, default=5000,
                    help="providers written to the worklist; the rest become counts")
    ap.add_argument("--neg-per-pos", type=int, default=20)
    ap.add_argument("--seed", type=int, default=42, help="undersampling draw only")
    ap.add_argument("--sample", type=int, default=20000, help="rows per fold for global SHAP")
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)

    print(f"loading {Path(args.in_path).name} ...")
    df = pd.read_parquet(args.in_path).drop(
        columns=["last_or_org_name", "first_name"], errors="ignore").reset_index(drop=True)
    features = feature_columns(df)
    print(f"{len(df):,} provider-years | {len(features)} features | "
          f"{df[GROUP].nunique():,} providers | {int(df[TARGET].sum()):,} fraud rows")

    print(f"\nscoring out-of-fold, {args.folds} grouped folds ...")
    scores, fold_of, models = kfold_scores(df, features, args.folds,
                                           args.neg_per_pos, args.seed)

    # RANK WITHIN ONE YEAR. See PROJECT.md limitation 6: the model scores early
    # years far higher than late ones, so letting providers compete across years
    # turns that bias into rank order - a worst-year worklist comes out 37.8%
    # year-2019. Holding the year fixed makes the shift identical for everyone
    # in the list, so it cancels out of the ranking entirely.
    #
    # "Most recent year per provider" would NOT do this: a provider who stopped
    # billing in 2020 would enter on a 2020 score and the mixing returns for
    # exactly the providers most affected. One calendar year, or nothing.
    #
    # Dropping providers who no longer bill is the right loss for a worklist
    # meant to be acted on.
    fraud_providers = df.loc[df[TARGET] == 1, GROUP].nunique()
    ranked = df[df["year"] == args.year].copy()
    ranked["score"] = scores[ranked.index.to_numpy()]
    ranked["trigger_year"] = args.year
    ranked["percentile"] = ranked["score"].rank(pct=True)
    ranked = ranked.sort_values("score", ascending=False).reset_index(drop=True)
    print(f"\n{len(df[GROUP].unique()):,} providers scored out-of-fold; "
          f"ranking the {len(ranked):,} that billed in {args.year} "
          f"({len(ranked) / df[GROUP].nunique():.0%} of them), "
          f"{int(ranked[TARGET].sum())} labeled fraud")

    top = ranked.head(args.top).copy()
    row_of = pd.Series(np.arange(len(df)), index=pd.MultiIndex.from_arrays(
        [df[GROUP], df["year"]]))
    print(f"explaining the top {len(top):,} ...")
    reasons = explain_top(df, top, features, fold_of, models, row_of)

    context = df.set_index([GROUP, "year"]).loc[
        list(zip(top[GROUP], top["trigger_year"])), ["provider_type", "state"]]

    # Withholding the NPI is not enough on its own: in a small enough cell,
    # specialty plus state IS an identifier. See suppress_small_cells.
    cell_size = ranked.groupby(["provider_type", "state"])[GROUP].nunique()

    worklist = []
    suppressed = 0
    for i, (_, row) in enumerate(top.iterrows()):
        specialty = str(context.iloc[i]["provider_type"])
        state = str(context.iloc[i]["state"])
        small = int(cell_size.get((specialty, state), 0)) < MIN_CELL
        suppressed += small
        worklist.append({
            "rank": i + 1,
            "score": round(float(row["score"]), 4),
            "percentile": round(float(row["percentile"]), 5),
            "year": int(row["trigger_year"]),
            "specialty": specialty,
            # None, not the state, when the cell is too small to hide in.
            "state": None if small else state,
            "state_suppressed": small,
            "known_exclusion": bool(row[TARGET]),
            "reasons": reasons[i],
        })
    check_privacy(worklist)
    print(f"state suppressed on {suppressed} of {len(worklist):,} rows "
          f"(specialty x state cell below {MIN_CELL})")

    # -- per-state summary, for the map ------------------------------------
    #
    # The rate is the honest measure, not the count. California has the most
    # providers on the worklist because California has the most providers; what
    # a reader actually wants to know is what SHARE of a state's providers rank
    # highly. Both are published so the count cannot be mistaken for the rate.
    #
    # Small denominators make rates unstable, so the count is carried alongside
    # and the map suppresses states below MIN_STATE_PROVIDERS rather than
    # drawing a confident colour over eleven providers.
    listed = pd.Series([w["state"] for w in worklist]).value_counts()
    eligible = ranked["state"].value_counts()
    states = sorted(
        (
            {
                "state": str(code),
                "providers": int(eligible[code]),
                "listed": int(listed.get(code, 0)),
                "rate": (float(listed.get(code, 0)) / int(eligible[code])
                         if int(eligible[code]) >= MIN_STATE_PROVIDERS else None),
            }
            for code in eligible.index
        ),
        key=lambda s: s["state"],
    )

    # -- the three files ----------------------------------------------------
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "providers.json").write_text(json.dumps(worklist, indent=1))

    protocol = json.loads((MODEL_DIR / "metrics.json").read_text())
    xgb = next(s for s in protocol["summary"] if s["model"] == "XGBoost")
    per_seed = [r["prov_recall_at_1pct"] for r in protocol["per_seed"]
                if r["model"] == "XGBoost"]
    summary = {
        "generated": date.today().isoformat(),
        "leie_snapshot": LEIE_SNAPSHOT,
        "data": {
            "provider_years": len(df),
            "providers": int(df[GROUP].nunique()),
            "years": [int(df["year"].min()), int(df["year"].max())],
            "fraud_provider_years": int(df[TARGET].sum()),
            # Providers carrying a fraud label in any year of the panel.
            "fraud_providers": int(fraud_providers),
            "prevalence_providers": float(fraud_providers / df[GROUP].nunique()),
            "specialties": int(df["provider_type"].nunique()),
        },
        "published_scores": {
            "method": f"{args.folds}-fold grouped cross-validation",
            "note": ("Every provider was scored by a model trained without them. "
                     "Scores are not a performance claim; see metrics."),
            "ranking_year": args.year,
            "ranking_note": (f"The worklist ranks {args.year} billing only. The model "
                             "scores earlier years systematically higher, so ranking "
                             "across years would order providers partly by how old "
                             "their billing is. Holding the year fixed removes that "
                             "from the ordering."),
            "providers_scored": int(df[GROUP].nunique()),
            "providers_ranked": len(ranked),
            "worklist_size": len(worklist),
        },
        "states": states,
        "states_note": (
            f"`rate` is the share of a state's {args.year} providers that reach "
            f"the top {len(worklist):,}. Use the rate, not `listed`: a big state "
            f"lists more providers because it has more providers. States with "
            f"fewer than {MIN_STATE_PROVIDERS:,} ranked providers carry a null "
            f"rate, being too small to colour confidently."
        ),
        "metrics": {
            "note": ("From the locked ten-seed protocol, not from the scoring run. "
                     "Provider level, which is the unit the worklist ranks."),
            "seeds": protocol["seeds"],
            "roc_auc": [round(xgb["prov_roc_auc"], 4), round(xgb["prov_roc_auc_std"], 4)],
            "recall_at_1pct": [round(xgb["prov_recall_at_1pct"], 4),
                               round(xgb["prov_recall_at_1pct_std"], 4)],
            "recall_at_5pct": [round(xgb["prov_recall_at_5pct"], 4),
                               round(xgb["prov_recall_at_5pct_std"], 4)],
            "recall_at_1pct_range": [round(min(per_seed), 4), round(max(per_seed), 4)],
            "precision_at_1pct": round(xgb["prov_precision_at_1pct"], 5),
        },
        "caveats": [
            "A positive label does not mean a provider committed fraud. It means "
            "they were caught, excluded by the OIG, and recorded with a usable NPI.",
            "Most real fraud is unlabeled and sits in this data as clean, so "
            "precision here is a floor rather than the truth.",
            "Report the range across splits, not the point estimate: only about "
            "120 labeled fraud providers exist per test split.",
            "Splits are random, not forward in time. A real deployment predicting "
            "the next year would score lower.",
            "2024 labels are the least complete, because investigations take years.",
            "The model uses patient risk score relative to specialty peers.",
            "No provider on this list is accused of anything. A high rank means "
            "the billing pattern is unusual for the specialty, nothing more.",
        ],
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=1))

    print(f"\nrecomputing global SHAP across the {len(models)} fold models ...")
    card = model_card(df, features, models, args.sample, args.seed)
    (out_dir / "model.json").write_text(json.dumps({
        "model": "XGBoost",
        "n_features": len(features),
        "note": ("Importance and audit computed across the fold models that "
                 "produced the published scores."),
        **card,
    }, indent=1))

    print("\n" + "=" * 68)
    print("WORKLIST, top 5")
    print("=" * 68)
    for entry in worklist[:5]:
        flag = "  [known exclusion]" if entry["known_exclusion"] else ""
        print(f"  {entry['rank']}. {entry['specialty']}, {entry['state']}, "
              f"{entry['year']}  score {entry['score']:.3f}{flag}")
        for reason in entry["reasons"]:
            print(f"       - {reason}")

    flagged = [row["feature"] for row in card["bias_audit"] if row["flagged"]]
    print(f"\n  bias audit on the published models: "
          f"{', '.join(flagged) if flagged else 'nothing flagged'}")

    for name in ("providers.json", "summary.json", "model.json"):
        size = (out_dir / name).stat().st_size / 1024
        print(f"  wrote {out_dir / name}  ({size:,.0f} KB)")
    print("Next: build web/ against these three files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
