"""
Step 4 of the pipeline: peer-relative features.

This is the step that makes the model work.

"Bills $500,000 a year" is meaningless on its own. For a solo psychologist it
would be extraordinary; for a large radiology group it is unremarkable. Raw
numbers cannot separate fraud from a busy practice.

So every provider is measured against its PEERS: providers of the same
specialty in the same year. "Bills $500,000" becomes "bills 4 standard
deviations above other psychologists in 2023", which is a statement you can
actually act on.

For each of the 11 base metrics we add three views of the same comparison:

    _z    how many standard deviations above or below the peer average
    _pct  percentile rank inside the peer group, 0 to 1
    _pmr  ratio to the peer median (2.0 means twice the typical peer)

11 metrics x 3 views = 33 new features.

Small peer groups are a trap. In a specialty with 4 providers, "2 SD above
average" is noise, not evidence. Any peer group smaller than MIN_PEER_GROUP is
damped: z goes to 0, ratio to 1, percentile to 0.5, all of which mean "this
provider looks perfectly average". We damp all three together on purpose. If we
damped only some of them, the undamped one would quietly tell the model which
rows had been damped, which is a signal about our processing rather than about
the provider.

These features do double duty. They sharpen the model, and they pre-write the
plain-English explanations the website shows ("bills 2.5 SD above same-specialty
peers").

Usage:
    python src/build_features.py
    python src/build_features.py --in data/processed/<some>_clean.parquet
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PROC_DIR = ROOT / "data" / "processed"
DEFAULT_IN = PROC_DIR / "provider_year_panel_2019_2024_clean.parquet"

# Peer group: same specialty, same year. Using year as part of the key means a
# provider is compared against how their specialty billed THAT year, so
# industry-wide shifts (a fee schedule change, COVID) do not look like fraud.
PEER_KEYS = ["provider_type", "year"]

# The 11 metrics that get peer-normalized: volume, money, intensity, patient mix.
BASE_METRICS = [
    "tot_hcpcs_codes",
    "tot_beneficiaries",
    "tot_services",
    "tot_submitted_charge",
    "tot_medicare_allowed",
    "tot_medicare_payment",
    "pay_per_service",
    "pay_per_bene",
    "services_per_bene",
    "charge_to_payment",
    "bene_avg_risk_score",
]

# Peer groups smaller than this cannot define a stable "normal".
MIN_PEER_GROUP = 30


def add_peer_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    metrics = [m for m in BASE_METRICS if m in df.columns]
    missing = [m for m in BASE_METRICS if m not in df.columns]
    if missing:
        raise SystemExit(f"missing expected columns: {missing}\nRun step 3 first.")

    grouped = df.groupby(PEER_KEYS, observed=True)

    group_size = grouped[metrics[0]].transform("size")
    big_enough = group_size >= MIN_PEER_GROUP

    new_cols: dict[str, pd.Series] = {}
    for metric in metrics:
        peer_mean = grouped[metric].transform("mean")
        peer_std = grouped[metric].transform("std").replace(0, np.nan)
        peer_median = grouped[metric].transform("median").replace(0, np.nan)

        z = (df[metric] - peer_mean) / peer_std
        pct = grouped[metric].rank(pct=True)
        pmr = df[metric] / peer_median

        # Clean up divide-by-zero and empty-group artifacts, then damp any row
        # whose peer group is too small to be trusted.
        z = z.replace([np.inf, -np.inf], np.nan).fillna(0.0).where(big_enough, 0.0)
        pmr = pmr.replace([np.inf, -np.inf], np.nan).fillna(1.0).where(big_enough, 1.0)
        pct = pct.fillna(0.5).where(big_enough, 0.5)

        new_cols[f"{metric}_z"] = z.astype("float32")
        new_cols[f"{metric}_pct"] = pct.astype("float32")
        new_cols[f"{metric}_pmr"] = pmr.astype("float32")

    out = pd.concat([df, pd.DataFrame(new_cols, index=df.index)], axis=1)
    out["peer_group_size"] = group_size.astype("int32")
    return out, list(new_cols)


def report_lift(df: pd.DataFrame) -> None:
    """Do fraud providers actually land in the extreme tail of their peer group?

    For each metric, compare how often fraud providers sit in their peer
    group's top 5% against how often clean providers do. A lift of 4x means a
    fraud provider is four times more likely to be there.
    """
    if "fraud_label" not in df:
        return

    print("\n" + "=" * 68)
    print("DOES THIS ACTUALLY SEPARATE FRAUD?  (share in their peer group's top 5%)")
    print("=" * 68)
    print(f"  {'metric':24s} {'fraud':>8s} {'clean':>8s} {'lift':>8s}")

    is_fraud = df["fraud_label"] == 1
    rows = []
    for metric in BASE_METRICS:
        col = f"{metric}_pct"
        if col not in df:
            continue
        top5 = df[col] >= 0.95
        fraud_rate = top5[is_fraud].mean()
        clean_rate = top5[~is_fraud].mean()
        lift = fraud_rate / clean_rate if clean_rate else float("nan")
        rows.append((metric, fraud_rate, clean_rate, lift))

    for metric, f, c, lift in sorted(rows, key=lambda r: -r[3]):
        print(f"  {metric:24s} {f:>7.1%} {c:>8.1%} {lift:>7.1f}x")


def build(in_path: Path) -> Path:
    df = pd.read_parquet(in_path)
    print(f"loaded {len(df):,} rows x {df.shape[1]} columns")

    n_groups = df.groupby(PEER_KEYS, observed=True).ngroups
    print(f"peer groups: {n_groups:,}  (by {' x '.join(PEER_KEYS)})")

    df, new_features = add_peer_features(df)
    print(f"added {len(new_features)} peer features "
          f"({len(BASE_METRICS)} metrics x 3 views) + peer_group_size")

    small = (df["peer_group_size"] < MIN_PEER_GROUP)
    print(f"damped {small.sum():,} rows ({small.mean():.2%}) in peer groups "
          f"smaller than {MIN_PEER_GROUP}")

    report_lift(df)

    out = PROC_DIR / (in_path.stem.replace("_clean", "") + "_features.parquet")
    df.to_parquet(out, index=False)
    print(f"\nWrote {out.name}  ({out.stat().st_size / 1e6:,.1f} MB)  shape={df.shape}")
    print("Next: python src/train_model.py")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Build peer-relative features.")
    ap.add_argument("--in", dest="in_path", default=str(DEFAULT_IN))
    args = ap.parse_args()
    build(Path(args.in_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
