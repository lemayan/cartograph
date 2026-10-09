import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readAnalysisSnapshot } from "@/lib/analyses/dashboard";
import { readStoredAnalysis } from "@/lib/analyses/result";
import { getWorkspaceIdentity } from "@/lib/identity/session";
import { repositoryLabel } from "@/lib/analyses/presentation";
import { AnalysisUpdates } from "@/components/analysis-progress";
import { AnalysisRerun } from "@/components/analysis-rerun";
import { CoverageBanner } from "@/components/coverage-banner";
import { MapShell } from "@/components/map-shell";

export default async function AnalysisMapPage({ params }: { params: Promise<{ analysisId: string }> }) {
  const { analysisId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(analysisId)) notFound();
  const organization = await getWorkspaceIdentity();
  const { analysis } = await readAnalysisSnapshot(analysisId);
  if (!analysis) notFound();
  if (analysis.status !== "complete") redirect(`/analyses/${analysisId}`);
  const result = await readStoredAnalysis(analysisId);
  if (result === null) {
    // A teammate can restart between the metadata and result reads.
    const { analysis: current } = await readAnalysisSnapshot(analysisId);
    if (!current) notFound();
    if (current.status !== "complete") redirect(`/analyses/${analysisId}`);
    throw new Error("Completed analysis has no stored parser result.");
  }
  return <section className="analysis-page analysis-explorer" aria-labelledby="analysis-heading">
    <header className="analysis-heading"><div><Link href="/">All analyses</Link><h1 id="analysis-heading"><code>{repositoryLabel(analysis.repositoryUrl)}</code></h1></div>
      <div className="analysis-heading-meta">{analysis.commitSha && <code title={analysis.commitSha}>Commit {analysis.commitSha.slice(0, 7)}</code>}
        <AnalysisUpdates key={organization.id} analysisId={analysisId} organizationId={organization.id} /><AnalysisRerun analysisId={analysisId} />
      </div>
    </header>
    <CoverageBanner coverage={result.coverage} /><div className="analysis-map"><MapShell key={analysis.updatedAt} result={result} /></div>
  </section>;
}
