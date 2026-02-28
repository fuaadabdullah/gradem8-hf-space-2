"use client";

import { FormEvent, useMemo, useState } from "react";

const DEFAULT_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct";
const MODEL_OPTIONS = [
  "meta-llama/Meta-Llama-3.1-8B-Instruct",
  "mistralai/Mistral-7B-Instruct-v0.3",
  "google/flan-t5-large",
];

type InferSuccess = {
  output: string;
  model: string;
  latencyMs?: number;
};

type InferError = {
  error: string;
  code?: string;
};

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

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed, model }),
      });

      const data = (await response.json()) as InferSuccess | InferError;
      if (!response.ok) {
        setError(data as InferError);
      } else {
        setResult(data as InferSuccess);
      }
    } catch {
      setError({ error: "Request failed. Check your network and try again.", code: "REQUEST_FAILED" });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px 48px" }}>
      <section
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0b1120 100%)",
          borderRadius: 16,
          padding: "28px 24px",
          color: "#e2e8f0",
          boxShadow: "0 16px 48px rgba(15, 23, 42, 0.22)",
        }}
      >
        <p style={{ margin: 0, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", opacity: 0.85 }}>Gradem8 Demo</p>
        <h1 style={{ margin: "10px 0 8px", fontSize: 34, lineHeight: 1.1 }}>Hugging Face Inference Playground</h1>
        <p style={{ margin: 0, maxWidth: 780, color: "#cbd5e1", fontSize: 16 }}>
          This app sends prompts through a server-side route that keeps your Hugging Face token private, returns normalized responses, and surfaces
          latency for quick demo validation.
        </p>
      </section>

      <section
        style={{
          marginTop: 20,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <form
          onSubmit={onSubmit}
          style={{
            background: "#ffffff",
            borderRadius: 14,
            padding: 20,
            border: "1px solid #e2e8f0",
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
          }}
        >
          <label htmlFor="model" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
            Model
          </label>
          <select
            id="model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            style={{
              width: "100%",
              marginBottom: 14,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              fontSize: 14,
            }}
          >
            {MODEL_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <label htmlFor="prompt" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
            Prompt
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={9}
            maxLength={6000}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              fontSize: 14,
              lineHeight: 1.5,
              resize: "vertical",
            }}
          />

          <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 13, color: "#64748b" }}>
            <span>Characters: {promptChars} / 6000</span>
            <span>Server route: POST /api/infer</span>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{
              marginTop: 14,
              width: "100%",
              border: "none",
              borderRadius: 10,
              padding: "12px 14px",
              fontWeight: 700,
              background: isLoading ? "#94a3b8" : "#0f172a",
              color: "#ffffff",
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            {isLoading ? "Running inference..." : "Run inference"}
          </button>
        </form>

        <div
          style={{
            background: "#ffffff",
            borderRadius: 14,
            padding: 20,
            border: "1px solid #e2e8f0",
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Output</h2>
          {error && (
            <div style={{ borderRadius: 10, padding: 12, background: "#fff1f2", border: "1px solid #fecdd3", color: "#9f1239", marginBottom: 12 }}>
              <strong>{error.code || "ERROR"}:</strong> {error.error}
            </div>
          )}
          {result && (
            <div style={{ borderRadius: 10, padding: 12, background: "#eff6ff", border: "1px solid #bfdbfe", marginBottom: 12 }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, color: "#1d4ed8" }}>
                Model: <strong>{result.model}</strong>
                {typeof result.latencyMs === "number" ? ` • Latency: ${result.latencyMs} ms` : ""}
              </p>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 14,
                  lineHeight: 1.55,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
                }}
              >
                {result.output}
              </pre>
            </div>
          )}
          {!error && !result && <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>Submit a prompt to see model output and latency.</p>}
        </div>
      </section>
    </main>
  );
}
