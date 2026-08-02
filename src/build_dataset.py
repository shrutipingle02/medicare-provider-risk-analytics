"""
Step 2 of the pipeline: join CMS billing data to the LEIE exclusion list and
build the labeled provider-year panel.

Real Medicare data has no "fraud" column. We construct one.

The OIG LEIE lists providers barred from federal health programs, and codes
each exclusion by the law it was made under (the EXCLTYPE column). Some of
those laws are about fraud convictions; others are not. We treat only the
fraud-related ones as positive labels:

    fraud_label   = 1 if the provider was excluded for a FRAUD reason
    excluded_any  = 1 if the provider was excluded for ANY reason

The largest bucket in the LEIE is 1128b4, license revocation. Losing your
medical license is serious, but it is not the same as being convicted of
fraud, so it is deliberately NOT counted in fraud_label. It is still visible
through excluded_any if we ever want to compare the two.

Timing matters as well. A provider who was excluded in 2021 was still billing
normally in 2019 and 2020, and stopped billing after. We label a provider-year
as fraud only when the billing year is at or before the exclusion year, so the
model learns from pre-exclusion behaviour rather than from the collapse in
billing that follows an exclusion.

Two known facts about this join, both reported by the script:
  * Most LEIE records cannot be joined at all. Around 74,000 of ~83,000 carry
    a placeholder NPI of 0000000000. Only the rest are usable.
  * The resulting fraud rate is roughly 0.02%. That is real, not a bug, and it
    is the whole reason this project ranks providers instead of classifying them.

Usage:
    python src/build_dataset.py                        # pool 2019-2024 (default)
    python src/build_dataset.py --years 2022,2023
    python src/build_dataset.py --no-temporal          # label every year of a fraud provider
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
PROC_DIR = ROOT / "data" / "processed"

DEFAULT_YEARS = [2019, 2020, 2021, 2022, 2023, 2024]

# LEIE exclusion authorities we treat as fraud.
# Reference: https://oig.hhs.gov/exclusions/authorities.asp
FRAUD_EXCLTYPES = {
    "1128a1",  # conviction of program-related crimes (Medicare/Medicaid fraud)
    "1128a3",  # felony conviction relating to health care fraud
    "1128b1",  # conviction relating to fraud (misdemeanor)
    "1128b7",  # fraud, kickbacks, and other prohibited activities
    "1128b8",  # entity controlled by a sanctioned (fraud-excluded) individual
}

# CMS column -> the name we use everywhere downstream. The CMS file has 81
# columns; these are the ones the pipeline needs.
CMS_COLUMNS = {
    "Rndrng_NPI": "npi",
    "Rndrng_Prvdr_Last_Org_Name": "last_or_org_name",
    "Rndrng_Prvdr_First_Name": "first_name",
    "Rndrng_Prvdr_Ent_Cd": "entity_code",
    "Rndrng_Prvdr_State_Abrvtn": "state",
    "Rndrng_Prvdr_RUCA": "ruca",
    "Rndrng_Prvdr_Type": "provider_type",
    "Rndrng_Prvdr_Mdcr_Prtcptg_Ind": "medicare_participating",
    "Tot_HCPCS_Cds": "tot_hcpcs_codes",
    "Tot_Benes": "tot_beneficiaries",
    "Tot_Srvcs": "tot_services",
    "Tot_Sbmtd_Chrg": "tot_submitted_charge",
    "Tot_Mdcr_Alowd_Amt": "tot_medicare_allowed",
    "Tot_Mdcr_Pymt_Amt": "tot_medicare_payment",
    "Tot_Mdcr_Stdzd_Amt": "tot_medicare_standardized",
    "Bene_Avg_Age": "bene_avg_age",
    "Bene_Avg_Risk_Scre": "bene_avg_risk_score",
}


def load_exclusions() -> tuple[set[str], set[str], dict[str, int]]:
    """Read the LEIE and return (all excluded NPIs, fraud NPIs, NPI -> first exclusion year)."""
    path = RAW_DIR / "LEIE_exclusions.csv"
    if not path.exists():
        raise SystemExit(f"Missing {path}\nRun: python src/download_data.py --all")

    leie = pd.read_csv(path, dtype=str, encoding="utf-8-sig").fillna("")
    leie["NPI"] = leie["NPI"].str.strip()
    leie["EXCLTYPE"] = leie["EXCLTYPE"].str.strip()

    # Records with a placeholder NPI cannot be joined to CMS at all.
    usable = leie[(leie["NPI"].str.len() == 10) & (leie["NPI"] != "0000000000")].copy()

    # EXCLDATE is YYYYMMDD. Keep the earliest exclusion per provider.
    usable["excl_year"] = pd.to_numeric(usable["EXCLDATE"].str[:4], errors="coerce")
    excl_year = (usable.dropna(subset=["excl_year"])
                       .groupby("NPI")["excl_year"].min().astype(int).to_dict())

    all_excluded = set(usable["NPI"])
    fraud_excluded = set(usable.loc[usable["EXCLTYPE"].isin(FRAUD_EXCLTYPES), "NPI"])

    unusable = len(leie) - len(usable)
    print(f"LEIE: {len(leie):,} records")
    print(f"  unusable (placeholder NPI) : {unusable:,}  ({unusable / len(leie):.1%})")
    print(f"  joinable                   : {len(all_excluded):,}")
    print(f"  of those, fraud-related    : {len(fraud_excluded):,}")
    return all_excluded, fraud_excluded, excl_year


def load_cms_year(year: int) -> pd.DataFrame:
    """Load one year of CMS Part B, keeping only the columns we need."""
    path = RAW_DIR / f"CMS_PartB_byProvider_{year}.csv"
    if not path.exists():
        raise SystemExit(f"Missing {path}\nRun: python src/download_data.py --year {year}")

    print(f"  loading {year} ...", end=" ", flush=True)
    df = pd.read_csv(path, usecols=list(CMS_COLUMNS), dtype={"Rndrng_NPI": str},
                     low_memory=False).rename(columns=CMS_COLUMNS)
    df["npi"] = df["npi"].str.strip()
    df.insert(1, "year", year)
    print(f"{len(df):,} providers")
    return df


def build_panel(years: list[int], temporal: bool = True) -> Path:
    """Stack every year into one provider-year table and attach the labels."""
    all_excluded, fraud_excluded, excl_year = load_exclusions()

    print(f"\nCMS Part B, {len(years)} years:")
    frames = []
    for year in sorted(years):
        df = load_cms_year(year)
        df["excluded_any"] = df["npi"].isin(all_excluded).astype("int8")
        df["fraud_label"] = df["npi"].isin(fraud_excluded).astype("int8")
        frames.append(df)

    panel = pd.concat(frames, ignore_index=True)
    panel["excl_year"] = panel["npi"].map(excl_year).astype("Int64")

    if temporal:
        before = int(panel["fraud_label"].sum())
        keep = (
            (panel["fraud_label"] == 1)
            & panel["excl_year"].notna()
            & (panel["year"] <= panel["excl_year"])
        )
        panel["fraud_label"] = keep.astype("int8")
        after = int(panel["fraud_label"].sum())
        print(f"\ntemporal labeling: {before:,} -> {after:,} fraud provider-years")
        print("  (dropped years after a provider was already excluded)")

    n = len(panel)
    n_fraud = int(panel["fraud_label"].sum())
    n_providers = panel["npi"].nunique()
    n_fraud_providers = panel.loc[panel["fraud_label"] == 1, "npi"].nunique()

    print(f"\nPanel {min(years)}-{max(years)}")
    print(f"  provider-years         : {n:,}")
    print(f"  unique providers       : {n_providers:,}")
    print(f"  fraud provider-years   : {n_fraud:,}  ({n_fraud / n:.4%})")
    print(f"  unique fraud providers : {n_fraud_providers:,}")

    if n_fraud == 0:
        print("\n  WARNING: no positive labels. Check the LEIE file and the NPI join.")

    PROC_DIR.mkdir(parents=True, exist_ok=True)
    out = PROC_DIR / f"provider_year_panel_{min(years)}_{max(years)}.parquet"
    panel.to_parquet(out, index=False)
    print(f"\nWrote {out.name}  ({out.stat().st_size / 1e6:,.1f} MB)")
    print("Next: python src/prepare_data.py")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Join CMS Part B + OIG LEIE into a labeled provider-year panel.")
    ap.add_argument("--years", type=str, default=",".join(str(y) for y in DEFAULT_YEARS),
                    help="comma-separated years, e.g. 2022,2023")
    ap.add_argument("--no-temporal", action="store_true",
                    help="label every year of a fraud provider, not only pre-exclusion years")
    args = ap.parse_args()

    years = [int(y) for y in args.years.split(",")]
    build_panel(years, temporal=not args.no_temporal)
    return 0


if __name__ == "__main__":
    sys.exit(main())
