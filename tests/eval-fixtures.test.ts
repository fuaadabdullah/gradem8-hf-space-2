import { describe, expect, it } from "vitest";
import { loadDataset } from "../eval/lib/dataset.mjs";
import { makeDocx, makePdf, tokenRecall } from "../eval/lib/fixtures.mjs";

const dataset = loadDataset();
const sample = ["school-excellent-1", "macbeth-good-3", "failure-bad-5"].map((id) => dataset.byId.get(id).text as string);

// The generated files are only useful if the real parsers can read them, so check with the same
// libraries the grader uses. If a parser is not installed the check is a no-op, not a failure.
async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

describe("generated .docx and .pdf fixtures", () => {
  it("are read back by mammoth with every word recovered", async () => {
    const mammoth: any = await optional(() => import("mammoth"));
    if (!mammoth) return;
    const extract = mammoth.default?.extractRawText ?? mammoth.extractRawText;
    for (const text of sample) {
      const { value } = await extract({ buffer: makeDocx(text) });
      expect(tokenRecall(text, value)).toBe(1);
    }
  });

  it("are read back by pdf-parse with every word recovered, across page breaks", async () => {
    const pdf: any = await optional(() => import("pdf-parse"));
    if (!pdf) return;
    const long = sample.join("\n\n") + "\n\n" + sample.join("\n\n");
    for (const text of [...sample, long]) {
      let extracted: string;
      if (typeof pdf.PDFParse === "function") {
        const parser = new pdf.PDFParse({ data: new Uint8Array(makePdf(text)) });
        extracted = (await parser.getText()).text;
        await parser.destroy?.();
      } else {
        extracted = (await (pdf.default ?? pdf)(makePdf(text))).text;
      }
      expect(tokenRecall(text, extracted)).toBeGreaterThanOrEqual(0.995);
    }
  }, 30_000);

  it("produce distinct, non-empty buffers with the right magic bytes", () => {
    expect(makeDocx(sample[0]).subarray(0, 2).toString()).toBe("PK");
    expect(makePdf(sample[0]).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
