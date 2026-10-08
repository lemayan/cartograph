"use client";

import { OrganizationSwitcher } from "@clerk/nextjs";
import { InviteForm } from "@/components/invite-form";

export function TeamSwitcher({ organizationId, canInvite }: { organizationId: string; canInvite: boolean }) {
  return (
    <OrganizationSwitcher
      hidePersonal
      skipInvitationScreen
      afterSelectOrganizationUrl="/"
      afterCreateOrganizationUrl="/"
      afterLeaveOrganizationUrl="/start"
      organizationProfileProps={{ appearance: { elements: { membersPageInviteButton: { display: "none" } } } }}
    >
      {canInvite && (
        <OrganizationSwitcher.OrganizationProfilePage
          label="Invite teammates"
          url="invite-teammates"
          labelIcon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 5h18v14H3zM3 5l9 7 9-7" /></svg>}
        >
          <section className="invite-content" aria-labelledby="invite-heading">
            <h2 id="invite-heading">Invite a teammate</h2>
            <p>They’ll join this organization as a member.</p>
            <InviteForm organizationId={organizationId} />
          </section>
        </OrganizationSwitcher.OrganizationProfilePage>
      )}
    </OrganizationSwitcher>
  );
}
