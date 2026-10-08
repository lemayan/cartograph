import "server-only";

import { createHash } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";

export async function findOrCreateTeam(userId: string): Promise<string> {
  const client = await clerkClient();
  const memberships = await client.users.getOrganizationMembershipList({ userId, limit: 1 });
  if (memberships.data[0]) return memberships.data[0].organization.id;

  const user = await client.users.getUser(userId);
  const email = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)?.emailAddress;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
    || user.username?.trim()
    || email?.split("@")[0]
    || user.id;

  // The unique slug makes retries and concurrent first-sign-ins create at most one bootstrap team.
  const slug = `team-${createHash("sha256").update(userId).digest("hex").slice(0, 48)}`;
  try {
    const team = await client.organizations.createOrganization({
      name: `${name.slice(0, 248)}'s team`, slug, createdBy: userId,
    });
    return team.id;
  } catch (error) {
    // Accept only a real membership if another request won the creation race.
    const retry = await client.users.getOrganizationMembershipList({ userId, limit: 1 });
    if (retry.data[0]) return retry.data[0].organization.id;
    throw error;
  }
}
