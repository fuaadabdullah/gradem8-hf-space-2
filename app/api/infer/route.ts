import { NextRequest, NextResponse } from "next/server";

const FALLBACK_MODEL = "meta-llama/Llama-3.1-8B-Instruct";
const MODEL_PATTERN = /^[a-zA-Z0-9._/:+-]+$/;
const MODEL_ALIASES: Record<string, string> = {
  "meta-llama/Meta-Llama-3.1-8B-Instruct": "meta-llama/Llama-3.1-8B-Instruct",
};

type InferRequest = {
  prompt?: string;
  model?: string;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
// Per-instance best effort only: Vercel runs multiple lambda instances with no shared
// memory, so this caps abuse from a single warm instance rather than globally per IP.
const requestLog = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = requestLog.get(ip);

  if (!entry || now > entry.resetAt) {
    requestLog.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  entry.count += 1;
  return false;
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function extractOutput(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const data = payload as Record<string, unknown>;
    if (Array.isArray(data.choices) && data.choices.length > 0) {
      const first = data.choices[0] as Record<string, unknown>;
      const message = first.message as Record<string, unknown> | undefined;
      if (message && typeof message.content === "string") {
        return message.content;
      }
    }
  }

  return "";
}

function extractUpstreamError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;

    if (typeof body.error === "string") {
      return body.error;
    }

    if (
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof (body.error as Record<string, unknown>).message === "string"
    ) {
      return (body.error as Record<string, unknown>).message as string;
    }

    if (typeof body.message === "string") {
      return body.message;
    }
  }

  return `Hugging Face request failed with status ${status}.`;
}

function buildDemoResponse(prompt: string, model: string, latencyMs: number) {
  const preview = prompt.length > 300 ? `${prompt.slice(0, 300)}...` : prompt;
  return {
    output: [
      "Demo mode response:",
      "Set HUGGINGFACE_API_TOKEN in Vercel production env to enable live model inference.",
      "",
      `Prompt received: ${preview}`,
    ].join("\n"),
    model,
    latencyMs,
  };
}

function normalizeModel(model: string): string {
  return MODEL_ALIASES[model] || model;
}

export async function POST(request: NextRequest) {
  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a minute and try again.", code: "TOO_MANY_REQUESTS" },
      { status: 429 }
    );
  }

  let body: InferRequest;

  try {
    body = (await request.json()) as InferRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body.", code: "INVALID_JSON" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required.", code: "PROMPT_REQUIRED" }, { status: 400 });
  }

  if (prompt.length > 6000) {
    return NextResponse.json({ error: "Prompt is too long. Keep it under 6000 characters.", code: "PROMPT_TOO_LONG" }, { status: 400 });
  }

  const model = normalizeModel(
    (body.model?.trim() || process.env.HUGGINGFACE_MODEL_DEFAULT || FALLBACK_MODEL).trim()
  );
  if (!MODEL_PATTERN.test(model)) {
    return NextResponse.json({ error: "Model identifier is invalid.", code: "INVALID_MODEL" }, { status: 400 });
  }

  const token = process.env.HUGGINGFACE_API_TOKEN;
  if (!token) {
    return NextResponse.json(buildDemoResponse(prompt, model, 0));
  }

  const start = Date.now();
  let upstream: Response;

  try {
    upstream = await fetch("https://router.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
        temperature: 0.2,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Failed to reach Hugging Face Inference API.", code: "UPSTREAM_UNREACHABLE" }, { status: 502 });
  }

  const latencyMs = Date.now() - start;
  const contentType = upstream.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await upstream.json() : await upstream.text();

  if (!upstream.ok) {
    const message = extractUpstreamError(payload, upstream.status);

    const code =
      upstream.status === 429
        ? "RATE_LIMITED"
        : upstream.status === 503
          ? "MODEL_LOADING"
          : upstream.status >= 500
            ? "UPSTREAM_ERROR"
            : "INFERENCE_REJECTED";

    return NextResponse.json({ error: message, code }, { status: upstream.status });
  }

  const output = extractOutput(payload);
  if (!output) {
    return NextResponse.json({ error: "Inference response did not include model output.", code: "EMPTY_OUTPUT" }, { status: 502 });
  }

  return NextResponse.json({ output, model, latencyMs });
}
