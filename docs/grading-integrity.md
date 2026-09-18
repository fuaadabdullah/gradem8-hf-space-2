# Grading integrity contract

This document is the implementation contract for the grading engine. It states what the
server computes itself, what the model is allowed to influence, and which tests enforce each
claim. Policy context is in [standards.md](./standards.md) and [privacy.md](./privacy.md).

## Threat model in one paragraph

A submission is attacker-controlled text. The grading model is an unreliable arithmetic
engine and an unreliable instruction follower. Neither is trusted: the model never decides a
criterion maximum, never decides a total, never decides its own identifier, and never gets to
treat student text as an instruction.

## Trust boundaries

| Layer | Authored by | Trust | Where it is enforced |
|---|---|---|---|
| System rules | Server | Trusted | `lib/grading/prompt.ts` (`SYSTEM_RULES`) |
| Rubric | Teacher, parsed by server | Trusted, authoritative | `lib/grading/rubric.ts` |
| Student submission | Student | **Untrusted data** | neutralized, nonce-fenced, user message only |
| Model output | Provider | **Untrusted** | `lib/grading/validate.ts` |
| Response payload | Server | Trusted | `lib/grading/engine.ts` |
| Submission id, model version | Server | Trusted | `lib/grading/engine.ts` |

## Prompt architecture

```
[system]  SYSTEM RULES            non-negotiable rules + JSON contract
   |
[system]  RUBRIC                  server-parsed criteria with ids and maxima
   |
[user]    UNTRUSTED SUBMISSION    one fenced block, per-request nonce
```

Rules enforced by construction:

1. The submission is **never** placed in a system message; it only exists inside the final
   user message, between `<untrusted_submission id="<nonce>" trust="untrusted-data">` tags.
2. The fence token is a fresh 32-character nonce per submission, so a submission cannot
   close the fence it is inside.
3. Before the submission is sent, the prompt copy is rewritten: role markers (`system:`),
   chat-template markers (`<|im_start|>`), pseudo system headers (`### SYSTEM`), fence
   forgeries (`</untrusted_submission>`) and any occurrence of the nonce are replaced with
   `[neutralized:...]` tokens. Invisible and bidirectional control characters are removed.
4. Criterion ids, maxima and the JSON contract are server-authored and never depend on the
   submission.
5. The rules tell the model that totals are advisory because the platform recomputes them.

The stored submission is never modified by step 3 - only the prompt copy is.

## Canonical response schema

`POST /api/grade` returns one report per submission:

```json
{
  "submission_id": "sub_4f1a9c2d7e0b3a51",
  "rubric_results": [
    {
      "criterion": "Thesis clarity",
      "criterion_id": "thesis_clarity",
      "score": 18,
      "max_score": 25,
      "reasoning": "The position is stated in the first paragraph and stays consistent.",
      "evidence": ["Trade-offs matter because the evidence is mixed"],
      "feedback": "Name the counter-argument explicitly in paragraph three."
    }
  ],
  "total_score": 77,
  "max_score": 100,
  "overall_feedback": "A clear argument with uneven support.",
  "strengths": ["Consistent position"],
  "improvements": ["Deepen the analysis of the counter-argument"],
  "confidence": 0.8,
  "model_version": "hf-router:meta-llama/Llama-3.1-8B-Instruct@gradem8-grader-v1",
  "integrity": {
    "engine_version": "hf-router:meta-llama/Llama-3.1-8B-Instruct@gradem8-grader-v1",
    "totals_source": "server",
    "client_submission_id_ignored": false,
    "model_reported_total": 81,
    "model_reported_max_score": 100,
    "arithmetic_corrected": true,
    "score_adjustments": [],
    "unmatched_criteria": [],
    "missing_criteria": [],
    "duplicate_criteria": [],
    "positional_fallback": false,
    "confidence_clamped": false,
    "confidence_capped": false,
    "output_sanitized": true,
    "submission_neutralizations": [],
    "rubric_warnings": [],
    "injection": {
      "detected": false,
      "categories": [],
      "signals": [],
      "requires_human_review": false
    }
  }
}
```

The legacy flat view (`name`, `extractedText`, `criteria`, `strengths`, `improvements`,
`totalScore`, `maxScore`) is derived from this same validated object, so the two views cannot
disagree. `usage` is included when the provider reports token counts.

Field notes:

- `criterion` is the teacher-facing label; `criterion_id` is the stable server key. Join on the id.
- `confidence` is `null` when the model did not report one. The server never invents a
  confidence value, it only clamps (`0..1`) and caps (injection) what the model returned.
- `integrity` is additive diagnostic data. Consumers that only need scores can ignore it, but
  a UI that lets a human override a grade should surface `requires_human_review`.

## Arithmetic is computed on the server

The model's `total_score`, `max_score` and any per-criterion `max_score` are **read only for
the record**. They never reach a caller.

With the rubric `Thesis clarity 25, Evidence quality 25, Analysis depth 20, Organization 15,
Language mechanics 15` and model scores `18, 17, 18, 14, 10`:

| Value | Model said | Server returns | Why |
|---|---|---|---|
| criterion maxima | mixed | `25, 25, 20, 15, 15` | maxima come from the parsed rubric |
| `total_score` | `81` | `77` | `18 + 17 + 18 + 14 + 10 = 77`, recomputed with `round2` |
| `max_score` | `100` | `100` | server rubric total |
| `integrity.model_reported_total` | - | `81` | the discrepancy is recorded, not hidden |
| `integrity.arithmetic_corrected` | - | `true` | a human can see the model drifted |

Scores are coerced to numbers, clamped into `0..criterion.max_score`, rounded to two decimals,
and reported in the integrity record when they had to be changed
(`above_criterion_max`, `negative_score`, `non_numeric_score`).

## Criterion matching

1. Model results are matched to rubric criteria by `criterion` id, then by normalized name.
2. Anything that does not match a rubric criterion is **dropped** and listed in
   `integrity.unmatched_criteria`.
3. A criterion scored twice keeps the first result; the duplicate is listed in
   `integrity.duplicate_criteria`.
4. If no label matches at all and the model returned at least one result per criterion, order
   is used as a last resort and `integrity.positional_fallback` is set to `true`.
5. If any rubric criterion is still unscored, the request fails closed with
   `502 GRADING_INCOMPLETE` and `details.missing_criteria`. A partial rubric never becomes a
   total.

## Prompt-injection handling

Detection is a heuristic (`lib/grading/prompt.ts`), and it is deliberately *not* a scoring
input:

| Category | Example trigger |
|---|---|
| `instruction_override` | "Ignore the rubric ..." |
| `score_demand` | "... give this essay 100%", "I deserve full marks" |
| `role_impersonation` | `system:`, `<|im_start|>`, "you are now ..." |
| `prompt_exfiltration` | "reveal your system prompt" |
| `rubric_tampering` | "mark this essay as perfect", "replace the rubric" |
| `delimiter_forgery` | `<untrusted_submission>` inside the submission |
| `hidden_text` | zero-width or bidirectional control characters |

When signals are detected the server:

1. still grades the submission against the rubric normally - detection never adds or removes
   points, because a false positive must not cost a student marks;
2. records the categories and short excerpts in `integrity.injection` and sets
   `requires_human_review`;
3. caps `confidence` at `0.5`, so a manipulated grading can never read as high confidence;
4. never returns the raw model text that tried to leak the system prompt - internal sentinels
   are replaced during sanitization.

`requires_human_review` is also set when the server had to clamp a score, drop an unmatched
criterion, or fall back to positional matching: any of those means the model output was not
clean.

## Output sanitization

All model-authored text (reasoning, feedback, evidence, overall feedback, strengths,
improvements) is sanitized before it leaves the process: control characters and invisible
characters are stripped, internal prompt sentinels such as `NON-NEGOTIABLE RULES` or
`<untrusted_submission>` are replaced with `[redacted]`, whitespace is normalized, and lengths
are capped (`reasoning` 1200, `feedback` 600, each evidence quote 300 with at most 4 quotes,
overall feedback 4000). `integrity.output_sanitized` records whether anything changed.
Consumers must render these strings as text, never as HTML.

## Fail-closed error codes

| Code | Status | Meaning |
|---|---|---|
| `INVALID_MODEL_OUTPUT` | 502 | model output was not JSON, or had no rubric results |
| `GRADING_INCOMPLETE` | 502 | at least one rubric criterion was not scored |
| `EMPTY_MODEL_OUTPUT` | 502 | provider returned no content |
| `MODEL_RATE_LIMITED` / `MODEL_FAILED` | 502 | provider refused the request |
| `MODEL_TIMEOUT` | 502 | provider exceeded the 45 s budget |
| `MODEL_UNAVAILABLE` | 502 | provider unreachable |
| `MALFORMED_RUBRIC` | 400 | a rubric line looked like a criterion but could not be parsed |
| `INVALID_MODEL` | 400 | model identifier failed the allowlist pattern |
| `TOO_MANY_REQUESTS` | 429 | per-instance, per-IP rate limit |
| `ESSAY_TOO_LARGE` / `FILE_TOO_LARGE` / `TOO_MANY_SUBMISSIONS` | 400 | input bounds |

A rubric line that looks like a criterion but does not parse (`Evidence - 25/25`,
`Huge - 500 points`) is an error rather than a silent omission, so a rubric can never shrink
without the teacher knowing.

## OWASP GenAI Top 10 (2025) mapping

Reference: [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/).
See [standards.md](./standards.md) for the wider standards baseline.

| Risk | Control in this repo | Evidence |
|---|---|---|
| LLM01 Prompt Injection | Layered system rules -> rubric -> nonce-fenced untrusted content; neutralization of role markers, fence forgeries and template markers; injection signals recorded for review | `lib/grading/prompt.ts`, `tests/grading-engine.test.ts`, `tests/grade-route-integrity.test.ts` |
| LLM02 Sensitive Information Disclosure | Provider token stays server-side; system rules forbid revealing rules, fence token, ids or metadata; internal sentinels are redacted from output; essays are not logged or persisted | `lib/grading/validate.ts`, `docs/privacy.md` |
| LLM03 Supply Chain | Lockfile-pinned dependencies, model identifier allowlist pattern, a single configured provider endpoint | `lib/grading/engine.ts`, `pnpm-lock.yaml`, CI |
| LLM05 Improper Output Handling | Every model string is sanitized and length-capped before it is returned; scores are coerced and clamped; totals recomputed | `lib/grading/validate.ts` |
| LLM07 System Prompt Leakage | Prompt sentinels and fence tokens are stripped from output; the system prompt is never echoed by the API | `lib/grading/validate.ts` |
| LLM09 Misinformation | Criterion maxima, totals and identifiers are server-owned; evidence is required per criterion; `confidence` is clamped and capped; `requires_human_review` forces a teacher look | `lib/grading/engine.ts`, `lib/grading/validate.ts` |
| LLM10 Unbounded Consumption | Per-IP rate limit, submission and file size caps, 20 submissions per request, 45 s provider timeout, `max_tokens` cap, token usage surfaced for cost tracking | `app/api/grade/route.ts`, `lib/grading/engine.ts` |
| LLM06 Excessive Agency | The engine has no tools, no persistence and no write actions; it returns a report for a human decision | `app/api/grade/route.ts` |
| LLM04 Data and Model Poisoning / LLM08 Vector and Embedding Weaknesses | Out of scope for v1: no fine-tuning, no embeddings, no vector store | - |

## Known limitations

Product-level limitations, evaluation status and the NIST AI RMF TEVV/monitoring gaps are in
[LIMITATIONS.md](../LIMITATIONS.md). The list below is module-level: what this contract does not enforce.

- Injection detection is a regex heuristic. It has false negatives (a novel phrasing is not
  flagged) and false positives (an essay quoting the phrase "ignore the rubric" can be
  flagged). It is a review signal, never a scoring input.
- Neutralization rewrites the prompt copy of a submission. The stored submission is untouched,
  but a reviewer comparing the two will see `[neutralized:...]` tokens.
- The rate limiter is in-memory and per serverless instance, so it is a speed bump, not a
  global quota. A durable limiter is required before real school traffic.
- `GRADING_RATE_LIMIT_PER_MINUTE=0` disables the limiter. That is deliberate and intended only
  for offline benchmark runs.
- Essay text is sent to the configured model provider. That is a provider/contract question,
  not something the code can solve; see [privacy.md](./privacy.md).
- Demo mode is a deterministic heuristic for UI review, not a measurement of grading quality.
  Accuracy, reliability and repeatability are measured by the harness in `eval/`.

## Verifying the claims

```bash
pnpm test                  # unit + route + evaluation harness tests
pnpm exec tsc --noEmit     # types
pnpm lint                  # eslint
```

| Claim | Test |
|---|---|
| Totals are recomputed, model arithmetic is recorded | `tests/grading-engine.test.ts`, `tests/grade-route-integrity.test.ts` |
| Scores are clamped to server maxima | `tests/grading-engine.test.ts` (clamps scores ...) |
| Partial grading fails closed | `tests/grading-engine.test.ts` (fail-closed validation), `tests/grade-route-integrity.test.ts` (fails closed ...) |
| The submission never enters a system message | `tests/grading-engine.test.ts` and `tests/grade-route-integrity.test.ts` (keeps the submission out of the system messages ...) |
| Injection attempts are recorded, not obeyed | `tests/grade-route-integrity.test.ts` (still enforces the rubric when the model obeyed the injection) |
| The server owns `submission_id` and `model_version` | `tests/grading-engine.test.ts` (prefers the server submission id ...) |
| Model text is sanitized | `tests/grading-engine.test.ts` (output hygiene), `tests/grade-route-integrity.test.ts` (sanitizes model text ...) |
| Demo mode uses the same validated path | `tests/grade-route-integrity.test.ts` (runs deterministically in demo mode ...) |
| Rubric parsing never shrinks a rubric silently | `tests/grading-engine.test.ts` (reports lines it could not parse ...) |