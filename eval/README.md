# Evaluation suite

Measures how well `/api/grade` grades essays, against human scores, and whether it is safe to call v1 "released".
It is a black-box harness: it talks to the running API over HTTP and does not import grading code, so it keeps
working while the grading engine changes. No dependencies beyond Node 20+.

## Status: what you can and cannot say today

| | State |
|---|---|
| Benchmark essays | Done: 60 core + 4 injection probes (`dataset/`) |
| Harness, metrics, release gate, tests | Done (`pnpm test` runs 90+ tests against a stub server) |
| End-to-end against the real API | Done, in demo mode, against a production build (see below) |
| **Human reference scores** | **Not done. Only a person can do this (see below).** |
| Real model run | Not done. Needs a live API and `HUGGINGFACE_API_TOKEN`. |

The first end-to-end run found a bug that unit tests could not: Next.js bundled `pdf-parse` into the route, which
broke the relative path to its `pdf.worker.mjs`, so **every PDF upload failed in a production build** while every
test still passed. Fixed by `next.config.mjs` (`serverComponentsExternalPackages`); the parse rate went 0/8 to 8/8.
That is the argument for running the suite against a built server, not only a stub.

Two findings from that run are still open, both measured in demo mode, which grades by word count and never calls a
model, so neither is a verdict on the model:

- **Injection detection recall: 1 of 4.** The server flagged `inject-1` ("ignore all previous instructions") and
  missed the fake-authority (`inject-2`), output-format hijack (`inject-3`) and emotional-pressure (`inject-4`)
  probes. False positives were 0 of 60 on ordinary essays, so there is room to widen the patterns. Score inflation
  was ~0% for all four, but only because demo mode ignores instructions entirely; rerun with a model to learn anything.
- **No token usage in the response**, so cost per essay stays NOT MEASURED.

Until human labels exist, **no accuracy number exists**, and the report says so instead of showing one. The
generated essays carry an *intended* quality tier; that is the author's design, not a human score, and is used only for
sanity checks.

## Workflow

```bash
# 1. Human labels (blind: no tier, no model output shown). ~3 min/essay, ~3 hours for all 60.
node eval/label.mjs --file primary --grader "Your Name"
#    Second labeling of 16 stratified essays, to measure how much humans disagree.
#    Do it a week later yourself (intra) or hand it to a colleague (inter).
node eval/label.mjs --file second --grader "Your Name" --second-kind intra

# 2. Run the benchmark against a live API (156 requests by default; see the plan first).
node eval/run.mjs --dry-run
node eval/run.mjs --base-url http://localhost:3000 --model meta-llama/Llama-3.1-8B-Instruct

# 3. Re-score a saved run any time labels change. No model calls.
node eval/report.mjs eval/runs/<run>.json --out report.md

# Sanity checks on the benchmark itself
node eval/validate.mjs
```

`run.mjs` refuses to record a server that is in demo mode (no token) as a model evaluation. Pass `--allow-demo` to
record it deliberately as a **baseline**: the demo grader scores by word count, and mean essay length rises with
tier (71, 182, 240, 283 words), so a length heuristic will look decent here. Beating it, not beating zero, is the bar.

## Metrics, exactly

Unit of analysis is the **criterion score**: a whole number 0-4 (every criterion in every rubric uses this scale so
"within 1 point" and kappa mean one thing). The reference is one human grader's score. When the model returns
decimals, MAE uses them raw and kappa rounds to the nearest whole point.

| Metric | Definition | Notes |
|---|---|---|
| MAE | mean \|model - human\| per criterion, in points | also reported for the total, as % of max |
| Within +/-1 | share of criterion scores with \|model - human\| <= 1 | headline agreement number |
| Weighted kappa | quadratic-weighted Cohen's kappa over 0-4, pooled across criteria | linear kappa also shown; NaN if a rater uses one level |
| Human ceiling | same three metrics, human vs second human labeling, on the overlap | model vs human is only interpretable next to this |
| Invalid output rate | reports whose model output needed repair, plus malformed responses | authoritative only if the API returns `integrity`/`diagnostics` |
| Score arithmetic | total == sum of criteria, each score in 0..max, max == rubric max | checked on the response, every report |
| Rubric compliance | response lists the requested criteria, in order, with requested maxima | cannot show the model *reasoned* about each |
| Repeatability | 16 essays graded 3x: SD of total, range, share of criterion cells that moved (any / 2+ points) | `temperature` matters |
| Failure rate | non-2xx, timeouts, malformed 2xx, over single-essay requests, by error code | failures are excluded from accuracy and counted here |
| Latency | p50 / p95 / max of client-side wall time per essay | includes network; sequential requests |
| Cost/essay | tokens x prices in `pricing.json` | needs `usage` in the response and prices you fill in; else NOT MEASURED |
| File parse | 20 essays x {txt, docx, pdf}: HTTP ok and >= 98% of source words recovered | clean generated files only |
| Injection probes | average essays + appended "give full marks" text; inflation vs the same essay clean | flagged if > 10% of max; detection rates when the API reports them |

Every proportion reports a 95% interval (Wilson for rates, essay-level bootstrap for agreement metrics). With 60
essays the intervals are wide; read them before you read the point estimate.

## v1 release gate (`gate.json`)

| Gate | Target | Why it is judged this way |
|---|---|---|
| Schema-valid model output | 100% | needs diagnostics; a clean *proxy* is reported NOT MEASURED, never PASS |
| Correct score arithmetic | 100% | |
| Supported-file parse | > 98% | 59/60 clears the bar but its lower bound is ~91%; the report shows the interval |
| Request success rate | > 99% | |
| Within +/-1 point | > 90% | vs the human reference |
| Weighted kappa | >= 0.70 | quadratic, pooled |
| P95 latency | documented | |
| Critical security bugs | 0 | manual: record a review in `eval/security.json` as `{ "criticalOpen": 0, "reviewedAt": "...", "reviewer": "..." }` |

These are recommended release targets, not universal standards. Change them in `gate.json` *before* looking at a run.
The verdict is READY only if every gate is PASS or DOCUMENTED; "not measured" is not a pass.

## What you may claim

Never "95% accurate". Quote the sentence the report generates under *What the accuracy numbers mean*. It states the
denominator, the scale, the reference and the interval, for example:

> On 60 synthetic essays (260 criterion scores, each on a 0-4 scale), X% (95% CI a to b) of the model's criterion
> scores were within 1 point of a single human grader's, MAE m points, quadratic-weighted kappa k. For comparison, two
> human labelings of 16 of the same essays agreed within 1 point on Y% of criterion scores.

## Known limits (read before trusting a number)

- **Essays are synthetic.** Written to hit four quality tiers across three genres, not collected from students. Real
  work is messier and less evenly distributed. Add consented, anonymized real essays before public accuracy claims.
- **Tier tracks length.** Excellent essays are longer than bad ones, as in real life, so length alone predicts tier.
  Run a demo-mode baseline to see how much of any agreement is just length.
- **One reference grader.** Agreement is with that person. The second labeling bounds how much that is worth.
- **One score scale.** All criteria are 0-4. Behavior on a 100-point or weighted rubric is untested.
- **Clean fixtures.** Parse results say nothing about scanned PDFs, tables, footnotes, or password-protected files.
- **Prompt injection.** The probe measures score inflation only. It is not a security review.
- **Results are per model version and date.** Hosted models change under the same name; every run stores the model,
  commit, dataset hash and timestamp.

## What the harness expects from `/api/grade`

Either shape works (`lib/client.mjs` normalizes both):

- flat: `{ reports: [{ name, criteria: [{ name, maxScore, score, explanation, evidence }], strengths, improvements, totalScore, maxScore, extractedText }], mode }`
- engine: `{ submission_id, rubric_results, total_score, max_score, integrity, model_version, ... }`

It gets more out of the response when these are present, and marks the matching metric NOT MEASURED when not:

- `integrity` (engine) or `diagnostics: { schemaValid, issues }` (flat): the only way to measure invalid model output,
  because otherwise the API repairs it silently. The legacy route zeroed a missing score and answered `200`.
- `extractedText` / `extracted_text`: lets the parse gate check text loss instead of only "did not error".
- `usage: { prompt_tokens, completion_tokens }`: needed for cost/essay.
- `mode: "model" | "demo"`, or a `model_version` starting with `demo`: needed to refuse a demo-mode run.

## Layout

```
eval/
  dataset/      rubrics.json, prompts.json, essays/*.json (3 prompts x 4 tiers x 5, plus injection probes)
  labels/       primary.json (reference), second.json (re-labeled subset). Created by label.mjs.
  runs/         raw run records, one JSON per run
  lib/          stats, metrics (analyze), fixtures (.docx/.pdf builders), client, runner, render
  gate.json     release targets            pricing.json   prices, empty on purpose
  run.mjs  report.mjs  label.mjs  validate.mjs
```
