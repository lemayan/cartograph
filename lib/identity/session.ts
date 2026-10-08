import "server-only";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export async function getWorkspaceIdentity() {
  const { orgId, orgRole, sessionClaims } = await auth.protect();
  if (!orgId) redirect("/start");
  const name = sessionClaims.org_name;
  if (typeof name !== "string" || !name.trim()) {
    throw new Error('The session token is missing org_name. Configure Clerk with org_name: "{{org.name}}" and sign in again.');
  }
  return { id: orgId, name, role: orgRole };
}
