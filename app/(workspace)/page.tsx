import { getWorkspaceIdentity } from "@/lib/identity/session";

export default async function WorkspacePage() {
  const organization = await getWorkspaceIdentity();
  return (
    <div className="workspace-heading">
      <h1>{organization.name}</h1>
      <p className="workspace-identity">
        <span>Organization ID</span>
        <code>{organization.id}</code>
      </p>
    </div>
  );
}
