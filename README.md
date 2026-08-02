# Medicare Provider Risk Analytics

An end-to-end pipeline that turns six years of real Medicare billing data into a
**ranked, explained worklist of providers whose billing is unusual for their
specialty**, published as a live public site.

**One-line pitch:** Nobody can review 1.67 million providers. Make the reviewable
slice as dense with real signal as possible, and state a reason for every flag.

```
CMS Part B  ->  Label (OIG LEIE)  ->  Clean  ->  Peer features  ->  Models  ->  Ranked worklist  ->  SHAP reasons
```

**Live:** [medicare-provider-risk-analytics.vercel.app](https://medicare-provider-risk-analytics.vercel.app)

**Author:** Shruti Pingle

---

## The idea

The goal is not to detect all fraud. An investigator has a fixed budget and can
only ever open cases on a small fraction of providers, so the useful question is
**which few hundred are worth looking at first, and why.** That reframing drives
every technical choice, which is why the headline metric is **recall in the top
k**, not accuracy.

Accuracy is not reported anywhere in this project. At a prevalence of 0.029% a
model can be 99.97% accurate by calling everyone clean.

The unit of the worklist is the **provider**, not the provider-year. An
investigator opens a case on a doctor, not on a doctor-year.

## Data: real-world, not a toy dataset

| Role | Source |
|---|---|
| Features | CMS Medicare Physician & Other Practitioners, by Provider, 2019–2024 |
| Labels | HHS OIG List of Excluded Individuals/Entities (LEIE), joined on NPI |

- **7,302,541** provider-years, **1,668,394** unique providers, **113** specialties
- **486** providers carry a billing-fraud exclusion — a rate of **0.029%**
- LEIE snapshot: **2026-07-31**. The list refreshes monthly, so labels shift over
  time and every published figure is tied to that date.

**What counts as fraud.** Only exclusions under `1128a1`, `1128a3`, `1128b1`,
`1128b7` and `1128b8`. Licence-only revocation (`1128b4`) is deliberately
excluded, along with controlled-substance convictions, patient abuse and loan
default. Including `1128b4` alone would have grown the positive set by roughly
60%, but losing a medical licence is not billing fraud and the model would have
learned the wrong target.

**Timing rule.** A provider-year is labeled fraud only where
`year <= exclusion_year`, so the model learns pre-exclusion billing rather than
the collapse in billing that follows being barred.

**What a positive really means.** Not "committed fraud" but "was caught,
convicted, excluded, and recorded with a usable NPI." Of 83,665 LEIE records,
74,898 carry a placeholder NPI and cannot be joined at all; 4,329 joinable
records are fraud-related; 486 of those appear in Part B billing data. Everything
downstream inherits those four filters.

## Pipeline

Raw and processed data are not committed — all of it is regenerable.

```bash
pip install -r requirements.txt

# 1. Download CMS Part B (per year) + OIG LEIE into data/raw/   (~2.8 GB)
python src/download_data.py --all

# 2. Join CMS + LEIE into a labeled provider-year panel
python src/build_dataset.py --years 2019,2020,2021,2022,2023,2024

# 3. Quality checks, conservative cleaning, + 4 ratio features
python src/prepare_data.py --in data/processed/provider_year_panel_2019_2024.parquet

# 4. Peer-relative features (z-score / percentile / peer-median ratio)
python src/build_features.py --in data/processed/provider_year_panel_2019_2024_clean.parquet

# 5. Train + evaluate on the locked ten-seed protocol
python src/train_model.py --in data/processed/provider_year_panel_2019_2024_features.parquet

# 6. SHAP explanations and the bias audit
python src/explain_shap.py --in data/processed/provider_year_panel_2019_2024_features.parquet

# 7. Out-of-fold scores for every provider -> data/site/
python src/score_providers.py --in data/processed/provider_year_panel_2019_2024_features.parquet --year 2024

# 8. Site
cd web && npm install && npm run sync-data && npm run dev
```

Two supporting scripts sit outside the eight. `baseline.py` ranks by single raw
columns to establish a floor. `temporal_check.py` measures whether the model
works forward in time, which the locked protocol cannot see.

## Feature engineering

**46 features in the final model**, in two layers.

**Layer 1 — ratios.** Payment per beneficiary, services per beneficiary, payment
per service, beneficiaries per service. Raw totals mostly measure practice size;
ratios measure behaviour.

**Layer 2 — peer-relative.** Every headline measure is recomputed against the
provider's own specialty within the same year, as a z-score, a percentile, and a
ratio to the peer median. A dermatologist billing like a dermatologist looks
ordinary; a dermatologist billing like nobody else in dermatology does not. This
is what stops the model from simply flagging large practices.

Peer groups below 30 providers have all three variants damped together to their
neutral values. Damping only some of them would leave the undamped one signalling
which rows had been damped.

**Two features were removed after the bias audit**, both from the top four by
SHAP importance: `peer_group_size`, an artefact of how the peer features were
built rather than a fact about any provider, and `bene_avg_risk_score`, which
rose with the score (r = +0.49), meaning sicker patient panels looked more like
fraud. Removing both cost 0.9 points of top-1% recall — well inside the ±2.7
spread — so nothing measurable was traded away.

## Modeling and results

**Chosen model: XGBoost.** Best at the provider level, and the model that
degrades least when scores are collapsed to one per provider.

**Provider level** (417,099 providers per split, ~120 known fraud):

| Model | ROC-AUC | top 1% | top 5% | top 10% |
|---|---|---|---|---|
| **XGBoost** | **0.801 ± 0.013** | **16.8% ± 2.7%** | **37.5% ± 3.2%** | **50.4% ± 3.6%** |
| GradientBoosting | 0.776 ± 0.014 | 14.5% ± 2.8% | 35.3% ± 2.5% | 47.1% ± 3.2% |
| LogisticRegression | 0.739 ± 0.019 | 11.8% ± 2.3% | 28.0% ± 3.5% | 40.7% ± 3.6% |

**Against a floor** (provider-year, top 1%):

| Ranked by | top 1% |
|---|---|
| random | 1.0% |
| `pay_per_bene`, raw column, no model | 5.6% |
| best peer-relative column | 9.4% |
| full model | **17.5%** |

Each layer roughly doubles the one below. The model is 3.1x the best
single-column heuristic.

**Forward in time**, splitting providers by exclusion year rather than billing
year: ROC-AUC 0.779 ± 0.003, top-1% recall 11.7% ± 1.4%. The model degrades
predicting forward but does not collapse — still about 12x random. The forward
test trains on 140 positives against the protocol's 486, so part of that gap is
less training signal rather than worse generalisation; treat it as an upper
bound on the cost of predicting forward.

### Evaluation protocol (locked)

- **10 grouped train/test splits**, so no provider appears on both sides. Five
  was not enough: two different sets of five seeds disagreed by more than the
  standard deviation either set reported.
- **Fixed, published seed list:** `42, 1, 7, 13, 99, 2, 5, 11, 23, 77`
- **Mean ± standard deviation, never a single run.** Every split's metrics are
  stored in `models/metrics.json`.
- **Random undersampling to 20:1, training side only.** The test set stays at
  true prevalence.
- The seed list is never changed to improve a result. If it changes, every
  reported number is regenerated.

**Published scores come from a different regime, deliberately.** The protocol
measures on held-out rows, but a worklist has to rank everyone and no held-out
set contains everyone. `score_providers.py` uses grouped 5-fold cross-validation
so every published score comes from a model that never saw that provider, and
every provider gets one. No number produced by the scoring run is ever quoted as
a performance result.

### Known limitations

1. Precision is ~0.48% at top 1% — about 17x random at this prevalence, and a
   floor rather than the truth, because most real fraud is unlabeled and sits in
   the data as clean.
2. Report the range, not the point estimate. Top-1% recall spans 11.7% to 21.8%
   across splits, driven by having only ~120 labeled positives per test split.
3. The 20:1 undersampling ratio is untuned.
4. 2024 labels are the least complete, because investigations take years.
5. **The model reconstructed `year` after it was withheld.** It scores 2019
   billing roughly twice as high as 2024 billing even on providers with no
   exclusion record. That is why the published worklist ranks a single calendar
   year: within one year the bias is identical for everyone and cancels out of
   the ordering. The untested fix is a peer-features-only model.

## Privacy

`providers.json` **must not contain NPI or provider names**, and that rule is
enforced in code — the writer refuses a file carrying an identifying column.

That is not sufficient on its own. **Specialty plus state is itself an
identifier once the cell is small enough.** Of the 5,000 published rows, one sat
in a cell of exactly one and ten more in cells of two to four. Any row whose
specialty × state cell holds fewer than **11** providers is therefore published
without its state — the same cell-suppression threshold CMS applies to the
public use files this data comes from.

Anonymity is a property of the *combination* of published fields, not of any one
field. Removing the obvious identifier is the start of the check, not the end.

## Method at a glance

| | |
|---|---|
| Target | OIG exclusion under a billing-fraud statute, joined on NPI |
| Unit of the worklist | Provider (their most suspicious year) |
| Headline metric | Recall in the top k, k = 1% / 5% / 10% |
| Imbalance | Random undersampling 20:1, training side only |
| Validation | 10 grouped splits, fixed seeds, mean ± sd |
| Published scores | Grouped 5-fold, out-of-fold for every provider |
| Explanations | SHAP, one reason set per flagged provider |

## Repository contents

```
src/
  download_data.py     CMS Part B + OIG LEIE -> data/raw/
  build_dataset.py     join + label -> provider-year panel
  prepare_data.py      cleaning + Layer 1 ratio features
  build_features.py    Layer 2 peer-relative features
  train_model.py       the locked protocol; writes models/metrics.json
  explain_shap.py      SHAP importances + the bias audit
  score_providers.py   out-of-fold scores -> data/site/
  baseline.py          single-column floor
  temporal_check.py    forward-in-time evaluation
models/                metrics and explanations, kept as a record
data/site/             the three JSON files the site reads
web/                   Next.js site (4 pages)
PROJECT.md             every decision and the reason behind it
```

## Tech stack

Python, pandas, NumPy, scikit-learn, XGBoost, SHAP, PyArrow. Site: Next.js,
TypeScript, Tailwind CSS, D3-geo, deployed on Vercel. No model binaries are
committed — the split, the undersample draw and the model are all seeded, so a
seed reproduces a model exactly.

## Acknowledgments

**Data.** The [Centers for Medicare & Medicaid Services](https://data.cms.gov/provider-summary-by-type-of-service/medicare-physician-other-practitioners)
publish the Physician & Other Practitioners files used here, and the
[HHS Office of Inspector General](https://oig.hhs.gov/exclusions/) publish the
LEIE exclusion list. Both are open public-use data.

**Methods.** The approach follows established work from the Medicare fraud
detection literature, primarily the group of **Taghi M. Khoshgoftaar** at Florida
Atlantic University:

- **Matthew Herland, Taghi M. Khoshgoftaar, Richard A. Bauder.** *Big Data fraud
  detection using multiple Medicare data sources* (Journal of Big Data, 2018) —
  basis for labeling CMS Part B with the LEIE on NPI.
- **Richard A. Bauder, Taghi M. Khoshgoftaar.** *The effects of class rarity on
  the evaluation of supervised healthcare fraud detection models* (Journal of Big
  Data, 2019) — basis for leading with top-k over accuracy.
- **Justin M. Johnson, Taghi M. Khoshgoftaar.** *Medicare fraud detection using
  neural networks* (Journal of Big Data, 2019) — basis for random undersampling
  under extreme class imbalance.
- **John T. Hancock, Taghi M. Khoshgoftaar.** *Explainable machine learning
  models for Medicare fraud detection* (Journal of Big Data, 2023) — basis for
  per-provider SHAP explanations.

**Tools.** scikit-learn, XGBoost and SHAP, and the maintainers of each.

---

See [`PROJECT.md`](PROJECT.md) for the full decision log, including the choices
that were reversed and why.
