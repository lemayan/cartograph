import type { ReactNode } from "react";
import { AuthHeader } from "@/components/auth-header";

export function AuthScreen({ mode, children }: { mode: "sign-in" | "sign-up"; children: ReactNode }) {
  return (
    <>
      <AuthHeader />
      <main id="main-content" className="auth-page">
        <div className="auth-layout">
          <section className="auth-story" aria-labelledby="auth-story-heading">
            <span className="auth-mark" aria-hidden="true">C</span>
            <p className="auth-eyebrow">Cartograph / Workspace</p>
            <h1 id="auth-story-heading">A clearer view of your code.</h1>
            <p className="auth-description">
              {mode === "sign-in"
                ? "Sign in to your team’s workspace and keep your codebase context together."
                : "Create an account to get started in a workspace for your team."}
            </p>
            <div className="auth-note">
              <span className="auth-note-label">Code first</span>
              <p>Connections come from the code. Explanations follow the evidence.</p>
            </div>
          </section>
          <div className="auth-form-column">{children}</div>
        </div>
      </main>
    </>
  );
}
