# Medicare Provider Risk Analytics

Rank Medicare providers by how unusually they bill for their specialty, explain
every flag in plain language, and publish the result as a public site.

**7.3M provider-years · 1.67M providers · 46 features · 486 known exclusions**

Built on CMS Medicare Physician & Other Practitioners data (2019–2024), labelled
against the OIG List of Excluded Individuals and Entities.

> **Nobody on the published list is accused of anything.** A high rank means the
> billing pattern is unusual for the specialty. Unusual billing has many
> innocent explanations, and the published files carry no NPI and no names.

---

## Results

Provider level, XGBoost, averaged over ten fixed train/test splits:

| Metric | Value |
|---|---|
| ROC-AUC | 0.801 ± 0.013 |
| Known fraud in the top 1% | 16.8% ± 2.7% |
| Known fraud in the top 5% | 37.5% ± 3.2% |
| Precision at top 1% | 0.48%, about 17× random |

Each layer roughly doubles the one below:

| Ranked by | Top 1% recall |
|---|---|
| random | 1.0% |
| best single raw column (`pay_per_bene`) | 5.6% |
| best peer-relative column | 9.4% |
| full model | **17.5%** |

Report the range, not the point estimate: across the ten splits, provider top-1%
recall runs 11.7% to 21.8%. Only ~120 labelled fraud providers exist per test
split, and no number of seeds removes that.

## Two findings worth more than the headline number

**The model reconstructed `year` after it was withheld.** Labels are gated to
`year <= exclusion_year`, so training positives cluster in early years, and the
raw features drift with time. On clean, unlabelled rows the model scores 2019
about 2.2× higher than 2024. The published worklist therefore ranks a single
calendar year, so the bias is identical for everyone listed and drops out of the
ordering.

**Predicting forward is harder than random splits suggest.** Trained only on
providers excluded by 2022 and tested on 346 providers excluded later — none
ever seen labelled — it finds 11.7% ± 1.4% in the top 1%, against 16.8% on
random splits. Still ~12× random, but the headline figure flatters it.

The obvious version of that second test was wrong, and the trap is documented in
`src/temporal_check.py`: splitting on *billing* year scores 23.5%, because a
provider excluded in 2024 is labelled fraud in every earlier year too, so 98 of
100 test positives had already been seen during training.

## The bias audit

Two features were removed at step 6 after ranking in the model's top four:

- `peer_group_size` — a fact about how the peer features were built, not about
  any provider
- `bene_avg_risk_score` — rose with the score, meaning sicker patient panels
  looked more like fraud

Removing both cost 0.9 points of top-1% recall, well inside the ±2.7 spread.

`bene_avg_age` was kept: the concern was that geriatric and hospice practices
would be flagged for their patient mix, and the audit found the opposite —
older patients push the score *down*.

## Pipeline

```
src/download_data.py     CMS Part B 2019-2024 + LEIE          -> data/raw/
src/build_dataset.py     join, apply the timing rule          -> 7,302,541 rows
src/prepare_data.py      clean, + 4 ratio features
src/build_features.py    + 33 peer-relative features
src/train_model.py       10 seeds x 3 models                  -> models/metrics.json
src/explain_shap.py      SHAP + bias audit                    -> models/shap_explanations.json
src/score_providers.py   5-fold OOF scoring, site export      -> data/site/
web/                     Next.js site
```

Two supporting scripts sit outside the seven: `baseline.py` establishes the
single-column floor, `temporal_check.py` measures forward-in-time performance.

## Running it

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt

.venv/bin/python src/download_data.py      # ~2.7 GB, slow
.venv/bin/python src/build_dataset.py
.venv/bin/python src/prepare_data.py
.venv/bin/python src/build_features.py
.venv/bin/python src/train_model.py        # ~12 min, all 3 models
.venv/bin/python src/explain_shap.py       # ~15 s
.venv/bin/python src/score_providers.py    # ~45 s
```

Then the site:

```bash
cd web
npm install
npm run sync-data     # copy data/site/*.json into public/
npm run build-map     # project US boundaries to SVG, once
npm run dev
```

Data and model binaries are not committed. Everything under `data/` is
regenerable from `download_data.py`; models are refit from their seed rather
than persisted, which is why `explain_shap.py` retrains instead of loading.

## Design decisions

`PROJECT.md` is the source of truth. Every decision is recorded there with the
reason behind it, including the ones that turned out wrong. The working
agreements it opens with:

- Outliers are the signal. Never smooth them away.
- The provider is the unit of the worklist.
- Top-k over the ranking unit is the metric. Not accuracy.
- Every flag must be explainable, or it does not ship.
- No result is reported from a single split.
- Nothing identifying a real provider goes into a published file.

## Limitations

A positive label does not mean a provider committed fraud. It means they were
caught, excluded by the OIG, and recorded with a usable NPI. Of 83,665 LEIE
records, 74,898 carry a placeholder NPI and cannot be joined at all; 4,329 are
fraud-related; 486 appear in Part B billing data. Everything downstream inherits
those filters, and precision here is a floor rather than the truth, because most
real fraud is unlabelled and sits in the data as clean.

The LEIE snapshot is dated 2026-07-31. The list refreshes monthly, so labels
shift over time and any figure above is tied to that date.

Full list in `PROJECT.md` section 6.
