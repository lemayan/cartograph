"use server";

import { auth } from "@clerk/nextjs/server";
import { findOrCreateTeam } from "@/lib/identity/bootstrap";

export async function startWorkspace(): Promise<string> {
  const { userId, orgId } = await auth.protect();
  if (orgId) return orgId;
  return findOrCreateTeam(userId);
}
