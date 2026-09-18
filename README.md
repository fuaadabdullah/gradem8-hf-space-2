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

## Impact

Demo outcomes and practical use cases are in [docs/impact.md](docs/impact.md).

## Docs

- [Architecture](docs/architecture.md)
- [Setup](docs/setup.md)
- [Impact](docs/impact.md)
- [Standards baseline](docs/standards.md)
- [Privacy and retention](docs/privacy.md)
- [Grading integrity contract](docs/grading-integrity.md)


## Contact

- Email: fuaadabdullah@gmail.com
- LinkedIn: https://www.linkedin.com/in/fuaadabdullah
