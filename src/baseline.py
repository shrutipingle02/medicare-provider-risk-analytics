"""
Baseline check: does the pipeline actually beat naive ranking?

A model score is not interpretable on its own. "We catch 18% of fraud in the
top 1%" is only meaningful next to what you would get with no model at all.

So this ranks the same held-out providers by a SINGLE raw column, sorted
descending, and scores it with the same metrics on the same 10 protocol splits.
No training, no features, no model. Just "sort by how much Medicare paid them".

It also ranks by the peer-relative versions of those same columns, which
separates two different questions:

    model vs raw column      does the pipeline earn its complexity?
    peer column vs raw       does peer-normalisation earn its place?

If a one-line sort matches the model, that is the finding, and it is much
better to learn it here than after the site is public.

Usage:
    python src/baseline.py
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from train_model import (DEFAULT_IN, MODEL_DIR, PROTOCOL_SEEDS, TARGET,
                         evaluate, grouped_split)

# Single columns to rank by, highest first. Each is a plausible "obvious"
# heuristic an analyst might reach for before building anything.
RAW_BASELINES = [
    "tot_medicare_payment",
    "tot_services",
    "pay_per_bene",
    "services_per_bene",
]

# The peer-relative percentile of the same underlying metric.
PEER_BASELINES = [f"{c}_pct" for c in RAW_BASELINES]


def main() -> int:
    ap = argparse.ArgumentParser(description="Rank by single columns and score them.")
    ap.add_argument("--in", dest="in_path", default=str(DEFAULT_IN))
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)

    needed = ["npi", TARGET] + RAW_BASELINES + PEER_BASELINES
    df = pd.read_parquet(args.in_path, columns=needed)
    print(f"loaded {len(df):,} rows | {len(PROTOCOL_SEEDS)} protocol splits\n")

    results: dict[str, list[dict]] = {c: [] for c in RAW_BASELINES + PEER_BASELINES}
    for seed in PROTOCOL_SEEDS:
        _, test = grouped_split(df, 0.25, seed)
        y_test = test[TARGET].to_numpy()
        for column in RAW_BASELINES + PEER_BASELINES:
            scores = test[column].fillna(0).to_numpy()
            results[column].append(evaluate(column, y_test, scores, quiet=True))
        print(f"  seed {seed:>3} done")

    summary = {}
    for column, rows in results.items():
        summary[column] = {
            k: float(np.mean([r[k] for r in rows]))
            for k in ["roc_auc", "recall_at_1pct", "recall_at_5pct", "recall_at_10pct"]
        }
        summary[column]["recall_at_1pct_std"] = float(
            np.std([r["recall_at_1pct"] for r in rows]))

    model = json.loads((MODEL_DIR / "metrics.json").read_text())
    best = max(model["summary"], key=lambda e: e["recall_at_1pct"])

    print("\n" + "=" * 74)
    print("BASELINE COMPARISON  (mean over 10 protocol splits)")
    print("=" * 74)
    print(f"  {'ranked by':34s}{'ROC-AUC':>9s}{'top 1%':>9s}{'top 5%':>9s}{'top 10%':>9s}")

    print(f"\n  {'-- raw column, no model --':34s}")
    for column in RAW_BASELINES:
        s = summary[column]
        print(f"  {column:34s}{s['roc_auc']:>9.3f}{s['recall_at_1pct']:>8.1%}"
              f"{s['recall_at_5pct']:>9.1%}{s['recall_at_10pct']:>9.1%}")

    print(f"\n  {'-- same column, peer-relative --':34s}")
    for column in PEER_BASELINES:
        s = summary[column]
        print(f"  {column:34s}{s['roc_auc']:>9.3f}{s['recall_at_1pct']:>8.1%}"
              f"{s['recall_at_5pct']:>9.1%}{s['recall_at_10pct']:>9.1%}")

    print(f"\n  {'-- full pipeline --':34s}")
    print(f"  {best['model']:34s}{best['roc_auc']:>9.3f}{best['recall_at_1pct']:>8.1%}"
          f"{best['recall_at_5pct']:>9.1%}{best['recall_at_10pct']:>9.1%}")

    best_raw = max(RAW_BASELINES, key=lambda c: summary[c]["recall_at_1pct"])
    best_peer = max(PEER_BASELINES, key=lambda c: summary[c]["recall_at_1pct"])

    print("\n" + "=" * 74)
    print("VERDICT")
    print("=" * 74)
    r, p, m = (summary[best_raw]["recall_at_1pct"],
               summary[best_peer]["recall_at_1pct"],
               best["recall_at_1pct"])
    print(f"  best raw column     {best_raw:26s} {r:>6.1%}")
    print(f"  best peer column    {best_peer:26s} {p:>6.1%}   ({p / r:.2f}x raw)")
    print(f"  full model          {best['model']:26s} {m:>6.1%}   ({m / r:.2f}x raw)")
    print(f"\n  peer-normalisation earns its place : {'YES' if p > r else 'NO'}")
    print(f"  the model earns its complexity     : {'YES' if m > p else 'NO'}")

    out = MODEL_DIR / "baseline_metrics.json"
    out.write_text(json.dumps(
        {"seeds": PROTOCOL_SEEDS, "baselines": summary,
         "model": {k: best[k] for k in ["model", "roc_auc", "recall_at_1pct",
                                        "recall_at_5pct", "recall_at_10pct"]}}, indent=2))
    print(f"\nsaved {out.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
