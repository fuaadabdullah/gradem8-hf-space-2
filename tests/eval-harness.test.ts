import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadDataset, parseRubricCriteria } from "../eval/lib/dataset.mjs";
import { buildPlan, secondPassIds } from "../eval/lib/plan.mjs";
import { executeRun } from "../eval/lib/runner.mjs";
import { buildResult } from "../eval/lib/report.mjs";
import { renderReport, claimSentence } from "../eval/lib/render.mjs";
import { mulberry32 } from "../eval/lib/stats.mjs";

const dataset = loadDataset();
const TIER_SCORE: Record<string, number> = { bad: 1, average: 2, good: 3, excellent: 4 };
const clamp = (v: number) => Math.max(0, Math.min(4, v));
const noise = (key: string, spread = 1) => {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.round((mulberry32(h >>> 0)() - 0.5) * 2 * spread * 0.99);
};

type StubOptions = { engine?: boolean; noExtractedText?: boolean; adjust?: boolean; mode?: string; diagnostics?: boolean; usage?: boolean; failEvery?: number; breakTotals?: boolean; fall?: boolean; jitter?: boolean; dropExplanation?: boolean };

/** Stands in for /api/grade. It identifies the essay by pasted text or file name, then scores it by intended tier +/- noise. */
function startStub(opts: StubOptions = {}): Promise<{ server: Server; url: string }> {
  let count = 0;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const byText = new Map(dataset.essays.map((e: { text: string }) => [norm(e.text), e]));
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": String(req.headers["content-type"]) } }).formData();
    count++;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (opts.failEvery && count % opts.failEvery === 0) return send(502, { error: "model down", code: "MODEL_FAILED" });

    const file = form.get("files");
    const essay: any = file instanceof File ? dataset.byId.get(file.name.replace(/\.[a-z]+$/, "")) : byText.get(norm(String(form.get("essay"))));
    const criteria = parseRubricCriteria(String(form.get("rubric")));
    const scored = criteria.map((c: { name: string; maxScore: number }, i: number) => {
      const score = essay.kind === "adversarial" && opts.fall ? c.maxScore : clamp(TIER_SCORE[essay.tier] + noise(`m${essay.id}${i}${opts.jitter ? count : ""}`));
      return { ...c, score, explanation: opts.dropExplanation && i === 0 ? "No explanation returned." : "fine", evidence: ["quote"] };
    });
    const total = scored.reduce((s: number, c: { score: number }) => s + c.score, 0);
    const report: Record<string, unknown> = {
      name: essay.id, extractedText: essay.text, criteria: scored, strengths: ["s"], improvements: ["i"],
      totalScore: opts.breakTotals ? total + 1 : total, maxScore: criteria.reduce((s: number, c: { maxScore: number }) => s + c.maxScore, 0),
    };
    if (opts.diagnostics) report.diagnostics = { schemaValid: true, issues: [] };
    if (opts.usage) report.usage = { prompt_tokens: 900, completion_tokens: 300 };
    if (opts.noExtractedText) delete report.extractedText;
    if (opts.engine) {
      // The validated-engine response shape: snake_case, integrity block, no `mode` field.
      const injected = essay.kind === "adversarial";
      return send(200, {
        submission_id: "srv-1", model_version: opts.mode === "demo" ? "demo-heuristic-grader-v1" : "meta-llama/Llama-3.1-8B-Instruct",
        rubric_results: scored.map((c: any) => ({ criterion: c.name, criterion_id: c.name, score: c.score, max_score: c.maxScore, reasoning: c.explanation, evidence: c.evidence, feedback: "" })),
        total_score: total, max_score: report.maxScore, overall_feedback: "", strengths: ["s"], improvements: ["i"], confidence: 0.8,
        ...(opts.noExtractedText ? {} : { extracted_text: essay.text }),
        integrity: {
          engine_version: "gradem8-grader-v1", totals_source: "server", arithmetic_corrected: Boolean(opts.adjust), model_reported_total: total, model_reported_max_score: report.maxScore,
          score_adjustments: opts.adjust ? [{ criterion_id: "x", reported: 9, applied: 4, reason: "clamped" }] : [], unmatched_criteria: [], missing_criteria: [], duplicate_criteria: [], positional_fallback: false,
          injection: { detected: injected, categories: injected ? ["instruction-override"] : [], signals: [], requires_human_review: injected },
        },
      });
    }
    send(200, { reports: [report], mode: opts.mode ?? "model" });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

function writeHumanLabels(dir: string) {
  const make = (kind: string, salt: string, only?: Set<string>, extra = {}) => {
    const labels: Record<string, unknown> = {};
    for (const e of dataset.essays.filter((x: { kind: string; id: string }) => x.kind === "core" && (!only || only.has(x.id)))) {
      labels[e.id] = { scores: Object.fromEntries(e.rubric.criteria.map((c: { name: string }, i: number) => [c.name, clamp(TIER_SCORE[e.tier] + noise(`${salt}${e.id}${i}`))])) };
    }
    fs.writeFileSync(path.join(dir, `${kind}.json`), JSON.stringify({ grader: "test", kind, ...extra, labels }));
  };
  make("primary", "h1");
  make("second", "h2", new Set(secondPassIds(dataset)), { secondKind: "intra" });
}

const SMALL = { repeats: 2, repeatPerTier: 1, parsePerTier: 1 };
const cleanup: Server[] = [];
afterAll(() => cleanup.forEach((s) => s.close()));

async function run(opts: StubOptions, plan = buildPlan(dataset, SMALL), extra = {}) {
  const { server, url } = await startStub(opts);
  cleanup.push(server);
  return executeRun({ dataset, plan, baseUrl: url, ...extra });
}
const status = (result: any, id: string) => result.gates.find((g: any) => g.id === id).status;

describe("evaluation harness against a well-behaved stub", () => {
  let result: any;
  let raw: any;
  let labelsDir: string;

  beforeAll(async () => {
    labelsDir = fs.mkdtempSync(path.join(os.tmpdir(), "labels-"));
    writeHumanLabels(labelsDir);
    raw = await run({ diagnostics: true, usage: true, jitter: true }, buildPlan(dataset));
    result = buildResult(raw, dataset, { labelsDir });
  }, 60_000);

  it("issues exactly the planned requests and records failures as data", () => {
    expect(raw.requests).toHaveLength(156);
    expect(raw.meta.modes).toEqual(["model"]);
    expect(result.metrics.reliability.successRate).toBe(1);
  });

  it("measures parse success, arithmetic and schema validity from the run", () => {
    expect(result.metrics.parse.rate).toBe(1);
    expect(result.metrics.structure.arithmeticViolations).toBe(0);
    expect(result.metrics.structure.validityMethod).toBe("diagnostics");
    for (const id of ["schemaValid", "arithmetic", "fileParse", "requestSuccess"]) expect(status(result, id)).toBe("PASS");
    expect(status(result, "p95Latency")).toBe("DOCUMENTED");
  });

  it("scores against human labels with intervals, and compares the model to the human ceiling", () => {
    const o = result.metrics.accuracy.overall;
    expect(o.essays).toBe(60);
    expect(o.criterionScores).toBe(20 * 5 + 20 * 4 + 20 * 4);
    expect(o.qwk).toBeGreaterThan(0.4);
    expect(o.qwkCI.lower).toBeLessThan(o.qwk);
    expect(o.qwkCI.upper).toBeGreaterThan(o.qwk);
    expect(result.metrics.humanAgreement.human.essays).toBe(16);
    expect(result.metrics.humanAgreement.modelOnSameEssays.essays).toBe(16);
    expect(status(result, "within1")).not.toBe("NOT_MEASURED");
  });

  it("checks repeatability, tier ordering, cost tokens and the injection probe", () => {
    expect(result.metrics.repeatability.essays).toBe(16);
    expect(result.metrics.repeatability.criterionCellsAnyChange).toBeGreaterThan(0);
    expect(result.metrics.tierCheck.monotonic).toBe(true);
    expect(result.metrics.cost.reportsWithUsage).toBeGreaterThan(0);
    expect(result.metrics.cost.perEssay).toBeNull();
    expect(result.metrics.injection).toHaveLength(4);
    expect(result.metrics.injection.filter((x: any) => x.flagged)).toHaveLength(0);
  });

  it("can report READY only when synthetic accuracy and security evidence are present", () => {
    expect(status(result, "criticalSecurity")).toBe("PASS");
    expect(result.verdict.ready).toBe(true);
    const markdown = renderReport(result);
    expect(markdown).toContain("v1 release gate: READY");
    expect(markdown).toContain("Human disagreement");
    expect(claimSentence(result)).toMatch(/single human grader/);
  });
});

describe("evaluation harness against the validated-engine response shape", () => {
  const labelsOf = () => fs.mkdtempSync(path.join(os.tmpdir(), "x-"));

  it("reads integrity data as authoritative diagnostics and measures injection detection", async () => {
    const result = buildResult(await run({ engine: true }, buildPlan(dataset)), dataset, { labelsDir: labelsOf() });
    expect(result.metrics.reliability.successRate).toBe(1);
    expect(result.metrics.structure.validityMethod).toBe("diagnostics");
    expect(status(result, "schemaValid")).toBe("PASS");
    expect(status(result, "arithmetic")).toBe("PASS");
    expect(result.metrics.injectionDetection).toMatchObject({ measurable: true, probes: 4, probesDetected: 4, falsePositives: 0 });
    expect(result.metrics.parse.rate).toBe(1);
    expect(result.metrics.parse.textUnverified).toBe(0);
  });

  it("counts coerced scores as invalid model output and reports how often the model's own total was wrong", async () => {
    const result = buildResult(await run({ engine: true, adjust: true }), dataset, { labelsDir: labelsOf() });
    expect(status(result, "schemaValid")).toBe("FAIL");
    expect(result.metrics.structure.modelArithmeticCorrected).toBe(result.metrics.structure.reports);
  });

  it("does not pretend to verify text fidelity when the API returns no extracted text", async () => {
    const result = buildResult(await run({ engine: true, noExtractedText: true }), dataset, { labelsDir: labelsOf() });
    expect(result.metrics.parse.textUnverified).toBe(result.metrics.parse.n);
    expect(renderReport(result)).toContain("could not be checked for text loss");
  });

  it("detects a demo-mode engine from its model version even without a mode field", async () => {
    await expect(run({ engine: true, mode: "demo" })).rejects.toThrow(/demo mode/);
  });
});

describe("evaluation harness failure paths", () => {
  it("makes no accuracy claim without human labels", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "nolabels-"));
    const result = buildResult(await run({ diagnostics: true }), dataset, { labelsDir: empty });
    expect(result.metrics.accuracy).toBeNull();
    expect(status(result, "within1")).toBe("NOT_MEASURED");
    expect(status(result, "weightedKappa")).toBe("NOT_MEASURED");
    expect(claimSentence(result)).toMatch(/No accuracy claim is possible/);
  });

  it("fails the request-success gate when the model backend keeps failing", async () => {
    const result = buildResult(await run({ diagnostics: true, failEvery: 10 }), dataset, { labelsDir: fs.mkdtempSync(path.join(os.tmpdir(), "x-")) });
    expect(result.metrics.reliability.failuresByCode.MODEL_FAILED).toBeGreaterThan(0);
    expect(status(result, "requestSuccess")).toBe("FAIL");
  });

  it("fails the arithmetic gate when totals do not equal the sum of criteria", async () => {
    const result = buildResult(await run({ diagnostics: true, breakTotals: true }), dataset, { labelsDir: fs.mkdtempSync(path.join(os.tmpdir(), "x-")) });
    expect(status(result, "arithmetic")).toBe("FAIL");
    expect(result.metrics.structure.arithmeticExamples.length).toBeGreaterThan(0);
  });

  it("cannot certify schema validity from a clean proxy, but does catch a repaired response", async () => {
    const clean = buildResult(await run({}), dataset, { labelsDir: fs.mkdtempSync(path.join(os.tmpdir(), "x-")) });
    expect(clean.metrics.structure.validityMethod).toBe("proxy");
    expect(status(clean, "schemaValid")).toBe("NOT_MEASURED");
    const repaired = buildResult(await run({ dropExplanation: true }), dataset, { labelsDir: fs.mkdtempSync(path.join(os.tmpdir(), "x-")) });
    expect(status(repaired, "schemaValid")).toBe("FAIL");
  });

  it("flags a grader that falls for prompt injection", async () => {
    const result = buildResult(await run({ diagnostics: true, fall: true }, buildPlan(dataset, { repeats: 1, repeatPerTier: 0, parsePerTier: 0 })), dataset, { labelsDir: fs.mkdtempSync(path.join(os.tmpdir(), "x-")) });
    expect(result.metrics.injection.every((x: any) => x.flagged)).toBe(true);
  });

  it("refuses to record demo-mode answers as a model evaluation unless told it is a baseline", async () => {
    await expect(run({ mode: "demo" })).rejects.toThrow(/demo mode/);
    const baseline = await run({ mode: "demo" }, buildPlan(dataset, SMALL), { allowDemo: true });
    expect(baseline.meta.modes).toEqual(["demo"]);
  });

  it("times out slow servers into a CLIENT_TIMEOUT failure instead of hanging", async () => {
    const server = createServer(() => {
      /* never respond */
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    cleanup.push(server);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const plan = buildPlan(dataset, SMALL).slice(0, 1);
    const result = await executeRun({ dataset, plan, baseUrl: url, timeoutMs: 150 });
    expect(result.requests[0]).toMatchObject({ ok: false, code: "CLIENT_TIMEOUT" });
    server.closeAllConnections?.();
  });
});
