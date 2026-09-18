import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TIERS = ["bad", "average", "good", "excellent"];

// Mirrors the "Name - N points" line contract that /api/grade parses rubrics with. It is a copy,
// so a drift in the route shows up as MALFORMED_RUBRIC failures in a real run, not here.
const CRITERION_LINE = /^(.*?)(?:\s*[-–—:]\s*|\s*\()([0-9]+(?:\.[0-9]+)?)(?:\s*(?:points?|pts?)\)?\s*)$/i;

export function parseRubricCriteria(rubricText) {
  const criteria = [];
  for (const rawLine of rubricText.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, "");
    const match = line && line.match(CRITERION_LINE);
    if (!match) continue;
    const name = match[1].trim();
    const maxScore = Number(match[2]);
    if (name && maxScore > 0 && maxScore <= 100) criteria.push({ name, maxScore });
  }
  return criteria;
}

/** The exact rubric string sent to the grader. The assignment is included because the API takes no separate prompt field. */
export function buildRubricText(rubric, prompt) {
  const lines = [
    `Rubric: ${rubric.title}`,
    `Assignment: ${prompt.text}`,
    "Score each criterion with a whole number from 0 to 4, where 0 is absent, 1 is weak, 2 is developing, 3 is proficient and 4 is excellent.",
    "",
  ];
  for (const criterion of rubric.criteria) {
    lines.push(`- ${criterion.name} - ${criterion.maxScore} points`);
    lines.push(`  Looks for: ${criterion.description}`);
  }
  return lines.join("\n");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadDataset(dir = path.join(EVAL_DIR, "dataset")) {
  const rubrics = Object.fromEntries(readJson(path.join(dir, "rubrics.json")).map((r) => [r.id, r]));
  const prompts = Object.fromEntries(readJson(path.join(dir, "prompts.json")).map((p) => [p.id, p]));
  const essayFiles = fs.readdirSync(path.join(dir, "essays")).filter((f) => f.endsWith(".json")).sort();
  const rawEssays = essayFiles.flatMap((file) => readJson(path.join(dir, "essays", file)));
  const rawById = new Map(rawEssays.map((raw) => [raw.id, raw]));
  const essays = rawEssays.map((raw) => {
    // Adversarial essays are a base essay plus appended text; they inherit prompt and tier from the base.
    const base = raw.baseEssayId ? rawById.get(raw.baseEssayId) : null;
    const merged = base ? { promptId: base.promptId, tier: base.tier, ...raw, paragraphs: [...base.paragraphs, ...(raw.appended || [])] } : raw;
    const prompt = prompts[merged.promptId];
    const rubric = prompt && rubrics[prompt.rubricId];
    return {
      ...merged,
      kind: merged.kind || "core",
      text: (merged.paragraphs || []).join("\n\n"),
      prompt,
      rubric,
      rubricText: prompt && rubric ? buildRubricText(rubric, prompt) : "",
    };
  });
  const hash = createHash("sha256")
    .update(JSON.stringify([rubrics, prompts, essays.map((e) => [e.id, e.tier, e.text])]))
    .digest("hex")
    .slice(0, 12);
  return { rubrics, prompts, essays, byId: new Map(essays.map((e) => [e.id, e])), hash };
}

export const wordCount = (text) => (text.match(/\S+/g) || []).length;

/** Structural checks on the benchmark itself. Returns { errors, warnings, summary }. */
export function validateDataset(dataset) {
  const errors = [];
  const warnings = [];
  const { rubrics, prompts, essays } = dataset;

  for (const rubric of Object.values(rubrics)) {
    const prompt = Object.values(prompts).find((p) => p.rubricId === rubric.id);
    if (!prompt) {
      errors.push(`rubric ${rubric.id} has no prompt`);
      continue;
    }
    const parsed = parseRubricCriteria(buildRubricText(rubric, prompt));
    const declared = rubric.criteria.map((c) => `${c.name}|${c.maxScore}`);
    if (parsed.map((c) => `${c.name}|${c.maxScore}`).join(";") !== declared.join(";")) {
      errors.push(`rubric ${rubric.id}: rendered text does not parse back to its declared criteria`);
    }
    if (rubric.criteria.some((c) => c.maxScore !== 4)) errors.push(`rubric ${rubric.id}: every criterion must be scored 0-4 (pooled kappa assumes one scale)`);
  }

  const ids = new Set();
  const texts = new Set();
  const cells = {};
  for (const essay of essays) {
    if (ids.has(essay.id)) errors.push(`duplicate essay id ${essay.id}`);
    ids.add(essay.id);
    if (texts.has(essay.text)) errors.push(`duplicate essay text ${essay.id}`);
    texts.add(essay.text);
    if (!essay.prompt || !essay.rubric) errors.push(`essay ${essay.id}: unknown promptId ${essay.promptId}`);
    if (!TIERS.includes(essay.tier)) errors.push(`essay ${essay.id}: invalid tier ${essay.tier}`);
    if (!/^[\x20-\x7E\n]+$/.test(essay.text)) errors.push(`essay ${essay.id}: non-ASCII text (breaks the hand-built PDF fixtures)`);
    if (essay.text.includes('"')) warnings.push(`essay ${essay.id}: contains a double quote`);
    if (essay.kind === "adversarial") {
      if (!essay.baseEssayId || !dataset.byId.has(essay.baseEssayId)) errors.push(`adversarial ${essay.id}: missing baseEssayId`);
    } else {
      const key = `${essay.promptId}/${essay.tier}`;
      cells[key] = (cells[key] || 0) + 1;
    }
  }

  const core = essays.filter((e) => e.kind !== "adversarial");
  if (core.length < 50 || core.length > 100) errors.push(`expected 50-100 core essays, found ${core.length}`);
  for (const promptId of Object.keys(prompts)) {
    for (const tier of TIERS) {
      if (!cells[`${promptId}/${tier}`]) errors.push(`no essays for ${promptId}/${tier}`);
    }
  }
  const counts = Object.values(cells);
  if (counts.length && Math.max(...counts) - Math.min(...counts) > 1) warnings.push("prompt/tier cells are unbalanced");

  const meanWords = Object.fromEntries(
    TIERS.map((tier) => {
      const group = core.filter((e) => e.tier === tier).map((e) => wordCount(e.text));
      return [tier, group.length ? Math.round(group.reduce((a, b) => a + b, 0) / group.length) : 0];
    }),
  );
  return {
    errors,
    warnings,
    summary: { core: core.length, adversarial: essays.length - core.length, prompts: Object.keys(prompts).length, rubrics: Object.keys(rubrics).length, meanWordsByTier: meanWords, hash: dataset.hash },
  };
}
