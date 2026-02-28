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
| `HUGGINGFACE_MODEL_DEFAULT` | No | `meta-llama/Meta-Llama-3.1-8B-Instruct` | Default model used when client does not override |

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

- `MISSING_TOKEN`: set `HUGGINGFACE_API_TOKEN` locally or in Vercel.
- `RATE_LIMITED`: retry after a short delay or use lower-traffic model.
- `MODEL_LOADING`: first request can take longer while model spins up.
