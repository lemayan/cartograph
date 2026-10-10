"use client";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useEffectEvent, useState } from "react";
import { createRealtimeClient } from "@/lib/supabase/browser";
import { readProgress, type Progress } from "@/lib/analyses/types";

export function useAnalysisLive(organizationId: string, topic: string, onProgress: (progress: Progress) => void, onConnected: () => void) {
  const { getToken, orgId, isLoaded, isSignedIn } = useAuth();
  const [connection, setConnection] = useState("Connecting live progress…");
  const progress = useEffectEvent(onProgress);
  const connected = useEffectEvent(onConnected);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || orgId !== organizationId) return;
    let disposed = false;
    const client = createRealtimeClient(async () => {
      // The installed SDK invokes this on connect and every heartbeat. Never reuse a 60s token.
      const token = await getToken({ skipCache: true });
      if (!token) throw new Error("Sign in again to reconnect live progress.");
      return token;
    });
    const channel = client.channel(topic, { config: { private: true } });
    channel.on("broadcast", { event: "progress" }, ({ payload }: { payload: unknown }) => {
      if (disposed) return;
      try { progress(readProgress(payload)); }
      catch (error) { setConnection(error instanceof Error ? error.message : "Invalid live progress."); }
    }).subscribe((status, error) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") { setConnection("Live"); connected(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setConnection(error?.message ?? "Live progress disconnected. Reconnecting…");
      } else if (status === "CLOSED") setConnection("Live progress disconnected. Reconnecting…");
    });
    return () => {
      disposed = true;
      void client.removeChannel(channel).finally(() => client.realtime.disconnect());
    };
  }, [getToken, orgId, isLoaded, isSignedIn, organizationId, topic]);
  return connection;
}
