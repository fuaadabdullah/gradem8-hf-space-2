#!/usr/bin/env node
// Blind human labeling. Shows the assignment, rubric and essay; never the intended tier or any model score.
//   node eval/label.mjs --file primary --grader "Your Name"        label every core essay (reference scores)
//   node eval/label.mjs --file second --grader "Your Name" --second-kind intra|inter
//                                                                  re-label a stratified subset (human disagreement)
// Progress saves after every essay, so you can quit (q) and resume.
import readline from "node:readline/promises";
import { loadDataset } from "./lib/dataset.mjs";
import { parseArgs } from "./lib/args.mjs";
import { readLabels, writeLabels } from "./lib/labels.mjs";
import { secondPassIds } from "./lib/plan.mjs";
import { seededShuffle } from "./lib/stats.mjs";

const args = parseArgs(process.argv.slice(2));
const kind = args.file;
if (!["primary", "second"].includes(kind) || typeof args.grader !== "string") {
  console.error('Usage: node eval/label.mjs --file primary|second --grader "Name" [--second-kind intra|inter]');
  process.exit(1);
}
if (kind === "second" && !["intra", "inter"].includes(args["second-kind"])) {
  console.error("--second-kind intra (same person, ideally a week later) or inter (a different person) is required for --file second.");
  process.exit(1);
}

const dataset = loadDataset();
const existing = readLabels()[kind];
const file = existing || { grader: args.grader, kind, ...(kind === "second" ? { secondKind: args["second-kind"] } : {}), createdAt: new Date().toISOString(), labels: {} };
if (existing && existing.grader !== args.grader) {
  console.error(`${kind}.json belongs to grader "${existing.grader}". Use that name, or delete the file to start over.`);
  process.exit(1);
}

const core = dataset.essays.filter((e) => e.kind === "core");
const pool = kind === "second" ? secondPassIds(dataset).map((id) => dataset.byId.get(id)) : core;
// Fixed shuffle so prompts and quality levels are interleaved, whatever order the files are in.
const queue = seededShuffle(pool, kind === "primary" ? 7 : 11).filter((e) => !file.labels[e.id]);

function wrap(text, width = 100) {
  return text
    .split("\n")
    .map((paragraph) => {
      const lines = [];
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if ((line + " " + word).trim().length > width) {
          lines.push(line);
          line = word;
        } else line = (line + " " + word).trim();
      }
      lines.push(line);
      return lines.join("\n");
    })
    .join("\n");
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const total = pool.length;
console.log(`\n${total - queue.length}/${total} already labeled in ${kind}.json. Scores are whole numbers 0-4 (0 absent, 1 weak, 2 developing, 3 proficient, 4 excellent). Type q to quit, s to skip.\n`);

outer: for (const essay of queue) {
  const done = total - queue.length + queue.indexOf(essay);
  console.log("=".repeat(100));
  console.log(`Essay ${done + 1}/${total}  (${essay.rubric.title})`);
  console.log(`Assignment: ${essay.prompt.text}\n`);
  console.log(wrap(essay.text));
  console.log("\n" + "-".repeat(100));
  const scores = {};
  for (const criterion of essay.rubric.criteria) {
    while (true) {
      const answer = (await rl.question(`${criterion.name} - ${criterion.description}\n  score 0-${criterion.maxScore}: `)).trim().toLowerCase();
      if (answer === "q") break outer;
      if (answer === "s") continue outer;
      const value = Number(answer);
      if (Number.isInteger(value) && value >= 0 && value <= criterion.maxScore) {
        scores[criterion.name] = value;
        break;
      }
      console.log("  Enter a whole number in range.");
    }
  }
  file.labels[essay.id] = { scores, labeledAt: new Date().toISOString() };
  writeLabels(kind, file);
}
rl.close();
console.log(`\nSaved. ${Object.keys(file.labels).length}/${total} labeled.`);
