import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { MAX_RUBRIC_CHARS, parseRubricText } from "../../../lib/grading/rubric";
import { MAX_ESSAY_CHARS } from "../../../lib/grading/prompt";
import {
  GRADING_MODEL_PATTERN,
  normalizeModel,
  runGradingEngine,
  type EngineFailure,
  type TokenUsage,
} from "../../../lib/grading/engine";
import { type ValidatedGradingResult } from "../../../lib/grading/validate";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SUBMISSIONS = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 60;
// Set GRADING_RATE_LIMIT_PER_MINUTE=0 to disable (for example during an offline
// benchmark run). 0 is opt-in and must be deliberate.
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.GRADING_RATE_LIMIT_PER_MINUTE ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS);

// Per-instance best effort only: serverless instances share no memory, so this caps
// abuse from a single warm instance rather than globally per IP.
const requestLog = new Map<string, { count: number; resetAt: number }>();

type Submission = { name: string; text: string };

function fail(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status });
}

function failureResponse(failure: EngineFailure) {
  return NextResponse.json({ error: failure.error, code: failure.code, details: failure.details }, { status: failure.status });
}

function isRateLimited(ip: string): boolean {
  if (!Number.isFinite(RATE_LIMIT_MAX_REQUESTS) || RATE_LIMIT_MAX_REQUESTS <= 0) return false;

  const now = Date.now();
  const entry = requestLog.get(ip);

  if (!entry || now > entry.resetAt) {
    requestLog.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) return true;

  entry.count += 1;
  return false;
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

async function extract(file: File) {
  if (file.size > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
  const ext = file.name.toLowerCase().split(".").pop();
  const buffer = Buffer.from(await file.arrayBuffer());
  if (ext === "txt") return buffer.toString("utf8").trim();
  if (ext === "docx") return (await mammoth.extractRawText({ buffer })).value.trim();
  if (ext === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      return (await parser.getText()).text.trim();
    } finally {
      await parser.destroy();
    }
  }
  throw new Error("UNSUPPORTED_FILE_TYPE");
}

/**
 * Legacy view of a validated report. Every field is derived from the validated result,
 * so the older UI shape can never disagree with the canonical one.
 */
function toLegacyReport(result: ValidatedGradingResult, submission: Submission, usage?: TokenUsage) {
  return {
    name: submission.name,
    extractedText: submission.text,
    criteria: result.rubric_results.map((item) => ({
      name: item.criterion,
      maxScore: item.max_score,
      score: item.score,
      explanation: item.reasoning,
      evidence: item.evidence,
      feedback: item.feedback,
    })),
    strengths: result.strengths,
    improvements: result.improvements,
    totalScore: result.total_score,
    maxScore: result.max_score,
    ...(usage ? { usage } : {}),
  };
}

export async function POST(request: NextRequest) {
  if (isRateLimited(getClientIp(request))) {
    return fail("Too many grading requests. Please wait a minute and try again.", "TOO_MANY_REQUESTS", 429);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Send a multipart form with a rubric and essay.", "INVALID_FORM");
  }

  const rubricText = String(form.get("rubric") || "").trim();
  if (!rubricText) return fail("A grading rubric is required.", "RUBRIC_REQUIRED");
  if (rubricText.length > MAX_RUBRIC_CHARS) return fail("The rubric is too large.", "RUBRIC_TOO_LARGE");

  const parsed = parseRubricText(String(form.get("rubricTitle") || "").trim() || "Grading rubric", rubricText);
  if (!parsed.rubric.criteria.length || parsed.unparsedLines.length) {
    return fail("Add each rubric criterion on its own line with maximum points, for example: Thesis - 20 points.", "MALFORMED_RUBRIC");
  }

  const rubricWarnings = parsed.truncated
    ? [`Only the first ${parsed.rubric.criteria.length} rubric criteria were used.`]
    : [];

  const submissions: Submission[] = [];
  const essay = String(form.get("essay") || "").trim();
  if (essay) submissions.push({ name: "Pasted essay", text: essay });

  for (const value of form.getAll("files")) {
    if (!(value instanceof File)) continue;
    try {
      const text = await extract(value);
      if (text) submissions.push({ name: value.name, text });
    } catch (error) {
      const code = error instanceof Error ? error.message : "FILE_READ_FAILED";
      return fail(
        code === "FILE_TOO_LARGE"
          ? "One file is larger than 5 MB."
          : code === "UNSUPPORTED_FILE_TYPE"
            ? "Only PDF, DOCX, and TXT files are supported."
            : "A file could not be read.",
        code
      );
    }
  }

  if (!submissions.length) return fail("Paste an essay or upload at least one file.", "ESSAY_REQUIRED");
  if (submissions.length > MAX_SUBMISSIONS) return fail(`Submit no more than ${MAX_SUBMISSIONS} essays at a time.`, "TOO_MANY_SUBMISSIONS");
  if (submissions.some((item) => item.text.length > MAX_ESSAY_CHARS)) {
    return fail(`An extracted essay is too large. Keep each submission under ${MAX_ESSAY_CHARS} characters.`, "ESSAY_TOO_LARGE");
  }

  const model = normalizeModel(String(form.get("model") || process.env.HUGGINGFACE_MODEL_DEFAULT || ""));
  if (!GRADING_MODEL_PATTERN.test(model)) return fail("Model identifier is invalid.", "INVALID_MODEL");

  const token = process.env.HUGGINGFACE_API_TOKEN;
  const clientSubmissionIdIgnored = Boolean(String(form.get("submission_id") || "").trim());
  const reports: Array<ValidatedGradingResult & ReturnType<typeof toLegacyReport>> = [];

  for (const submission of submissions) {
    const outcome = await runGradingEngine({
      submissionText: submission.text,
      rubric: parsed.rubric,
      model,
      token,
      rubricWarnings,
      clientSubmissionIdIgnored,
    });

    if (outcome.ok === false) return failureResponse(outcome);
    reports.push({ ...outcome.result, ...toLegacyReport(outcome.result, submission, outcome.usage) });
  }

  return NextResponse.json({
    mode: token ? "model" : "demo",
    rubric: { title: parsed.rubric.title, criteria: parsed.rubric.criteria, max_score: parsed.rubric.maxScore },
    reports,
  });
}
