"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pipelineStages, staleAfter, stageLabels, type Analysis, type Progress } from "@/lib/analyses/types";
import { useAnalysisLive } from "./analysis-live";
import { AnalysisRerun } from "./analysis-rerun";

export function AnalysisProgress({ analysis, organizationId, asOf }: { analysis: Analysis; organizationId: string; asOf: number }) {
  const router = useRouter();
  const [live, setLive] = useState<Progress | null>(null);
  const [messages, setMessages] = useState(analysis.stageMessages);
  const [updated, setUpdated] = useState(Date.parse(analysis.updatedAt));
  const [clock, setClock] = useState(asOf);
  const connection = useAnalysisLive(organizationId, `analysis:${analysis.id}`, (progress) => {
    setLive(progress); setUpdated(Date.now()); setClock(Date.now());
    setMessages((previous) => ({ ...previous, [progress.stage]: progress.message }));
    if (progress.status === "complete") router.replace(`/analyses/${analysis.id}/map`);
    else if (progress.status === "failed" || analysis.status === "failed") router.refresh();
  }, () => router.refresh());
  const terminal = live?.status ?? analysis.status;
  const activeStage = live?.stage ?? analysis.failureStage ?? analysis.stage;
  const stale = terminal !== "failed" && terminal !== "complete" && clock - updated >= staleAfter;
  useEffect(() => {
    if (terminal === "failed" || terminal === "complete" || stale) return;
    const timeout = setTimeout(() => setClock(Date.now()), Math.max(0, updated + staleAfter - Date.now()) + 10);
    return () => clearTimeout(timeout);
  }, [updated, terminal, stale]);
  const activeIndex = pipelineStages.findIndex((stage) => stage === activeStage);
  return <div className="analysis-progress">
    <div className="progress-heading"><h2>{terminal === "failed" ? "Analysis failed" : terminal === "complete" ? "Opening stored map" : "Analysing repository"}</h2>
      <span className="analysis-live-status">{connection}</span></div>
    <ol className="progress-stages" aria-label="Analysis stages">{pipelineStages.map((stage, index) => {
      const state = index < activeIndex || terminal === "complete" ? "done" : index === activeIndex ? terminal === "failed" ? "failed" : "current" : "waiting";
      return <li key={stage} className={`progress-${state}`} aria-current={state === "current" ? "step" : undefined}>
        <span className="progress-step-number">{index + 1}</span><span className="progress-step-copy">{stageLabels[stage]}
          {messages[stage] && <span className="progress-stage-message">{messages[stage]}</span>}
        </span>
        <span className="progress-step-state">{state === "done" ? "Done" : state === "failed" ? "Failed" : state === "current" ? "Running" : "Waiting"}</span>
      </li>;
    })}</ol>
    <p className={terminal === "failed" ? "analysis-error progress-message" : "progress-message"} role={terminal === "failed" ? "alert" : "status"}>
      {live?.message ?? analysis.failureMessage ?? analysis.message ?? "Waiting for the first stage."}
    </p>
    {stale && <p className="progress-stale" role="status">No stage update for five minutes. The process may have stopped. Re-run to replace this stale run.</p>}
    {(terminal === "failed" || terminal === "complete" || stale) && <AnalysisRerun analysisId={analysis.id} />}
    {(connection !== "Live" || terminal === "complete") && <button className="analysis-secondary" type="button" onClick={() => router.refresh()}>Refresh status</button>}
  </div>;
}

export function AnalysisUpdates({ analysisId, organizationId }: { analysisId: string; organizationId: string }) {
  const router = useRouter();
  const connection = useAnalysisLive(organizationId, `analysis:${analysisId}`, () => router.refresh(), () => router.refresh());
  return <span className="analysis-live-status" role="status">{connection}</span>;
}
