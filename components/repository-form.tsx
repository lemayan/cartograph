"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function RepositoryForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const repositoryUrl = new FormData(event.currentTarget).get("repositoryUrl");
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/analyses", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryUrl }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Could not start this analysis.");
      if (typeof body !== "object" || body === null || !("analysisId" in body) || typeof body.analysisId !== "string"
        || !/^[0-9a-f-]{36}$/.test(body.analysisId)) throw new Error("The server returned an invalid analysis.");
      router.push(`/analyses/${body.analysisId}`);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start this analysis."); setPending(false); }
  }
  return <form className="repository-form" onSubmit={submit}>
    <label htmlFor="repository-url">Public GitHub repository</label>
    <div className="repository-input-row">
      <input id="repository-url" name="repositoryUrl" type="url" placeholder="https://github.com/owner/repository" required
        autoComplete="off" spellCheck={false} disabled={pending} aria-describedby={error ? "repository-error" : "repository-help"} />
      <button type="submit" disabled={pending}>{pending ? "Starting…" : "Analyse repository"}</button>
    </div>
    <p id="repository-help">TypeScript and JavaScript. An existing repository opens its saved analysis.</p>
    {error && <p id="repository-error" className="analysis-error" role="alert">{error}</p>}
  </form>;
}
