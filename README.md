# Cartograph

Paste a public GitHub repository URL in the dashboard header to fetch, parse,
and store a dependency map. Analyses belong to a Clerk organization; Supabase
policies protect both rows and private progress streams. The parser and graph
calculations remain standalone. System/light/dark themes and team invitations
are available through the workspace toolbar.

## Local setup

Copy `.env.example` to `.env.local` and supply the Clerk and Supabase values.
`SUPABASE_SECRET_KEY` is used only by the server-only analysis writer. Reads and
browser subscriptions use the publishable key and Clerk token. Missing public
or Clerk configuration stops startup/build; a missing writer key stops submission.

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
policies read the same claim, with no identity-provider lookup. Database
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
the phase specs, including [`docs/specs/phase-08.md`](docs/specs/phase-08.md).

## Standalone parser (Phase 03)

No app server, account, database, environment values, or network is needed:

```sh
pnpm parser . --out .cartograph/project.json
pnpm parser --read .cartograph/project.json
pnpm parser:verify
```

The directory argument can point anywhere on disk. JSON output is the versioned
`ParserResult` contract in `lib/parser/types.ts`, validated by
`readParserResult()` before it is used. The CLI detects Next.js, NestJS, then
React from declared package dependencies. It prints coverage, unique edges,
recovered routes, skip reasons, and unresolved examples; the JSON keeps the full
occurrence ledger. Detection and framework knowledge live outside the parser core.

The parser retains every supported file in complete directories, excluding
dependency, hidden, and generated directories with explicit reasons. It does
not follow symlinks. `folder` is the exact parent directory, with `.` for files
at the repository root. See [Phase 03 implementation](docs/phase-03-implementation.md)
for the contract, selection rules, acceptance numbers, and limitations.

## Stored dependency map (Phase 07)

Submit a public repository from `/`, then open `/analyses/<id>`. The progress
page follows database broadcasts and redirects to `/analyses/<id>/map` after
storage completes. Completed runs load the full parser contract from stored
files, edges, and coverage under RLS. Click a folder to open its file
panel, scroll its list to reach every file, click a row to highlight its real neighbours, or click the panel header
to fold it again. Node height reflects fan-in. The right detail column shows the
repository summary or selected file/folder structure, with clickable paths and
hover highlights shared with the map. Explanation is an empty state for now.

The rail groups parsed files by framework role in fixed reading order: Next.js
shows Page routes, API endpoints, and Server actions; NestJS shows Controllers,
Services, and Modules. Unmatched repositories use Generic files. The Routes
button opens the stored method/pattern/source table. Source links point to the
analysed commit. Existing analyses need a deliberate rerun to extract roles and
routes; unknown runtime route configuration produces no guessed patterns.

```sh
corepack pnpm parser <repository-directory> --out .cartograph/map.json
corepack pnpm map:verify .cartograph/map.json
corepack pnpm graph:verify .cartograph/map.json
corepack pnpm adapters:verify
corepack pnpm pipeline:verify
corepack pnpm pipeline:verify:live
```

Map/graph verification requires an explicit real parser output with imports
and cycles; missing input fails loudly. No parser snapshots or preview route
are checked in. Live pipeline verification creates a temporary organization,
tests the actual writer and RLS, then removes its own fixtures.

See [Phase 07 implementation](docs/phase-07-implementation.md) for applied
migrations, progress and rerun behavior, verification, browser checks, and
limitations. Earlier map/detail/graph implementation reports remain in `docs/`.

See [Phase 08 implementation](docs/phase-08-implementation.md) for framework
scope, route storage, terminal evidence, and browser acceptance.
