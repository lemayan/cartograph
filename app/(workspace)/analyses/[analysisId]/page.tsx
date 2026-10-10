import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readAnalysisSnapshot } from "@/lib/analyses/dashboard";
import { getWorkspaceIdentity } from "@/lib/identity/session";
import { repositoryLabel } from "@/lib/analyses/presentation";
import { AnalysisProgress } from "@/components/analysis-progress";

export default async function AnalysisPage({ params }: { params: Promise<{ analysisId: string }> }) {
  const { analysisId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(analysisId)) notFound();
  const organization = await getWorkspaceIdentity();
  const { analysis, asOf } = await readAnalysisSnapshot(analysisId);
  if (!analysis) notFound();
  // Handles completed submissions and completion before the live subscription connects.
  if (analysis.status === "complete") redirect(`/analyses/${analysisId}/map`);
  return <section className="analysis-page" aria-labelledby="analysis-heading">
    <header className="analysis-heading"><div><Link href="/">All analyses</Link><h1 id="analysis-heading"><code>{repositoryLabel(analysis.repositoryUrl)}</code></h1></div>
      <div className="analysis-heading-meta">{analysis.commitSha && <code title={analysis.commitSha}>Commit {analysis.commitSha.slice(0, 7)}</code>}</div>
    </header>
    <AnalysisProgress key={`${organization.id}:${analysis.updatedAt}`} analysis={analysis} organizationId={organization.id} asOf={asOf} />
  </section>;
}
