import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/infer/route";

function request(body: unknown, ip = `198.51.100.${Math.floor(Math.random() * 200)}`) {
  return new NextRequest("http://localhost/api/infer", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

async function responseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  delete process.env.HUGGINGFACE_API_TOKEN;
  delete process.env.HUGGINGFACE_MODEL_DEFAULT;
  vi.restoreAllMocks();
});

describe("POST /api/infer", () => {
  it("rejects malformed JSON and missing prompts", async () => {
    const malformed = new NextRequest("http://localhost/api/infer", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10" },
      body: "{",
    });
    expect((await POST(malformed)).status).toBe(400);
    expect(await responseBody(await POST(request({})))) .toMatchObject({ code: "PROMPT_REQUIRED" });
  });

  it("enforces prompt and model validation", async () => {
    const tooLong = await POST(request({ prompt: "x".repeat(6001) }));
    expect(tooLong.status).toBe(400);
    expect(await responseBody(tooLong)).toMatchObject({ code: "PROMPT_TOO_LONG" });

    const invalidModel = await POST(request({ prompt: "hello", model: "bad model" }));
    expect(invalidModel.status).toBe(400);
    expect(await responseBody(invalidModel)).toMatchObject({ code: "INVALID_MODEL" });
  });

  it("returns a demo response and normalizes the supported model alias without a token", async () => {
    const response = await POST(request({ prompt: "hello", model: "meta-llama/Meta-Llama-3.1-8B-Instruct" }));
    expect(response.status).toBe(200);
    expect(await responseBody(response)).toMatchObject({
      model: "meta-llama/Llama-3.1-8B-Instruct",
      latencyMs: 0,
      output: expect.stringContaining("Prompt received: hello"),
    });
  });

  it("maps a successful upstream response", async () => {
    process.env.HUGGINGFACE_API_TOKEN = "test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "Generated answer" } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ prompt: "hello", model: "org/model" }));
    expect(response.status).toBe(200);
    expect(await responseBody(response)).toMatchObject({ output: "Generated answer", model: "org/model" });
    expect(fetchMock).toHaveBeenCalledWith("https://router.huggingface.co/v1/chat/completions", expect.objectContaining({ method: "POST" }));
  });

  it.each([
    [429, "RATE_LIMITED"],
    [503, "MODEL_LOADING"],
    [500, "UPSTREAM_ERROR"],
    [400, "INFERENCE_REJECTED"],
  ])("maps upstream status %i to %s", async (status, code) => {
    process.env.HUGGINGFACE_API_TOKEN = "test-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Upstream detail" } }), { status, headers: { "content-type": "application/json" } })));

    const response = await POST(request({ prompt: "hello", model: "org/model" }));
    expect(response.status).toBe(status);
    expect(await responseBody(response)).toMatchObject({ code, error: "Upstream detail" });
  });

  it("handles unreachable and malformed upstream responses", async () => {
    process.env.HUGGINGFACE_API_TOKEN = "test-token";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await responseBody(await POST(request({ prompt: "hello" })))).toMatchObject({ code: "UPSTREAM_UNREACHABLE" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "content-type": "application/json" } })));
    expect(await responseBody(await POST(request({ prompt: "hello" })))).toMatchObject({ code: "EMPTY_OUTPUT" });
  });

  it("rate limits the eleventh request from the same instance and IP", async () => {
    const ip = "198.51.100.250";
    for (let count = 0; count < 10; count += 1) {
      expect((await POST(request({ prompt: "hello" }, ip))).status).toBe(200);
    }
    const limited = await POST(request({ prompt: "hello" }, ip));
    expect(limited.status).toBe(429);
    expect(await responseBody(limited)).toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
