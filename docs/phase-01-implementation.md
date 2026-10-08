# Phase 01 implementation

This phase implements the agreed first-sign-in flow and token-based workspace.
Server identity lookups happen only during `/start`. Invitation creation is the
explicit exception for Clerk writes, so invitation links return to this app.

## Implemented steps

1. **First sign-in and team bootstrap.** All enabled sign-in and sign-up methods
   use the existing Clerk components and continue through `/start`. The proxy
   also sends any signed-in account without an active organization there. The
   authenticated server action reads one existing membership; if found, it uses
   that organization. Otherwise it creates `"<name>'s team"`, assigning the user
   Clerk's default admin role. It uses the account's name, username, email local
   part, or account ID as the naming source. A deterministic unique slug keeps
   concurrent bootstrap attempts from creating duplicate teams. Creation errors
   propagate unless a repeated membership lookup proves another request created
   a real membership. Implemented in `app/start/actions.ts` and
   `lib/identity/bootstrap.ts`.

2. **Activate the organization before the workspace request.** `/start` invokes
   the server action automatically after Clerk loads. The client activates the
   returned organization, explicitly refreshes its Clerk token, and navigates
   to `/`. It does not ask the user to name or select a first team. A failed
   bootstrap shows an error and a user-controlled retry. Already-active
   organizations pass straight through to `/`. Implemented in `app/start/page.tsx`
   and `components/start-workspace.tsx`.

3. **Render the organization name and ID on the server.** Clerk session configuration
   adds `org_name: "{{org.name}}"` while the default token retains the organization
   ID in `o.id`. Server code uses `auth().orgId` and validates that `org_name` is a
   nonblank string. The workspace heading renders that name directly in HTML,
   with the full organization ID labeled beneath it in selectable monospace text.
   A missing name throws an explicit error; there is no name fallback or Clerk
   API lookup. Implemented in `lib/identity/session.ts` and the workspace page.

4. **Protect routes before rendering.** `proxy.ts` allows the existing sign-in,
   sign-up and Clerk callback routes. Every other matched route requires Clerk
   authentication before its page renders. Signed-out requests go to login;
   signed-in requests without an organization go to `/start`. Workspace server
   rendering also enforces the organization and name-claim contract.

5. **Switch teams and invite from the top bar.** The organization switcher hides
   personal workspaces. Switching or creating an organization returns to `/`;
   leaving one goes through `/start`. Admins use **Manage → Invite teammates**
   inside the switcher's organization profile. The server invitation action
   verifies the admin role and current organization, validates the email, and
   sends a default-member invitation with this app's `/sign-in` URL. The native
   invite button is hidden and the creation wizard's invite screen is skipped
   to keep one invitation path. Implemented in `components/team-switcher.tsx`,
   `components/invite-form.tsx` and `app/actions/invite.ts`.

6. **Persist and render all three themes.** The theme control writes the
   `cartograph-theme` cookie and updates the root `data-theme` attribute
   immediately. The server reads that cookie before rendering the root element.
   System mode follows the media query, and explicit light/dark values override
   it. Clerk's appearance configuration uses the same colour tokens. Implemented
   in the root layout, `components/theme-control.tsx` and `app/globals.css`.

7. **Keep the shell limited to this phase.** The workspace has one top bar with
   the brand, organization switcher, theme control and user menu. The content
   displays the actual organization name and ID. No dependency-map panels, placeholder
   data or later-phase scaffolding are included.

8. **Use one session system.** `lib/supabase/server.ts` constructs a fresh,
   server-only Supabase client for each request. Every request uses Clerk's
   default session token through `accessToken`. It requires a signed-in account,
   an active organization and the `role: "authenticated"` claim. Missing tokens
   fail rather than falling back to anonymous access. `@supabase/ssr` is removed;
   Supabase session persistence, refreshing and URL-session detection are
   disabled. No tables or application database queries are created.

9. **Fail early on missing environment configuration.** Next configuration and
   server instrumentation validate the two Clerk keys, Supabase URL and
   publishable key before serving requests. Errors name the missing or invalid
   variable. The example environment file lists the required values. pnpm is
   pinned and its lockfile replaces the npm lockfile.

10. **Brand the authentication screens.** Sign-in and sign-up share a responsive
    layout with product context on the left and the existing Clerk form on the
    right. Smaller screens stack the sections. A simple Clerk theme, compact
    controls, clear borders and matching colour tokens replace the default card
    treatment. CSS layers keep the application overrides predictable; native
    control styles are scoped so they do not recolour Clerk's unrelated buttons.
    No packages, custom login fields or hardcoded providers are added.
    Implemented in `components/auth-screen.tsx`, `lib/auth-appearance.ts`, the
    authentication pages and `app/globals.css`.

## Verification completed

- Type generation and strict TypeScript checks passed.
- ESLint and the production build passed.
- Git whitespace checks passed.
- Mocked server checks passed for existing memberships, new team naming,
  deterministic retry slugs, concurrent-creation recovery, creation failures,
  missing name claims, invitation permissions and invitation return URLs.
- Rendering the actual workspace server component to HTML confirmed that its
  heading contains the organization name from the token, without client hydration.
- The saved development Clerk settings were read back and checked against
  bootstrap ownership, unique slugs and the two custom token claims.
- Earlier phase checks confirmed Clerk token forwarding through the actual
  Supabase transport with a mocked fetch, and fail-fast environment validation.
  This revision leaves those mechanisms unchanged.

The mocked checks sent no external requests or invitations. The browser
acceptance steps in `docs/specs/phase-01.md` remain for the user to run. Start
with a fresh sign-in so the token contains the newly added name claim.

## Remaining setup checks

Supabase's Third-party Auth issuer registration could not be inspected with the
available connector or browser. Confirm that Cartograph registers Clerk's issuer
as `https://real-walleye-1304.clerk.accounts.dev` before querying the database.

`clerk doctor --json` still reports an expired CLI account-login token. The
development instance configuration was successfully applied and independently
read back using the existing application access; no new application key was
needed for this phase.

The detailed phase-report preference is now recorded in `AGENTS.md` for later
phases.
