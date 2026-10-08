"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { startWorkspace } from "@/app/start/actions";

export function StartWorkspace() {
  const clerk = useClerk();
  const { isLoaded } = useAuth();
  const inFlight = useRef<Promise<void> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    inFlight.current ??= (async () => {
      const organizationId = await startWorkspace();
      await clerk.setActive({ organization: organizationId });
      const token = await clerk.session?.getToken({ skipCache: true });
      if (!token) throw new Error("Clerk did not return an active session token.");
      // Send the newly minted organization claim with the first workspace request.
      window.location.replace("/");
    })();
    void inFlight.current.catch((reason: unknown) => {
      console.error("Workspace setup failed:", reason instanceof Error ? reason.message : "Unknown error");
      if (!cancelled) setError("Your workspace could not be prepared. Try again.");
    });
    return () => { cancelled = true; };
  }, [clerk, isLoaded, attempt]);

  function retry() {
    inFlight.current = null;
    setError("");
    setAttempt((value) => value + 1);
  }

  return (
    <div className="start-status" role="status">
      {error ? <><p className="form-error">{error}</p><button onClick={retry}>Try again</button></> : <p>Preparing your workspace…</p>}
    </div>
  );
}
