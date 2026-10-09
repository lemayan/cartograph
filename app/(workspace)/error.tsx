"use client";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <section className="workspace-feedback" role="alert">
      <h1>Could not load the workspace</h1>
      <p>The request failed. Try again; if it keeps failing, check the server error.</p>
      <button type="button" onClick={reset}>Try again</button>
    </section>
  );
}
