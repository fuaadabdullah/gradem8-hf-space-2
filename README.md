# GradeM8

GradeM8 is a deliberately narrow essay-grading workspace: provide a rubric and one or more papers, inspect the extracted text, review rubric-grounded feedback, override the total when needed, and download the report.

This is a portfolio/demo implementation, not a school-approved FERPA service.

## Stack

- Next.js 15.5.24
- TypeScript
- Server-side grading route (`POST /api/grade`)
- PDF, DOCX, and TXT extraction
- Optional server-side Hugging Face inference
- Vercel deployment

## Architecture

Component and integration design notes are in [docs/architecture.md](docs/architecture.md).

## Quickstart

```bash
pnpm install
pnpm dev
```

## Testing

```bash
pnpm test
```

The test suite covers grading input boundaries, file extraction, rubric parsing, server-side score validation, prompt-injection defenses, evaluation fixtures, and the legacy inference route. The root `code-security.datadog.yaml` file is an intentional SAST configuration for repository security scanning.

Passing tests verify the integrity invariants (server-owned maxima and totals, sanitized output, fail-closed validation) and the harness plumbing. They are **not** evidence that the grading is accurate, and the suite is not a substitute for the human-review step described in [LIMITATIONS.md](LIMITATIONS.md).

## Deployment

Deployment prerequisites and environment setup are documented in [docs/setup.md](docs/setup.md).

## API

`POST /api/grade` accepts a multipart form with `rubric`, optional pasted `essay`, and zero or more `files` fields. Supported files are PDF, DOCX, and TXT. The route returns extracted text and one report per submission.

The legacy inference endpoint remains available as an integration fixture:

`POST /api/infer`

Request:

```json
{
  "prompt": "Explain risk-to-reward ratio in 4 bullets.",
  "model": "meta-llama/Llama-3.1-8B-Instruct"
}
```

Response:

```json
{
  "output": "1. ...",
  "model": "meta-llama/Llama-3.1-8B-Instruct",
  "latencyMs": 872
}
```

## Limitations

GradeM8 provides **grading assistance, not authoritative academic decisions**. It proposes criterion scores, evidence and feedback; an instructor must review each report and accept the total before a grade is finalized. The recomputed total and the `teacher-approved` label are client-side conveniences, not a server-side attestation.

**Performance has been evaluated against 0 human-scored essays.** The benchmark (60 synthetic essays plus 4 injection probes), the evaluation harness and the release gate exist; human reference labels do not. There is therefore **no accuracy figure for this project**, the accuracy gates report NOT MEASURED, and the last recorded end-to-end run was demo mode (no model call) with a verdict of NOT READY.

**Scores may vary between model versions.** Every report records its `model_version`, decoding runs at `temperature: 0.1` rather than 0, and hosted weights change under a stable model name, so a result is only meaningful for the model, engine version, rubric and date that produced it.

Known weaknesses, each with the review step that compensates for it:

- **Ambiguous rubrics**: unparsable criteria are rejected rather than guessed, but vague descriptors with no points are simply ignored.
- **Image-heavy PDFs**: extraction is text-only, with no OCR, table or footnote reconstruction.
- **Highly technical writing**: the rubric is the only domain context, and no technical writing is in the benchmark.
- **Unusual formatting**: structure criteria assume normal blank-line prose.
- **Extremely long submissions**: 30,000 characters per submission, 5 MB per file, 20 submissions per request, 45 s provider timeout.
- Plus regex prompt-injection detection, heuristic demo mode, untested 100-point or weighted scales, an unverified WCAG 2.2 AA target, no monitoring or drift detection, and provider retention terms that GradeM8 cannot vouch for.

Full detail, measured numbers, the NIST AI RMF test/evaluation/verification/validation/monitoring status, and a pre-use checklist are in [LIMITATIONS.md](LIMITATIONS.md).

## Impact

Demo outcomes and practical use cases are in [docs/impact.md](docs/impact.md).

## Docs

- [Architecture](docs/architecture.md)
- [Setup](docs/setup.md)
- [Impact](docs/impact.md)
- [Limitations](LIMITATIONS.md)
- [Standards baseline](docs/standards.md)
- [Privacy and retention](docs/privacy.md)
- [Grading integrity contract](docs/grading-integrity.md)


## Contact

- Email: fuaadabdullah@gmail.com
- LinkedIn: https://www.linkedin.com/in/fuaadabdullah
