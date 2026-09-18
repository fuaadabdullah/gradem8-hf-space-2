/**
 * Server-side validation of grading output.
 *
 * The model is never trusted. This module is the only place that produces the
 * canonical grading result:
 *
 *   - criterion results are matched back to the server rubric (by id, then name,
 *     with a recorded positional fallback) and unknown criteria are dropped
 *   - every score is coerced to a number and clamped to the rubric maximum; the
 *     model's own max_score values are ignored
 *   - total_score and max_score are recomputed from the clamped scores, so the
 *     model's arithmetic is never propagated downstream
 *   - a grading that misses a rubric criterion fails closed instead of producing
 *     a misleading total
 *   - submission_id and model_version are always server values
 *   - all model text is sanitized (control characters, invisible characters,
 *     prompt sentinels, length caps) before it leaves the process
 */

import {
  createCriterionIndex,
  normalizeCriterionKey,
  round2,
  type Rubric,
  type RubricCriterion,
} from "./rubric";
import { type InjectionSignal } from "./prompt";

export const MAX_REASONING_CHARS = 1200;
export const MAX_FEEDBACK_CHARS = 600;
export const MAX_OVERALL_FEEDBACK_CHARS = 4000;
export const MAX_EVIDENCE_ITEMS = 4;
export const MAX_EVIDENCE_CHARS = 300;
export const MAX_LIST_ITEMS = 5;
export const MAX_LIST_ITEM_CHARS = 300;
export const INJECTION_CONFIDENCE_CAP = 0.5;

export type ValidatedCriterionResult = {
  criterion: string;
  criterion_id: string;
  score: number;
  max_score: number;
  reasoning: string;
  evidence: string[];
  feedback: string;
};

export type IntegrityReport = {
  engine_version: string;
  totals_source: "server";
  /** True when the request tried to supply its own submission_id and the server ignored it. */
  client_submission_id_ignored: boolean;
  model_reported_total: number | null;
  model_reported_max_score: number | null;
  arithmetic_corrected: boolean;
  score_adjustments: Array<{ criterion_id: string; reported: number | null; applied: number; reason: string }>;
  unmatched_criteria: string[];
  missing_criteria: string[];
  duplicate_criteria: string[];
  positional_fallback: boolean;
  confidence_clamped: boolean;
  confidence_capped: boolean;
  output_sanitized: boolean;
  submission_neutralizations: string[];
  rubric_warnings: string[];
  injection: {
    detected: boolean;
    categories: string[];
    signals: InjectionSignal[];
    requires_human_review: boolean;
  };
};

export type ValidatedGradingResult = {
  submission_id: string;
  rubric_results: ValidatedCriterionResult[];
  total_score: number;
  max_score: number;
  overall_feedback: string;
  strengths: string[];
  improvements: string[];
  confidence: number | null;
  model_version: string;
  integrity: IntegrityReport;
};

export type ValidationInput = {
  raw: unknown;
  rubric: Rubric;
  submissionId: string;
  modelVersion: string;
  injectionSignals: InjectionSignal[];
  neutralizations: string[];
  rubricWarnings: string[];
  clientSubmissionIdIgnored: boolean;
};

export type ValidationOutcome =
  | { ok: true; result: ValidatedGradingResult; code?: undefined; error?: undefined; details?: undefined }
  | { ok: false; code: string; error: string; details?: Record<string, unknown> };

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const INTERNAL_SENTINELS = /(?:non-negotiable rules|<\/?\s*untrusted_submission[^>]*>|gradem8-grader-v\d+)/gi;

export type SanitizeResult = { text: string; sanitized: boolean };

export function sanitizeText(value: unknown, maxChars: number): SanitizeResult {
  const raw = typeof value === "string" ? value : "";
  let sanitized = typeof value !== "string" && value !== undefined && value !== null;

  let text = raw.replace(CONTROL_CHARS, "").replace(INVISIBLE_CHARS, "");
  if (text !== raw) sanitized = true;

  INTERNAL_SENTINELS.lastIndex = 0;
  if (INTERNAL_SENTINELS.test(text)) {
    INTERNAL_SENTINELS.lastIndex = 0;
    text = text.replace(INTERNAL_SENTINELS, "[redacted]");
    sanitized = true;
  }

  const collapsed = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (collapsed !== raw) sanitized = true;
  text = collapsed;

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars).trimEnd()}...`;
    sanitized = true;
  }

  return { text, sanitized };
}

export function coerceNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? round2(numeric) : null;
}

type ParseAttempt = { ok: true; value: unknown } | { ok: false };

function tryParse(text: string): ParseAttempt {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Scans for the first complete JSON object without being fooled by braces in strings. */
function firstJsonObject(text: string): ParseAttempt {
  const start = text.indexOf("{");
  if (start < 0) return { ok: false };

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return tryParse(text.slice(start, index + 1));
    }
  }

  return { ok: false };
}

/** Extracts the model's JSON object from fenced or chatty output. */
export function extractJsonObject(output: string): unknown {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidates = [fenced, output].filter((value): value is string => typeof value === "string" && value.trim() !== "");

  for (const candidate of candidates) {
    const direct = tryParse(candidate.trim());
    if (direct.ok) return direct.value;

    const scanned = firstJsonObject(candidate);
    if (scanned.ok) return scanned.value;
  }

  throw new Error("INVALID_MODEL_OUTPUT");
}

type ScoreResolution = { value: number; reported: number | null; reason?: string };

/** Clamps a model score into the server rubric range. The model's max is never consulted. */
function resolveScore(value: unknown, maxScore: number): ScoreResolution {
  const numeric = coerceNumber(value);
  if (numeric === null) return { value: 0, reported: null, reason: "non_numeric_score" };
  if (numeric < 0) return { value: 0, reported: numeric, reason: "negative_score" };
  if (numeric > maxScore) return { value: maxScore, reported: numeric, reason: "above_criterion_max" };
  return { value: numeric, reported: numeric };
}

function labelOf(entry: Record<string, unknown>): string {
  for (const key of ["criterion", "criterion_id", "id", "name"]) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
  }
  return "";
}

type MatchedEntry = { criterion: RubricCriterion; entry: Record<string, unknown>; positional: boolean };

/**
 * Maps model results onto rubric criteria by id, then by normalized name.
 * Results that do not belong to the rubric are dropped and reported.
 */
function matchResults(rawResults: unknown[], rubric: Rubric) {
  const index = createCriterionIndex(rubric);
  const matched = new Map<string, MatchedEntry>();
  const unmatched: string[] = [];
  const duplicates: string[] = [];
  let positionalFallback = false;

  for (const rawEntry of rawResults) {
    const entry = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry) ? (rawEntry as Record<string, unknown>) : {};
    const label = labelOf(entry);
    const criterion = label ? index.get(normalizeCriterionKey(label)) : undefined;

    if (!criterion) {
      if (label) unmatched.push(label);
      continue;
    }
    if (matched.has(criterion.id)) {
      duplicates.push(label);
      continue;
    }
    matched.set(criterion.id, { criterion, entry, positional: false });
  }

  // Last resort: a model that returned bare scores in rubric order with no usable labels.
  if (matched.size === 0 && rawResults.length >= rubric.criteria.length) {
    positionalFallback = true;
    rubric.criteria.forEach((criterion, position) => {
      const rawEntry = rawResults[position];
      if (rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)) {
        matched.set(criterion.id, { criterion, entry: rawEntry as Record<string, unknown>, positional: true });
      } else if (typeof rawEntry === "number" || typeof rawEntry === "string") {
        matched.set(criterion.id, { criterion, entry: { score: rawEntry }, positional: true });
      }
    });
  }

  return { matched, unmatched, duplicates, positionalFallback };
}

/**
 * Converts raw model output into the canonical, server-validated grading result.
 * Fails closed when the rubric was not fully scored.
 */
export function validateGradingOutput(input: ValidationInput): ValidationOutcome {
  const { raw, rubric, submissionId, modelVersion, injectionSignals, neutralizations, rubricWarnings, clientSubmissionIdIgnored } = input;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: "INVALID_MODEL_OUTPUT", error: "The grading model did not return a JSON object." };
  }

  const data = raw as Record<string, unknown>;
  const rawResults = Array.isArray(data.criteria)
    ? data.criteria
    : Array.isArray(data.rubric_results)
      ? data.rubric_results
      : null;

  if (!rawResults || rawResults.length === 0) {
    return { ok: false, code: "INVALID_MODEL_OUTPUT", error: "The grading model returned no rubric results." };
  }

  const { matched, unmatched, duplicates, positionalFallback } = matchResults(rawResults, rubric);
  const missing = rubric.criteria.filter((criterion) => !matched.has(criterion.id));

  if (missing.length > 0) {
    return {
      ok: false,
      code: "GRADING_INCOMPLETE",
      error: "The grading model did not score every rubric criterion, so no score was returned.",
      details: {
        missing_criteria: missing.map((criterion) => criterion.id),
        received_criteria: [...matched.keys()],
        unmatched_criteria: unmatched,
      },
    };
  }

  let outputSanitized = false;
  const scoreAdjustments: IntegrityReport["score_adjustments"] = [];

  const toList = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .map((item) => sanitizeText(item, MAX_LIST_ITEM_CHARS))
      .filter((item) => item.text.length > 0)
      .slice(0, MAX_LIST_ITEMS)
      .map((item) => {
        if (item.sanitized) outputSanitized = true;
        return item.text;
      });

  const rubricResults: ValidatedCriterionResult[] = rubric.criteria.map((criterion) => {
    const entry = (matched.get(criterion.id) as MatchedEntry).entry;

    const resolution = resolveScore(entry.score, criterion.maxScore);
    if (resolution.reason) {
      scoreAdjustments.push({
        criterion_id: criterion.id,
        reported: resolution.reported,
        applied: resolution.value,
        reason: resolution.reason,
      });
    }

    const reasoning = sanitizeText(entry.reasoning ?? entry.explanation, MAX_REASONING_CHARS);
    const feedback = sanitizeText(entry.feedback ?? entry.next_step, MAX_FEEDBACK_CHARS);
    if (reasoning.sanitized || feedback.sanitized) outputSanitized = true;

    const evidence = (Array.isArray(entry.evidence) ? entry.evidence : [])
      .map((item) => sanitizeText(item, MAX_EVIDENCE_CHARS))
      .filter((item) => item.text.length > 0)
      .slice(0, MAX_EVIDENCE_ITEMS)
      .map((item) => {
        if (item.sanitized) outputSanitized = true;
        return item.text;
      });

    return {
      criterion: criterion.name,
      criterion_id: criterion.id,
      score: resolution.value,
      max_score: criterion.maxScore,
      reasoning: reasoning.text || "The model did not return reasoning for this criterion.",
      evidence,
      feedback: feedback.text,
    };
  });

  // The only totals that ever leave this process are computed here.
  const totalScore = round2(rubricResults.reduce((sum, item) => sum + item.score, 0));
  const maxScore = rubric.maxScore;
  const modelReportedTotal = coerceNumber(data.total_score ?? data.totalScore);
  const modelReportedMaxScore = coerceNumber(data.max_score ?? data.maxScore);
  const arithmeticCorrected = modelReportedTotal !== null && Math.abs(modelReportedTotal - totalScore) > 0.001;

  const overall = sanitizeText(data.overall_feedback ?? data.summary ?? data.overall, MAX_OVERALL_FEEDBACK_CHARS);
  if (overall.sanitized) outputSanitized = true;
  const strengths = toList(data.strengths);
  const improvements = toList(data.improvements);
  const composed = [
    strengths.length ? `Strengths: ${strengths.join(" ")}` : "",
    improvements.length ? `Improvements: ${improvements.join(" ")}` : "",
  ]
    .join(" ")
    .trim();

  const reportedConfidence = coerceNumber(data.confidence);
  let confidence = reportedConfidence;
  let confidenceClamped = false;
  if (confidence !== null && (confidence < 0 || confidence > 1)) {
    confidence = Math.min(1, Math.max(0, confidence));
    confidenceClamped = true;
  }

  const injectionDetected = injectionSignals.length > 0;
  let confidenceCapped = false;
  if (confidence !== null && injectionDetected && confidence > INJECTION_CONFIDENCE_CAP) {
    confidence = INJECTION_CONFIDENCE_CAP;
    confidenceCapped = true;
  }

  const integrity: IntegrityReport = {
    engine_version: modelVersion,
    totals_source: "server",
    client_submission_id_ignored: clientSubmissionIdIgnored,
    model_reported_total: modelReportedTotal,
    model_reported_max_score: modelReportedMaxScore,
    arithmetic_corrected: arithmeticCorrected,
    score_adjustments: scoreAdjustments,
    unmatched_criteria: unmatched,
    missing_criteria: [],
    duplicate_criteria: duplicates,
    positional_fallback: positionalFallback,
    confidence_clamped: confidenceClamped,
    confidence_capped: confidenceCapped,
    output_sanitized: outputSanitized,
    submission_neutralizations: neutralizations,
    rubric_warnings: rubricWarnings,
    injection: {
      detected: injectionDetected,
      categories: [...new Set(injectionSignals.map((signal) => signal.category))],
      signals: injectionSignals,
      requires_human_review:
        injectionDetected || scoreAdjustments.length > 0 || positionalFallback || unmatched.length > 0,
    },
  };

  return {
    ok: true,
    result: {
      submission_id: submissionId,
      rubric_results: rubricResults,
      total_score: totalScore,
      max_score: maxScore,
      overall_feedback: overall.text || composed || "The grading model did not return an overall summary.",
      strengths,
      improvements,
      confidence,
      model_version: modelVersion,
      integrity,
    },
  };
}
