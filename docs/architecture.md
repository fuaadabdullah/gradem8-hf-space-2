# GradeM8 architecture

GradeM8 v1 is a stateless essay-grading workflow. The browser submits a rubric plus one pasted essay or a batch of PDF, DOCX, or TXT files to `POST /api/grade`. The server extracts text, validates the rubric, grades each submission in demo or provider mode, and returns reports for teacher review.

## Trust boundaries

1. Browser input is untrusted. Files and pasted essays are size- and type-bounded.
2. The server owns rubric criteria and maximum scores.
3. Student writing is data, not instructions. Grading prompt construction and injection detection live in `lib/grading/prompt.ts`.
4. Model output is untrusted. `lib/grading/validate.ts` clamps criterion scores and recomputes totals.
5. The v1 application does not persist submissions, reports, or rubrics.

## Request flow

1. Teacher enters a rubric and pastes an essay or selects files.
2. `POST /api/grade` parses the multipart request.
3. PDF, DOCX, and TXT content is extracted server-side and bounded.
4. The rubric is parsed into server-authoritative criteria.
5. Demo mode produces deterministic review data when no provider token is configured; provider mode sends the rubric and essay to the server-configured model.
6. The browser shows extracted text, criterion scores, maximums, explanations, evidence, strengths, improvements, and total score.
7. A teacher can override the total and download the final report locally.

## Failure behavior

Malformed forms, unsupported or oversized files, malformed rubrics, empty submissions, too many submissions, provider errors, empty model output, and timeouts return explicit error codes. Incomplete or untrusted model output must never silently become a final grade.

## Related controls

- [Standards baseline](./standards.md)
- [Privacy and retention](./privacy.md)
- [Limitations](../LIMITATIONS.md)
- [Grading prompt controls](../lib/grading/prompt.ts)
- [Server-side grading validation](../lib/grading/validate.ts)
- [Grading integrity contract](./grading-integrity.md)
- [Grading engine entry point](../lib/grading/engine.ts)

