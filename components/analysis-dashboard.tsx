"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { relativeTime, repositoryLabel } from "@/lib/analyses/presentation";
import { isStale, staleAfter, stageLabels, type Analysis, type Progress } from "@/lib/analyses/types";
import { useAnalysisLive } from "./analysis-live";

function AnalysisTime({ value, now }: { value: string | null; now: number }) {
  return value === null ? <span className="analysis-missing">—</span> : <time dateTime={value} title={new Date(value).toUTCString()}>{relativeTime(value, now)}</time>;
}
function LiveAnalysisState({ analysis, organizationId, now }: { analysis: Analysis; organizationId: string; now: number }) {
  const router = useRouter();
  const [live, setLive] = useState<Progress | null>(null);
  const [lastProgress, setLastProgress] = useState<number | null>(null);
  const connection = useAnalysisLive(organizationId, `analysis:${analysis.id}`, (progress) => {
    setLive(progress); setLastProgress(Date.now()); router.refresh();
  }, () => router.refresh());
  const status = live?.status ?? analysis.status;
  const stage = live?.stage ?? analysis.stage;
  const message = live?.message ?? analysis.message;
  const stale = (status === "running" || status === "queued") && now - Math.max(Date.parse(analysis.updatedAt), lastProgress ?? 0) >= staleAfter;
  return <><span className={`analysis-status analysis-${status}`}>{stale ? "Stale" : status}</span>
    {stage && <span className="analysis-stage">{stageLabels[stage]}</span>}
    {message && <p className="analysis-failure">{message}</p>}
    {stale && <p className="analysis-failure">No stage update for five minutes. The process may have stopped.</p>}
    {connection !== "Live" && <p className="analysis-failure">{connection}</p>}
  </>;
}
export function AnalysisDashboard({ organizationId, organizationName, analyses, asOf, hasMore }: {
  organizationId: string; organizationName: string; analyses: Analysis[]; asOf: number; hasMore: boolean;
}) {
  const router = useRouter();
  const connection = useAnalysisLive(organizationId, `organization:${organizationId}`, () => router.refresh(), () => router.refresh());
  const [clock, setClock] = useState(asOf);
  const now = Math.max(clock, asOf);
  useEffect(() => {
    const deadlines = analyses.filter((item) => item.status === "queued" || item.status === "running")
      .map((item) => Date.parse(item.updatedAt) + staleAfter).filter((deadline) => deadline > now);
    if (deadlines.length === 0) return;
    // A local deadline changes the label only. It never reads the database.
    const timeout = setTimeout(() => setClock(Date.now()), Math.min(...deadlines) - now + 10);
    return () => clearTimeout(timeout);
  }, [analyses, now]);
  return <>
    <div className="analysis-live-status" role="status"><span>{connection}</span>
      <span>{analyses.filter((analysis) => isStale(analysis, now)).length} stale{hasMore ? " in this list" : ""}</span>
      {connection !== "Live" && <button type="button" onClick={() => router.refresh()}>Refresh status</button>}
    </div>
    {analyses.length === 0 ? <div className="analyses-empty"><h2>No analyses yet</h2><p>Paste a public repository URL to build this team’s first map.</p></div> :
      <div className="analyses-panel"><div className="analyses-scroll" role="region" aria-label="Repository analyses" tabIndex={0}>
        <table className="analyses-table"><caption className="sr-only">Repository analyses for {organizationName}</caption>
          <thead><tr><th scope="col">Repository</th><th scope="col">State / stage</th><th scope="col">Commit</th><th scope="col">Started</th><th scope="col">Finished</th></tr></thead>
          <tbody>{analyses.map((analysis) => <tr key={analysis.id}>
            <td className="analysis-repository"><Link href={`/analyses/${analysis.id}`}><code>{repositoryLabel(analysis.repositoryUrl)}</code></Link></td>
            <td>{analysis.status === "running" || analysis.status === "queued" ?
              <LiveAnalysisState key={analysis.startedAt} analysis={analysis} organizationId={organizationId} now={now} /> :
              <><span className={`analysis-status analysis-${analysis.status}`}>{analysis.status}</span>
                {analysis.status === "failed" && <p className="analysis-failure">{analysis.failureStage && `${stageLabels[analysis.failureStage]}: `}{analysis.failureMessage}</p>}
              </>}
            </td>
            <td className="analysis-metadata">{analysis.commitSha ? <code title={analysis.commitSha}>{analysis.commitSha.slice(0, 7)}</code> : <span className="analysis-missing">—</span>}</td>
            <td className="analysis-metadata"><AnalysisTime value={analysis.startedAt} now={now} /></td>
            <td className="analysis-metadata"><AnalysisTime value={analysis.finishedAt} now={now} /></td>
          </tr>)}</tbody>
        </table>
      </div>{hasMore && <footer className="analyses-footer"><p>Showing the latest 50 analyses.</p></footer>}</div>}
  </>;
}
