import { afterEach, describe, expect, it, vi } from "vitest";
import { runGradingEngine } from "../lib/grading/engine";
import { parseRubricText } from "../lib/grading/rubric";
import { buildDemoGradingOutput } from "../lib/grading/demo";

/**
 * Cost per essay is only measurable if the engine passes the provider's token counts through.
 * A demo-mode run calls no model and so has no tokens; that is expected, not a missing feature.
 * These tests pin the difference, because the evaluation report distinguishes the two cases.
 */
const { rubric } = parseRubricText("Test rubric", "Thesis - 4 points\nEvidence - 4 points");
const essay = "A short but complete essay about a clear position, with one supporting reason.";

// The engine's own demo output is a schema-valid report, so the test exercises the usage path
// rather than a hand-written payload that could drift from the validator.
const modelReply = (usage: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: buildDemoGradingOutput(rubric, essay) } }], ...(usage ? { usage } : {}) }),
});

afterEach(() => vi.unstubAllGlobals());

describe("token usage from the grading engine", () => {
  it("passes the provider's token counts through in model mode", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelReply({ prompt_tokens: 1234, completion_tokens: 321 })));
    const outcome = await runGradingEngine({ submissionText: essay, rubric, model: "meta-llama/Llama-3.1-8B-Instruct", token: "test-token" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.mode).toBe("model");
    expect(outcome.usage).toEqual({ prompt_tokens: 1234, completion_tokens: 321 });
  });

  it("accepts camelCase usage from a provider that sends it that way", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelReply({ promptTokens: 10, completionTokens: 5 })));
    const outcome = await runGradingEngine({ submissionText: essay, rubric, token: "test-token" });
    expect(outcome.ok && outcome.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
  });

  it("omits usage rather than inventing zeros when the provider sends none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelReply(null)));
    const outcome = await runGradingEngine({ submissionText: essay, rubric, token: "test-token" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.usage).toBeUndefined();
  });

  it("reports demo mode with no usage when there is no token", async () => {
    const outcome = await runGradingEngine({ submissionText: essay, rubric });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.mode).toBe("demo");
    expect(outcome.usage).toBeUndefined();
  });
});
