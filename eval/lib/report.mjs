import fs from "node:fs";
import path from "node:path";
import { EVAL_DIR } from "./dataset.mjs";
import { readLabels, LABELS_DIR } from "./labels.mjs";
import { secondPassIds } from "./plan.mjs";
import { analyze } from "./analyze.mjs";

const readJsonIfExists = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);

/** Scores a raw run against whatever labels exist today. Re-run it any time labels change; the run is not repeated. */
export function buildResult(run, dataset, { labelsDir = LABELS_DIR, evalDir = EVAL_DIR } = {}) {
  return analyze({
    run,
    dataset,
    labels: readLabels(labelsDir),
    gate: readJsonIfExists(path.join(evalDir, "gate.json")),
    pricing: readJsonIfExists(path.join(evalDir, "pricing.json")) || {},
    security: readJsonIfExists(path.join(evalDir, "security.json")),
    secondPass: secondPassIds(dataset),
  });
}
