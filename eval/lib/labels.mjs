import fs from "node:fs";
import path from "node:path";
import { EVAL_DIR } from "./dataset.mjs";

export const LABELS_DIR = path.join(EVAL_DIR, "labels");

/**
 * Label file: { grader, kind: "primary" | "second", secondKind?: "intra" | "inter", labels: { [essayId]: { scores: { [criterion]: int } } } }
 * primary.json is the reference the model is scored against; second.json re-labels a subset to measure human disagreement.
 */
export function readLabels(dir = LABELS_DIR) {
  const out = {};
  for (const kind of ["primary", "second"]) {
    const file = path.join(dir, `${kind}.json`);
    if (fs.existsSync(file)) out[kind] = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return out;
}

export function writeLabels(kind, data, dir = LABELS_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${kind}.json`), JSON.stringify(data, null, 2) + "\n");
}

/** Ordered integer scores for an essay, or null if the label is missing/invalid for this rubric. */
export function labelVector(labelFile, essay) {
  const scores = labelFile?.labels?.[essay.id]?.scores;
  if (!scores) return null;
  const vector = essay.rubric.criteria.map((c) => scores[c.name]);
  return vector.every((v, i) => Number.isInteger(v) && v >= 0 && v <= essay.rubric.criteria[i].maxScore) ? vector : null;
}
