import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/grade/route";

function formRequest(fields: Record<string, string>, files: File[] = []) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.set(key, value));
  files.forEach((file) => form.append("files", file));
  return new NextRequest("http://localhost/api/grade", { method: "POST", body: form });
}

async function body(response: Response) { return await response.json() as Record<string, unknown>; }

beforeEach(() => {
  delete process.env.HUGGINGFACE_API_TOKEN;
  vi.restoreAllMocks();
});

describe("POST /api/grade", () => {
  it("grades a pasted essay in deterministic demo mode and returns review fields", async () => {
    const response = await POST(formRequest({ rubric: "Thesis - 20 points\nEvidence - 30 points", essay: "A clear thesis supported by evidence." }));
    const data = await body(response);
    expect(response.status).toBe(200);
    expect(data).toMatchObject({ mode: "demo" });
    expect(data.reports).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Pasted essay", extractedText: "A clear thesis supported by evidence.", totalScore: expect.any(Number), maxScore: 50, strengths: expect.any(Array), improvements: expect.any(Array) })]));
  });

  it("extracts a batch of TXT files", async () => {
    const files = [new File(["first paper"], "first.txt", { type: "text/plain" }), new File(["second paper"], "second.txt", { type: "text/plain" })];
    const response = await POST(formRequest({ rubric: "Content - 10 points" }, files));
    const data = await body(response);
    expect(response.status).toBe(200);
    expect((data.reports as Array<Record<string, unknown>>).map((report) => report.extractedText)).toEqual(["first paper", "second paper"]);
  });

  it("rejects malformed rubrics and oversized submissions clearly", async () => {
    const malformed = await POST(formRequest({ rubric: "Grade it", essay: "paper" }));
    expect(malformed.status).toBe(400);
    expect(await body(malformed)).toMatchObject({ code: "MALFORMED_RUBRIC" });

    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" });
    const response = await POST(formRequest({ rubric: "Content - 10 points" }, [oversized]));
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ code: "FILE_TOO_LARGE" });
  });
});
