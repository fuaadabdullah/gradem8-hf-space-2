#!/usr/bin/env node
// Re-scores a saved run against the current labels. Use this after labeling; no model calls are made.
//   node eval/report.mjs eval/runs/<run>.json [--json out.json] [--out report.md]
import fs from "node:fs";
import { loadDataset } from "./lib/dataset.mjs";
import { parseArgs } from "./lib/args.mjs";
import { buildResult } from "./lib/report.mjs";
import { renderReport } from "./lib/render.mjs";

const args = parseArgs(process.argv.slice(2));
const file = args._[0];
if (!file) {
  console.error("Usage: node eval/report.mjs <run.json> [--json out.json] [--out report.md]");
  process.exit(1);
}
const run = JSON.parse(fs.readFileSync(file, "utf8"));
const dataset = loadDataset();
if (run.meta.datasetHash !== dataset.hash) console.warn(`Warning: run used dataset ${run.meta.datasetHash} but the current dataset is ${dataset.hash}; essay text or tiers changed since.\n`);
const result = buildResult(run, dataset);
const markdown = renderReport(result);
if (typeof args.json === "string") fs.writeFileSync(args.json, JSON.stringify(result, null, 2));
if (typeof args.out === "string") fs.writeFileSync(args.out, markdown);
console.log(markdown);
process.exit(result.verdict.fail ? 3 : 0);
