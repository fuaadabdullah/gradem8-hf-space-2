import { describe, expect, it } from "vitest";
import { TIERS, loadDataset, parseRubricCriteria, validateDataset } from "../eval/lib/dataset.mjs";
import { PARSE_FORMATS, buildPlan, secondPassIds } from "../eval/lib/plan.mjs";

const dataset = loadDataset();

describe("benchmark dataset", () => {
  it("passes its own structural validation", () => {
    const { errors } = validateDataset(dataset);
    expect(errors).toEqual([]);
  });

  it("has 50-100 core essays, balanced across every prompt and tier", () => {
    const core = dataset.essays.filter((e: { kind: string }) => e.kind === "core");
    expect(core.length).toBeGreaterThanOrEqual(50);
    expect(core.length).toBeLessThanOrEqual(100);
    for (const promptId of Object.keys(dataset.prompts)) {
      for (const tier of TIERS) {
        expect(core.filter((e: { promptId: string; tier: string }) => e.promptId === promptId && e.tier === tier)).toHaveLength(5);
      }
    }
  });

  it("varies rubric shape (more than one criterion count) so it is not one template", () => {
    const counts = new Set(Object.values(dataset.rubrics).map((r: { criteria: unknown[] }) => r.criteria.length));
    expect(counts.size).toBeGreaterThan(1);
  });

  it("renders rubric text that the grader's 'Name - N points' parser reads back exactly, and nothing more", () => {
    for (const essay of dataset.essays) {
      const parsed = parseRubricCriteria(essay.rubricText);
      expect(parsed).toEqual(essay.rubric.criteria.map((c: { name: string; maxScore: number }) => ({ name: c.name, maxScore: c.maxScore })));
    }
  });

  it("makes intended tier track length, as real writing tends to (a known bias the report warns about)", () => {
    const { meanWordsByTier: m } = validateDataset(dataset).summary;
    expect(m.bad).toBeLessThan(m.average);
    expect(m.average).toBeLessThan(m.good);
    expect(m.good).toBeLessThan(m.excellent);
  });

  it("builds injection probes as an average base essay plus appended instructions", () => {
    const probes = dataset.essays.filter((e: { kind: string }) => e.kind === "adversarial");
    expect(probes.length).toBeGreaterThanOrEqual(3);
    for (const probe of probes) {
      const base = dataset.byId.get(probe.baseEssayId);
      expect(base.tier).toBe("average");
      expect(probe.text.startsWith(base.text)).toBe(true);
      expect(probe.text.length).toBeGreaterThan(base.text.length);
    }
  });
});

describe("run plan and second pass", () => {
  it("plans one attempt per core essay plus repeats, parse variants and probes", () => {
    const plan = buildPlan(dataset, { repeats: 3, repeatPerTier: 4, parsePerTier: 5 });
    const count = (kind: string) => plan.filter((j: { kind: string }) => j.kind === kind).length;
    expect(plan.filter((j: { kind: string; attempt: number }) => j.kind === "grade" && j.attempt === 0)).toHaveLength(60);
    expect(count("grade")).toBe(60 + 16 * 2);
    expect(count("parse")).toBe(20 * PARSE_FORMATS.length);
    expect(count("adversarial")).toBe(4);
  });

  it("selects a stable second-pass subset covering every tier and prompt", () => {
    const ids = secondPassIds(dataset);
    expect(ids).toEqual(secondPassIds(dataset));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(16);
    const essays = ids.map((id: string) => dataset.byId.get(id));
    for (const tier of TIERS) expect(essays.filter((e: { tier: string }) => e.tier === tier)).toHaveLength(4);
    expect(new Set(essays.map((e: { promptId: string }) => e.promptId)).size).toBe(3);
  });
});
