import { seededShuffle } from "./stats.mjs";
import { TIERS } from "./dataset.mjs";

export const PARSE_FORMATS = ["txt", "docx", "pdf"];

/** Round-robin over prompts within each tier so small samples still cover every prompt and tier. */
export function stratifiedPick(essays, perTier, seed) {
  const picked = [];
  for (const tier of TIERS) {
    const byPrompt = new Map();
    for (const essay of seededShuffle(essays.filter((e) => e.tier === tier), seed)) {
      if (!byPrompt.has(essay.promptId)) byPrompt.set(essay.promptId, []);
      byPrompt.get(essay.promptId).push(essay);
    }
    const queues = [...byPrompt.values()];
    let taken = 0;
    for (let round = 0; taken < perTier && queues.some((q) => q.length > round); round++) {
      for (const queue of queues) {
        if (taken < perTier && queue[round]) {
          picked.push(queue[round]);
          taken++;
        }
      }
    }
  }
  return picked;
}

/** The essays that get a second human label. Deterministic so label.mjs and the report agree. */
export function secondPassIds(dataset, seed = 20260918, perTier = 4) {
  return stratifiedPick(dataset.essays.filter((e) => e.kind === "core"), perTier, seed).map((e) => e.id);
}

/**
 * Every request the run will make. Attempt 0 of each core essay feeds accuracy metrics; extra
 * attempts on a stratified subset feed repeatability; file variants feed the parse gate;
 * adversarial essays feed the prompt-injection probe.
 */
export function buildPlan(dataset, { repeats = 3, repeatPerTier = 4, parsePerTier = 5, seed = 20260918 } = {}) {
  const core = dataset.essays.filter((e) => e.kind === "core");
  const jobs = core.map((e) => ({ kind: "grade", essayId: e.id, attempt: 0 }));
  for (const essay of stratifiedPick(core, repeatPerTier, seed + 1)) {
    for (let attempt = 1; attempt < repeats; attempt++) jobs.push({ kind: "grade", essayId: essay.id, attempt });
  }
  for (const essay of stratifiedPick(core, parsePerTier, seed + 2)) {
    for (const format of PARSE_FORMATS) jobs.push({ kind: "parse", essayId: essay.id, attempt: 0, format });
  }
  for (const essay of dataset.essays.filter((e) => e.kind === "adversarial")) {
    jobs.push({ kind: "adversarial", essayId: essay.id, attempt: 0 });
  }
  return jobs.map((job, i) => ({ id: i, ...job }));
}
