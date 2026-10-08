import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { cookies } from "next/headers";
import { TeamSwitcher } from "@/components/team-switcher";
import { ThemeControl } from "@/components/theme-control";
import { readTheme, themeCookie } from "@/lib/theme";
import { getWorkspaceIdentity } from "@/lib/identity/session";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const organization = await getWorkspaceIdentity();
  const theme = readTheme((await cookies()).get(themeCookie)?.value);

  return (
    <div className="workspace-shell">
      <header className="site-header workspace-toolbar">
        <Link href="/" className="brand">Cartograph</Link>
        <TeamSwitcher key={organization.id} organizationId={organization.id} canInvite={organization.role === "org:admin"} />
        <div className="toolbar-spacer" />
        <ThemeControl initialTheme={theme} />
        <UserButton />
      </header>
      <main id="main-content" className="workspace-content">{children}</main>
    </div>
  );
}
