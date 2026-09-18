/**
 * The Gradem8 grading engine.
 *
 * This module is the only supported way to turn a submission into a score. It exists
 * so the security-relevant ordering cannot be dropped by accident in a route handler:
 *
 *   validate rubric (server) -> detect injection -> neutralize -> build layered prompt
 *   -> call model -> parse JSON -> validate, clamp and recompute totals (server)
 *
 * Everything a caller receives is either a server-validated result or an error. Raw
 * model output never escapes this module.
 */

import {
  GRADING_ENGINE_VERSION,
  buildGradingMessages,
  createNonce,
  detectInjectionSignals,
  neutralizeUntrustedText,
} from "./prompt";
import { type Rubric } from "./rubric";
import { DEMO_MODEL_VERSION, buildDemoGradingOutput } from "./demo";
import { extractJsonObject, validateGradingOutput, type ValidatedGradingResult } from "./validate";

export const GRADING_MODEL_PATTERN = /^[a-zA-Z0-9._/:+-]+$/;
export const DEFAULT_GRADING_MODEL = "meta-llama/Llama-3.1-8B-Instruct";
export const UPSTREAM_TIMEOUT_MS = 45_000;
export const MAX_OUTPUT_TOKENS = 1800;

const UPSTREAM_URL = "https://router.huggingface.co/v1/chat/completions";
const MODEL_ALIASES: Record<string, string> = {
  "meta-llama/Meta-Llama-3.1-8B-Instruct": "meta-llama/Llama-3.1-8B-Instruct",
};

export type TokenUsage = { prompt_tokens: number; completion_tokens: number };

export type EngineSuccess = { ok: true; result: ValidatedGradingResult; usage?: TokenUsage; mode: "model" | "demo" };
export type EngineFailure = { ok: false; status: number; code: string; error: string; details?: Record<string, unknown> };

export type EngineInput = {
  submissionText: string;
  rubric: Rubric;
  model?: string;
  token?: string;
  rubricWarnings?: string[];
  clientSubmissionIdIgnored?: boolean;
};

export function normalizeModel(model: string | undefined): string {
  const candidate = (model || DEFAULT_GRADING_MODEL).trim();
  return MODEL_ALIASES[candidate] || candidate;
}

/** Submission identity is server assigned. A request can never choose its own id. */
export function createSubmissionId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  const token = cryptoApi?.randomUUID
    ? cryptoApi.randomUUID().replace(/-/g, "").slice(0, 16)
    : Math.random().toString(16).slice(2, 18);
  return `sub_${token}`;
}

function readUsage(payload: unknown): TokenUsage | undefined {
  const usage = (payload as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const prompt = Number(usage.prompt_tokens ?? usage.promptTokens);
  const completion = Number(usage.completion_tokens ?? usage.completionTokens);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return undefined;
  return { prompt_tokens: prompt, completion_tokens: completion };
}

async function callModel(
  messages: ReturnType<typeof buildGradingMessages>,
  model: string,
  token: string
): Promise<{ ok: true; output: string; usage?: TokenUsage } | EngineFailure> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.1 }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        code: response.status === 429 ? "MODEL_RATE_LIMITED" : "MODEL_FAILED",
        error:
          response.status === 429
            ? "The grading model is rate limited. Try again shortly."
            : "The grading model could not complete this submission.",
      };
    }

    const payload = await response.json().catch(() => null);
    const output = (payload as { choices?: Array<{ message?: { content?: string } }> } | null)?.choices?.[0]?.message?.content;
    if (!output) {
      return { ok: false, status: 502, code: "EMPTY_MODEL_OUTPUT", error: "The grading model returned no report." };
    }

    return { ok: true, output, usage: readUsage(payload) };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: 502,
      code: aborted ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE",
      error: aborted ? "The grading model timed out. Try again." : "The grading model is unavailable. Try again.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runGradingEngine(input: EngineInput): Promise<EngineSuccess | EngineFailure> {
  const { submissionText, rubric, token, rubricWarnings = [], clientSubmissionIdIgnored = false } = input;
  const model = normalizeModel(input.model);
  const submissionId = createSubmissionId();

  // Recorded as review signals. They never give the submission any authority.
  const injectionSignals = detectInjectionSignals(submissionText);
  const nonce = createNonce();
  const neutralized = neutralizeUntrustedText(submissionText, nonce);

  let rawOutput: string;
  let usage: TokenUsage | undefined;
  const mode: "model" | "demo" = token ? "model" : "demo";

  if (token) {
    const messages = buildGradingMessages({ rubric, submissionText: neutralized.text, submissionId, nonce });
    const upstream = await callModel(messages, model, token);
    if (upstream.ok === false) return upstream;
    rawOutput = upstream.output;
    usage = upstream.usage;
  } else {
    rawOutput = buildDemoGradingOutput(rubric, neutralized.text);
  }

  let parsed: unknown;
  try {
    parsed = extractJsonObject(rawOutput);
  } catch {
    return {
      ok: false,
      status: 502,
      code: "INVALID_MODEL_OUTPUT",
      error: "The grading model returned output that is not valid JSON.",
    };
  }

  const outcome = validateGradingOutput({
    raw: parsed,
    rubric,
    submissionId,
    modelVersion: mode === "model" ? `hf-router:${model}@${GRADING_ENGINE_VERSION}` : `demo:${DEMO_MODEL_VERSION}`,
    injectionSignals,
    neutralizations: neutralized.neutralized,
    rubricWarnings,
    clientSubmissionIdIgnored,
  });

  if (!outcome.ok) {
    return { ok: false, status: 502, code: outcome.code, error: outcome.error, details: outcome.details };
  }

  return { ok: true, result: outcome.result, usage, mode };
}
