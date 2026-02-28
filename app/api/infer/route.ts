import { NextRequest, NextResponse } from "next/server";

const FALLBACK_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct";
const MODEL_PATTERN = /^[a-zA-Z0-9._/:+-]+$/;

type InferRequest = {
  prompt?: string;
  model?: string;
};

function extractOutput(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (Array.isArray(payload) && payload.length > 0) {
    const first = payload[0] as Record<string, unknown>;
    if (typeof first?.generated_text === "string") {
      return first.generated_text;
    }
    if (typeof first?.text === "string") {
      return first.text;
    }
  }

  if (payload && typeof payload === "object") {
    const data = payload as Record<string, unknown>;
    if (typeof data.generated_text === "string") {
      return data.generated_text;
    }
    if (typeof data.summary_text === "string") {
      return data.summary_text;
    }
    if (typeof data.translation_text === "string") {
      return data.translation_text;
    }
    if (typeof data.answer === "string") {
      return data.answer;
    }
    if (typeof data.text === "string") {
      return data.text;
    }
  }

  return "";
}

export async function POST(request: NextRequest) {
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

  const token = process.env.HUGGINGFACE_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Server is missing HUGGINGFACE_API_TOKEN.", code: "MISSING_TOKEN" }, { status: 500 });
  }

  const model = (body.model?.trim() || process.env.HUGGINGFACE_MODEL_DEFAULT || FALLBACK_MODEL).trim();
  if (!MODEL_PATTERN.test(model)) {
    return NextResponse.json({ error: "Model identifier is invalid.", code: "INVALID_MODEL" }, { status: 400 });
  }

  const start = Date.now();
  let upstream: Response;

  try {
    upstream = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        options: {
          wait_for_model: true,
        },
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
    const message =
      typeof payload === "object" && payload && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Hugging Face request failed with status ${upstream.status}.`;

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
