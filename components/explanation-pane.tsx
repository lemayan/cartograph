"use client";
import { useRef, useState } from "react";
import type { ParserResult } from "@/lib/parser/types";
import type { MapSelection } from "@/lib/map/scene";
import { isExplanation, selectionKey, type Explanation, type ExplanationSetup } from "@/lib/explanations/types";
import { ExplanationProse } from "./explanation-prose";
import { AnalysisRerun } from "./analysis-rerun";

export function ExplanationPane({ setup, selection, result, folders, onSelect }: {
  setup?: ExplanationSetup; selection: MapSelection | null; result: ParserResult;
  folders: string[]; onSelect: (selection: MapSelection) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, Explanation>>(() => Object.fromEntries((setup?.saved ?? []).map((answer) => [selectionKey(answer.selection), answer])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const key = selection ? selectionKey(selection) : "";
  const answer = answers[key];
  const stale = setup?.stale || answer?.stale;
  async function explain() {
    if (!setup || !selection || inFlight.current.has(key)) return;
    const selected = selection;
    const selectedKey = key;
    inFlight.current.add(selectedKey);
    setPending(new Set(inFlight.current));
    setErrors((previous) => ({ ...previous, [selectedKey]: "" }));
    try {
      const response = await fetch(`/api/analyses/${setup.analysisId}/explain`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...selected, runId: setup.runId }) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Explanation failed. Retry Explain.");
      if (!isExplanation(body) || selectionKey(body.selection) !== selectedKey) throw new Error("The explanation response did not match the selected target.");
      setAnswers((previous) => ({ ...previous, [selectedKey]: body }));
    } catch (error) { setErrors((previous) => ({ ...previous, [selectedKey]: error instanceof Error ? error.message : "Explanation failed. Retry Explain." })); }
    finally { inFlight.current.delete(selectedKey); setPending(new Set(inFlight.current)); }
  }
  const paths: MapSelection[] = [...result.files.map((file): MapSelection => ({ type: "file", path: file.path })),
    ...folders.filter((folder) => folder !== ".").map((path): MapSelection => ({ type: "folder", path }))];
  return <section className="map-detail-section explanation-pane">
    {selection && <code className="map-detail-name">{selection.path}</code>}
    {setup ? <>
      <div className="explanation-actions"><button type="button" onClick={explain} disabled={!selection || pending.has(key)}>
        {pending.has(key) ? answer?.content ? "Checking…" : "Explaining…" : "Explain"}</button>
        {answer?.cacheHit && <span>Cached</span>}
      </div>
      {(stale || setup.reason || answer?.reason) && <div className="explanation-notice" role="status">
        {stale && <strong>Stale analysis</strong>}
        <p>{answer?.reason ?? setup.reason}</p>
        {stale && <AnalysisRerun analysisId={setup.analysisId} label="Re-analyse" />}
      </div>}
      {errors[key] && <p className="explanation-error" role="alert">{errors[key]}</p>}
      {answer?.content ? <ExplanationProse content={answer.content} paths={paths} onSelect={onSelect} />
        : !pending.has(key) && !stale && <p className="map-detail-empty">Explain this {selection?.type ?? "selection"} using its parsed files and imports.</p>}
      <p className="explanation-meta"><code>{setup.model}</code><br />{setup.tracing ? "Tracing configured" : "Tracing off — model calls still work"}</p>
    </> : <p className="map-detail-empty">Explain is available on a stored repository analysis.</p>}
  </section>;
}
