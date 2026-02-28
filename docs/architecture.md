# Architecture

## Overview

Gradem8 HF Space 2 is a focused integration demo that routes browser prompts to Hugging Face Inference through a server-only API route.

## Components

- `app/page.tsx`: client interface for prompt entry, model selection, and output display.
- `app/api/infer/route.ts`: secure server endpoint that validates input, calls Hugging Face, and normalizes responses.
- `docs/`: architecture, setup, and impact documentation.
- deployment config: `vercel.json` for build/runtime behavior.

## Request flow

1. User submits prompt from browser UI.
2. Client sends `POST /api/infer` with prompt and optional model.
3. Server route validates prompt and model, then reads `HUGGINGFACE_API_TOKEN` from server environment.
4. Server route calls `https://router.huggingface.co/hf-inference/models/{model}`.
5. Server route maps provider response into normalized JSON:
   - success: `output`, `model`, `latencyMs`
   - error: `error`, `code`
6. UI renders output or actionable error state.

## Deployment topology

- Frontend + API route deployed together on Vercel.
- Hugging Face API token stored in Vercel environment variables (never exposed to client bundle).
- Optional default model configured via `HUGGINGFACE_MODEL_DEFAULT`.

## Reliability and failure handling

- Empty prompt and invalid model rejected at API edge with `400`.
- Missing server token returns a deterministic demo response so the UI remains usable.
- Upstream transient errors are surfaced with normalized codes (`RATE_LIMITED`, `MODEL_LOADING`, `UPSTREAM_ERROR`).
- UI presents recoverable error messages without crashing render flow.
