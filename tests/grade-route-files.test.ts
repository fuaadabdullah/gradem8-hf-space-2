import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { loadDataset } from "../eval/lib/dataset.mjs";
import { makeDocx, makePdf, tokenRecall } from "../eval/lib/fixtures.mjs";

const text = loadDataset().byId.get("school-excellent-1").text as string;

describe("upload parsing, as app/api/grade/route.ts performs it", () => {
  // The route hands these libraries a Node Buffer from file.arrayBuffer(), not a Uint8Array.
  it("extracts docx from a Buffer with every word recovered", async () => {
    const value = (await mammoth.extractRawText({ buffer: Buffer.from(makeDocx(text)) })).value.trim();
    expect(tokenRecall(text, value)).toBe(1);
  });

  it("extracts pdf from a Buffer with every word recovered", async () => {
    const parser = new PDFParse({ data: Buffer.from(makePdf(text)) });
    try {
      expect(tokenRecall(text, (await parser.getText()).text.trim())).toBe(1);
    } finally {
      await parser.destroy();
    }
  });
});

describe("next.config.mjs keeps the document parsers external", () => {
  // These libraries resolve helper files (notably pdf.worker.mjs) relative to their own location in
  // node_modules. Letting Next bundle them into the route breaks those paths, and every PDF upload
  // then fails at runtime with "Setting up fake worker failed" while unit tests still pass, because
  // only a real `next build` reproduces it. This asserts the fix stays in place; the end-to-end proof
  // is the per-format parse rate in an `eval/run.mjs` report against a built server.
  //
  // The option is read from the loaded config rather than matched in the source text, because its
  // name moved from `experimental.serverComponentsExternalPackages` to a top-level
  // `serverExternalPackages` in Next 15. Accepting either keeps this honest across that rename
  // instead of passing on a key the installed Next would ignore.
  it.each(["pdf-parse", "mammoth"])("keeps %s external to the server bundle", async (pkg) => {
    const config = (await import("../next.config.mjs")).default as {
      serverExternalPackages?: string[];
      experimental?: { serverComponentsExternalPackages?: string[] };
    };
    const external = config.serverExternalPackages ?? config.experimental?.serverComponentsExternalPackages ?? [];
    expect(external).toContain(pkg);
  });

  it("uses the option name the installed Next actually supports", async () => {
    const config = (await import("../next.config.mjs")).default as Record<string, unknown> & {
      experimental?: Record<string, unknown>;
    };
    const major = Number(
      JSON.parse(fs.readFileSync(path.join(process.cwd(), "node_modules/next/package.json"), "utf8")).version.split(".")[0]
    );
    const key = major >= 15 ? "serverExternalPackages" : "experimental.serverComponentsExternalPackages";
    const value = major >= 15 ? config.serverExternalPackages : config.experimental?.serverComponentsExternalPackages;
    expect(value, `Next ${major} reads ${key}; a config using the other name is silently ignored`).toBeDefined();
  });
});
