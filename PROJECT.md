# Medicare Provider Risk Analytics
## Project source document

**Goal:** Rank Medicare providers by fraud risk, explain every flag, and publish
the result as a live public site.

**Status:** shipped 2026-08-01. All eight steps complete, site live at
`medicare-provider-risk-analytics.vercel.app`. Deploys are CLI-only for now -
the GitHub repo is not connected to Vercel, and connecting it needs Root
Directory set to `web`.

> This file is the single source of truth. Decisions get recorded here with the
> reason behind them, so nothing has to be re-derived or re-argued later.

---

## 1. Scope

**In:** CMS Part B billing data 2019-2024, OIG LEIE labels, peer-relative
features, three supervised models, SHAP explanations, static JSON export, a
Next.js site on Vercel.

**Out (v1):** PU learning, anomaly detection, temporal trajectory features,
backend, database, live prediction, auth.

**Parked for v2:** PostgreSQL, FastAPI, live scoring, real-time querying.

---

## 2. Data

| Role | Source |
|---|---|
| Features | CMS Medicare Physician & Other Practitioners, by Provider, 2019-2024 |
| Labels | OIG LEIE exclusion list, joined on NPI |

**Fraud label** = excluded under `1128a1`, `1128a3`, `1128b1`, `1128b7`, `1128b8`.

License-only revocation (`1128b4`) is **deliberately excluded**, along with
controlled-substance convictions (`1128a4`), patient abuse (`1128a2`) and loan
default (`1128b14`). Including `1128b4` alone would have grown the positive set
by roughly 60%, but losing a medical licence is not billing fraud, and the model
would have learned the wrong target.

**Timing rule:** a provider-year is labeled fraud only when
`year <= exclusion_year`, so the model learns pre-exclusion billing rather than
the collapse in billing that follows being barred.

**Label reality, to be stated plainly in the write-up.** A positive does not mean
"committed fraud". It means "was caught, convicted, excluded, and recorded with a
usable NPI". Of 83,665 LEIE records, 74,898 carry a placeholder NPI and cannot be
joined at all; 4,329 joinable records are fraud-related; 486 of those appear in
Part B billing data. Everything downstream inherits those four filters.

**LEIE snapshot: downloaded 2026-07-31.** The list refreshes monthly, so labels
shift over time. Any published number should cite this date.

---

## 3. Decisions

### Evaluation protocol (locked)

- **10 grouped train/test splits.** Five was not enough: two different sets of
  five seeds disagreed by more than the standard deviation either set reported,
  so the n=5 error bar was not trustworthy. Confirmed empirically, not assumed.
- **Fixed published seed list:** `42, 1, 7, 13, 99, 2, 5, 11, 23, 77`
- **Report mean +/- standard deviation.** Never a single run.
- **Store every split's metrics** in `models/metrics.json`.
- **Select the final model on averaged performance.**
- **Results reported standalone.** No comparison to any other project.
- The seed list is never changed to improve a result. If it changes, every
  reported number is regenerated and the change is logged here.

**Interpretation caveat.** Provider top-1% recall ranges 11.7% to 21.8% across
the ten splits. The band is driven by having only ~120 labeled fraud providers
per test split, which no number of seeds removes. Report the range, not the
point estimate.

### No model files. Refit from the seed instead.

`train_model.py` fits a fresh model per seed and saves none of them, which left
step 6 with nothing to load. The fix is not to start saving `.joblib` files: the
split, the undersample draw and the model are all seeded, so the same seed
reproduces the same model exactly. `explain_shap.py` refits rather than loads,
and takes 15 seconds to do it. Persistence would be a cache, and it is not
needed yet.

### Explanations run on one seed. Reported numbers still run on ten.

The locked protocol governs every published metric. It does not govern
explanations, which answer "what is this model paying attention to" - a question
that does not need an error bar. `explain_shap.py` therefore uses a single
protocol seed (42). Any number quoted as a result still comes from
`models/metrics.json` and all ten seeds.

### Ranking unit: the provider

The model trains on provider-years, but **the worklist ranks providers**, one row
each. A provider's score is their **most suspicious year**, and that trigger year
travels with the record as evidence.

This is a product decision, not a metric one. An investigator opens a case on a
doctor, not on a doctor-year. Leaving the worklist at provider-year level means
one doctor occupies several slots while other providers never appear at all.

`max` is used because "this provider's worst year is what merits a look" is the
right definition of provider risk, not because it scored best.

Metrics are reported at **both** levels so nothing is hidden.

**The published worklist ranks one calendar year instead, and 2024 by default.**
The worst-year rule above still describes how *metrics* are computed - it is the
protocol's provider-level aggregation and nothing there has changed. It is no
longer how the *site* ranks, and the reason is limitation 6.

The model scores 2019 rows about 2.2x higher than 2024 rows even on clean,
unlabeled providers. Any ranking that lets providers compete across years turns
that into rank order: the worst-year worklist came out 37.8% year-2019 and 4.8%
year-2024, which reads as a historical list rather than a current one. Within a
single year the bias is identical for everyone on the list, so it cancels out of
the ordering.

"Each provider's most recent year" would not work, because a provider who
stopped billing in 2020 would enter on a 2020 score and the year mixing returns
for exactly the providers it hurts most. It has to be one calendar year.

The cost is coverage: 1,296,739 of 1,668,394 providers billed in 2024, so 78% of
them are rankable. Dropping providers who no longer bill Medicare is the correct
loss for a list meant to be acted on.

The cost in verifiability is real and must be stated on the site: only 52
providers carry a 2024 fraud label, against 486 across the panel, because
investigations take years. The 2024 list is the most useful view and the least
checkable one at the same time. Hit rate is unchanged - 4 of 52 in the top
5,000, against 35 of 486 for the worst-year list, both about 7.5%.

This mitigates the bias in the ordering. It does not remove it from the model.
The fix for that is the peer-features-only model in section 7.

### Imbalance handling

Random undersampling to 20 clean rows per fraud row, **training side only**. The
test set stays untouched at true prevalence (~0.018%). All three models are
trained under the same regime so the comparison is like-for-like.

The 20:1 ratio is a common default and has **not** been tuned. Say so.

### Excluded from features

`year` is withheld. Because positives are gated to years at or before exclusion,
2019 carries ~10x the fraud rate of 2024. A model given `year` would learn how
the labels were built rather than how anyone billed.

Also withheld: `fraud_label`, `excluded_any`, `excl_year`, `npi`.

### Two features removed after the bias audit

`peer_group_size` and `bene_avg_risk_score` were **dropped at step 6**, taking the
feature count from 48 to 46. Both ranked in the model's top four by SHAP
importance, and neither describes how a provider billed:

- `peer_group_size` is a fact about how the peer features were constructed, not
  about any provider. A model leaning on it is reading the pipeline.
- `bene_avg_risk_score` rose with the score (r = +0.49 between feature value and
  SHAP contribution), meaning sicker patient panels looked more like fraud.

**Cost of removing both: 0.9 points of provider top-1% recall, well inside the
+/-2.7 spread, with top-5% unchanged.** The loss cannot be distinguished from
noise, so nothing measurable was traded away. Ablation runs are kept in
`models/ablation_*.json`.

### The peer-relative risk-score features are kept

`bene_avg_risk_score_z`, `_pct` and `_pmr` **stay in**, and this was a decision
rather than an oversight - the audit flags `_pct` at rank 4 with r = +0.70, a
stronger signal than the raw feature it replaced.

The reason is that the peer version measures something different. Raw patient
risk score says "my patients are sick", which is patient mix. The peer-relative
version says "my patients are recorded as sicker than my same-specialty peers",
which is the signature of **upcoding** - and upcoding is billing behaviour, one
of the more common forms of Medicare fraud.

The audit cannot separate a real fraud signal from a demographic proxy, because
here they look identical. The tiebreaker is that this one has a mechanism behind
it. Dropping the three would cost a further 1.0 point, also inside the spread, so
the choice was free either way and is recorded here rather than left implicit.

**This must be stated on the site:** the model uses patient risk score relative
to specialty peers.

### Peer-group damping

Peer groups below 30 providers have `_z`, `_pct` and `_pmr` all damped together
to their neutral values. Damping only some of them would leave the undamped one
signalling which rows had been damped, which is information about the data
processing rather than about the provider. Affects 495 rows (0.007%), none of
them positives.

### Published scores come from k-fold, not from the protocol

The protocol measures on held-out rows, but a worklist has to rank *everyone*,
and no held-out set contains everyone. `score_providers.py` therefore uses
5-fold grouped cross-validation: each provider sits in exactly one fold and is
scored by a model trained on the other four. Every published score comes from a
model that never saw that provider, and every provider gets one.

Reusing the ten protocol seeds would not work. They are ten independent random
25% splits, so a provider has a 0.75^10 = 5.6% chance of never being held out -
about 93,000 providers with no honest score available.

To keep the two regimes straight:

| | governed by |
|---|---|
| reported metrics | the ten-seed protocol, `models/metrics.json` |
| published scores | grouped 5-fold, `data/site/` |

No number produced by the scoring run is ever quoted as a performance result.

### Privacy: dropping the identifiers is not enough

`providers.json` **must not contain NPI or provider names.** That rule was
written first and is enforced in code - `check_privacy` refuses to write a file
carrying an identifying column.

It is not sufficient. **Specialty plus state is itself an identifier once the
cell is small enough.** Checked before the first public deploy: of the 5,000
published rows, one sits in a cell of exactly one - there is a single
`Oral Surgery (Dentist only)` provider in New Mexico - and ten more sit in cells
of two to four. Publishing those rows names a specific, findable person as one
of the most unusual billers in the country, with no NPI required.

Any row whose specialty x state cell holds fewer than **11** providers is
therefore published without its state. It keeps its rank and its reasons and
loses only the geography that would pin it to a person. Eleven is CMS's own
cell-suppression threshold for the public use files this data comes from, so the
rule the source applies is applied downstream too.

The general lesson, worth keeping: anonymity is a property of the *combination*
of published fields, not of any one field. Removing the obvious identifier is
the start of the check, not the end of it.

### Privacy

`providers.json` **must not contain NPI or provider names.** The site shows
specialty, state, trigger year and reasons. Almost every high-scoring provider
has no exclusion record, and a public page must not name real doctors as likely
fraudsters.

---

## 4. Pipeline

| # | Script | Output | Status |
|---|---|---|---|
| 1 | `download_data.py` | `data/raw/`, 2.8 GB | done |
| 2 | `build_dataset.py` | 7,302,541 provider-years, 1,379 fraud | done |
| 3 | `prepare_data.py` | cleaned, + 4 ratio features | done |
| 4 | `build_features.py` | + 33 peer features, 59 columns | done |
| 5 | `train_model.py` | `models/metrics.json` | done |
| 6 | `explain_shap.py` | `models/shap_explanations.json` | done |
| 7 | `score_providers.py` | `data/site/`, 3 JSON files | done |
| 8 | `web/` | 4-page site, `web/` | done, deployed |

Two supporting scripts sit outside the seven. `baseline.py` ranks by single raw
columns to establish a floor. `temporal_check.py` measures whether the model
works forward in time, which the locked protocol cannot see.

---

## 5. Results so far

**All numbers below are the 46-feature model**, regenerated on the full ten-seed
protocol after the step 6 bias audit removed `peer_group_size` and
`bene_avg_risk_score`. The pre-audit 48-feature run is kept for comparison in
`models/metrics_48features_preaudit.json`.

**Chosen model: XGBoost.** Best at the provider level, and the model that
degrades least when scores are collapsed to one per provider (-0.7 points,
versus -2.2 for GradientBoosting), which suggests its year-to-year scores are
more stable.

**Provider level** (417,099 providers per split, ~120 known fraud):

| Model | ROC-AUC | top 1% | top 5% | top 10% |
|---|---|---|---|---|
| **XGBoost** | **0.801 +/- 0.013** | **16.8% +/- 2.7%** | **37.5% +/- 3.2%** | **50.4% +/- 3.6%** |
| GradientBoosting | 0.776 +/- 0.014 | 14.5% +/- 2.8% | 35.3% +/- 2.5% | 47.1% +/- 3.2% |
| LogisticRegression | 0.739 +/- 0.019 | 11.8% +/- 2.3% | 28.0% +/- 3.5% | 40.7% +/- 3.6% |

**Provider-year level** (1,826,740 rows per split, ~336 known fraud):

| Model | ROC-AUC | top 1% | top 5% | top 10% |
|---|---|---|---|---|
| XGBoost | 0.820 +/- 0.011 | 17.5% +/- 2.1% | 39.3% +/- 2.9% | 52.8% +/- 2.7% |
| GradientBoosting | 0.798 +/- 0.014 | 16.7% +/- 2.2% | 36.8% +/- 3.2% | 48.4% +/- 2.9% |
| LogisticRegression | 0.760 +/- 0.020 | 12.6% +/- 2.5% | 29.7% +/- 3.0% | 43.6% +/- 3.6% |

**Effect of the audit.** Provider top-1% moved 17.7% -> 16.8% and ROC-AUC 0.807
-> 0.801. Both shifts are far inside the +/-2.7 and +/-0.013 spreads, so the two
removed features bought nothing that can be measured. The model ordering is
unchanged.

**Baseline floor** (provider-year, top 1%):

| Ranked by | top 1% |
|---|---|
| random | 1.0% |
| `pay_per_bene`, raw column, no model | 5.6% |
| best peer-relative column (`tot_medicare_payment_pct`) | 9.4% |
| full model | **17.5%** |

Each layer roughly doubles the one below. The model is 3.1x the best
single-column heuristic. The single-column rows come from `baseline.py` and are
unaffected by the feature drop; the model row is from the current
`models/metrics.json`, not the older figure stored inside
`models/baseline_metrics.json`.

**Forward in time** (`temporal_check.py`, providers split by exclusion year -
caught by 2022 train, caught 2023+ held out, 346 test positives never seen
labeled):

| Test | ROC-AUC | top 1% | top 5% | top 10% |
|---|---|---|---|---|
| Random split (protocol) | 0.801 +/- 0.013 | 16.8% +/- 2.7% | 37.5% | 50.4% |
| **Forward in time** | **0.779 +/- 0.003** | **11.7% +/- 1.4%** | **30.5% +/- 1.5%** | **43.8% +/- 1.4%** |

The model degrades predicting forward but does not collapse: 11.7% at top 1% is
still about 12x random. This is the number limitation 3 previously only asserted
in prose.

**State the confound with the number.** The forward test trains on 140
positives against the protocol's 486, so part of the 16.8 -> 11.7 gap is less
training signal rather than worse generalisation. Treat the gap as an upper
bound on the cost of predicting forward, not a measurement of it.

**Peer feature lift.** Fraud providers land in their specialty's top 5% on
payment-per-patient 4.6x more often than clean providers (22.8% vs 5.0%).

**Fraud vs clean, medians.** Services per patient 6.63 vs 2.72. Payment per
patient $340 vs $178.

---

## 6. Known limitations, to appear in the write-up

1. **Precision is ~0.48% at top 1%** (provider level). That is ~17x random at
   this prevalence (0.029%), and it is a floor rather than the truth, because
   most real fraud is unlabeled and sits in the data as clean.
2. **Report the range, not the point estimate.** See the protocol caveat above.
3. **Random splits flatter the result, and by how much is now measured.**
   Forward in time the model gets 11.7% +/- 1.4% at provider top 1%, against
   16.8% +/- 2.7% on random splits. See section 5, including the training-size
   confound that makes that gap an upper bound.

4. **The 20:1 undersampling ratio is untuned.**
5. **The 2024 labels are the least complete.** Investigations take years, so
   providers committing fraud in 2024 are mostly not excluded yet.
6. **`year` was withheld, and the model reconstructed it anyway.** On clean,
   unlabeled rows it scores 2019 about 2.2x higher than 2024 (mean 0.032 vs
   0.014) and puts 2019 rows in its top 1% 4.5x as often - even though the
   underlying panel is nearly flat across years, 15.8% to 17.8% of rows each.

   The mechanism: positives are gated to `year <= exclusion_year` so training
   fraud concentrates in early years, and the raw non-peer features drift with
   time, which lets the model infer the year from payment levels and volumes.
   The five features it leans on hardest are all raw rather than peer-relative,
   which is consistent - the peer features are computed within specialty x year
   and are year-neutral by construction.

   **Consequence for the site:** the published worklist is 37.8% year-2019 and
   only 4.8% year-2024, so it reads as a historical list rather than a current
   one. The untested fix is a peer-features-only model, which would remove the
   drift by construction at some cost in accuracy. Recorded as future work
   rather than attempted.

---

## 7. Open items

- ~~**Bias audit** at step 6.~~ **Done, and the guess was wrong.** `bene_avg_age`
  does drive the model (rank 3), but in the *opposite* direction to the concern:
  r = -0.78, so older patients push the risk score **down**. Geriatric and
  hospice practices are not being flagged for their patient mix - if anything
  they are protected. `bene_avg_age` is therefore kept.

  The audit found two different problems instead, `peer_group_size` and
  `bene_avg_risk_score`, both now dropped. See section 3.

  **Lesson worth keeping:** the first version of the audit checked a hand-written
  list of four suspect features, so it could only ever confirm or deny what had
  already been guessed. It stayed silent on the peer-relative risk-score
  features, and silence read as approval. The audit now expands every watched
  feature to its `_z`/`_pct`/`_pmr` variants automatically, which immediately
  surfaced `bene_avg_risk_score_pct` at rank 4.
- ~~Whether to report a temporal split as a limitation number.~~ **Done, and the
  obvious version of the test was wrong.** Splitting on *billing* year - fit
  2019-2022, test 2023-2024 - returns 23.5%, well above the headline. That
  number is invalid: a provider excluded in 2024 is labeled fraud in every
  earlier year too, so 98 of the 100 test-year positives had already been seen
  labeled in training and the model was recognising memorised providers. The
  valid design splits providers by *exclusion* year instead, which is disjoint
  by construction. Both the trap and the fix are documented in
  `temporal_check.py`.

- ~~**A "current risk" view is now more than a nice-to-have.**~~ **Decided: the
  site ships one view, 2024 only.** See section 3. A worst-year view is one
  `--year` flag and one rerun away if the site turns out to want both, but
  building the toggle before a single page exists is optionality nobody has
  asked for.

- Whether to build the peer-features-only model that would remove the year
  drift, and what it costs. Not attempted; see limitation 6.

---

## 8. Working agreements

- This file records decisions and the reason for each. Update it when a decision
  changes, rather than relying on memory.
- Outliers are the signal. Never smooth them away.
- The provider is the unit of the worklist.
- Top-k over the ranking unit is the metric. Not accuracy.
- Every flag must be explainable, or it does not ship.
- No result is reported from a single split.
- Nothing identifying a real provider goes into a published file.
