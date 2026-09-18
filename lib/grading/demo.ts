/**
 * Deterministic demo grading output.
 *
 * Demo mode is not a separate scoring path: it produces the same shape a model
 * would return and then flows through the exact same validator, so totals,
 * clamping and sanitization behave identically with or without a token.
 */

import { round2, type Rubric } from "./rubric";

export const DEMO_MODEL_VERSION = "demo-heuristic-grader-v1";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildDemoGradingOutput(rubric: Rubric, submissionText: string): string {
  const words = submissionText.split(/\s+/).filter(Boolean);
  const paragraphs = submissionText.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  const sentences = submissionText.split(/[.!?]+\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const evidenceMarkers = (submissionText.match(/\d|percent|according to|research|study|because/gi) || []).length;
  const uniqueWords = new Set(words.map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""))).size;
  const uniqueRatio = words.length ? uniqueWords / words.length : 0;

  const lengthRatio = clamp(words.length / 650, 0.35, 0.9);
  const structureRatio = clamp(paragraphs.length / 5, 0.3, 1);
  const evidenceRatio = clamp(evidenceMarkers / 6, 0.3, 1);
  const vocabularyRatio = clamp(uniqueRatio * 1.6, 0.4, 1);

  const criteria = rubric.criteria.map((criterion) => {
    const ratio = clamp(
      lengthRatio * 0.5 + structureRatio * 0.2 + evidenceRatio * 0.15 + vocabularyRatio * 0.15,
      0.2,
      0.95
    );
    return {
      criterion: criterion.id,
      score: round2(criterion.maxScore * ratio),
      reasoning: `Demo mode: deterministic heuristic over ${words.length} words across ${paragraphs.length} paragraphs. Connect HUGGINGFACE_API_TOKEN for rubric-aware model grading.`,
      evidence: sentences.slice(0, 1).map((sentence) => sentence.trim().slice(0, 200)),
      feedback: "Review this criterion manually while no model provider is configured.",
    };
  });

  return JSON.stringify({
    criteria,
    overall_feedback: `Demo grading of ${words.length} words against ${rubric.criteria.length} criteria. Totals are recomputed server-side.`,
    strengths: ["The submission was extracted successfully and is ready for teacher review."],
    improvements: ["Connect a model provider for rubric-specific feedback."],
    confidence: 0.35,
    total_score: round2(criteria.reduce((sum, item) => sum + item.score, 0)),
    max_score: rubric.maxScore,
  });
}
