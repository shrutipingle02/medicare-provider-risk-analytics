"""
Step 5 of the pipeline: train and evaluate the fraud ranking models.

Three things make this different from a normal classification script, and all
three come from the same fact: fraud is about 1 in 5,300 rows.

1. WE SPLIT BY PROVIDER, NOT BY ROW.
   Each provider appears up to 6 times, once per year. If a provider's 2019 row
   landed in training and their 2020 row in testing, the model would recognise
   them rather than learn a pattern, and the score would be flattering nonsense.
   GroupShuffleSplit keeps all of a provider's years on the same side, and an
   assertion enforces it.

2. WE BALANCE THE TRAINING SET, NOT THE TEST SET.
   With 1 positive per 5,300 rows, a model can score 99.98% accuracy by calling
   everything clean. So we undersample the training data down to 20 clean rows
   per fraud row. The test set is left completely untouched at its true, brutal
   ratio, so the evaluation reflects reality.

3. WE MEASURE TOP-K, NOT ACCURACY.
   Investigators cannot review 1.8 million providers. They can review the top
   1%. So the question is not "is this model accurate" but "if we hand over the
   top 1%, how much real fraud is in there?" We report, at k = 1%, 5%, 10%:
       precision  of the providers we flagged, what share are truly fraud
       recall     of all known fraud, what share did we catch

A note on what is deliberately NOT given to the model. `year` is excluded.
Because a provider is only labeled fraud for years at or before their
exclusion, early years carry far more positives than late ones (2019 has 10x
the fraud rate of 2024). A model handed `year` would learn "2019 means risky",
which is a fact about how we built the labels, not about how anyone billed.

Usage:
    python src/train_model.py
    python src/train_model.py --seeds 42,1,7,13,99     # average over 5 splits
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
PROC_DIR = ROOT / "data" / "processed"
MODEL_DIR = ROOT / "models"
DEFAULT_IN = PROC_DIR / "provider_year_panel_2019_2024_features.parquet"

TARGET = "fraud_label"
GROUP = "npi"

# Columns never given to the model.
#
# The last two were removed after the step 6 bias audit. Both ranked in the top
# four by SHAP importance, and neither describes how a provider billed:
# `peer_group_size` is an artefact of how the peer features were constructed,
# and `bene_avg_risk_score` rose with the score (r = +0.49), meaning sicker
# patient panels looked more like fraud. Removing both cost 0.9 points of
# provider top-1% recall (17.7% -> 16.8%), well inside the +/-2.7 spread, and
# left top-5% unchanged. See PROJECT.md section 3.
DROP_COLUMNS = {
    TARGET,
    "excluded_any",         # built from the same exclusion list as the target
    "excl_year",            # the exclusion year IS the answer
    "npi",                  # identifier
    "year",                 # encodes label timing, not behaviour (see docstring)
    "peer_group_size",      # peer-construction artefact, not provider behaviour
    "bene_avg_risk_score",  # patient mix, and already a coding-intensity measure
}

# Text columns. Listed for clarity; they are numeric-filtered out anyway.
TEXT_COLUMNS = ["last_or_org_name", "first_name", "entity_code", "state",
                "provider_type", "medicare_participating"]

K_FRACTIONS = (0.01, 0.05, 0.10)

# EVALUATION PROTOCOL (locked).
#
#   * 10 grouped train/test splits. Five was not enough: two different sets of
#     five seeds disagreed by more than the standard deviation either set
#     reported, so the n=5 error bar was not trustworthy. Confirmed empirically,
#     not assumed.
#   * Fixed, published seed list, so any rerun is comparable and no flattering
#     split can be selected after the fact.
#   * Report mean +/- standard deviation. Never a single run.
#   * Store every split's metrics individually in models/metrics.json.
#   * Select the final model on averaged performance.
#   * Results are reported standalone, on this protocol alone.
#
# Note on interpretation: 10 splits is a pragmatic floor, not a precise
# estimator. Roughly two thirds of the spread in top-k recall is binomial noise
# from having only ~345 labeled positives per test split, which no number of
# seeds removes. Report the range, not the point estimate.
#
# Do not change this list to improve a result. If it changes, every previously
# reported number must be regenerated and the change recorded in PROJECT.md.
PROTOCOL_SEEDS = [42, 1, 7, 13, 99, 2, 5, 11, 23, 77]


# --------------------------------------------------------------------------
# Pieces shared with later steps (explain_shap.py, score_providers.py import
# these, so they stay plain functions with no side effects).
# --------------------------------------------------------------------------

def feature_columns(df: pd.DataFrame) -> list[str]:
    """Every numeric column that is not an identifier or a form of the answer."""
    numeric = df.select_dtypes(include=[np.number]).columns
    return [c for c in numeric if c not in DROP_COLUMNS]


def grouped_split(df: pd.DataFrame, test_size: float = 0.25, seed: int = 42):
    """Split so that no provider appears on both sides."""
    splitter = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    train_idx, test_idx = next(splitter.split(df, df[TARGET], groups=df[GROUP]))
    train, test = df.iloc[train_idx], df.iloc[test_idx]
    assert set(train[GROUP]).isdisjoint(set(test[GROUP])), "provider leaked across the split"
    return train, test


def undersample(df: pd.DataFrame, neg_per_pos: int = 20, seed: int = 42) -> pd.DataFrame:
    """Keep every fraud row, plus neg_per_pos clean rows for each one."""
    positive = df[df[TARGET] == 1]
    negative = df[df[TARGET] == 0]
    n_keep = min(len(negative), len(positive) * neg_per_pos)
    sampled = negative.sample(n=n_keep, random_state=seed)
    return pd.concat([positive, sampled]).sample(frac=1, random_state=seed)


def clean_matrix(X: pd.DataFrame) -> pd.DataFrame:
    """Infinities confuse the imputer; turn them into missing values."""
    return X.replace([np.inf, -np.inf], np.nan)


def top_k_scores(y_true: np.ndarray, scores: np.ndarray, k_fraction: float,
                 total_fraud: int) -> tuple[float, float, int, int]:
    """Rank by score, take the top k fraction, and see how much fraud is in it."""
    n_k = max(1, int(len(scores) * k_fraction))
    top = np.argsort(scores)[::-1][:n_k]
    hits = int(y_true[top].sum())
    precision = hits / n_k
    recall = hits / total_fraud if total_fraud else 0.0
    return precision, recall, hits, n_k


def aggregate_to_provider(test: pd.DataFrame, scores: np.ndarray) -> pd.DataFrame:
    """Collapse provider-year scores into one row per provider.

    The model scores provider-years, but an investigator opens a case on a
    PROVIDER. Leaving the data at provider-year level means one doctor occupies
    several slots in the worklist while other providers never appear.

    A provider's risk is taken as their most suspicious year, because that is
    the year a case would be opened on. The year that produced the score is
    kept alongside it, so the flag can be explained rather than just asserted.
    A provider counts as fraud if any of their years is labeled fraud.

    This is a product decision, not a metric one: the ranking unit follows what
    the worklist is used for. It is not chosen by whichever option scores best.
    """
    frame = pd.DataFrame({
        GROUP: test[GROUP].to_numpy(),
        "trigger_year": test["year"].to_numpy(),
        TARGET: test[TARGET].to_numpy(),
        "score": scores,
    })
    peak = frame.loc[frame.groupby(GROUP)["score"].idxmax()].copy()
    peak[TARGET] = frame.groupby(GROUP)[TARGET].max().reindex(peak[GROUP]).to_numpy()
    return peak.reset_index(drop=True)


def evaluate(name: str, y_true: np.ndarray, scores: np.ndarray, quiet: bool = False) -> dict:
    total_fraud = int(y_true.sum())
    result = {
        "model": name,
        "roc_auc": float(roc_auc_score(y_true, scores)),
        "pr_auc": float(average_precision_score(y_true, scores)),
    }
    if not quiet:
        print(f"\n  {name}")
        print(f"    ROC-AUC {result['roc_auc']:.4f}    PR-AUC {result['pr_auc']:.5f}")
    for k in K_FRACTIONS:
        precision, recall, hits, n_k = top_k_scores(y_true, scores, k, total_fraud)
        result[f"precision_at_{int(k * 100)}pct"] = precision
        result[f"recall_at_{int(k * 100)}pct"] = recall
        if not quiet:
            print(f"    top {int(k * 100):>2}% ({n_k:>7,} reviewed): "
                  f"caught {hits:>3}/{total_fraud} fraud ({recall:>5.1%})  "
                  f"precision {precision:.4%}")
    return result


# --------------------------------------------------------------------------
# Models. Plain scikit-learn. Imputation lives inside each pipeline so it is
# fitted on training data only.
# --------------------------------------------------------------------------

def make_logistic(seed: int) -> Pipeline:
    return Pipeline([
        ("impute", SimpleImputer(strategy="median")),
        ("scale", StandardScaler()),
        ("clf", LogisticRegression(max_iter=1000, random_state=seed)),
    ])


def make_gradient_boosting(seed: int) -> Pipeline:
    return Pipeline([
        ("impute", SimpleImputer(strategy="median")),
        ("clf", GradientBoostingClassifier(random_state=seed)),
    ])


def make_xgboost(seed: int) -> Pipeline:
    from xgboost import XGBClassifier
    return Pipeline([
        ("impute", SimpleImputer(strategy="median")),
        ("clf", XGBClassifier(
            n_estimators=400, max_depth=6, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, tree_method="hist",
            eval_metric="aucpr", n_jobs=-1, random_state=seed)),
    ])


MODELS = {
    "LogisticRegression": make_logistic,
    "GradientBoosting": make_gradient_boosting,
    "XGBoost": make_xgboost,
}


def run_one_seed(df: pd.DataFrame, features: list[str], seed: int,
                 test_size: float, neg_per_pos: int, quiet: bool = False,
                 models: dict | None = None) -> list[dict]:
    train, test = grouped_split(df, test_size, seed)
    train_balanced = undersample(train, neg_per_pos, seed)

    X_train = clean_matrix(train_balanced[features])
    y_train = train_balanced[TARGET]
    X_test = clean_matrix(test[features])
    y_test = test[TARGET].to_numpy()

    if not quiet:
        print(f"\n{'=' * 68}")
        print(f"SEED {seed}")
        print(f"{'=' * 68}")
        print(f"  train {len(train):>10,} rows ({int(train[TARGET].sum()):>4} fraud)"
              f"  ->  balanced to {len(train_balanced):,} rows "
              f"({train_balanced[TARGET].mean():.1%} fraud)")
        print(f"  test  {len(test):>10,} rows ({int(y_test.sum()):>4} fraud, "
              f"{y_test.mean():.4%} - left untouched)")

    results = []
    for name, factory in (models or MODELS).items():
        model = factory(seed)
        model.fit(X_train, y_train)
        scores = model.predict_proba(X_test)[:, 1]

        # Provider-year level: matches the unit the model was trained on.
        result = evaluate(name, y_test, scores, quiet=quiet)

        # Provider level: matches the unit the worklist is actually used on.
        peak = aggregate_to_provider(test, scores)
        provider = evaluate(f"{name} (provider level)", peak[TARGET].to_numpy(),
                            peak["score"].to_numpy(), quiet=True)
        result.update({f"prov_{k}": v for k, v in provider.items() if k != "model"})
        result["n_providers"] = len(peak)
        result["n_provider_positives"] = int(peak[TARGET].sum())

        if not quiet:
            print(f"    provider level ({len(peak):,} providers, "
                  f"{int(peak[TARGET].sum())} fraud): "
                  f"ROC-AUC {provider['roc_auc']:.4f}  "
                  f"top 1% {provider['recall_at_1pct']:.1%}  "
                  f"top 5% {provider['recall_at_5pct']:.1%}  "
                  f"top 10% {provider['recall_at_10pct']:.1%}")

        result["seed"] = seed
        results.append(result)
    return results


def summarize(all_results: list[dict], seeds: list[int],
              models: dict | None = None) -> list[dict]:
    """Average each model's metrics across seeds."""
    base = ["roc_auc", "pr_auc"] + [
        f"{p}_at_{int(k * 100)}pct" for k in K_FRACTIONS for p in ("precision", "recall")]
    metrics = base + [f"prov_{m}" for m in base]
    summary = []
    for name in (models or MODELS):
        rows = [r for r in all_results if r["model"] == name]
        entry = {"model": name, "seeds": seeds, "n_seeds": len(rows)}
        for metric in metrics:
            values = [r[metric] for r in rows]
            entry[metric] = float(np.mean(values))
            entry[f"{metric}_std"] = float(np.std(values))
        summary.append(entry)
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description="Train and evaluate the fraud ranking models.")
    ap.add_argument("--in", dest="in_path", default=str(DEFAULT_IN))
    ap.add_argument("--seeds", type=str,
                    default=",".join(str(s) for s in PROTOCOL_SEEDS),
                    help="comma-separated seeds; defaults to the locked protocol seed list")
    ap.add_argument("--test-size", type=float, default=0.25)
    ap.add_argument("--neg-per-pos", type=int, default=20)
    ap.add_argument("--drop", type=str, default="",
                    help="comma-separated features to withhold, for ablation runs")
    ap.add_argument("--models", type=str, default=",".join(MODELS),
                    help="comma-separated model names; fewer models means a faster run")
    ap.add_argument("--out", type=str, default="metrics.json",
                    help="filename under models/; use a different name for ablations "
                         "so the protocol results are never overwritten")
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)

    seeds = [int(s) for s in args.seeds.split(",")]

    print(f"loading {Path(args.in_path).name} ...")
    df = pd.read_parquet(args.in_path,
                         columns=None).drop(columns=["last_or_org_name", "first_name"],
                                            errors="ignore")
    features = feature_columns(df)
    dropped = [f.strip() for f in args.drop.split(",") if f.strip()]
    if dropped:
        unknown = [f for f in dropped if f not in features]
        if unknown:
            print(f"error: not a feature: {', '.join(unknown)}")
            return 1
        features = [f for f in features if f not in dropped]
    print(f"{len(df):,} rows | {len(features)} features | "
          f"{int(df[TARGET].sum()):,} fraud ({df[TARGET].mean():.4%})")
    print(f"excluded from features: {sorted(DROP_COLUMNS)}")
    if dropped:
        print(f"ABLATION - also withheld: {', '.join(dropped)}")

    selected = [m.strip() for m in args.models.split(",") if m.strip()]
    unknown = [m for m in selected if m not in MODELS]
    if unknown:
        print(f"error: not a model: {', '.join(unknown)}. known: {', '.join(MODELS)}")
        return 1
    models = {name: MODELS[name] for name in selected}

    all_results = []
    for seed in seeds:
        all_results.extend(run_one_seed(df, features, seed, args.test_size,
                                        args.neg_per_pos, models=models))

    summary = summarize(all_results, seeds, models)

    print("\n" + "=" * 68)
    print(f"SUMMARY over {len(seeds)} seed(s)")
    print("=" * 68)
    for level, prefix, label in (("PROVIDER LEVEL", "prov_", "what the worklist ranks"),
                                 ("PROVIDER-YEAR LEVEL", "", "what the model was trained on")):
        print(f"\n  {level}  ({label})")
        print(f"  {'model':22s} {'ROC-AUC':>9s} {'top 1%':>9s} {'top 5%':>9s} {'top 10%':>9s}")
        for entry in sorted(summary, key=lambda e: -e[f"{prefix}recall_at_1pct"]):
            print(f"  {entry['model']:22s} {entry[f'{prefix}roc_auc']:>9.4f} "
                  f"{entry[f'{prefix}recall_at_1pct']:>8.1%} "
                  f"{entry[f'{prefix}recall_at_5pct']:>9.1%} "
                  f"{entry[f'{prefix}recall_at_10pct']:>9.1%}")

    best = max(summary, key=lambda e: e["prov_recall_at_1pct"])
    print(f"\n  best at the provider level (the ranking unit): {best['model']}")

    MODEL_DIR.mkdir(exist_ok=True)
    out = MODEL_DIR / args.out
    out.write_text(json.dumps(
        {"seeds": seeds, "n_features": len(features), "features": features,
         "dropped": dropped, "summary": summary, "per_seed": all_results}, indent=2))
    print(f"\nsaved {out}")
    print("Next: python src/explain_shap.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
