import { getWorkspaceIdentity } from "@/lib/identity/session";
import { dashboardPageSize, listDashboardAnalyses } from "@/lib/analyses/dashboard";
import { AnalysisDashboard } from "@/components/analysis-dashboard";
import { RepositoryForm } from "@/components/repository-form";

export default async function WorkspacePage() {
  const organization = await getWorkspaceIdentity();
  const snapshot = await listDashboardAnalyses();
  return <section className="dashboard" aria-labelledby="workspace-heading">
    <header className="dashboard-header"><div className="workspace-heading"><div className="dashboard-heading">
      <h1 id="workspace-heading">{organization.name}</h1>
      <p className="analysis-count">{snapshot.hasMore ? `Latest ${dashboardPageSize} analyses` : `${snapshot.analyses.length} ${snapshot.analyses.length === 1 ? "analysis" : "analyses"}`}</p>
    </div><p className="workspace-identity"><span>Organization ID</span><code>{organization.id}</code></p></div>
      <RepositoryForm key={organization.id} />
    </header>
    <AnalysisDashboard key={organization.id} organizationId={organization.id} organizationName={organization.name} {...snapshot} />
  </section>;
}
