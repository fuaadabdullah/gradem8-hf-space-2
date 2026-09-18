# Privacy and retention

Last reviewed: 2026-09-18

This policy describes the GradeM8 v1 portfolio demo. It is not a FERPA compliance determination or a substitute for a school/district contract and privacy review.

## In plain English

**What gets stored?** Nothing by GradeM8 v1. Essays, uploaded files, rubrics, extracted text, reports, and teacher overrides live in the browser during the current session only. The application has no database, account system, analytics store, or report persistence.

**Why?** The demo needs the submission and rubric in memory to extract text, ask for a grade, show the report, and let the teacher download it. Persistence is not required for that workflow.

**For how long?** Until the page is closed, refreshed, or the browser discards the session state. Temporary server memory is used only while processing a request and is not an application retention store.

**Where?** Pasted text and selected files are sent to the GradeM8 server route for processing. If a Hugging Face token is configured, the server sends the rubric and essay text to the configured Hugging Face inference provider over HTTPS. Without a token, the app uses deterministic demo grading and does not call an AI provider.

**Who can access it?** During a local/demo session, the teacher using the browser and the configured processing provider can access the content needed to produce the report. No other GradeM8 user can access it because v1 has no shared workspace or account system.

**Can the teacher delete it?** There is no server copy to delete. The teacher can clear the form, close/refresh the page, or remove the selected files from the browser control. A downloaded report is under the teacher's control and should be deleted from the download location when no longer needed.

**Is student writing sent to an AI provider?** Only when a server-side model token is configured. In that mode, the rubric and essay are sent to the configured provider to generate grading feedback. In demo mode, they are not sent to an AI provider.

**Can that provider train on it?** GradeM8 does not claim that a provider will or will not train on submitted text. That depends on the provider account, product terms, configuration, and contract in force at deployment time. Before school use, the district must verify provider retention, training use, subprocessors, deletion, security, and FERPA terms in writing.

## School deployment gate

Before enabling persistent storage, accounts, batch history, or school use, document and obtain approval for: school control of education records; authorized purpose; access roles; retention and deletion; encryption; audit logging; incident response; provider terms; subprocessors; and a process for teacher and school deletion requests.

Until those controls exist, GradeM8's policy is simple: **do not persist essays.**
