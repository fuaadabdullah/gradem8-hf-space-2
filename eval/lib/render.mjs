const pct = (v, digits = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : "n/a");
const num = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : "n/a");
const ci = (interval, fmt) => (interval ? ` (95% CI ${fmt(interval.lower)} to ${fmt(interval.upper)})` : "");

/** The one sentence you are allowed to quote. It states the denominator and the reference, not just a percentage. */
export function claimSentence(result) {
  const acc = result.metrics.accuracy?.overall;
  if (!acc) return "No accuracy claim is possible yet: there are no human reference labels (see eval/README.md).";
  const human = result.metrics.humanAgreement;
  const ceiling = human?.human ? ` For comparison, two human labelings of ${human.human.essays} of the same essays agreed within 1 point on ${pct(human.human.within1)} of criterion scores.` : " No second human labeling exists, so human disagreement is unmeasured.";
  return (
    `On ${acc.essays} synthetic essays (${acc.criterionScores} criterion scores, each on a 0-4 scale), ` +
    `${pct(acc.within1)}${ci(acc.within1CI, pct)} of the model's criterion scores were within 1 point of a single human grader's, ` +
    `mean absolute error ${num(acc.mae)} points, quadratic-weighted kappa ${num(acc.qwk)}${ci(acc.qwkCI, num)}.${ceiling}`
  );
}

function table(headers, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

const summaryRow = (name, s) => [name, s.essays, num(s.mae), pct(s.within1), num(s.qwk), num(s.bias)];
const SUMMARY_HEADERS = ["Slice", "Essays", "MAE (pts)", "Within +/-1", "QWK", "Bias (model - human)"];

export function renderReport(result) {
  const { metrics: m, meta } = result;
  const out = [];
  out.push(`# Evaluation report`);
  out.push(`Run \`${meta.runId}\` | model: ${meta.model || "server default"} | mode: ${meta.modes.join(", ") || "unknown"} | dataset ${meta.datasetHash} | commit ${meta.gitSha}${meta.gitDirty ? " (dirty)" : ""} | ${meta.startedAt}`);

  const v = result.verdict;
  out.push(`\n## v1 release gate: ${v.ready ? "READY" : "NOT READY"}`);
  out.push(`${v.pass} pass, ${v.fail} fail, ${v.notMeasured} not measured, ${v.documented} documented.\n`);
  out.push(
    table(
      ["Gate", "Target", "Observed", "n", "95% interval", "Status"],
      result.gates.map((g) => {
        const isRate = g.id !== "p95Latency" && g.id !== "criticalSecurity";
        const observed = g.observed == null ? "n/a" : g.id === "p95Latency" ? `${Math.round(g.observed)} ms` : isRate ? (g.id === "weightedKappa" ? num(g.observed) : pct(g.observed)) : String(g.observed);
        const target = g.op ? `${g.op} ${g.id === "weightedKappa" ? g.threshold : g.id === "criticalSecurity" ? g.threshold : pct(g.threshold, 0)}` : "documented";
        const interval = g.ci ? `${g.id === "weightedKappa" ? num(g.ci.lower) : pct(g.ci.lower)} to ${g.id === "weightedKappa" ? num(g.ci.upper) : pct(g.ci.upper)}` : "";
        return [g.label, target, observed, g.n, interval, g.status === "NOT_MEASURED" ? `NOT MEASURED - ${g.reason}` : g.status];
      }),
    ),
  );

  out.push(`\n## What the accuracy numbers mean\n${claimSentence(result)}`);

  if (m.accuracy) {
    const a = m.accuracy;
    out.push(`\n## Agreement with human reference`);
    out.push(`${a.gradedAndLabeled} essays graded and labeled of ${a.attemptedEssays} attempted (${a.labeledEssays} labeled). Failed requests are excluded here and counted under reliability.${a.misaligned ? ` ${a.misaligned} excluded for criterion-count mismatch.` : ""}`);
    if (a.overall) {
      const o = a.overall;
      out.push(`\n- MAE per criterion: ${num(o.mae)} points${ci(o.maeCI, num)}\n- Within +/-1 point: ${pct(o.within1)}${ci(o.within1CI, pct)}\n- Exact agreement (rounded): ${pct(o.exact)}\n- Quadratic-weighted kappa: ${num(o.qwk)}${ci(o.qwkCI, num)} (linear: ${num(o.linearKappa)})\n- Signed bias: ${num(o.bias)} points (positive = model grades higher)`);
    }
    if (a.totals) out.push(`- Total score: MAE ${num(a.totals.maeTotal)} points (${num(a.totals.maeTotalPctOfMax, 1)}% of max), Spearman rho ${num(a.totals.spearman)}`);
    for (const [title, group] of [["By rubric", a.byRubric], ["By intended tier", a.byTier], ["By criterion", a.byCriterion]]) {
      const note = title === "By intended tier" ? "\nKappa inside one tier is low or negative by construction: with little spread in the human scores, chance agreement dominates. Read MAE and within +/-1 here, and use the pooled kappa above." : "";
      out.push(`\n### ${title}\n${table(SUMMARY_HEADERS, Object.entries(group).map(([k, s]) => summaryRow(k, s)))}${note}`);
    }
  }

  out.push(`\n## Human disagreement (the ceiling)`);
  if (m.humanAgreement?.human) {
    const h = m.humanAgreement;
    out.push(`Second labeling type: ${h.kind}.\n`);
    out.push(table(SUMMARY_HEADERS, [summaryRow("Human vs human", h.human), ...(h.modelOnSameEssays ? [summaryRow("Model vs human (same essays)", h.modelOnSameEssays)] : [])]));
    out.push(`\nIf the model's agreement is close to human-vs-human agreement, further "accuracy" gains are mostly noise-fitting.`);
  } else out.push("NOT MEASURED - no second human labels (eval/labels/second.json).");

  out.push(`\n## Reliability and structure`);
  const r = m.reliability;
  out.push(`- Request success (single-essay requests): ${pct(r.successRate, 2)}${ci(r.successCI, (x) => pct(x, 2))} over ${r.requests} requests; failures by code: ${JSON.stringify(r.failuresByCode)}`);
  const s = m.structure;
  out.push(`- Invalid output rate: ${pct(s.invalidOutputRate, 2)} (method: ${s.validityMethod}; ${s.invalidByDiagnostics} by diagnostics, ${s.proxyViolations} by repair-marker proxy, ${s.shapeViolations} response-shape violations, ${s.badResponses} malformed 2xx)`);
  if (s.validityMethod !== "diagnostics") out.push(`  - The API repairs bad model output silently, so without \`diagnostics\` in the response this can only detect some violations, never rule them out.`);
  if (s.reportsWithIntegrity) out.push(`- Model's own arithmetic was wrong (server recomputed the total) in ${s.modelArithmeticCorrected} of ${s.reportsWithIntegrity} reports.`);
  out.push(`- Score arithmetic violations: ${s.arithmeticViolations} of ${s.reports} reports${s.arithmeticExamples.length ? ` (e.g. ${JSON.stringify(s.arithmeticExamples[0])})` : ""}`);
  out.push(`- Rubric compliance (names, order, max points): ${pct(s.complianceRate)}. This checks that the response lists the requested criteria, in order, with the requested maximums. It cannot show that the model reasoned about each one.`);

  out.push(`\n## File parsing`);
  const p = m.parse;
  out.push(`${p.ok}/${p.n} parsed${p.textUnverified === p.n ? "" : " with at least 98% of words recovered"} (${pct(p.rate)}, 95% CI ${pct(p.ci.lower)} to ${pct(p.ci.upper)}). These are clean machine-generated files, not scans or real-world Word exports.`);
  if (p.textUnverified) out.push(`${p.textUnverified} of ${p.n} successes could not be checked for text loss because the API does not return the extracted text; those count as parsed.`);
  out.push(table(["Format", "n", "OK", "Failures"], Object.entries(p.byFormat).map(([f, x]) => [f, x.n, x.ok, JSON.stringify(x.failures)])));

  out.push(`\n## Repeatability`);
  if (m.repeatability) {
    const t = m.repeatability;
    out.push(`${t.essays} essays graded ${num(t.attemptsPerEssay, 1)}x each. Mean SD of total ${num(t.meanTotalSD)} points; mean total range ${num(t.meanTotalRangePctOfMax, 1)}% of max (worst ${num(t.maxTotalRangePctOfMax, 1)}%). Any criterion changed in ${pct(t.criterionCellsAnyChange)} of cells; by 2+ points in ${pct(t.criterionCellsChangedByTwoPlus)}.${t.essaysWithTwoPointSwing.length ? ` Essays with a 2+ point swing: ${t.essaysWithTwoPointSwing.join(", ")}.` : ""}`);
  } else out.push("NOT MEASURED - no essay was graded more than once.");

  out.push(`\n## Latency and cost`);
  out.push(m.latency ? `- Latency per essay: p50 ${Math.round(m.latency.p50)} ms, p95 ${Math.round(m.latency.p95)} ms, max ${Math.round(m.latency.max)} ms, mean ${Math.round(m.latency.mean)} ms (n=${m.latency.n}, client-side, includes network).` : "- Latency: no successful requests.");
  const c = m.cost;
  if (!c.reportsWithUsage && !c.modelReports) out.push(`- Cost/essay: NOT MEASURED - no model was called in this run (demo mode), so there are no tokens to count. Rerun with a token.`);
  else if (!c.reportsWithUsage) out.push(`- Cost/essay: NOT MEASURED - /api/grade returned no token usage on ${c.modelReports} model-mode reports.`);
  else if (c.perEssay == null) out.push(`- Cost/essay: tokens measured (mean ${Math.round(c.meanPromptTokens)} in / ${Math.round(c.meanCompletionTokens)} out) but no prices set in eval/pricing.json.`);
  else out.push(`- Cost/essay: ${c.perEssay.toFixed(5)} ${c.currency} (mean ${Math.round(c.meanPromptTokens)} in / ${Math.round(c.meanCompletionTokens)} out tokens; prices: ${c.priceSource}).`);

  out.push(`\n## Sanity checks (not accuracy)`);
  out.push(`Mean model score by intended tier: ${m.tierCheck.rows.map((x) => `${x.tier} ${x.meanPctOfMax == null ? "n/a" : num(x.meanPctOfMax, 1) + "%"}`).join(", ")}. Spearman rho vs tier ${num(m.tierCheck.spearman)}; ordering ${m.tierCheck.monotonic ? "monotonic" : "NOT monotonic"}. Intended tier is the author's design, not a human score.`);
  const d = m.injectionDetection;
  if (d.measurable) out.push(`Server-side injection detection: flagged ${d.probesDetected} of ${d.probes} injected essays; also flagged ${d.falsePositives} of ${d.coreChecked} ordinary essays${d.falsePositives ? ` (${d.falsePositiveIds.join(", ")})` : ""}.`);
  if (m.injection.length) {
    out.push(`\nPrompt-injection probe (appended instructions to award full marks):\n${table(["Injected essay", "Base total", "Injected total", "Inflation (% of max)", "Flag"], m.injection.map((x) => (x.comparable ? [x.essayId, num(x.baseTotal), num(x.injectedTotal), num(x.inflationPctOfMax, 1), x.flagged ? "INFLATED" : "ok"] : [x.essayId, "-", "-", "-", "no base score"])))}`);
  }
  return out.join("\n") + "\n";
}
