#!/usr/bin/env node
// Runs the benchmark against a live /api/grade and scores it against whatever human labels exist.
//   node eval/run.mjs --base-url http://localhost:3000 --model meta-llama/Llama-3.1-8B-Instruct
//   node eval/run.mjs --dry-run            (print the request plan and exit; costs nothing)
import fs from "node:fs";
import path from "node:path";
import { EVAL_DIR, loadDataset, validateDataset } from "./lib/dataset.mjs";
import { parseArgs, intArg } from "./lib/args.mjs";
import { buildPlan } from "./lib/plan.mjs";
import { executeRun } from "./lib/runner.mjs";
import { buildResult } from "./lib/report.mjs";
import { renderReport } from "./lib/render.mjs";

const args = parseArgs(process.argv.slice(2));
const dataset = loadDataset();
const { errors } = validateDataset(dataset);
if (errors.length) {
  console.error(`Dataset is invalid:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

let plan = buildPlan(dataset, { repeats: intArg(args.repeats, 3), repeatPerTier: intArg(args["repeat-per-tier"], 4), parsePerTier: intArg(args["parse-per-tier"], 5) });
if (args.limit) plan = plan.slice(0, intArg(args.limit, plan.length));

const counts = plan.reduce((acc, j) => ({ ...acc, [j.kind]: (acc[j.kind] || 0) + 1 }), {});
console.log(`Plan: ${plan.length} requests ${JSON.stringify(counts)} against ${args["base-url"] || "http://localhost:3000"}`);
if (args["dry-run"]) process.exit(0);

const baseUrl = args["base-url"] || "http://localhost:3000";
try {
  const run = await executeRun({
    dataset,
    plan,
    baseUrl,
    model: typeof args.model === "string" ? args.model : null,
    concurrency: intArg(args.concurrency, 1),
    delayMs: intArg(args["delay-ms"], 0),
    timeoutMs: intArg(args["timeout-ms"], 90_000),
    allowDemo: Boolean(args["allow-demo"]),
    log: (r, i, n) => process.stdout.write(`\r[${i}/${n}] ${r.kind} ${r.essayId}${r.format ? "." + r.format : ""} ${r.ok ? "ok" : "FAIL " + r.code}          `),
  });
  console.log("");
  const runsDir = path.join(EVAL_DIR, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const file = path.join(runsDir, `${run.meta.runId}.json`);
  fs.writeFileSync(file, JSON.stringify(run, null, 1));
  console.log(`Saved ${path.relative(process.cwd(), file)}\n`);
  console.log(renderReport(buildResult(run, dataset)));
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(2);
}
