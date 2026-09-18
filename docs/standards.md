# GradeM8 standards baseline

GradeM8 v1 uses four practical reference points. These are engineering and product commitments, not a claim of certification or legal compliance.

## NIST AI RMF + Generative AI Profile

Reference: [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework) and [NIST AI 600-1](https://doi.org/10.6028/NIST.AI.600-1).

GradeM8 uses the AI RMF functions as its risk loop:

| Function | GradeM8 v1 practice | Evidence |
|---|---|---|
| Govern | Keep the product scope, human-review rule, provider decision, and retention policy explicit. | This document, [privacy policy](./privacy.md), README, [limitations](../LIMITATIONS.md) |
| Map | Treat student writing, rubric manipulation, prompt injection, bad extraction, model failure, and unfair feedback as product risks. | [grading prompt](../lib/grading/prompt.ts), route limits, error codes |
| Measure | Test rubric parsing, score bounds, output integrity, adversarial submissions, and failure handling. | `tests/grading-engine.test.ts`, `tests/grade-route-integrity.test.ts`, `eval/` |
| Manage | Fail closed on incomplete model output, recompute totals server-side, show evidence, and require teacher review/override. | [validation module](../lib/grading/validate.ts), report UI |

The GenAI Profile is especially relevant to prompt injection, sensitive information disclosure, fabricated explanations, and over-reliance on model output. GradeM8 therefore treats the model as an untrusted assistant, not the authority for rubric maxima or final grades.

## OWASP Top 10:2025 + OWASP GenAI Top 10

References: [OWASP Top 10:2025](https://top10.owasp.org/2025/) and [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/).

| Risk area | v1 control or boundary |
|---|---|
| Access control and authentication | This portfolio demo has no school tenancy or student accounts. Those are explicitly required before real school deployment. |
| Misconfiguration and supply chain | Secrets are server-side; dependencies are lockfile-pinned; the build and lint checks run in CI. |
| Injection and insecure design | Student text is untrusted, fenced and neutralized in the grading prompt; rubric criteria are server-authoritative. |
| Integrity | Model scores are clamped, criterion maxima come from the parsed teacher rubric, and totals are recomputed on the server. |
| Logging and exceptional conditions | Essays are not persisted or written to logs by the v1 application; bad files, malformed rubrics, provider errors, empty output, oversized input, and timeouts return explicit errors. |

The remaining controls are release gates, not implied features: authentication, school-level authorization, audit logging, deletion workflows, provider contract review, and an incident process are required before processing identifiable student records.

## WCAG 2.2 AA

Reference: [W3C WCAG 2.2 Recommendation](https://www.w3.org/TR/WCAG22/).

WCAG 2.2 AA is the target for the full page, including responsive states. The v1 interface uses native form controls, visible focus styles, semantic headings and labels, keyboard-operable buttons, status/error messaging, reduced-motion support, and responsive layouts. Before calling a release conformant, run keyboard-only review, screen-reader review, 200% zoom review, automated checks, and contrast checks across the full page.

Do not describe the portfolio demo as WCAG-conformant based on code inspection alone; the target requires testing the rendered page and all responsive states.

## FERPA-aware boundary

Reference: [U.S. Department of Education guidance on online educational services](https://studentprivacy.ed.gov/faq/i-want-use-online-tool-or-application-part-my-course-however-i-am-worried-it-violation-ferpa).

The portfolio demo is not presented as a FERPA-compliant school service. If GradeM8 later processes identifiable student work for a school, the school must control the use and maintenance of the data, the service must be used only for authorized school purposes, and the provider must not improperly redisclose it. A district review and contract are prerequisites to that deployment.

See [Privacy and retention](./privacy.md) for the plain-English data policy.
