import { execSync } from "node:child_process";
import { gradeOnce, readUsage, readDiagnostics, readMode } from "./client.mjs";
import { FORMATS, tokenRecall } from "./fixtures.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function git(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

/** Executes a plan against a running /api/grade and returns the raw run record. Nothing is scored here. */
export async function executeRun({ dataset, plan, baseUrl, model = null, concurrency = 1, delayMs = 0, timeoutMs = 90_000, allowDemo = false, parseRecallMin = 0.98, log = () => {} }) {
  const startedAt = new Date();
  const requests = new Array(plan.length);
  const modes = new Set();
  let next = 0;
  let demoAbort = false;

  async function worker() {
    while (!demoAbort) {
      const index = next++;
      if (index >= plan.length) return;
      const job = plan[index];
      const essay = dataset.byId.get(job.essayId);
      const args = { baseUrl, rubricText: essay.rubricText, model, timeoutMs };
      if (job.kind === "parse") {
        const format = FORMATS[job.format];
        args.file = { buffer: format.build(essay.text), type: format.type, name: `${essay.id}.${job.format}` };
      } else args.essayText = essay.text;

      const res = await gradeOnce(args);
      const record = { ...job, ok: res.ok, httpStatus: res.httpStatus, code: res.code ?? null, error: res.error ?? null, latencyMs: res.latencyMs };
      if (res.ok) {
        const { extractedText, injection, ...report } = res.reports[0];
        record.mode = readMode(res.body, res.reports[0]);
        record.report = { ...report, extractedChars: String(extractedText ?? "").length };
        record.usage = readUsage(res.body, res.reports[0]);
        record.diagnostics = readDiagnostics(res.body, res.reports[0]);
        record.injection = injection ?? null;
        // Only verifiable when the API echoes what it extracted; otherwise null means "not checked".
        if (job.kind === "parse") record.parseRecall = extractedText == null ? null : tokenRecall(essay.text, String(extractedText));
        modes.add(record.mode);
        if (record.mode === "demo" && !allowDemo) demoAbort = true;
      }
      requests[index] = record;
      log(record, index + 1, plan.length);
      if (delayMs) await sleep(delayMs);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  if (demoAbort) {
    throw new Error("The server answered in demo mode (no HUGGINGFACE_API_TOKEN), so it is grading by word count, not with a model. Refusing to record that as a model evaluation. Pass --allow-demo to record it as a baseline.");
  }

  const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return {
    meta: {
      runId: `${stamp}-${(model || "default-model").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      baseUrl,
      model,
      modes: [...modes],
      datasetHash: dataset.hash,
      gitSha: git("git rev-parse --short HEAD") || "unknown",
      gitDirty: Boolean(git("git status --porcelain")),
      node: process.version,
      options: { concurrency, delayMs, timeoutMs, parseRecallMin },
    },
    requests: requests.filter(Boolean),
  };
}
