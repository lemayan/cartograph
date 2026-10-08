"use client";

import { useActionState } from "react";
import { inviteTeammate, type InviteState } from "@/app/actions/invite";

const initialState: InviteState = { status: "idle", message: "" };

export function InviteForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(inviteTeammate, initialState);
  return (
    <form action={action} className="invite-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <label htmlFor="invite-email">Email address</label>
      <div className="invite-fields">
        <input id="invite-email" name="email" type="email" autoComplete="email" required maxLength={254} disabled={pending} placeholder="teammate@example.com" />
        <button type="submit" disabled={pending}>{pending ? "Sending…" : "Send invitation"}</button>
      </div>
      <p role="status" aria-live="polite" className={state.status === "error" ? "form-message form-error" : "form-message"}>{state.message}</p>
    </form>
  );
}
