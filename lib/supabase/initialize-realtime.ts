import "server-only";
import { createClient } from "@supabase/supabase-js";

/** A native socket connection creates today's message partition; send() alone cannot. */
export async function initializeRealtime() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase public configuration is missing.");
  const client = createClient(url, key, {
    accessToken: async () => null,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Realtime initialization timed out.")), 15_000);
      // This connection publishes nothing and cannot receive our private progress.
      client.channel("cartograph-initialize").subscribe((status, error) => {
        if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout); reject(error ?? new Error(`Realtime initialization: ${status}`));
        }
      });
    });
  } finally {
    await client.removeAllChannels();
    client.realtime.disconnect();
  }
}
