"use client";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/** Realtime only. Application row reads remain in server code under RLS. */
export function createRealtimeClient(accessToken: () => Promise<string | null>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase public configuration is missing.");
  return createClient<Database>(url, key, {
    accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
