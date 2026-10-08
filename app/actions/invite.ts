"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { headers } from "next/headers";

export type InviteState = { status: "idle" | "success" | "error"; message: string };

export async function inviteTeammate(_previous: InviteState, formData: FormData): Promise<InviteState> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId || orgRole !== "org:admin") {
    return { status: "error", message: "Only an organization admin can invite teammates." };
  }
  if (formData.get("organizationId") !== orgId) {
    return { status: "error", message: "Your organization changed. Reload before inviting." };
  }
  const emailValue = formData.get("email");
  const emailAddress = typeof emailValue === "string" ? emailValue.trim() : "";
  if (emailAddress.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
    return { status: "error", message: "Enter a valid email address." };
  }
  // Server Actions verify Origin against Host. Use that origin so invitations return to this app.
  const origin = (await headers()).get("origin");
  if (!origin) {
    return { status: "error", message: "The invitation could not determine this app’s address. Reload and try again." };
  }
  try {
    const client = await clerkClient();
    await client.organizations.createOrganizationInvitation({
      organizationId: orgId,
      inviterUserId: userId,
      emailAddress,
      role: "org:member",
      redirectUrl: new URL("/sign-in", origin).href,
    });
    return { status: "success", message: `Invitation sent to ${emailAddress}.` };
  } catch (error) {
    console.error("Clerk organization invitation failed:", error instanceof Error ? error.message : "Unknown error");
    return { status: "error", message: "The invitation could not be sent. Check the address and try again." };
  }
}
