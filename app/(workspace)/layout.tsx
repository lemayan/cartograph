import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { cookies } from "next/headers";
import { TeamSwitcher } from "@/components/team-switcher";
import { ThemeControl } from "@/components/theme-control";
import { readTheme, themeCookie } from "@/lib/theme";
import { getWorkspaceIdentity } from "@/lib/identity/session";
import "./workspace.css";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const organization = await getWorkspaceIdentity();
  const theme = readTheme((await cookies()).get(themeCookie)?.value);

  return (
    <div className="workspace-shell">
      <header className="site-header workspace-toolbar">
        <div className="workspace-toolbar-main">
          <Link href="/" className="brand">
            <svg className="brand-mark" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d="M16 5H6v12h10M6 11h7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M14 3h4v4h-4zM14 15h4v4h-4zM11 9h4v4h-4z" fill="currentColor" />
            </svg>
            Cartograph
          </Link>
          <span className="workspace-toolbar-divider" aria-hidden="true" />
          <TeamSwitcher key={organization.id} organizationId={organization.id} canInvite={organization.role === "org:admin"} />
        </div>
        <div className="workspace-toolbar-account">
          <ThemeControl initialTheme={theme} />
          <UserButton appearance={{ elements: { userButtonTrigger: "workspace-user-trigger", avatarBox: "workspace-user-avatar" } }} />
        </div>
      </header>
      <main id="main-content" className="workspace-content">{children}</main>
    </div>
  );
}
