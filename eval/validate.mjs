#!/usr/bin/env node
// Structural checks on the benchmark dataset: node eval/validate.mjs
import { loadDataset, validateDataset } from "./lib/dataset.mjs";

const { errors, warnings, summary } = validateDataset(loadDataset());
console.log(JSON.stringify(summary, null, 2));
for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
process.exit(errors.length ? 1 : 0);
