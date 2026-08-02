"""
Step 1 of the pipeline: download the raw source data.

Two public sources, neither containing any patient information:

  1. CMS Medicare Physician & Other Practitioners - by Provider (Part B).
     One row per provider (NPI) per year, with billing and utilization
     totals. About 470 MB per year.
  2. OIG LEIE (List of Excluded Individuals/Entities).
     Providers barred from federal health programs. This is where the
     fraud labels come from.

Raw files are large and regenerable, so they are never committed to git.
Re-run this script to recreate data/raw/ from scratch.

Before downloading anything, the script "peeks" at each file: it asks the
server for only the first few KB, reads the header line, and checks that
every column we need is present. A 470 MB download is a bad way to find
out that CMS renamed a column.

Usage:
    python src/download_data.py --check          # peek at headers only, no download
    python src/download_data.py --year 2023      # one year (+ LEIE)
    python src/download_data.py --all            # all years 2019-2024 (+ LEIE)
    python src/download_data.py --all --force    # re-download files already present
"""
from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"

# CMS "Medicare Physician & Other Practitioners - by Provider" CSV downloads.
# Landing page (use this to find replacements if a link ever 404s):
# https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners
CMS_BY_PROVIDER = {
    2019: "https://data.cms.gov/sites/default/files/2025-11/ac110c46-3429-4f3c-9348-56f0a5312cb8/MUP_PHY_R25_P07_V20_D19_Prov.csv",
    2020: "https://data.cms.gov/sites/default/files/2025-11/056e8c6b-7e39-4945-b9a4-52d0a1cbbb9a/MUP_PHY_R25_P07_V20_D20_Prov.csv",
    2021: "https://data.cms.gov/sites/default/files/2025-11/fc6ea9aa-12f0-4c2f-9909-6c8e06c961cf/MUP_PHY_R25_P07_V20_D21_Prov.csv",
    2022: "https://data.cms.gov/sites/default/files/2025-11/adcd20c5-4534-43cd-8dfa-881ebe7bacfd/MUP_PHY_R25_P07_V20_D22_Prov.csv",
    2023: "https://data.cms.gov/sites/default/files/2025-04/22edfd1e-d17a-4478-ad6b-92cac2a5a3c4/MUP_PHY_R25_P05_V20_D23_Prov.csv",
    2024: "https://data.cms.gov/sites/default/files/2026-05/7323ba02-52e7-4a86-b2ce-ad210c25d9aa/MUP_PHY_R26_P05_V10_D24_Prov.csv",
}

# OIG LEIE, the full current exclusion list. Refreshed monthly.
# https://oig.hhs.gov/exclusions/exclusions_list.asp
LEIE_URL = "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv"

# The CMS columns the rest of the pipeline depends on. If any of these are
# missing from a year's file, that year needs looking at before we use it.
REQUIRED_CMS_COLUMNS = [
    "Rndrng_NPI",                     # provider ID, joins to LEIE
    "Rndrng_Prvdr_Last_Org_Name",
    "Rndrng_Prvdr_First_Name",
    "Rndrng_Prvdr_Ent_Cd",            # I = individual, O = organization
    "Rndrng_Prvdr_State_Abrvtn",
    "Rndrng_Prvdr_RUCA",              # rural / urban
    "Rndrng_Prvdr_Type",              # specialty, the peer-group key
    "Rndrng_Prvdr_Mdcr_Prtcptg_Ind",
    "Tot_HCPCS_Cds",                  # distinct procedure codes
    "Tot_Benes",                      # patients
    "Tot_Srvcs",                      # services
    "Tot_Sbmtd_Chrg",                 # what they billed
    "Tot_Mdcr_Alowd_Amt",             # what Medicare approved
    "Tot_Mdcr_Pymt_Amt",              # what Medicare paid
    "Tot_Mdcr_Stdzd_Amt",             # payment adjusted for geography
    "Bene_Avg_Age",
    "Bene_Avg_Risk_Scre",
]

# LEIE columns we need for labeling.
REQUIRED_LEIE_COLUMNS = ["NPI", "EXCLTYPE", "EXCLDATE"]

USER_AGENT = "Mozilla/5.0 (medicare-provider-risk-analytics; data download)"
PEEK_BYTES = 65_536


def _request(url: str, headers: dict[str, str] | None = None) -> urllib.request.Request:
    all_headers = {"User-Agent": USER_AGENT}
    all_headers.update(headers or {})
    return urllib.request.Request(url, headers=all_headers)


def _mb(n: float) -> str:
    return f"{n / 1e6:,.1f} MB"


def peek_columns(url: str) -> list[str]:
    """Read just the header line of a remote CSV, without downloading the file.

    Asks for the first PEEK_BYTES bytes via an HTTP Range request. If the
    server ignores Range and starts sending the whole file, we simply stop
    reading after the first line, which has the same effect.
    """
    req = _request(url, {"Range": f"bytes=0-{PEEK_BYTES - 1}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        chunk = resp.read(PEEK_BYTES)
    text = chunk.decode("utf-8-sig", errors="replace")
    header = text.split("\n", 1)[0].strip().strip("\r")
    return [c.strip().strip('"') for c in header.split(",")]


def check_source(name: str, url: str, required: list[str]) -> bool:
    """Peek at one file and report whether every required column is present."""
    try:
        columns = peek_columns(url)
    except urllib.error.HTTPError as e:
        print(f"  {name:12s} FAILED  HTTP {e.code} - link may have moved")
        return False
    except Exception as e:  # network, timeout, decode
        print(f"  {name:12s} FAILED  {type(e).__name__}: {e}")
        return False

    missing = [c for c in required if c not in columns]
    if missing:
        print(f"  {name:12s} MISSING {len(missing)} of {len(required)} columns "
              f"({len(columns)} present in file)")
        for c in missing:
            print(f"                 - {c}")
        return False

    print(f"  {name:12s} ok      all {len(required)} needed columns present "
          f"({len(columns)} total)")
    return True


def check_all(years: list[int]) -> bool:
    """Verify every file we are about to download has the columns we need."""
    print("Checking file headers before downloading (a few KB each)\n")
    ok = check_source("LEIE", LEIE_URL, REQUIRED_LEIE_COLUMNS)
    for year in years:
        ok &= check_source(f"CMS {year}", CMS_BY_PROVIDER[year], REQUIRED_CMS_COLUMNS)
    print()
    if ok:
        print("All headers look right.")
    else:
        print("Some files are not what the pipeline expects. Fix these before downloading.")
    return ok


def download(url: str, dest: Path, force: bool = False) -> None:
    """Download url to dest, resiliently.

    Writes to a temporary .part file and renames only on success, so an
    interrupted download can never leave a truncated file that later looks
    complete.
    """
    if dest.exists() and not force:
        print(f"  already have {dest.name} ({_mb(dest.stat().st_size)}), skipping")
        return

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")

    with urllib.request.urlopen(_request(url), timeout=120) as resp:
        total = int(resp.headers.get("Content-Length") or 0)
        print(f"  downloading {dest.name} ({_mb(total) if total else 'size unknown'})")

        done = 0
        next_report = 0.0
        with open(tmp, "wb") as out:
            while True:
                block = resp.read(1 << 20)  # 1 MB
                if not block:
                    break
                out.write(block)
                done += len(block)
                if total:
                    pct = done / total * 100
                    if pct >= next_report:
                        print(f"    {pct:5.1f}%  {_mb(done)}", end="\r", flush=True)
                        next_report += 5

    if total and done != total:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"  incomplete download: got {_mb(done)}, expected {_mb(total)}")

    tmp.replace(dest)
    print(f"    done: {dest.name} ({_mb(dest.stat().st_size)})        ")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Download CMS Part B + OIG LEIE source data.")
    ap.add_argument("--year", type=int, choices=sorted(CMS_BY_PROVIDER),
                    help="download a single CMS year")
    ap.add_argument("--all", action="store_true",
                    help="download every year, 2019-2024")
    ap.add_argument("--check", action="store_true",
                    help="only verify file headers, download nothing")
    ap.add_argument("--force", action="store_true",
                    help="re-download files that are already present")
    ap.add_argument("--skip-check", action="store_true",
                    help="skip the header check and download immediately")
    args = ap.parse_args()

    if args.all:
        years = sorted(CMS_BY_PROVIDER)
    elif args.year:
        years = [args.year]
    elif args.check:
        years = sorted(CMS_BY_PROVIDER)
    else:
        ap.print_help()
        print("\nTip: start with  python src/download_data.py --check")
        return 1

    if not args.skip_check:
        if not check_all(years):
            return 1
        if args.check:
            return 0
        print()

    total_mb = 470 * len(years)
    print(f"Downloading LEIE + {len(years)} CMS year(s), roughly {total_mb / 1000:.1f} GB\n")

    print("LEIE exclusions:")
    download(LEIE_URL, RAW_DIR / "LEIE_exclusions.csv", args.force)

    for year in years:
        print(f"CMS Part B by Provider ({year}):")
        download(CMS_BY_PROVIDER[year], RAW_DIR / f"CMS_PartB_byProvider_{year}.csv",
                 args.force)

    print(f"\nAll files in {RAW_DIR}")
    print("Next: python src/build_dataset.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
