"""
Step 3 of the pipeline: quality-check, clean, and add the basic ratio features.

The guiding rule here is that in fraud data, OUTLIERS ARE THE SIGNAL. A provider
billing 30 standard deviations above their peers is exactly who we are looking
for. So this step does not do the usual "remove outliers" cleaning. It only
removes rows that are genuinely broken or genuinely uninformative:

  * negative money values (data errors)
  * rows missing the fields the pipeline depends on
  * providers with fewer than 11 patients

That last one needs explaining. CMS suppresses data for providers with fewer
than 11 beneficiaries to protect patient privacy, so those rows carry blanked
or unreliable values. They are dropped because they cannot be characterized,
not because they look unusual.

It then builds the four ratio features. Raw totals are not comparable across
providers, because a large practice naturally has large totals. Ratios convert
totals into "per patient" and "per service" terms so a small practice and a
large one can be compared on the same footing:

    pay_per_service    payment per procedure
    pay_per_bene       payment per patient
    services_per_bene  procedures per patient
    charge_to_payment  what they billed vs what they were paid

In the reference implementation of this approach, charge_to_payment and
services_per_bene turned out to be the two strongest signals in the entire
model, which matches the two classic fraud patterns: inflating charges, and
running up procedures per patient.

Usage:
    python src/prepare_data.py
    python src/prepare_data.py --in data/processed/provider_year_panel_2019_2023.parquet
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PROC_DIR = ROOT / "data" / "processed"
DEFAULT_IN = PROC_DIR / "provider_year_panel_2019_2024.parquet"

MONEY_COLS = [
    "tot_submitted_charge", "tot_medicare_allowed",
    "tot_medicare_payment", "tot_medicare_standardized",
]
COUNT_COLS = ["tot_hcpcs_codes", "tot_beneficiaries", "tot_services"]

# CMS suppresses providers below this many beneficiaries.
MIN_BENES = 11

RATIO_FEATURES = ["pay_per_service", "pay_per_bene", "services_per_bene", "charge_to_payment"]


def quality_report(df: pd.DataFrame) -> None:
    print("=" * 62)
    print("DATA QUALITY REPORT (before cleaning)")
    print("=" * 62)
    print(f"rows: {len(df):,}   columns: {df.shape[1]}")

    if "year" in df:
        print("\nrows per year:")
        for year, n in df["year"].value_counts().sort_index().items():
            print(f"  {year}  {n:>10,}")

    if "fraud_label" in df:
        pos = int(df["fraud_label"].sum())
        print(f"\nfraud_label: {pos:,} positive ({pos / len(df):.4%})")

    missing = df.isna().sum()
    missing = missing[missing > 0].sort_values(ascending=False)
    print("\nmissing values:")
    if len(missing):
        for col, n in missing.items():
            print(f"  {col:28s} {n:>10,}  ({n / len(df):.2%})")
    else:
        print("  none")

    key = [c for c in ["npi", "year"] if c in df]
    print(f"\nduplicate {tuple(key)} rows: {df.duplicated(subset=key).sum():,}")

    print("\nnegative values in money/count columns:")
    found = False
    for col in MONEY_COLS + COUNT_COLS:
        if col in df:
            n = int((df[col] < 0).sum())
            if n:
                print(f"  {col:28s} {n:>10,}")
                found = True
    if not found:
        print("  none")
    print()


def prepare(in_path: Path) -> Path:
    df = pd.read_parquet(in_path)
    quality_report(df)

    start_rows = len(df)
    start_pos = int(df["fraud_label"].sum()) if "fraud_label" in df else 0

    print("=" * 62)
    print("CLEANING")
    print("=" * 62)

    def step(label: str, new_df: pd.DataFrame) -> pd.DataFrame:
        """Apply a cleaning step and report what it cost us, positives included."""
        dropped = len(df_state[0]) - len(new_df)
        pos_before = int(df_state[0]["fraud_label"].sum()) if "fraud_label" in new_df else 0
        pos_after = int(new_df["fraud_label"].sum()) if "fraud_label" in new_df else 0
        print(f"  {label:42s} -{dropped:>9,} rows"
              + (f"  (-{pos_before - pos_after} fraud)" if pos_before != pos_after else ""))
        df_state[0] = new_df
        return new_df

    df_state = [df]

    # 1. Make sure numbers are actually numbers. CMS sometimes ships them as text.
    for col in MONEY_COLS + COUNT_COLS + ["bene_avg_age", "bene_avg_risk_score"]:
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df_state[0] = df

    # 2. Negative money is a data error, not a signal.
    for col in MONEY_COLS:
        if col in df:
            df = step(f"drop negative {col}", df[df[col].fillna(0) >= 0])

    # 3. Rows missing the fields everything downstream depends on.
    df = step("drop missing npi/services/beneficiaries",
              df.dropna(subset=["npi", "tot_services", "tot_beneficiaries"]))

    # 4. Providers too small to characterize (CMS suppression threshold).
    df = step(f"drop providers with < {MIN_BENES} patients",
              df[df["tot_beneficiaries"] >= MIN_BENES])

    # 5. Fill the two patient-mix columns with their median. These are averages
    #    describing the provider's patients, so a median fill is a neutral guess.
    for col in ["bene_avg_age", "bene_avg_risk_score"]:
        if col in df:
            n_missing = int(df[col].isna().sum())
            if n_missing:
                df[col] = df[col].fillna(df[col].median())
                print(f"  {'median-filled ' + col:42s}  {n_missing:>9,} values")

    # 6. The four ratio features.
    df["pay_per_service"] = df["tot_medicare_payment"] / df["tot_services"].replace(0, np.nan)
    df["pay_per_bene"] = df["tot_medicare_payment"] / df["tot_beneficiaries"].replace(0, np.nan)
    df["services_per_bene"] = df["tot_services"] / df["tot_beneficiaries"].replace(0, np.nan)
    df["charge_to_payment"] = df["tot_submitted_charge"] / df["tot_medicare_payment"].replace(0, np.nan)
    for col in RATIO_FEATURES:
        df[col] = df[col].replace([np.inf, -np.inf], np.nan).fillna(0)

    end_pos = int(df["fraud_label"].sum()) if "fraud_label" in df else 0
    print(f"\n  built {len(RATIO_FEATURES)} ratio features: {', '.join(RATIO_FEATURES)}")

    print("\n" + "=" * 62)
    print("RESULT")
    print("=" * 62)
    print(f"  rows      {start_rows:>12,} -> {len(df):>12,}   "
          f"({start_rows - len(df):,} dropped, {(start_rows - len(df)) / start_rows:.2%})")
    print(f"  positives {start_pos:>12,} -> {end_pos:>12,}   "
          f"({start_pos - end_pos:,} dropped, "
          f"{(start_pos - end_pos) / start_pos:.2%})" if start_pos else "")
    print(f"  fraud rate {end_pos / len(df):.4%}")

    # Cleaning should never cost us a large share of the positives. If it does,
    # a rule is too aggressive and needs revisiting before we model on this.
    if start_pos and (start_pos - end_pos) / start_pos > 0.25:
        print("\n  WARNING: cleaning removed more than 25% of the fraud labels.")
        print("  Check which rule is responsible before continuing.")

    print("\nsanity check, clean vs fraud (median):")
    if "fraud_label" in df:
        for col in RATIO_FEATURES + ["tot_services", "tot_medicare_payment"]:
            med = df.groupby("fraud_label")[col].median()
            c, f = med.get(0, float("nan")), med.get(1, float("nan"))
            arrow = "higher" if f > c else "lower"
            print(f"  {col:20s} clean {c:>12,.2f}  fraud {f:>12,.2f}   ({arrow})")

    out = PROC_DIR / (in_path.stem + "_clean.parquet")
    df.to_parquet(out, index=False)
    print(f"\nWrote {out.name}  ({out.stat().st_size / 1e6:,.1f} MB)  shape={df.shape}")
    print("Next: python src/build_features.py")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Quality-check, clean, and add ratio features.")
    ap.add_argument("--in", dest="in_path", default=str(DEFAULT_IN),
                    help="panel parquet to clean")
    args = ap.parse_args()
    prepare(Path(args.in_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
