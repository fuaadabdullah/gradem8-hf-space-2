/** One POST to /api/grade. Failures are returned as data, never thrown: they are a metric. */
export async function gradeOnce({ baseUrl, rubricText, essayText, file, model, timeoutMs = 90_000 }) {
  const form = new FormData();
  form.set("rubric", rubricText);
  if (essayText != null) form.set("essay", essayText);
  if (file) form.append("files", new Blob([file.buffer], { type: file.type }), file.name);
  if (model) form.set("model", model);

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/grade", baseUrl), { method: "POST", body: form, signal: controller.signal });
    const raw = await response.text();
    const latencyMs = Math.round(performance.now() - started);
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      /* non-JSON body handled below */
    }
    if (!response.ok) {
      return { ok: false, httpStatus: response.status, code: body?.code || `HTTP_${response.status}`, error: body?.error || raw.slice(0, 200), latencyMs };
    }
    const reports = normalizeReports(body);
    if (!reports) {
      return { ok: false, httpStatus: response.status, code: "BAD_RESPONSE", error: "2xx response without a recognizable report", latencyMs };
    }
    return { ok: true, httpStatus: response.status, body, reports, latencyMs };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return { ok: false, httpStatus: 0, code: timedOut ? "CLIENT_TIMEOUT" : "NETWORK_ERROR", error: String(error?.message || error), latencyMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

/** Accepts camelCase or OpenAI-style snake_case usage, at response or report level. */
export function readUsage(body, report) {
  const usage = report?.usage || body?.usage;
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = usage.promptTokens ?? usage.prompt_tokens;
  const completionTokens = usage.completionTokens ?? usage.completion_tokens;
  return Number.isFinite(promptTokens) && Number.isFinite(completionTokens) ? { promptTokens, completionTokens } : null;
}

export function readDiagnostics(body, report) {
  const diagnostics = report?.diagnostics || body?.diagnostics;
  return diagnostics && typeof diagnostics === "object" ? diagnostics : null;
}

/**
 * /api/grade has two response shapes in the repo's history: the original flat report
 * ({ reports: [{ criteria, totalScore, maxScore }], mode }) and the validated engine result
 * ({ rubric_results, total_score, max_score, integrity, model_version }). Both are mapped to the
 * flat shape here so the metrics never care which one the server speaks.
 */
export function normalizeReports(body) {
  const list = Array.isArray(body?.reports) ? body.reports : Array.isArray(body?.results) ? body.results : Array.isArray(body?.rubric_results) ? [body] : null;
  return list && list.length ? list.map(normalizeReport) : null;
}

export function normalizeReport(raw) {
  if (!Array.isArray(raw?.rubric_results)) return raw;
  const integrity = raw.integrity && typeof raw.integrity === "object" ? raw.integrity : null;
  const issues = [];
  if (integrity) {
    if (integrity.score_adjustments?.length) issues.push(`${integrity.score_adjustments.length} score(s) coerced or clamped`);
    if (integrity.unmatched_criteria?.length) issues.push(`${integrity.unmatched_criteria.length} unknown criterion name(s)`);
    if (integrity.missing_criteria?.length) issues.push(`${integrity.missing_criteria.length} missing criterion(s)`);
    if (integrity.duplicate_criteria?.length) issues.push(`${integrity.duplicate_criteria.length} duplicate criterion(s)`);
    if (integrity.positional_fallback) issues.push("criteria matched by position");
  }
  return {
    name: raw.submission_id,
    criteria: raw.rubric_results.map((c) => ({ name: c.criterion, maxScore: c.max_score, score: c.score, explanation: c.reasoning, evidence: c.evidence })),
    strengths: raw.strengths,
    improvements: raw.improvements,
    totalScore: raw.total_score,
    maxScore: raw.max_score,
    extractedText: raw.extractedText ?? raw.extracted_text,
    modelVersion: raw.model_version,
    diagnostics: integrity ? { schemaValid: issues.length === 0, issues, modelArithmeticCorrected: Boolean(integrity.arithmetic_corrected), source: "integrity" } : undefined,
    injection: integrity?.injection ? { detected: Boolean(integrity.injection.detected), requiresReview: Boolean(integrity.injection.requires_human_review), categories: integrity.injection.categories || [] } : undefined,
  };
}

/** "demo" only when the server says so; "unknown" when it says nothing, so a silent demo-mode server is at least visible. */
export function readMode(body, report) {
  if (typeof body?.mode === "string") return body.mode;
  const version = String(report?.modelVersion ?? body?.model_version ?? "");
  if (/^demo/i.test(version)) return "demo";
  return version ? "model" : "unknown";
}
