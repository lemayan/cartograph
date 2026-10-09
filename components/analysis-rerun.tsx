"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AnalysisRerun({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function rerun() {
    if (pending) return;
    setPending(true); setError(null);
    try {
      const response = await fetch(`/api/analyses/${analysisId}/rerun`, { method: "POST" });
      if (!response.ok) {
        const body: unknown = await response.json();
        throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Could not restart analysis.");
      }
      setConfirming(false); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not restart analysis."); }
    finally { setPending(false); }
  }
  return <div className="analysis-rerun">
    {confirming ? <><span>Replace the saved map with the latest commit?</span>
      <button type="button" disabled={pending} onClick={rerun}>{pending ? "Starting…" : "Re-run repository"}</button>
      <button type="button" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button></> :
      <button type="button" onClick={() => setConfirming(true)}>Re-run repository</button>}
    {error && <p className="analysis-error" role="alert">{error}</p>}
  </div>;
}
