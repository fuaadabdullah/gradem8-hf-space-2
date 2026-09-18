/**
 * Server-authoritative rubric model for the Gradem8 grading engine.
 *
 * The rubric is always parsed and scored on the server. Nothing the student
 * submits (and nothing the model returns) is allowed to change a criterion id,
 * a criterion maximum, or the maximum total. Downstream code reads these values
 * from here, never from model output.
 */

export type RubricCriterion = {
  /** Stable, slugified identifier used to match model output back to the rubric. */
  id: string;
  /** Teacher-facing label. */
  name: string;
  /** Maximum points for this criterion. Server-owned. */
  maxScore: number;
};

export type Rubric = {
  title: string;
  criteria: RubricCriterion[];
  /** Sum of every criterion maximum. Always recomputed, never supplied by a model. */
  maxScore: number;
};

export const MAX_RUBRIC_CHARS = 12_000;
export const MAX_CRITERIA = 20;
export const MIN_CRITERION_MAX_SCORE = 1;
export const MAX_CRITERION_MAX_SCORE = 100;
export const MAX_CRITERION_NAME_CHARS = 120;
export const MAX_UNPARSED_LINES = 5;

/**
 * Accepts the rubric formats teachers actually paste:
 *   "Thesis - 25 points", "Evidence: 25", "Analysis (20 pts)", "Mechanics - 15 points"
 */
const CRITERION_LINE = /^(.*?)(?:\s*[-–—:]\s*|\s*\()([0-9]+(?:\.[0-9]+)?)(?:\s*(?:points?|pts?)\)?\s*)$/i;
/**
 * A looser shape used only for reporting: lines that were clearly meant as criteria
 * (name, separator, number) but failed validation. Ordinary prose is never reported.
 */
const LOOKS_LIKE_CRITERION = /^(.*?)(?:\s*[-–—:]\s*|\s*\()\s*[0-9]+(?:\.[0-9]+)?(?:\s*\/\s*[0-9]+)?\s*(?:points?|pts?)?\s*\)?\s*$/i;

export type ParsedRubric = {
  rubric: Rubric;
  /** Lines that contain a number but did not parse. Surfaced so a rubric never shrinks silently. */
  unparsedLines: string[];
  /** True when more than MAX_CRITERIA criteria were found and the remainder was dropped. */
  truncated: boolean;
};

export function criterionId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug || "criterion";
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseRubricText(title: string, rubricText: string): ParsedRubric {
  const criteria: RubricCriterion[] = [];
  const unparsedLines: string[] = [];
  const usedIds = new Set<string>();
  let truncated = false;

  for (const rawLine of rubricText.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, "");
    if (!line) continue;

    const match = line.match(CRITERION_LINE);
    if (!match) {
      // Only report lines that were clearly meant to be criteria, never ordinary prose.
      if (LOOKS_LIKE_CRITERION.test(line) && unparsedLines.length < MAX_UNPARSED_LINES) {
        unparsedLines.push(line.slice(0, 160));
      }
      continue;
    }

    const name = match[1].trim().slice(0, MAX_CRITERION_NAME_CHARS);
    const maxScore = Number(match[2]);
    if (!name) continue;
    if (!Number.isFinite(maxScore) || maxScore < MIN_CRITERION_MAX_SCORE || maxScore > MAX_CRITERION_MAX_SCORE) {
      if (unparsedLines.length < MAX_UNPARSED_LINES) unparsedLines.push(line.slice(0, 160));
      continue;
    }

    let id = criterionId(name);
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}_${suffix}`)) suffix += 1;
      id = `${id}_${suffix}`;
    }

    if (criteria.length >= MAX_CRITERIA) {
      truncated = true;
      break;
    }

    usedIds.add(id);
    criteria.push({ id, name, maxScore: round2(maxScore) });
  }

  return {
    rubric: {
      title: title.slice(0, MAX_CRITERION_NAME_CHARS) || "Grading rubric",
      criteria,
      maxScore: round2(criteria.reduce((sum, criterion) => sum + criterion.maxScore, 0)),
    },
    unparsedLines,
    truncated,
  };
}

/**
 * Matches a criterion label coming from a model back to the server rubric.
 * Model output is matched by id or by normalized name; anything else is ignored.
 */
export function normalizeCriterionKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function createCriterionIndex(rubric: Rubric): Map<string, RubricCriterion> {
  const index = new Map<string, RubricCriterion>();
  for (const criterion of rubric.criteria) {
    index.set(normalizeCriterionKey(criterion.id), criterion);
    index.set(normalizeCriterionKey(criterion.name), criterion);
  }
  return index;
}
