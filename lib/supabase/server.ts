import "server-only";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { validateEnvironment } from "@/lib/env";

export async function createServerDatabaseClient() {
  const { userId, orgId, sessionClaims, getToken } = await auth();
  if (!userId || !orgId) {
    throw new Error("A signed-in session with an active organization is required for database access.");
  }
  if (sessionClaims?.role !== "authenticated") {
    throw new Error('Configure Clerk session claims with role: "authenticated" for Supabase.');
  }
  const { supabaseUrl, supabasePublishableKey } = validateEnvironment();

  // A fresh client per request prevents one team's token leaking into another's request.
  // The default Clerk token contains the organization; no JWT template or Supabase session.
  return createClient(supabaseUrl, supabasePublishableKey, {
    accessToken: async () => {
      const token = await getToken();
      if (!token) throw new Error("The Clerk session token is unavailable. Sign in again.");
      return token;
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
