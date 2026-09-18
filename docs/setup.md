# Setup

## Prerequisites

- Node.js 18+
- pnpm 10+
- Hugging Face account + API token

## Environment variables

Create `.env.local` from `.env.example`.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `HUGGINGFACE_API_TOKEN` | Yes | n/a | Server-only token for Hugging Face Inference API |
| `HUGGINGFACE_MODEL_DEFAULT` | No | `meta-llama/Llama-3.1-8B-Instruct` | Default model used when client does not override |
| `GRADING_RATE_LIMIT_PER_MINUTE` | No | `60` | Per-instance, per-IP limit for `POST /api/grade`. `0` disables it (offline benchmark runs only) |

Grading integrity behavior, response schema and failure codes are documented in
[grading-integrity.md](./grading-integrity.md).

## Install and run locally

```bash
pnpm install
pnpm dev
```

App URL: `http://localhost:3000`

## Quality checks

```bash
pnpm lint
pnpm build
```

## Deploy to Vercel

```bash
vercel --prod
```

Then set environment variables in Vercel project settings:

- `HUGGINGFACE_API_TOKEN`
- `HUGGINGFACE_MODEL_DEFAULT` (optional)

## Troubleshooting

- No token configured: app returns demo-mode output; set `HUGGINGFACE_API_TOKEN` locally or in Vercel for live inference.
- `RATE_LIMITED`: retry after a short delay or use lower-traffic model.
- `MODEL_LOADING`: first request can take longer while model spins up.
