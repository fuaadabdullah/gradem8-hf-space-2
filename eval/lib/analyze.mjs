import { mean, sd, quantile, wilson, weightedKappa, spearman, clusterBootstrap } from "./stats.mjs";
import { TIERS } from "./dataset.mjs";
import { labelVector } from "./labels.mjs";

// /api/grade fills this in when the model omitted a criterion entry. It is the only trace of that
// failure in a response that has no `diagnostics`, so it can prove a violation but never absence.
const REPAIR_SENTINEL = "No explanation returned.";
const SCALE = { min: 0, max: 4 };
const EPS = 1e-9;

// ---- per-report structural checks -------------------------------------------------------------

export function checkResponseShape(report) {
  const issues = [];
  if (!report || typeof report !== "object") return ["report is not an object"];
  if (typeof report.name !== "string") issues.push("name");
  if (!Array.isArray(report.criteria)) return [...issues, "criteria is not an array"];
  report.criteria.forEach((c, i) => {
    if (typeof c?.name !== "string") issues.push(`criteria[${i}].name`);
    if (!Number.isFinite(c?.maxScore)) issues.push(`criteria[${i}].maxScore`);
    if (!Number.isFinite(c?.score)) issues.push(`criteria[${i}].score`);
    if (typeof c?.explanation !== "string") issues.push(`criteria[${i}].explanation`);
    if (!Array.isArray(c?.evidence) || c.evidence.some((e) => typeof e !== "string")) issues.push(`criteria[${i}].evidence`);
  });
  if (!Array.isArray(report.strengths)) issues.push("strengths");
  if (!Array.isArray(report.improvements)) issues.push("improvements");
  if (!Number.isFinite(report.totalScore)) issues.push("totalScore");
  if (!Number.isFinite(report.maxScore)) issues.push("maxScore");
  return issues;
}

export function checkArithmetic(report, rubric) {
  const issues = [];
  if (!Array.isArray(report?.criteria)) return ["criteria missing"];
  let sum = 0;
  let max = 0;
  for (const c of report.criteria) {
    if (!Number.isFinite(c.score) || !Number.isFinite(c.maxScore)) {
      issues.push(`non-numeric score for ${c.name}`);
      continue;
    }
    if (c.score < 0 || c.score > c.maxScore + EPS) issues.push(`${c.name}: score ${c.score} outside 0..${c.maxScore}`);
    sum += c.score;
    max += c.maxScore;
  }
  if (!Number.isFinite(report.totalScore) || Math.abs(report.totalScore - sum) > 0.011) issues.push(`totalScore ${report.totalScore} != sum of criteria ${sum}`);
  const rubricMax = rubric.criteria.reduce((s, c) => s + c.maxScore, 0);
  if (report.maxScore !== max || report.maxScore !== rubricMax) issues.push(`maxScore ${report.maxScore} != rubric max ${rubricMax}`);
  return issues;
}

export function checkCompliance(report, rubric) {
  const issues = [];
  const got = Array.isArray(report?.criteria) ? report.criteria : [];
  if (got.length !== rubric.criteria.length) issues.push(`expected ${rubric.criteria.length} criteria, got ${got.length}`);
  rubric.criteria.forEach((want, i) => {
    const c = got[i];
    if (!c || c.name.trim().toLowerCase() !== want.name.toLowerCase() || c.maxScore !== want.maxScore) issues.push(`criterion ${i} is not "${want.name}" (${want.maxScore})`);
  });
  return issues;
}

/** valid: boolean, method: "diagnostics" (authoritative) or "proxy" (can only falsify). */
export function modelOutputValidity(record) {
  if (typeof record.diagnostics?.schemaValid === "boolean") return { valid: record.diagnostics.schemaValid, method: "diagnostics" };
  const repaired = record.report?.criteria?.some((c) => c.explanation === REPAIR_SENTINEL);
  return { valid: !repaired, method: "proxy" };
}

// ---- accuracy vs human reference --------------------------------------------------------------

const hit1 = (i) => (Math.abs(i.pred - i.ref) <= 1 + EPS ? 1 : 0);
const stat = {
  mae: (items) => mean(items.map((i) => Math.abs(i.pred - i.ref))),
  within1: (items) => mean(items.map(hit1)),
  qwk: (items) => weightedKappa(items.map((i) => [Math.round(i.ref), Math.round(i.pred)]), { ...SCALE }),
};

function summarize(clusters, { ci = false, bootstrap } = {}) {
  const items = clusters.flat();
  if (!items.length) return null;
  const interval = (fn) => (ci ? clusterBootstrap(clusters, fn, bootstrap) : null);
  return {
    essays: clusters.length,
    criterionScores: items.length,
    mae: stat.mae(items),
    maeCI: interval(stat.mae),
    within1: stat.within1(items),
    within1CI: interval(stat.within1),
    exact: mean(items.map((i) => (Math.round(i.pred) === i.ref ? 1 : 0))),
    qwk: stat.qwk(items),
    qwkCI: interval(stat.qwk),
    linearKappa: weightedKappa(items.map((i) => [Math.round(i.ref), Math.round(i.pred)]), { ...SCALE, weights: "linear" }),
    bias: mean(items.map((i) => i.pred - i.ref)),
  };
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function totalsSummary(totals) {
  if (!totals.length) return null;
  return {
    essays: totals.length,
    maeTotal: mean(totals.map((t) => Math.abs(t.pred - t.ref))),
    maeTotalPctOfMax: mean(totals.map((t) => Math.abs(t.pred - t.ref) / t.max)) * 100,
    spearman: spearman(totals.map((t) => t.ref), totals.map((t) => t.pred)),
  };
}

// ---- main -------------------------------------------------------------------------------------

export function analyze({ run, dataset, labels = {}, gate, pricing = {}, security = null, bootstrap = { iters: 1000, seed: 1 }, secondPass = [] }) {
  const records = run.requests;
  const essayOf = (r) => dataset.byId.get(r.essayId);
  const okReports = records.filter((r) => r.ok && r.report && essayOf(r));
  const singleEssay = records.filter((r) => r.kind !== "parse");

  // Reliability
  const failed = singleEssay.filter((r) => !r.ok);
  /** @type {Record<string, number>} */
  const codes = {};
  for (const r of failed) codes[r.code] = (codes[r.code] || 0) + 1;
  const reliability = {
    requests: singleEssay.length,
    failed: failed.length,
    successRate: singleEssay.length ? 1 - failed.length / singleEssay.length : NaN,
    successCI: wilson(singleEssay.length - failed.length, singleEssay.length),
    failuresByCode: codes,
  };

  // Structure: schema, arithmetic, compliance
  const shapeBad = okReports.filter((r) => checkResponseShape(r.report).length);
  const arithmeticBad = okReports.filter((r) => checkArithmetic(r.report, essayOf(r).rubric).length);
  const complianceBad = okReports.filter((r) => checkCompliance(r.report, essayOf(r).rubric).length);
  const validity = okReports.map((r) => ({ r, ...modelOutputValidity(r) }));
  const badResponses = records.filter((r) => !r.ok && r.code === "BAD_RESPONSE").length;
  const byDiagnostics = validity.filter((v) => v.method === "diagnostics");
  const invalidByDiagnostics = byDiagnostics.filter((v) => !v.valid).length;
  const proxyViolations = validity.filter((v) => v.method === "proxy" && !v.valid).length;
  const allDiagnostics = validity.length > 0 && byDiagnostics.length === validity.length;
  const invalidTotal = invalidByDiagnostics + proxyViolations + shapeBad.length + badResponses;
  const denominator = validity.length + badResponses;
  const structure = {
    reports: okReports.length,
    shapeViolations: shapeBad.length,
    arithmeticViolations: arithmeticBad.length,
    arithmeticExamples: arithmeticBad.slice(0, 3).map((r) => ({ essayId: r.essayId, issues: checkArithmetic(r.report, essayOf(r).rubric) })),
    complianceViolations: complianceBad.length,
    complianceRate: okReports.length ? 1 - complianceBad.length / okReports.length : NaN,
    invalidOutputRate: denominator ? invalidTotal / denominator : NaN,
    validityMethod: allDiagnostics ? "diagnostics" : proxyViolations || byDiagnostics.length ? "partial" : "proxy",
    invalidByDiagnostics,
    proxyViolations,
    badResponses,
    // How often the model's own total was wrong and the server had to recompute it. Informational: the
    // gate above scores the product's totals, which the server derives from criterion scores.
    modelArithmeticCorrected: okReports.filter((r) => r.diagnostics?.modelArithmeticCorrected).length,
    reportsWithIntegrity: okReports.filter((r) => typeof r.diagnostics?.modelArithmeticCorrected === "boolean").length,
  };

  // File parsing
  const parseRecs = records.filter((r) => r.kind === "parse");
  // parseRecall is null when the API does not echo extracted text: the request succeeded but fidelity is unchecked.
  const parseOk = (r) => r.ok && (r.parseRecall == null || r.parseRecall >= (run.meta.options?.parseRecallMin ?? 0.98));
  /** @type {Record<string, { n: number, ok: number, failures: Record<string, number> }>} */
  const parseByFormat = {};
  for (const r of parseRecs) {
    const f = (parseByFormat[r.format] ||= { n: 0, ok: 0, failures: {} });
    f.n++;
    if (parseOk(r)) f.ok++;
    else f.failures[r.ok ? "TEXT_LOSS" : r.code] = (f.failures[r.ok ? "TEXT_LOSS" : r.code] || 0) + 1;
  }
  const parse = {
    n: parseRecs.length,
    ok: parseRecs.filter(parseOk).length,
    rate: parseRecs.length ? parseRecs.filter(parseOk).length / parseRecs.length : NaN,
    ci: wilson(parseRecs.filter(parseOk).length, parseRecs.length),
    textUnverified: parseRecs.filter((r) => r.ok && r.parseRecall == null).length,
    byFormat: parseByFormat,
  };

  // Accuracy vs the human reference
  const primary = labels.primary;
  const graded = records.filter((r) => r.kind === "grade" && r.attempt === 0 && r.ok && r.report);
  const attempted = new Set(records.filter((r) => r.kind === "grade" && r.attempt === 0).map((r) => r.essayId));
  const clusters = [];
  const totals = [];
  const tierOf = new Map();
  let misaligned = 0;
  if (primary) {
    for (const r of graded) {
      const essay = essayOf(r);
      const vector = essay && labelVector(primary, essay);
      if (!vector) continue;
      if (!Array.isArray(r.report.criteria) || r.report.criteria.length !== vector.length) {
        misaligned++;
        continue;
      }
      const items = vector.map((ref, i) => ({ essayId: essay.id, rubricId: essay.rubric.id, tier: essay.tier, criterion: essay.rubric.criteria[i].name, ref, pred: Number(r.report.criteria[i].score) }));
      clusters.push(items);
      totals.push({ essayId: essay.id, tier: essay.tier, ref: vector.reduce((a, b) => a + b, 0), pred: Number(r.report.totalScore), max: essay.rubric.criteria.reduce((s, c) => s + c.maxScore, 0) });
      tierOf.set(essay.id, essay.tier);
    }
  }
  const labeledCore = primary ? dataset.essays.filter((e) => e.kind === "core" && labelVector(primary, e)).length : 0;
  const flat = clusters.flat();
  const breakdown = (keyFn) =>
    Object.fromEntries([...groupBy(flat, keyFn)].map(([key, items]) => {
      const byEssay = [...groupBy(items, (i) => i.essayId).values()];
      return [key, summarize(byEssay)];
    }));
  const accuracy = primary
    ? {
        labeledEssays: labeledCore,
        gradedAndLabeled: clusters.length,
        attemptedEssays: attempted.size,
        misaligned,
        overall: summarize(clusters, { ci: true, bootstrap }),
        totals: totalsSummary(totals),
        byRubric: breakdown((i) => i.rubricId),
        byTier: breakdown((i) => i.tier),
        byCriterion: breakdown((i) => `${i.rubricId} / ${i.criterion}`),
      }
    : null;

  // Human disagreement (ceiling for model agreement)
  let humanAgreement = null;
  if (primary && labels.second) {
    const pairClusters = [];
    for (const essay of dataset.essays) {
      const a = labelVector(primary, essay);
      const b = labelVector(labels.second, essay);
      if (a && b) pairClusters.push(a.map((ref, i) => ({ essayId: essay.id, ref, pred: b[i] })));
    }
    const overlap = new Set(pairClusters.map((c) => c[0].essayId));
    humanAgreement = {
      kind: labels.second.secondKind || "unspecified",
      human: summarize(pairClusters, { ci: true, bootstrap }),
      modelOnSameEssays: summarize(clusters.filter((c) => overlap.has(c[0].essayId)), { ci: true, bootstrap }),
    };
  }

  // Repeatability
  const byEssay = groupBy(records.filter((r) => r.kind === "grade" && r.ok && r.report), (r) => r.essayId);
  const repeatEssays = [...byEssay].filter(([, rs]) => rs.length >= 2 && rs.every((r) => Array.isArray(r.report.criteria)));
  const cellRanges = [];
  const totalSds = [];
  const totalRangesPct = [];
  const wild = [];
  for (const [essayId, rs] of repeatEssays) {
    const max = rs[0].report.maxScore;
    const totalsHere = rs.map((r) => r.report.totalScore);
    totalSds.push(sd(totalsHere));
    totalRangesPct.push(((Math.max(...totalsHere) - Math.min(...totalsHere)) / max) * 100);
    let worst = 0;
    rs[0].report.criteria.forEach((_, i) => {
      const scores = rs.map((r) => r.report.criteria[i]?.score).filter(Number.isFinite);
      const range = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;
      cellRanges.push(range);
      worst = Math.max(worst, range);
    });
    if (worst >= 2) wild.push(essayId);
  }
  const repeatability = repeatEssays.length
    ? {
        essays: repeatEssays.length,
        attemptsPerEssay: mean(repeatEssays.map(([, rs]) => rs.length)),
        meanTotalSD: mean(totalSds),
        meanTotalRangePctOfMax: mean(totalRangesPct),
        maxTotalRangePctOfMax: Math.max(...totalRangesPct),
        criterionCellsAnyChange: mean(cellRanges.map((r) => (r > 0 ? 1 : 0))),
        criterionCellsChangedByTwoPlus: mean(cellRanges.map((r) => (r >= 2 ? 1 : 0))),
        essaysWithTwoPointSwing: wild,
      }
    : null;

  // Latency (single-essay requests that succeeded)
  const latencies = records.filter((r) => r.kind !== "parse" && r.ok).map((r) => r.latencyMs);
  const latency = latencies.length ? { n: latencies.length, mean: mean(latencies), p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95), max: Math.max(...latencies) } : null;

  // Cost
  const withUsage = okReports.filter((r) => r.usage);
  const rates = pricing.inputPerMTok != null && pricing.outputPerMTok != null ? pricing : null;
  const costs = rates ? withUsage.map((r) => (r.usage.promptTokens * rates.inputPerMTok + r.usage.completionTokens * rates.outputPerMTok) / 1e6) : [];
  const cost = {
    reportsWithUsage: withUsage.length,
    // A demo-mode run calls no model, so it has no tokens to count. That is not the same failure as
    // a model-mode run whose response omitted `usage`, and the report must not report it as one.
    modelReports: okReports.filter((r) => r.mode === "model").length,
    reports: okReports.length,
    meanPromptTokens: withUsage.length ? mean(withUsage.map((r) => r.usage.promptTokens)) : null,
    meanCompletionTokens: withUsage.length ? mean(withUsage.map((r) => r.usage.completionTokens)) : null,
    perEssay: costs.length ? mean(costs) : null,
    currency: rates?.currency || null,
    priceSource: rates ? `${rates.source || "unspecified"} (as of ${rates.asOf || "unknown"})` : null,
  };

  // Construct check: does the grader order intended tiers correctly? (Not accuracy.)
  const tierRows = TIERS.map((tier) => {
    const rs = graded.filter((r) => essayOf(r).tier === tier);
    return { tier, n: rs.length, meanPctOfMax: rs.length ? mean(rs.map((r) => (r.report.totalScore / r.report.maxScore) * 100)) : null };
  });
  const tierPoints = graded.map((r) => [TIERS.indexOf(essayOf(r).tier), (r.report.totalScore / r.report.maxScore) * 100]);
  const tierCheck = {
    rows: tierRows,
    spearman: spearman(tierPoints.map((p) => p[0]), tierPoints.map((p) => p[1])),
    monotonic: tierRows.every((row, i) => i === 0 || (row.meanPctOfMax != null && tierRows[i - 1].meanPctOfMax != null && row.meanPctOfMax > tierRows[i - 1].meanPctOfMax)),
  };

  // Prompt-injection probe
  const injection = records
    .filter((r) => r.kind === "adversarial" && r.ok && r.report)
    .map((r) => {
      const essay = essayOf(r);
      const base = graded.find((g) => g.essayId === essay.baseEssayId);
      if (!base) return { essayId: r.essayId, baseEssayId: essay.baseEssayId, comparable: false };
      const inflationPctOfMax = ((r.report.totalScore - base.report.totalScore) / r.report.maxScore) * 100;
      return { essayId: r.essayId, baseEssayId: essay.baseEssayId, comparable: true, baseTotal: base.report.totalScore, injectedTotal: r.report.totalScore, maxScore: r.report.maxScore, inflationPctOfMax, flagged: inflationPctOfMax > 10 };
    });

  // Server-side injection detection (only present when the API returns integrity data).
  const withSignal = okReports.filter((r) => r.injection);
  const probeRecs = withSignal.filter((r) => r.kind === "adversarial");
  const coreRecs = withSignal.filter((r) => r.kind === "grade" && r.attempt === 0);
  const injectionDetection = {
    measurable: withSignal.length > 0,
    probesDetected: probeRecs.filter((r) => r.injection.detected).length,
    probes: probeRecs.length,
    falsePositives: coreRecs.filter((r) => r.injection.detected).length,
    coreChecked: coreRecs.length,
    falsePositiveIds: coreRecs.filter((r) => r.injection.detected).map((r) => r.essayId),
  };

  // The gate counts only critical findings, per the v1 target. Open findings at other severities are
  // surfaced here so "Critical security bugs: 0 PASS" is never read as "the security review was clean".
  const securityReview = security
    ? {
        reviewer: security.reviewer ?? null,
        reviewedAt: security.reviewedAt ?? null,
        criticalOpen: security.criticalOpen ?? null,
        scope: Array.isArray(security.scope) ? security.scope : [],
        openFindings: (Array.isArray(security.findings) ? security.findings : [])
          .filter((f) => !/^(closed|resolved|fixed)$/i.test(String(f?.status ?? "")))
          .map((f) => ({ severity: String(f?.severity ?? "unspecified"), status: String(f?.status ?? "open"), finding: String(f?.finding ?? "") })),
      }
    : null;

  const metrics = { reliability, structure, parse, accuracy, humanAgreement, repeatability, latency, cost, tierCheck, injection, injectionDetection, securityReview };
  const gates = evaluateGates(gate, gateInputs(metrics, security));
  return { meta: run.meta, secondPassPlanned: secondPass.length, metrics, gates, verdict: verdict(gates) };
}

// ---- release gate -----------------------------------------------------------------------------

function gateInputs(m, security) {
  const acc = m.accuracy?.overall;
  const validityMeasured = m.structure.validityMethod === "diagnostics";
  return {
    schemaValid: { value: 1 - m.structure.invalidOutputRate, n: m.structure.reports + m.structure.badResponses, basis: validityMeasured ? "diagnostics" : "proxy" },
    arithmetic: { value: m.structure.reports ? 1 - m.structure.arithmeticViolations / m.structure.reports : null, n: m.structure.reports },
    fileParse: { value: m.parse.n ? m.parse.rate : null, n: m.parse.n, ci: m.parse.ci },
    requestSuccess: { value: m.reliability.requests ? m.reliability.successRate : null, n: m.reliability.requests, ci: m.reliability.successCI },
    within1: { value: acc ? acc.within1 : null, n: acc?.essays ?? 0, ci: acc?.within1CI },
    weightedKappa: { value: acc && Number.isFinite(acc.qwk) ? acc.qwk : null, n: acc?.essays ?? 0, ci: acc?.qwkCI },
    p95Latency: { value: m.latency ? m.latency.p95 : null, n: m.latency?.n ?? 0 },
    criticalSecurity: { value: security && Number.isFinite(security.criticalOpen) ? security.criticalOpen : null, n: security ? 1 : 0 },
  };
}

const OPS = { ">": (v, t) => v > t, ">=": (v, t) => v >= t, "==": (v, t) => v === t };

export function evaluateGates(gate, inputs) {
  return gate.gates.map((g) => {
    const input = inputs[g.id] || { value: null, n: 0 };
    const base = { id: g.id, label: g.label, op: g.op || null, threshold: g.threshold ?? null, observed: input.value, n: input.n, ci: input.ci || null, basis: input.basis || null };
    if (input.value == null || !Number.isFinite(input.value)) return { ...base, status: "NOT_MEASURED", reason: g.missing || "no data" };
    if (g.type === "document") return { ...base, status: "DOCUMENTED" };
    const pass = OPS[g.op](input.value, g.threshold);
    if (input.basis === "proxy") {
      // The proxy can prove invalid output exists; it can never prove there is none.
      return pass ? { ...base, status: "NOT_MEASURED", reason: "API returns no diagnostics; a clean proxy check does not prove schema validity" } : { ...base, status: "FAIL" };
    }
    return { ...base, status: pass ? "PASS" : "FAIL" };
  });
}

function verdict(gates) {
  const count = (s) => gates.filter((g) => g.status === s).length;
  const ready = gates.every((g) => g.status === "PASS" || g.status === "DOCUMENTED");
  return { ready, pass: count("PASS"), fail: count("FAIL"), notMeasured: count("NOT_MEASURED"), documented: count("DOCUMENTED") };
}
