# GradeM8 limitations

Last reviewed: 2026-09-18. Code: commit `75e1edd` plus the documentation and harness work in the working tree.
Benchmark dataset hash: `80373ab5ea0b`. Last recorded end-to-end run:
`eval/runs/20260918T184804-default-model.json` (demo mode, no model call).

This file exists because an essay grader that claims to be authoritative is a worse product than one that
states its own error budget. Everything below is either measured, bounded by code, or explicitly
**NOT MEASURED**. Where a number is missing, it says so instead of estimating.

## 1. Grading assistance, not authoritative academic decisions

- GradeM8 proposes criterion scores, evidence quotations and feedback for a teacher to review. It is not a
  grade of record, and nothing it returns is a final, reportable or appealable grade.
- Every report carries `confidence` and `integrity.requires_human_review`, which is set when injection
  signals, score clamping, positional fallback or unmatched criteria occurred. Those are cues to look
  closer, not permission to skip review.
- The interface keeps the teacher in the loop: criterion scores are editable, the total is recomputed in
  the browser from those scores, and the download is labelled `teacher-approved`.
- That approval is client-asserted. The downloaded JSON says a teacher approved it, but v1 has no signing
  key and no server-side record that could prove it. Treat the file as a teacher's working document, not
  as evidence.
- Scores are clamped to the teacher's rubric maxima and totals are recomputed on the server, so the model
  cannot inflate a total by itself. That is an integrity control, not a correctness guarantee: a clamped
  score can still be the wrong score.

## 2. Evaluation status: N = 0 human-scored essays

**Performance has been evaluated against 0 human-scored essays.** That is the honest number today. What
exists is a benchmark, a harness and a release gate; what does not exist is a human reference score to
compare the model against.

| Layer | State | Where |
|---|---|---|
| Benchmark essays | Done: 60 core + 4 injection probes (3 prompts x 4 quality tiers, 3 rubrics) | `eval/dataset/`, hash `80373ab5ea0b` |
| Harness, metrics, release gate | Done | `eval/lib/`, `eval/gate.json` |
| Unit, route and integrity tests | Done | `tests/` (`pnpm test`) |
| End-to-end run against the real API | Done in **demo mode only** | `eval/runs/20260918T184804-default-model.json` |
| **Human reference scores** | **Not done: 0 of 60 essays labeled** | `eval/labels/primary.json` does not exist |
| Second labeling (human disagreement ceiling) | Not done | `eval/labels/second.json` does not exist |
| Real model run | Not done: requires a live server plus `HUGGINGFACE_API_TOKEN` | - |
| Accuracy, within-1-point agreement, weighted kappa | **NOT MEASURED** | `eval/gate.json` marks both gates `missing` |

So there is no accuracy figure for this project, and none should be quoted from it. The harness is built
to say NOT MEASURED rather than to print a number it cannot support, and the last recorded run's verdict
was **NOT READY**: 5 gates pass, 2 are not measured, 1 is documented. The two gates that cannot be answered
yet are exactly the two accuracy gates.

### What the recorded demo-mode run did measure

Demo mode grades by word count and paragraph structure and never calls a model, so these numbers describe
plumbing and not grading quality. They are still useful as a baseline, because any real model must beat
this.

| Gate | Target | Observed (demo) | Status |
|---|---|---|---|
| Schema-valid model output | 100% | 100.0% (n=88) | PASS |
| Correct score arithmetic | 100% | 100.0% (n=88) | PASS |
| Supported-file parse | > 98% | 100.0% (n=24: 8 txt, 8 docx, 8 pdf) | PASS |
| Request success rate | > 99% | 100.0% (n=64) | PASS |
| Within +/-1 rubric point | > 90% | n/a | NOT MEASURED: needs human labels |
| Weighted kappa (quadratic) | >= 0.70 | n/a | NOT MEASURED: needs human labels |
| P95 grading latency | documented | 6 ms (demo, client-side) | DOCUMENTED |
| Critical security bugs | 0 | 0 critical open (reviewed 2026-09-18) | PASS |

Three caveats on that table. The essays are synthetic, so they do not represent real student writing. The
security gate counts critical findings only: the review recorded on 2026-09-18 (`eval/security.json`) also
left two `pre-release requirement` findings open (no authentication or school tenancy; no human labels or
real provider run), which is why the verdict is still NOT READY. And the injection counts from this run
(4 of 4 probes flagged, 0 of 60 ordinary essays flagged) are demo-mode detector measurements, not a model
result, and the detector keeps changing, so refresh them by re-running the harness.

### How to replace N = 0 with a real number

```bash
node eval/label.mjs --file primary --grader "Your Name"   # blind human labels, ~3 min/essay
node eval/run.mjs --dry-run                               # see the planned requests first
node eval/run.mjs --base-url http://localhost:3000        # live API, writes eval/runs/<run>.json
node eval/report.mjs eval/runs/<run>.json --out report.md # re-score later; no model calls
```

`eval/run.mjs` refuses to record a demo-mode server as a model evaluation unless `--allow-demo` is passed,
so a tokenless server cannot quietly become an accuracy claim. Once labels exist, the report states the
denominator, the scale, the reference grader, the interval, and human-vs-human agreement next to
model-vs-human agreement. Quote that sentence, never "X% accurate".

## 3. Scores may vary between model versions

- Every report carries `model_version` (`hf-router:<model>@gradem8-grader-v1`, or
  `demo:demo-heuristic-grader-v1`), and each eval run records the model, git commit, dataset hash and
  timestamp. Results without that context are not comparable.
- Hosted weights change under a stable model name. GradeM8 does not pin a revision digest, so the same
  essay, rubric and prompt can produce a different score after a provider update.
- Decoding uses `temperature: 0.1`, not 0. Near-deterministic is not deterministic. The last run also
  graded no essay twice, so repeatability is **NOT MEASURED**.
- Provider routing can change which backend actually served a request, even for an unchanged model id.
- Scores are per criterion and per rubric. A score of 3 of 4 under one teacher's rubric says nothing about
  the same essay under a different rubric, a 100-point scale, or weighted criteria.
- Before acting on any score, check that the model id, engine version, dataset hash and rubric text match
  the run you are citing. Otherwise you are comparing two different graders.

## 4. Known weaknesses

| Weakness | What happens today | Do this instead |
|---|---|---|
| **Ambiguous rubrics** | The parser accepts `Name - 20 points` (also `Name: 20`, `Name (20 pts)`). Descriptors without points are ignored, and a criterion-looking line that fails validation returns `MALFORMED_RUBRIC` instead of being graded silently. More than 20 criteria are truncated with a warning. A model given "analysis: strong" cannot be consistent, because the human standard is undefined. | Rewrite vague descriptors as criteria with maxima, keep one criterion per line, and check the parsed criteria list before grading. |
| **Image-heavy PDFs** | Extraction is text-only (`pdf-parse`, `mammoth`, UTF-8 for txt). There is no OCR, no layout model and no table or footnote reconstruction, so scans, screenshots, handwriting, tables and multi-column layouts can extract empty or scrambled text. The eval fixtures are clean, machine-generated files, so the 100% parse rate says nothing about scans, tables, footnotes or password-protected files. A file with no extractable text produces no submission, and one unreadable file fails the whole batch. | Paste the text for scanned work, and read the extracted text pane before trusting any score. |
| **Highly technical writing** | The rubric is the only domain context the grader gets. Equations, code, citations and discipline-specific vocabulary can be misread, and nothing in the benchmark covers them (it is three genres of school essay). Demo mode is word-count-driven and will not notice technical correctness at all. | Narrow the rubric wording for technical work and treat technical feedback as unverified. |
| **Unusual formatting** | Paragraph detection is blank-line based. One-giant-paragraph essays, bullet fragments, tables, heading-only outlines and heavy markup score badly on structure criteria for reasons unrelated to the writing. Neutralization can also leave `[neutralized:...]` tokens in the prompt copy that a reviewer compares against the raw submission. | Expect structure criteria to be unreliable outside normal prose, and review the extracted text. |
| **Extremely long submissions** | Hard caps: 30,000 characters per submission (`ESSAY_TOO_LARGE`), 5 MB per file, 20 submissions per request, 12,000 characters of rubric, 20 criteria, 45 s provider timeout, 1,800 output tokens. Longer work must be split, which changes the context the grader sees. Submissions are graded sequentially, so a 20-essay batch is 20 provider calls, and the first failure returns an error for the whole request instead of partial results. | Split long work by section and grade each part, knowing the score applies to the excerpt. |

Additional weaknesses that are not in the headline list:

- **Prompt injection.** Detection is a regex heuristic: pattern sets across 10 categories
  (`instruction_override`, `score_demand`, `fake_authority`, `criticism_suppression`, `output_hijack`,
  `role_impersonation`, `prompt_exfiltration`, `rubric_tampering`, `delimiter_forgery`, `hidden_text`).
  Novel phrasing is missed, and ordinary classroom language can be flagged; a flag caps confidence at 0.5
  and forces human review. Injection signals never change a score and criterion maxima and totals stay
  server-owned, but the detector is a review aid, not a security control.
- **Demo mode (no token).** A deterministic word-count, paragraph and vocabulary heuristic with decimal
  scores and confidence 0.35. Useful for reviewing the UI and as a baseline to beat, useless as evidence of
  grading quality.
- **Scales and subjects outside the benchmark.** Only 0-4 criterion scales with a single reference grader
  have coverage. Rubric maxima up to 100 are accepted and clamped per criterion, but the agreement metrics
  assume one shared scale, so weighted or 100-point rubrics are untested. Non-English writing, creative
  writing, lab reports and math proofs are untested too.
- **Accessibility.** WCAG 2.2 AA is a target, not a verified state: no screen-reader, keyboard-only, 200%
  zoom, contrast or automated audit of the rendered page has been recorded.
- **Operations.** No authentication, tenancy, audit log or persistence, and the rate limiter is in-memory
  and per serverless instance, so it is a speed bump rather than a quota. The recorded security review
  (`eval/security.json`) lists these as pre-release requirements rather than closed items.
- **Provider data handling.** In model mode the rubric and essay go to the configured provider. GradeM8
  makes no claim about that provider's retention, training use or subprocessors; see
  [privacy.md](./docs/privacy.md).
- **Teacher overrides are client-side.** The recomputed total and the `teacher-approved` label are set in
  the browser, so a downloaded report can be edited afterwards with no server-side record.

## 5. NIST AI RMF: what is verified, and what is not

[NIST AI 600-1](https://doi.org/10.6028/NIST.AI.600-1) treats testing, evaluation, verification,
validation (TEVV), documentation and monitoring as parts of trustworthy AI risk management. This project
implements part of that loop and is explicit about the gaps. The mapping is maintained in
[docs/standards.md](./docs/standards.md).

| Function | In place | Missing |
|---|---|---|
| Govern | Written scope, human-review rule, provider decision and retention policy; this limitations file | No owner, review cadence or change-control record for the model or the grading prompt |
| Map | Documented risks: untrusted submissions, injection, bad extraction, model failure, unfair feedback | No risk register with owners or likelihood/impact ratings |
| Measure | Unit, route and integrity tests; benchmark corpus; harness with a release gate; score bounds and output validation | No human reference labels, so no accuracy, agreement or bias measurement; repeatability and cost per essay NOT MEASURED |
| Manage | Fail closed on incomplete output, server-recomputed totals, evidence per criterion, teacher review and override, explicit error codes; a recorded security review with 0 critical findings open (`eval/security.json`) | No monitoring, alerting, drift detection, incident process or rollback plan; no post-deployment audit of scores; the review's two pre-release requirements (auth and tenancy, human labels) are unresolved |

The practical consequence: **v1 is test- and document-oriented, not monitoring-oriented.** Verification
exists for the integrity invariants (server-owned maxima and totals, sanitized output, fail-closed
validation). Validation against human judgment does not exist yet. Anyone describing this project's
reliability should cite the tests and the unmeasured gates together, never the tests alone.

## 6. Checklist before a score is used for anything real

1. Is the submission fully extracted, and does the extracted text match the original?
2. Did the parsed rubric list match your intent, including every maximum?
3. Did the report set `integrity.requires_human_review`, or flag injection signals, clamping, unmatched
   criteria or a positional fallback?
4. Does each criterion have evidence quoted from the essay, and does that evidence actually support the score?
5. Was the run made with the model version, engine version and rubric you think it was?
6. Has an instructor read the report, adjusted the scores and accepted the total?
7. If a claim about accuracy is being made: do human labels exist for a comparable corpus, and does the
   report quote its denominator, scale, reference and interval?

If any answer is no, the score is a draft, not a grade.

## 7. Related documents

- [README](./README.md): what the product is and how to run it.
- [Grading integrity contract](./docs/grading-integrity.md): module-level limitations for the prompt,
  detection, validation and rate-limit layers, plus the tests that enforce each claim.
- [Evaluation suite](./eval/README.md): metrics, release gates and the current "what you may claim" state.
- [Standards baseline](./docs/standards.md): NIST AI RMF, OWASP Top 10 / GenAI Top 10, WCAG 2.2 AA and the
  FERPA boundary.
- [Privacy and retention](./docs/privacy.md): what is stored, for how long, and the school deployment gate.
- [Architecture](./docs/architecture.md): trust boundaries and request flow.