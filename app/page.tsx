"use client";

import { FormEvent, useMemo, useState } from "react";

const DEFAULT_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct";
const MODEL_OPTIONS = [DEFAULT_MODEL, "mistralai/Mistral-7B-Instruct-v0.3"];
type InferSuccess = { output: string; model: string; latencyMs?: number };
type InferError = { error: string; code?: string };

export default function Page() {
  const [prompt, setPrompt] = useState("Summarize the benefits of disciplined risk management for day traders in 5 bullet points.");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [result, setResult] = useState<InferSuccess | null>(null);
  const [error, setError] = useState<InferError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const promptChars = useMemo(() => prompt.length, [prompt]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError({ error: "Prompt is required.", code: "PROMPT_REQUIRED" });
      setResult(null);
      return;
    }
    setIsLoading(true); setError(null); setResult(null);
    try {
      const response = await fetch("/api/infer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: trimmed, model }) });
      const data = (await response.json()) as InferSuccess | InferError;
      if (!response.ok) setError(data as InferError); else setResult(data as InferSuccess);
    } catch {
      setError({ error: "Request failed. Check your network and try again.", code: "REQUEST_FAILED" });
    } finally { setIsLoading(false); }
  }

  return (
    <main className="shell">
      <div className="page-frame">
        <header className="topbar">
          <div className="brand"><span className="brand-mark">G8</span><span>Gradem8 / HF Space</span></div>
          <div className="status"><span className="status-dot" aria-hidden="true" /> Secure inference route</div>
        </header>

        <section className="hero" aria-labelledby="page-title">
          <p className="eyebrow">Model playground / 02</p>
          <h1 id="page-title">Turn a question into a useful answer.</h1>
          <p className="hero-copy">A focused interface for testing hosted language models through a server-side route. Your Hugging Face token stays private while you explore output, model choice, and response speed.</p>
        </section>

        <section className="workspace" aria-label="Inference workspace">
          <form className="panel" onSubmit={onSubmit}>
            <div className="panel-inner">
              <div className="panel-heading"><h2>Compose request</h2><span className="panel-number">01 / INPUT</span></div>
              <div className="field">
                <label className="field-label" htmlFor="model">Model <span className="field-hint">Hosted by Hugging Face</span></label>
                <select id="model" value={model} onChange={(event) => setModel(event.target.value)}>{MODEL_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="prompt">Prompt <span className="field-hint">Be specific</span></label>
                <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={8} maxLength={6000} aria-describedby="prompt-meta" />
                <div className="field-meta" id="prompt-meta"><span>{promptChars.toLocaleString()} / 6,000 characters</span><span>POST /api/infer</span></div>
              </div>
              <button className="run-button" type="submit" disabled={isLoading}><span aria-hidden="true">{isLoading ? "◌" : "→"}</span>{isLoading ? "Running inference" : "Run inference"}</button>
            </div>
          </form>

          <section className="panel output-panel" aria-labelledby="output-title" aria-live="polite">
            <div className="panel-inner output-shell">
              <div className="panel-heading"><h2 id="output-title">Model output</h2><span className="panel-number">02 / RESULT</span></div>
              <div className="output-body">
                {error && <div className="error-card"><strong>{error.code || "ERROR"}</strong><br />{error.error}</div>}
                {result && <div className="result-card"><div className="result-meta"><span>{result.model}</span>{typeof result.latencyMs === "number" && <span>{result.latencyMs} ms response</span>}</div><pre className="result-output">{result.output}</pre></div>}
                {!error && !result && <div className="empty-state"><div className="empty-icon" aria-hidden="true">✦</div><p>Submit a prompt and the model’s response will appear here, along with its latency.</p></div>}
              </div>
              <p className="footer-note">Responses are normalized for quick demo validation.</p>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
