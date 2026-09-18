import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy and retention · GradeM8",
  description: "GradeM8 v1 privacy and retention policy.",
};

export default function PrivacyPage() {
  return <main className="policy-page">
    <Link className="policy-back" href="/">← Back to GradeM8</Link>
    <p className="eyebrow">GradeM8 v1 · Last reviewed 2026-09-18</p>
    <h1>Privacy and retention</h1>
    <p className="policy-lead">This portfolio demo does not persist essays. It is not a FERPA compliance determination or a substitute for a school or district review.</p>
    <section><h2>What gets stored?</h2><p>Nothing by GradeM8 v1. Essays, uploaded files, rubrics, extracted text, reports, and teacher overrides remain in the browser during the current session. There is no database, account system, analytics store, or report persistence.</p></section>
    <section><h2>Why and for how long?</h2><p>The app needs the content in memory to extract text, produce feedback, show the report, and let the teacher download it. It remains until the page is closed or refreshed. Temporary server memory is used only while processing a request.</p></section>
    <section><h2>Where and who can access it?</h2><p>Content is sent to the GradeM8 server route for processing. If a Hugging Face token is configured, the server sends the rubric and essay to that configured provider over HTTPS. During a demo session, access is limited to the teacher using the browser and the configured processing provider; v1 has no shared workspace.</p></section>
    <section><h2>AI provider and training</h2><p>Without a server token, GradeM8 uses deterministic demo grading and does not call an AI provider. With a token, the provider receives the rubric and essay to generate feedback. GradeM8 does not claim what a provider will do with that data; verify retention, training use, subprocessors, deletion, security, and FERPA terms in writing before school use.</p></section>
    <section><h2>Deletion</h2><p>There is no server copy to delete. Clear the form, close or refresh the page, remove selected files, and delete downloaded reports when they are no longer needed.</p></section>
    <section><h2>School deployment gate</h2><p>Before adding persistence, accounts, or school history, document school control, authorized purpose, access roles, retention, deletion, encryption, audit logging, incident response, provider terms, and subprocessors. Until then: <strong>do not persist essays.</strong></p></section>
  </main>;
}
