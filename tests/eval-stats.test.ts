import { describe, expect, it } from "vitest";
import { clusterBootstrap, mean, quantile, seededShuffle, spearman, weightedKappa, wilson } from "../eval/lib/stats.mjs";
import { checkArithmetic, checkCompliance, evaluateGates, modelOutputValidity } from "../eval/lib/analyze.mjs";
import { tokenRecall } from "../eval/lib/fixtures.mjs";

describe("weightedKappa", () => {
  const scale = { min: 0, max: 4 };

  it("is 1 for perfect agreement and NaN when nothing varies", () => {
    expect(weightedKappa([[0, 0], [2, 2], [4, 4], [3, 3]], scale)).toBe(1);
    expect(weightedKappa([[2, 2], [2, 2]], scale)).toBeNaN();
  });

  it("matches the hand-computed two-category value (10/10 agree, 5/5 disagree => 1/3)", () => {
    const pairs = [...Array(10).fill([0, 0]), ...Array(10).fill([1, 1]), ...Array(5).fill([0, 1]), ...Array(5).fill([1, 0])];
    expect(weightedKappa(pairs, { min: 0, max: 1 })).toBeCloseTo(1 / 3, 10);
  });

  it("penalises far misses more than near misses under quadratic weights", () => {
    const base = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [2, 2], [3, 3], [1, 1]];
    const near = [...base, [2, 3], [3, 2]];
    const far = [...base, [0, 4], [4, 0]];
    expect(weightedKappa(near, scale)).toBeGreaterThan(weightedKappa(far, scale));
  });

  it("linear weights are more forgiving than quadratic for a single 1-point miss", () => {
    const pairs = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [2, 3], [3, 2]];
    expect(weightedKappa(pairs, { ...scale, weights: "linear" })).toBeLessThan(weightedKappa(pairs, scale));
  });
});

describe("summary statistics", () => {
  it("uses nearest-rank quantiles", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(quantile(xs, 0.95)).toBe(19);
    expect(quantile(xs, 0.5)).toBe(10);
  });

  it("wilson interval shows that 59/60 is not enough to be sure of 98%", () => {
    const { lower, upper } = wilson(59, 60);
    expect(lower).toBeGreaterThan(0.9);
    expect(lower).toBeLessThan(0.93);
    expect(upper).toBeGreaterThan(0.99);
  });

  it("spearman is 1 for a monotone relationship, with ties handled", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 2, 3], [1, 2, 2, 3])).toBeCloseTo(1, 10);
  });

  it("shuffles deterministically per seed", () => {
    expect(seededShuffle([1, 2, 3, 4, 5, 6], 7)).toEqual(seededShuffle([1, 2, 3, 4, 5, 6], 7));
    expect(seededShuffle([1, 2, 3, 4, 5, 6], 7)).not.toEqual(seededShuffle([1, 2, 3, 4, 5, 6], 8));
  });

  it("cluster bootstrap brackets the sample mean and widens with noisier data", () => {
    const tight = Array.from({ length: 30 }, (_, i) => [{ v: 1 + (i % 2) * 0.1 }]);
    const noisy = Array.from({ length: 30 }, (_, i) => [{ v: i % 2 ? 0 : 2 }]);
    const stat = (items: { v: number }[]) => mean(items.map((x) => x.v));
    const a = clusterBootstrap(tight, stat, { iters: 400, seed: 3 });
    const b = clusterBootstrap(noisy, stat, { iters: 400, seed: 3 });
    if (!a || !b) throw new Error("30 clusters must yield an interval; null means the bootstrap gave up");
    expect(a.lower).toBeLessThanOrEqual(stat(tight.flat()));
    expect(a.upper).toBeGreaterThanOrEqual(stat(tight.flat()));
    expect(b.upper - b.lower).toBeGreaterThan(a.upper - a.lower);
  });
});

describe("structural checks", () => {
  const rubric = { criteria: [{ name: "Thesis", maxScore: 4 }, { name: "Style", maxScore: 4 }] };
  const good = {
    name: "e", totalScore: 6, maxScore: 8,
    criteria: [
      { name: "Thesis", maxScore: 4, score: 3, explanation: "x", evidence: [] },
      { name: "Style", maxScore: 4, score: 3, explanation: "x", evidence: [] },
    ],
  };

  it("accepts consistent arithmetic and flags each way it can break", () => {
    expect(checkArithmetic(good, rubric)).toEqual([]);
    expect(checkArithmetic({ ...good, totalScore: 7 }, rubric)).toHaveLength(1);
    expect(checkArithmetic({ ...good, criteria: [{ ...good.criteria[0], score: 5 }, good.criteria[1]], totalScore: 8 }, rubric).length).toBeGreaterThan(0);
    expect(checkArithmetic({ ...good, maxScore: 10 }, rubric).length).toBeGreaterThan(0);
  });

  it("flags criteria that are missing, renamed or reordered", () => {
    expect(checkCompliance(good, rubric)).toEqual([]);
    expect(checkCompliance({ ...good, criteria: [good.criteria[0]] }, rubric).length).toBeGreaterThan(0);
    expect(checkCompliance({ ...good, criteria: [good.criteria[1], good.criteria[0]] }, rubric).length).toBeGreaterThan(0);
  });

  it("treats the repair marker as proof of invalid output but diagnostics as authoritative", () => {
    const repaired = { report: { criteria: [{ explanation: "No explanation returned." }] } };
    expect(modelOutputValidity(repaired)).toEqual({ valid: false, method: "proxy" });
    expect(modelOutputValidity({ ...repaired, diagnostics: { schemaValid: true } })).toEqual({ valid: true, method: "diagnostics" });
  });

  it("recovers words through typographic apostrophes but notices real loss", () => {
    expect(tokenRecall("Shakespeare's play", "Shakespeare’s play")).toBe(1);
    expect(tokenRecall("one two three four", "one two")).toBe(0.5);
  });
});

describe("evaluateGates", () => {
  const gate = { gates: [{ id: "schemaValid", label: "s", op: "==", threshold: 1 }, { id: "within1", label: "w", op: ">", threshold: 0.9 }, { id: "p95Latency", label: "l", type: "document" }] };

  it("never lets a proxy pass a gate, but lets it fail one", () => {
    const clean = evaluateGates(gate, { schemaValid: { value: 1, n: 10, basis: "proxy" }, within1: { value: null, n: 0 }, p95Latency: { value: 900, n: 5 } });
    expect(clean[0].status).toBe("NOT_MEASURED");
    const dirty = evaluateGates(gate, { schemaValid: { value: 0.9, n: 10, basis: "proxy" }, within1: { value: null, n: 0 }, p95Latency: { value: 900, n: 5 } });
    expect(dirty[0].status).toBe("FAIL");
  });

  it("uses strict > where the target says >, and reports missing data as not measured", () => {
    const r = evaluateGates(gate, { schemaValid: { value: 1, n: 10, basis: "diagnostics" }, within1: { value: 0.9, n: 60 }, p95Latency: { value: null, n: 0 } });
    expect(r.map((x: { status: string }) => x.status)).toEqual(["PASS", "FAIL", "NOT_MEASURED"]);
  });
});
