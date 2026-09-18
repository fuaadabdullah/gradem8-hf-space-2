"use client";

import { ChangeEvent, FormEvent, useState } from "react";

type Criterion = {
  name: string;
  maxScore: number;
  score: number;
  explanation: string;
  evidence: string[];
  feedback: string;
};
type Report = {
  name: string;
  extractedText: string;
  criteria: Criterion[];
  strengths: string[];
  improvements: string[];
  totalScore: number;
  maxScore: number;
  approved?: boolean;
};

const starterRubric = "Thesis and argument - 30 points\nEvidence and analysis - 30 points\nOrganization - 20 points\nStyle and mechanics - 20 points";
const starterEssay = "Paste one essay here, or upload a PDF, DOCX, or TXT file. Your extracted text will be shown before you review the grade.";

export default function Page() {
  const [rubric, setRubric] = useState(starterRubric);
  const [essay, setEssay] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState<{ error: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRubricHelp, setShowRubricHelp] = useState(false);

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files || []));
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setReports([]);
    const form = new FormData();
    form.set("rubric", rubric);
    if (essay.trim()) form.set("essay", essay.trim());
    files.forEach((file) => form.append("files", file));
    try {
      const response = await fetch("/api/grade", { method: "POST", body: form });
      const data = await response.json() as { reports?: Report[]; error?: string; code?: string };
      if (!response.ok) setError({ error: data.error || "Grading failed.", code: data.code });
      else setReports((data.reports || []).map((report) => ({ ...report, approved: false, criteria: report.criteria.map((criterion) => ({ ...criterion, feedback: criterion.feedback || criterion.explanation })) })));
    } catch {
      setError({ error: "The request failed. Check your connection and try again.", code: "REQUEST_FAILED" });
    } finally {
      setLoading(false);
    }
  }

  function updateReport(index: number, update: (report: Report) => Report) {
    setReports((current) => current.map((report, reportIndex) => reportIndex === index ? update(report) : report));
  }

  function updateCriterion(reportIndex: number, criterionIndex: number, update: (criterion: Criterion) => Criterion) {
    updateReport(reportIndex, (report) => ({
      ...report,
      approved: false,
      criteria: report.criteria.map((criterion, index) => index === criterionIndex ? update(criterion) : criterion),
    }));
  }

  function total(report: Report) {
    return Number(report.criteria.reduce((sum, criterion) => sum + criterion.score, 0).toFixed(2));
  }

  function approveAndDownload() {
    if (!reports.length) return;
    const approvedReports = reports.map((report) => ({ ...report, totalScore: total(report), approved: true }));
    setReports(approvedReports);
    const blob = new Blob([JSON.stringify({ status: "teacher-approved", approvedAt: new Date().toISOString(), rubric, reports: approvedReports }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "gradem8-teacher-approved-report.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <main className="app-shell">
    <div className="grain" aria-hidden="true" />
    <header className="topbar"><div className="brand"><span className="brand-mark">G8</span><span>GradeM8</span></div><span className="topbar-note">Teacher grading desk · v1</span></header>
    <section className="hero" aria-labelledby="page-title">
      <div><p className="eyebrow">The paper comes first</p><h1 id="page-title">Boringly good<br /><em>grading.</em></h1></div>
      <p className="hero-copy">Give GradeM8 a rubric and a paper. It extracts the words, applies your criteria, and gives you a report you can actually review.</p>
    </section>

    <form className="workbench" onSubmit={submit}>
      <section className="card rubric-card" aria-labelledby="rubric-title"><div className="card-kicker">01 <span>Rubric</span></div><div className="card-heading"><h2 id="rubric-title">What are you looking for?</h2><button type="button" className="text-button" onClick={() => setShowRubricHelp((value) => !value)}>Format guide</button></div><textarea aria-label="Grading rubric" value={rubric} onChange={(event) => setRubric(event.target.value)} rows={8} />{showRubricHelp && <p className="help-copy">One criterion per line, followed by its maximum points. Example: <strong>Evidence and analysis - 30 points</strong>.</p>}<div className="microcopy">{rubric.length.toLocaleString()} / 12,000 characters</div></section>
      <section className="card essay-card" aria-labelledby="essay-title"><div className="card-kicker">02 <span>Submission</span></div><div className="card-heading"><h2 id="essay-title">Bring in the paper.</h2><span className="batch-chip">Single or batch</span></div><textarea aria-label="Essay text" value={essay} onChange={(event) => setEssay(event.target.value)} placeholder={starterEssay} rows={8} /><div className="upload-row"><label className="upload-label"><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" multiple onChange={onFiles} /> <span>＋ Upload PDF, DOCX, or TXT</span></label><span className="microcopy">{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} ready` : "Up to 20 papers"}</span></div>{files.length > 0 && <ul className="file-list">{files.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}<span>{(file.size / 1024).toFixed(0)} KB</span></li>)}</ul>}</section>
      <div className="action-row"><button className="grade-button" type="submit" disabled={loading}>{loading ? "Reading and grading…" : "Grade submission"}<span aria-hidden="true">↗</span></button><span className="action-note">AI proposes. Teacher decides.<br />Review every score before sharing.</span></div>
    </form>

    {error && <div className="error-banner" role="alert"><strong>{error.code || "ERROR"}</strong><span>{error.error}</span></div>}
    {reports.length > 0 && <section className="reports" aria-live="polite"><div className="reports-heading"><div><p className="eyebrow">03 · Review</p><h2>Teacher report</h2></div><div className="review-actions"><span className="decision-note">AI proposes. Teacher decides.</span><button className="download-button" type="button" onClick={approveAndDownload}>Approve &amp; download ↓</button></div></div>{reports.map((report, reportIndex) => <ReportCard key={`${report.name}-${reportIndex}`} report={report} reportIndex={reportIndex} total={total(report)} updateCriterion={updateCriterion} />)}</section>}
    <footer>GradeM8 v1 · Extract. Explain. Review. <a href="/privacy">Privacy &amp; retention</a><span>Nothing more.</span></footer>
  </main>;
}

function ReportCard({ report, reportIndex, total, updateCriterion }: { report: Report; reportIndex: number; total: number; updateCriterion: (reportIndex: number, criterionIndex: number, update: (criterion: Criterion) => Criterion) => void }) {
  return <article className="report-card"><div className="report-top"><div><p className="report-label">Submission {String(reportIndex + 1).padStart(2, "0")}</p><h3>{report.name}</h3><span className={`approval-state ${report.approved ? "is-approved" : ""}`}>{report.approved ? "Teacher-approved" : "Needs teacher review"}</span></div><div className="score-block"><span>{report.approved ? "Approved grade" : "Grade"}</span><strong>{total}<small> / {report.maxScore}</small></strong></div></div><details className="extracted"><summary>Show extracted text <span>{report.extractedText.length.toLocaleString()} characters</span></summary><pre>{report.extractedText}</pre></details><div className="breakdown-heading"><h4>Rubric breakdown</h4><span>Click a score to override it</span></div><div className="criteria-table" role="table" aria-label={`Rubric breakdown for ${report.name}`}><div className="criteria-table-head" role="row"><span>Criterion</span><span>Score</span><span>Max</span></div>{report.criteria.map((criterion, criterionIndex) => <div className="criterion-row" role="row" key={criterion.name}><strong>{criterion.name}</strong><label><span className="sr-only">Score for {criterion.name}</span><input type="number" min="0" max={criterion.maxScore} step="0.5" value={criterion.score} onChange={(event) => { const score = Math.max(0, Math.min(criterion.maxScore, Number(event.target.value) || 0)); updateCriterion(reportIndex, criterionIndex, (current) => ({ ...current, score })); }} /></label><span className="criterion-max">{criterion.maxScore}</span><div className="criterion-detail"><div><span className="detail-label">Evidence</span>{criterion.evidence.length > 0 ? <blockquote>“{criterion.evidence[0]}”</blockquote> : <p className="muted-detail">No evidence returned.</p>}</div><div><label className="detail-label" htmlFor={`feedback-${reportIndex}-${criterionIndex}`}>Teacher-facing comment</label><textarea id={`feedback-${reportIndex}-${criterionIndex}`} value={criterion.feedback || criterion.explanation} onChange={(event) => updateCriterion(reportIndex, criterionIndex, (current) => ({ ...current, feedback: event.target.value }))} rows={3} /></div></div></div>)}</div><div className="feedback-grid"><div><h4>Strengths</h4><ul>{report.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h4>Improvements</h4><ul>{report.improvements.map((item) => <li key={item}>{item}</li>)}</ul></div></div></article>;
}
