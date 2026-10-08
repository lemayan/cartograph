# Cartograph

Phase 01 provides Clerk sign-in and teams, a protected workspace, invitations,
and persistent system/light/dark themes. Supabase receives the Clerk session
token; it does not manage a second session. No tables or queries exist yet.

## Local setup

Copy `.env.example` to `.env.local` and supply the four required values. Missing
or invalid values stop startup and build with the variable's name.

Use the pinned pnpm version through Corepack:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open [localhost:3000](http://localhost:3000). Signed-out visitors are redirected
to `/sign-in`; all sign-in and sign-up methods pass through `/start` and land at `/`.

## Identity configuration

The development Clerk instance has the settings in `clerk.phase-01.json`:
app login paths, organization-name and `role: "authenticated"` session claims.
Clerk's automatic organization creation and selection task are disabled because
the app's `/start` bootstrap provides those behaviors. The workspace still
requires an organization, enforced in the proxy and server rendering. Sign-in methods
remain Clerk configuration. To configure another instance, preview this patch
with the Clerk CLI before applying it.

In the [Cartograph Supabase third-party auth settings](https://supabase.com/dashboard/project/lkhikzvvelvmsfdpyhdt/auth/third-party),
add Clerk with this instance's issuer domain. Supabase must trust the issuer
before requests with Clerk tokens can be authorized. See the
[Supabase Clerk integration guide](https://supabase.com/docs/guides/auth/third-party/clerk).

Clerk's default v2 session token carries the current organization in `o.id`.
Server rendering reads `auth().orgId` from that verified token. Later database
policies should read the same claim, with no identity-provider lookup. Database
access starts with `createServerDatabaseClient()` in server code only.

`/start` performs the only Clerk identity lookup: it reuses the user's newest
organization membership, or creates `"<name>'s team"`. The name comes from their
profile name, username, email local part, or account ID when none of those exist.
A deterministic, unique organization slug prevents duplicate bootstrap teams
when requests race. The client activates the returned organization, refreshes
the Clerk token, then navigates to `/` with that token.

The workspace renders the `org_name` claim (`{{org.name}}`) on the server. A
missing or blank claim throws an error; it never fetches a name or invents one.
After changing session claims, sign out and sign in once to obtain a fresh token.

Admins invite teammates through the organization switcher: **Manage → Invite
teammates**. This custom page uses a server action; invitation creation is the
only deliberate Clerk write outside bootstrap. Invitations explicitly return
to this app's `/sign-in` page; Clerk's existing components accept the invitation
and activate its organization. The built-in invite button is hidden and the
creation wizard's invite screen is skipped, so invitations use the same server
action and login return URL.

The theme preference lives in the `cartograph-theme` cookie and is rendered on
the root element before the first paint. System mode follows the media query;
explicit light and dark choices override it.

## Checks

```sh
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
```

The browser acceptance check belongs to the user and is in
[`docs/specs/phase-01.md`](docs/specs/phase-01.md).
