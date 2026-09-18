/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse (pdfjs) and mammoth resolve helper files, including pdf.worker.mjs, relative to
  // their own location in node_modules. Bundling them into .next/server/app/api/grade/route.js
  // breaks those paths at runtime: every PDF upload fails with "Setting up fake worker failed".
  // Keeping them external means they are required from node_modules, where their layout is intact.
  // Regression test: tests/grade-route-files.test.ts, and eval/run.mjs reports the parse rate per format.
  serverExternalPackages: ["pdf-parse", "mammoth", "@napi-rs/canvas"],
};

export default nextConfig;
