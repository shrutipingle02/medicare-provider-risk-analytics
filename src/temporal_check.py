"""
Supporting script, outside the seven: does this model work FORWARD in time?

WHY THIS EXISTS. The locked protocol splits providers at random, so both sides
of every split hold the same mix of years. That measurement cannot detect a
model that has learned WHEN rather than WHO - and step 6 found evidence that
this model has: on clean, unlabeled rows it scores 2019 about 2.2x higher than
2024, despite `year` being withheld. The labels are gated to
`year <= exclusion_year`, so training positives concentrate in early years, and
the raw non-peer features drift with time. The model can reconstruct the year
and leans that way because that is where its positives live.

THE OBVIOUS TEST DOES NOT WORK, and the reason is worth keeping.

Splitting on billing year - fit 2019-2022, test 2023-2024 - scores 23.5% at
provider top 1%, far ABOVE the protocol's 16.8%. That number is meaningless. A
provider excluded in 2024 carries `fraud_label = 1` for every year at or before
2024, so they are a positive in the training years AND in the test years: 98 of
the 100 test-year positives were already seen labeled during training. The model
was recognising providers it had memorised, which is exactly the failure
`train_model.py` splits by provider to prevent.

WHAT THIS DOES INSTEAD. Split the providers by WHEN THEY WERE CAUGHT.

    train positives   excluded on or before 2022      (140 providers)
    test positives    excluded 2023 or later          (346 providers)
    clean providers   split at random, no overlap

A provider has one exclusion year, so the two sides are disjoint by
construction. Nothing in the test set was ever seen labeled. The question this
asks is the one that matters: given billing history, does the model rank
providers who were caught LATER above providers who were never caught at all?

CAVEATS THAT TRAVEL WITH ANY NUMBER FROM HERE.

1. 140 training positives, against 484 in the protocol. Some of the gap to the
   headline number is less training signal, not worse generalisation.
2. Test positives are providers excluded 2023-2026, so some of their billing
   here is post-exclusion or close to it.
3. Different test set to the protocol's, so the comparison is directional -
   "does it hold up or collapse" - not a like-for-like difference.

Usage:
    python src/temporal_check.py
    python src/temporal_check.py --cut 2021
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from train_model import (
    DEFAULT_IN,
    GROUP,
    MODEL_DIR,
    PROTOCOL_SEEDS,
    TARGET,
    aggregate_to_provider,
    clean_matrix,
    evaluate,
    feature_columns,
    make_xgboost,
    undersample,
)


def split_by_exclusion(df: pd.DataFrame, cut: int, seed: int):
    """Providers caught by `cut` train; providers caught later are held out."""
    excl = df[df[TARGET] == 1].groupby(GROUP)["excl_year"].min()
    train_pos = set(excl[excl <= cut].index)
    test_pos = set(excl[excl > cut].index)
    assert not (train_pos & test_pos), "a provider cannot be on both sides"

    clean = np.array(sorted(set(df[GROUP].unique()) - train_pos - test_pos))
    rng = np.random.default_rng(seed)
    rng.shuffle(clean)
    # Match the protocol's 25% test fraction for the clean population.
    cut_at = int(len(clean) * 0.75)
    train_ids = train_pos | set(clean[:cut_at])
    test_ids = test_pos | set(clean[cut_at:])

    train = df[df[GROUP].isin(train_ids)]
    test = df[df[GROUP].isin(test_ids)]
    return train, test, len(train_pos), len(test_pos)


def main() -> int:
    ap = argparse.ArgumentParser(description="Forward-in-time check, split by exclusion year.")
    ap.add_argument("--in", dest="in_path", default=str(DEFAULT_IN))
    ap.add_argument("--cut", type=int, default=2022,
                    help="providers excluded after this year are held out")
    ap.add_argument("--neg-per-pos", type=int, default=20)
    ap.add_argument("--out", default="temporal_metrics.json")
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)

    print(f"loading {Path(args.in_path).name} ...")
    df = pd.read_parquet(args.in_path).drop(
        columns=["last_or_org_name", "first_name"], errors="ignore")
    features = feature_columns(df)

    results = []
    for seed in PROTOCOL_SEEDS:
        train, test, n_train_pos, n_test_pos = split_by_exclusion(df, args.cut, seed)
        if seed == PROTOCOL_SEEDS[0]:
            print(f"\ncaught on or before {args.cut}: {n_train_pos} providers -> train")
            print(f"caught after {args.cut}:        {n_test_pos} providers -> test")
            print(f"train {len(train):>9,} rows | test {len(test):>9,} rows")

        balanced = undersample(train, args.neg_per_pos, seed)
        model = make_xgboost(seed)
        model.fit(clean_matrix(balanced[features]), balanced[TARGET])
        scores = model.predict_proba(clean_matrix(test[features]))[:, 1]

        peak = aggregate_to_provider(test, scores)
        provider = evaluate("provider", peak[TARGET].to_numpy(),
                            peak["score"].to_numpy(), quiet=True)
        row = evaluate("provider-year", test[TARGET].to_numpy(), scores, quiet=True)
        row.update({f"prov_{k}": v for k, v in provider.items() if k != "model"})
        row.update({"seed": seed, "n_train_positives": n_train_pos,
                    "n_test_positives": n_test_pos, "n_test_providers": len(peak)})
        results.append(row)
        print(f"  seed {seed:>3}: provider top 1% {provider['recall_at_1pct']:>5.1%}   "
              f"ROC-AUC {provider['roc_auc']:.4f}")

    def stat(key):
        values = [r[key] for r in results]
        return float(np.mean(values)), float(np.std(values)), min(values), max(values)

    print("\n" + "=" * 68)
    print(f"FORWARD IN TIME (split on exclusion year, cut {args.cut})")
    print("=" * 68)
    print(f"  test set: {results[0]['n_test_providers']:,} providers, "
          f"{results[0]['n_test_positives']} caught after {args.cut}")
    print(f"  none of them was ever seen labeled during training\n")
    for level, prefix in (("PROVIDER", "prov_"), ("PROVIDER-YEAR", "")):
        auc = stat(f"{prefix}roc_auc")
        print(f"  {level:14s} ROC-AUC {auc[0]:.4f} +/- {auc[1]:.4f}")
        for k in (1, 5, 10):
            mean, std, lo, hi = stat(f"{prefix}recall_at_{k}pct")
            print(f"    top {k:>2}%  {mean:>5.1%} +/- {std:.1%}   (range {lo:.1%} - {hi:.1%})")

    protocol = json.loads((MODEL_DIR / "metrics.json").read_text())
    xgb = next(s for s in protocol["summary"] if s["model"] == "XGBoost")
    forward = stat("prov_recall_at_1pct")[0]
    print(f"\n  random-split protocol, provider top 1%: "
          f"{xgb['prov_recall_at_1pct']:.1%} +/- {xgb['prov_recall_at_1pct_std']:.1%}")
    print(f"  forward in time,        provider top 1%: {forward:.1%}")
    print("  Directional only: different test set, and only "
          f"{results[0]['n_train_positives']} training positives against "
          f"{int(df[df[TARGET] == 1][GROUP].nunique())} available to the protocol.")

    out = MODEL_DIR / args.out
    out.write_text(json.dumps({
        "design": "providers split by exclusion year; disjoint by construction",
        "cut": args.cut, "seeds": PROTOCOL_SEEDS,
        "note": ("Billing-year splits are invalid here: a provider excluded in 2024 "
                 "is labeled fraud in every earlier year too, so 98 of 100 test "
                 "positives would already have been seen labeled in training."),
        "per_seed": results,
    }, indent=2))
    print(f"\nsaved {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
