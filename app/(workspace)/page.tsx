import { getWorkspaceIdentity } from "@/lib/identity/session";
import { dashboardPageSize, listDashboardAnalyses } from "@/lib/analyses/dashboard";
import { relativeTime, repositoryLabel } from "@/lib/analyses/presentation";

function AnalysisTime({ value, now }: { value: string | null; now: number }) {
  if (value === null) return <span className="analysis-missing">—</span>;
  return (
    <time dateTime={value} title={new Date(value).toUTCString()}>
      {relativeTime(value, now)}
    </time>
  );
}

export default async function WorkspacePage() {
  const organization = await getWorkspaceIdentity();
  const { analyses, hasMore, asOf } = await listDashboardAnalyses();
  const hasSeeds = analyses.some((analysis) => analysis.isSeed);

  return (
    <section className="dashboard" aria-labelledby="workspace-heading">
      <div className="workspace-heading">
        <div className="dashboard-heading">
          <h1 id="workspace-heading">{organization.name}</h1>
          <p className="analysis-count">{hasMore ? `Latest ${dashboardPageSize} analyses` : `${analyses.length} ${analyses.length === 1 ? "analysis" : "analyses"}`}</p>
        </div>
        <p className="workspace-identity">
          <span>Organization ID</span>
          <code>{organization.id}</code>
        </p>
      </div>
      {analyses.length === 0 ? (
        <div className="analyses-empty">
          <h2>No analyses yet</h2>
          <p>Repository analyses for this team will appear here.</p>
        </div>
      ) : (
        <div className="analyses-panel">
          <div className="analyses-scroll" role="region" aria-label="Repository analyses" tabIndex={0}>
            <table className="analyses-table">
              <caption className="sr-only">Repository analyses for {organization.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Repository</th>
                  <th scope="col">State</th>
                  <th scope="col">Commit</th>
                  <th scope="col">Started</th>
                  <th scope="col">Finished</th>
                </tr>
              </thead>
              <tbody>
                {analyses.map((analysis) => (
                  <tr key={analysis.id}>
                    <td className="analysis-repository">
                      <code title={analysis.repositoryUrl}>{repositoryLabel(analysis.repositoryUrl)}</code>
                      {analysis.isSeed && <span className="analysis-seed">Seed</span>}
                    </td>
                    <td>
                      <span className={`analysis-status${analysis.status === "queued" || analysis.status === "parsing" ? " analysis-pending" : ""}`}>
                        {analysis.status}
                      </span>
                      {analysis.status === "failed" && analysis.failureMessage && (
                        <p className="analysis-failure">{analysis.failureMessage}</p>
                      )}
                    </td>
                    <td className="analysis-metadata">
                      {analysis.commitSha === null ? <span className="analysis-missing">—</span> : <code title={analysis.commitSha}>{analysis.commitSha.slice(0, 7)}</code>}
                    </td>
                    <td className="analysis-metadata"><AnalysisTime value={analysis.startedAt} now={asOf} /></td>
                    <td className="analysis-metadata"><AnalysisTime value={analysis.finishedAt} now={asOf} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(hasSeeds || hasMore) && (
            <footer className="analyses-footer">
              {hasSeeds && <p>Seed rows are examples; no repository analysis was run for them.</p>}
              {hasMore && <p>Showing the latest {dashboardPageSize} analyses.</p>}
            </footer>
          )}
        </div>
      )}
    </section>
  );
}
