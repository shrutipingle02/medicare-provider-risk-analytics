"""
Step 6 of the pipeline: explain what the model learned, and audit it for bias.

This step exists for two reasons, and the second one is the important one.

1. EVERY FLAG MUST BE EXPLAINABLE.
   A working agreement in PROJECT.md: a flag that cannot be explained does not
   ship. SHAP attributes each prediction to the features that produced it, which
   is what turns a score into a sentence an investigator can read.

2. THE MODEL MIGHT BE KEYING ON THE WRONG THING.
   `bene_avg_age` and `peer_group_size` are plausible top drivers. If the model
   leans on how old a provider's patients are, then geriatric and hospice
   practices get flagged for their patient mix rather than for their billing,
   and the site would be publishing a demographic proxy dressed up as a fraud
   signal. `peer_group_size` is worse in kind: it is an artefact of how the peer
   features were built, not a fact about any provider's behaviour.

   This script measures both and prints a verdict. PROJECT.md open item #1 gets
   decided from that output, before anything is made public.

ONE SEED, ON PURPOSE. The locked protocol trains 10 splits and reports mean and
standard deviation, and that is still how every published NUMBER is produced.
But explanations are not a reported metric: they answer "what is this model
paying attention to", and that does not need an error bar. So this runs a single
seeded fit, which is deterministic and reproducible - same seed, same model,
same explanation. No model file is saved anywhere because none is needed.

WHAT IT WRITES. `models/shap_explanations.json` holds global importance, the
bias audit, and plain-English reasons for the top-ranked providers. Per the
privacy rule, it carries NO NPI and NO provider names - specialty, state and
trigger year only, exactly what the public site is allowed to show.

Usage:
    python src/explain_shap.py
    python src/explain_shap.py --sample 50000 --top 100
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import shap
from scipy.stats import spearmanr

from train_model import (
    GROUP,
    MODEL_DIR,
    TARGET,
    aggregate_to_provider,
    clean_matrix,
    feature_columns,
    grouped_split,
    make_xgboost,
    undersample,
)

DEFAULT_IN = Path(__file__).resolve().parents[1] / "data" / "processed" / \
    "provider_year_panel_2019_2024_features.parquet"

# Features the bias audit watches: ones that would look legitimate near the top
# of an importance list while meaning something is wrong.
#
# These are the BASE names. Every peer-relative variant (_z, _pct, _pmr) is
# audited too, because a concern does not disappear when a feature is expressed
# relative to peers - it only changes shape. The first version of this list was
# written by hand, which meant the audit could only ever find problems that had
# already been guessed at. Expanding by suffix removes that blind spot.
WATCHED_BASE = {
    "bene_avg_age": "patient age - flags a practice's patient mix, not its billing",
    "peer_group_size": "an artefact of peer-group construction, not provider behaviour",
    "bene_avg_risk_score": "CMS risk score - partly a coding-intensity measure already",
    "ruca": "rural-urban location - a geography proxy",
}

# Plain-English names. Written out rather than generated, because a wrong guess
# here becomes a wrong sentence on a public page.
LABELS = {
    "ruca": "rural-urban location code",
    "tot_hcpcs_codes": "distinct procedure codes billed",
    "tot_beneficiaries": "patients",
    "tot_services": "services",
    "tot_submitted_charge": "submitted charges",
    "tot_medicare_allowed": "Medicare allowed amount",
    "tot_medicare_payment": "Medicare payment",
    "tot_medicare_standardized": "standardized Medicare payment",
    "bene_avg_age": "average patient age",
    "bene_avg_risk_score": "average patient risk score",
    "pay_per_service": "payment per service",
    "pay_per_bene": "payment per patient",
    "services_per_bene": "services per patient",
    "charge_to_payment": "charge-to-payment ratio",
    "peer_group_size": "peer group size",
}

MONEY = {"tot_submitted_charge", "tot_medicare_allowed", "tot_medicare_payment",
         "tot_medicare_standardized", "pay_per_service", "pay_per_bene"}

SUFFIXES = {"_z": "vs peers", "_pct": "peer percentile", "_pmr": "vs peer median"}


def split_suffix(feature: str) -> tuple[str, str]:
    """Return (base feature, suffix) - e.g. pay_per_bene_pct -> (pay_per_bene, _pct)."""
    for suffix in SUFFIXES:
        if feature.endswith(suffix):
            return feature[: -len(suffix)], suffix
    return feature, ""


def pretty(feature: str) -> str:
    base, suffix = split_suffix(feature)
    label = LABELS.get(base, base.replace("_", " "))
    return f"{label} ({SUFFIXES[suffix]})" if suffix else label


def watched_features(features: list[str]) -> dict[str, str]:
    """Every watched base feature present, plus its peer-relative variants."""
    watched = {}
    for feature in features:
        base, suffix = split_suffix(feature)
        if base in WATCHED_BASE:
            note = WATCHED_BASE[base]
            watched[feature] = f"{note} (expressed {SUFFIXES[suffix]})" if suffix else note
    return watched


def ordinal(n: int) -> str:
    """1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st, 82nd."""
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


def strength(percentile: float) -> str:
    """How emphatic the wording is allowed to be, given where the value sits.

    "Unusually high" is a strong claim about a named-if-not-identified provider,
    and the 71st percentile does not earn it. The wording is graded so that the
    adjective never outruns the evidence behind it.
    """
    for cutoff, wording in ((0.95, "unusually high"), (0.80, "high"),
                            (0.65, "above typical")):
        if percentile >= cutoff:
            return wording
    for cutoff, wording in ((0.05, "unusually low"), (0.20, "low"),
                            (0.35, "below typical")):
        if percentile <= cutoff:
            return wording
    return "typical"        # filtered out before this is ever printed


def phrase(feature: str, value: float) -> str:
    """One clause describing where this provider sits on this feature.

    The peer-relative features carry their own units and are worth stating
    precisely, because "97th percentile for its specialty" is evidence while
    "high payment per patient" is an opinion.

    The direction is said in words as well as numbers. A reader scanning a
    worklist should not have to work out for themselves that the 6th percentile
    is the unusual end - and for some metrics, such as charge-to-payment, it is
    the low end that the model finds suspicious.
    """
    base, suffix = split_suffix(feature)
    label = LABELS.get(base, base.replace("_", " "))
    if value is None or not np.isfinite(value):
        return f"{label} unavailable"
    if suffix == "_pct":
        # Clamped to 1-100: "0th percentile" reads as an error rather than as
        # the bottom of the range.
        rank = min(100, max(1, round(value * 100)))
        return f"{strength(value)} {label} ({ordinal(rank)} percentile of its peer group)"
    if suffix == "_z":
        side = "above" if value >= 0 else "below"
        return f"{label} {abs(value):.1f} SD {side} the peer mean"
    if suffix == "_pmr":
        return (f"{label} {value:.1f}x the peer median" if value >= 1
                else f"{label} {1 / value:.1f}x below the peer median" if value > 0
                else f"{label} at zero against a non-zero peer median")
    if base in MONEY:
        return f"{label} ${value:,.0f}"
    # Small-magnitude features (risk scores, ratios) lose their meaning when
    # rounded to whole numbers - a risk score of 1.4 is not "1".
    return f"{label} {value:,.1f}" if abs(value) < 100 else f"{label} {value:,.0f}"


def fit_model(df: pd.DataFrame, features: list[str], seed: int, neg_per_pos: int):
    """Reproduce the protocol's fit for one seed. Same split, same undersample."""
    train, test = grouped_split(df, 0.25, seed)
    balanced = undersample(train, neg_per_pos, seed)
    print(f"  train {len(train):>10,} rows -> balanced to {len(balanced):,} "
          f"({balanced[TARGET].mean():.1%} fraud)")
    print(f"  test  {len(test):>10,} rows ({int(test[TARGET].sum()):,} fraud, untouched)")

    pipe = make_xgboost(seed)
    pipe.fit(clean_matrix(balanced[features]), balanced[TARGET])
    return pipe, test


def shap_matrix(pipe, X: pd.DataFrame) -> np.ndarray:
    """SHAP values for the tree model inside the pipeline.

    TreeExplainer needs the bare booster and the matrix as the booster sees it,
    so the imputer is applied by hand first rather than passing the pipeline.
    """
    imputed = pipe.named_steps["impute"].transform(clean_matrix(X))
    explainer = shap.TreeExplainer(pipe.named_steps["clf"])
    values = explainer.shap_values(imputed)
    if isinstance(values, list):        # older shap returns one array per class
        values = values[1]
    return np.asarray(values)


def global_importance(values: np.ndarray, features: list[str]) -> list[dict]:
    """Rank features by mean absolute SHAP - how much each moves scores overall."""
    mean_abs = np.abs(values).mean(axis=0)
    total = mean_abs.sum() or 1.0
    order = np.argsort(mean_abs)[::-1]
    return [{
        "rank": i + 1,
        "feature": features[j],
        "label": pretty(features[j]),
        "mean_abs_shap": float(mean_abs[j]),
        "share": float(mean_abs[j] / total),
    } for i, j in enumerate(order)]


def bias_audit(values: np.ndarray, X: pd.DataFrame, features: list[str],
               importance: list[dict]) -> list[dict]:
    """For each watched feature: how much it matters, and which way it pushes.

    Importance alone does not settle anything. A feature can rank high and still
    be harmless. What matters is the DIRECTION: if higher patient age reliably
    pushes the risk score up, the model has learned "old patients are suspicious",
    and that is the finding that would block publication.
    """
    rank_of = {row["feature"]: row for row in importance}
    findings = []
    for feature, concern in watched_features(features).items():
        column = X[feature].to_numpy(dtype=float)
        contribution = values[:, features.index(feature)]
        ok = np.isfinite(column) & np.isfinite(contribution)

        # Spearman, because the relationship only has to be monotonic to matter.
        correlation = float(spearmanr(column[ok], contribution[ok]).statistic) if ok.sum() > 2 else 0.0
        high = np.quantile(column[ok], 0.9)
        low = np.quantile(column[ok], 0.1)
        entry = rank_of[feature]
        findings.append({
            "feature": feature,
            "label": pretty(feature),
            "concern": concern,
            "rank": entry["rank"],
            "share": entry["share"],
            "value_vs_shap_spearman": correlation,
            "mean_shap_top_decile": float(contribution[ok][column[ok] >= high].mean()),
            "mean_shap_bottom_decile": float(contribution[ok][column[ok] <= low].mean()),
            # A feature is only a problem if it carries real weight AND pushes
            # scores consistently in one direction.
            "flagged": bool(entry["rank"] <= 10 and abs(correlation) >= 0.3),
        })
    return sorted(findings, key=lambda row: row["rank"])


# Peer-relative forms in the order we prefer to say them out loud. A percentile
# is the easiest to read; the peer-median ratio is the next best; the z-score is
# the least intuitive and is only used if nothing else exists.
PREFERRED_FORMS = ("_pct", "_pmr", "_z")

# How far from the middle of the peer group a value has to sit before it is
# worth saying out loud. A metric at the 44th percentile contributed something
# to the score, but "44th percentile" is not a reason a reader can act on - it
# describes a typical provider. Anything inside this band is dropped from the
# sentence list; the full contribution is still in the SHAP output.
NOTABLE_PCT = 0.15          # i.e. outside the 35th-65th percentile
NOTABLE_PMR = 1.5           # or 1/1.5 below
NOTABLE_Z = 1.0


def is_notable(feature: str, value: float) -> bool:
    """Is this far enough from typical to be worth stating as a reason?"""
    if value is None or not np.isfinite(value):
        return False
    _, suffix = split_suffix(feature)
    if suffix == "_pct":
        return abs(value - 0.5) >= NOTABLE_PCT
    if suffix == "_pmr":
        return value >= NOTABLE_PMR or 0 < value <= 1 / NOTABLE_PMR
    if suffix == "_z":
        return abs(value) >= NOTABLE_Z
    return False


def reasons_for(shap_row: np.ndarray, feature_row: pd.Series, features: list[str],
                top_n: int = 4) -> list[str]:
    """Why THIS provider is on the list, in sentences a reader can check.

    Two rules, both of which exist because the output is public.

    ONE REASON PER METRIC. A metric appears in the feature set up to four times
    (raw, _z, _pct, _pmr). Ranking raw features by SHAP therefore produces lists
    that say the same thing twice in different units. Contributions are summed
    per underlying metric instead, so "payment per patient" is weighed once.

    NO BARE NUMBERS. "services per patient 6" is not a reason - the reader has no
    idea whether 6 is normal. Every reason is stated against the provider's peer
    group, so it carries its own yardstick. A metric with no peer-relative form
    is skipped rather than published without context, which is why patient age
    never appears here even when it contributes.
    """
    # Group each feature index under the metric it describes.
    by_metric: dict[str, dict[str, int]] = {}
    for i, feature in enumerate(features):
        base, suffix = split_suffix(feature)
        by_metric.setdefault(base, {})[suffix] = i

    scored = []
    for base, forms in by_metric.items():
        # Only positive contributions: the question is why this provider is
        # flagged, not what argued against it.
        total = sum(shap_row[i] for i in forms.values() if shap_row[i] > 0)
        if total <= 0:
            continue
        form = next((s for s in PREFERRED_FORMS if s in forms), None)
        if form is None:
            continue        # no peer-relative version exists - say nothing
        scored.append((total, base + form))

    scored.sort(reverse=True)
    notable = [(total, f) for total, f in scored if is_notable(f, feature_row.get(f))]

    # If nothing clears the bar, this provider was ranked on an accumulation of
    # ordinary-looking numbers rather than any single standout. Say that,
    # instead of dressing up a 44th percentile as evidence.
    if not notable:
        return ["no single peer-relative measure stands out; "
                "ranked on the combination of its billing pattern"]
    return [phrase(feature, feature_row.get(feature)) for _, feature in notable[:top_n]]


def main() -> int:
    ap = argparse.ArgumentParser(description="SHAP explanations and bias audit.")
    ap.add_argument("--in", dest="in_path", default=str(DEFAULT_IN))
    ap.add_argument("--seed", type=int, default=42,
                    help="single protocol seed; explanations do not need an error bar")
    ap.add_argument("--neg-per-pos", type=int, default=20)
    ap.add_argument("--sample", type=int, default=40000,
                    help="test rows sampled for global SHAP and the bias audit")
    ap.add_argument("--top", type=int, default=50,
                    help="top-ranked providers to write reasons for")
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)

    print(f"loading {Path(args.in_path).name} ...")
    df = pd.read_parquet(args.in_path).drop(
        columns=["last_or_org_name", "first_name"], errors="ignore")
    features = feature_columns(df)
    print(f"{len(df):,} rows | {len(features)} features | "
          f"{int(df[TARGET].sum()):,} fraud ({df[TARGET].mean():.4%})")

    print(f"\nfitting XGBoost on seed {args.seed} ...")
    pipe, test = fit_model(df, features, args.seed, args.neg_per_pos)

    # -- global importance and the bias audit, on a sample of held-out rows ---
    n = min(args.sample, len(test))
    sample = test.sample(n=n, random_state=args.seed)
    print(f"\ncomputing SHAP on {n:,} held-out rows ...")
    values = shap_matrix(pipe, sample[features])

    importance = global_importance(values, features)
    print("\n" + "=" * 68)
    print("GLOBAL IMPORTANCE (top 15)")
    print("=" * 68)
    for row in importance[:15]:
        print(f"  {row['rank']:>2}. {row['label']:<52s} {row['share']:>6.1%}")

    audit = bias_audit(values, sample[features], features, importance)
    print("\n" + "=" * 68)
    print("BIAS AUDIT")
    print("=" * 68)
    for row in audit:
        mark = "FLAG" if row["flagged"] else "ok  "
        direction = ("higher value -> higher risk" if row["value_vs_shap_spearman"] > 0
                     else "higher value -> lower risk")
        print(f"  [{mark}] {row['label']}")
        print(f"         rank {row['rank']} of {len(features)}, {row['share']:.1%} of total weight")
        print(f"         value vs contribution: r = {row['value_vs_shap_spearman']:+.2f}  ({direction})")
        print(f"         concern: {row['concern']}")

    flagged = [row for row in audit if row["flagged"]]
    print("\n  VERDICT: ", end="")
    if flagged:
        print(f"{len(flagged)} feature(s) flagged - "
              f"{', '.join(r['feature'] for r in flagged)}")
        print("  Decide before publishing: drop the feature and retrain, keep it with"
              "\n  the caveat stated on the site, or restrict what the worklist shows.")
    else:
        print("no watched feature is both influential and directional.")
    print("  Record the decision in PROJECT.md section 7 either way.")

    # -- per-provider reasons for the top of the worklist -------------------
    print(f"\nscoring {len(test):,} held-out rows for the worklist ...")
    scores = pipe.predict_proba(clean_matrix(test[features]))[:, 1]
    peak = aggregate_to_provider(test, scores)
    top = peak.nlargest(args.top, "score")

    # Pull each provider's trigger-year row back out of the test set.
    keyed = test.set_index([GROUP, "year"])
    trigger_rows = keyed.loc[list(zip(top[GROUP], top["trigger_year"]))]
    trigger_shap = shap_matrix(pipe, trigger_rows[features])

    worklist = []
    for i, (_, provider) in enumerate(top.iterrows()):
        row = trigger_rows.iloc[i]
        worklist.append({
            "rank": i + 1,
            "score": float(provider["score"]),
            "trigger_year": int(provider["trigger_year"]),
            # Privacy rule: specialty, state and year only. No NPI, no names.
            "specialty": str(row.get("provider_type", "")),
            "state": str(row.get("state", "")),
            "known_fraud": bool(provider[TARGET]),
            "reasons": reasons_for(trigger_shap[i], row, features),
        })

    print("\n" + "=" * 68)
    print(f"TOP {min(5, len(worklist))} PROVIDERS (sample of the worklist)")
    print("=" * 68)
    for entry in worklist[:5]:
        label = " [known fraud]" if entry["known_fraud"] else ""
        print(f"  {entry['rank']}. {entry['specialty']}, {entry['state']}, "
              f"{entry['trigger_year']}  score {entry['score']:.3f}{label}")
        for reason in entry["reasons"]:
            print(f"       - {reason}")

    MODEL_DIR.mkdir(exist_ok=True)
    out = MODEL_DIR / "shap_explanations.json"
    out.write_text(json.dumps({
        "seed": args.seed,
        "model": "XGBoost",
        "n_features": len(features),
        "sample_rows": n,
        "note": ("Explanations come from a single seeded fit. Reported metrics "
                 "still come from the 10-seed protocol in models/metrics.json."),
        "global_importance": importance,
        "bias_audit": audit,
        "worklist_sample": worklist,
    }, indent=2))
    print(f"\nsaved {out}")
    print("Next: decide the bias audit open item, then python src/score_providers.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
