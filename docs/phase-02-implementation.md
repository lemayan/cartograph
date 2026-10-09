# Phase 02 implementation

Phase 02 adds the organization-owned schema and a read-only dashboard. The
eight application tables use the approved ninth `organizations` table as their
local foreign-key and cascade root. Clerk continues to own identity and
membership; the database stores no membership or role copies.

## Implemented steps

1. **Create the schema in recorded migrations.**
   `supabase/migrations/20261008101604_phase_02_workspace.sql` creates
   `organizations`, `projects`, `analyses`, `files`, `edges`, `routes`,
   `explanations`, `file_roles`, and `insights`. Projects store repository URLs;
   analyses store a project, state, creation timestamp, and seed marker. States
   are now `queued`, `parsing`, `complete`, and `failed`. Files store paths; edges
   reference source and target files; routes store a file, method, and path;
   explanations and insights store text; file roles store a file and role label.
   These tables have no parser, AI, or write workflow attached in this phase.

2. **Enforce ownership and deletion in Postgres.** Every application table has
   a non-null organization foreign key with `ON DELETE CASCADE`. Composite
   foreign keys require each child to belong to its parent's organization.
   File references also carry the analysis ID, so an edge or file attachment
   cannot refer to a file from another analysis. Organization, parent, and
   dashboard order indexes support the policy reads and cascading deletion.
   UUIDs keep exposed row IDs as strings without JavaScript integer precision
   concerns. Timestamps include time zones.

3. **Enable and force RLS on all nine tables.** The first migration installs a
   private, invoker event-trigger function that automatically enables and forces
   RLS on newly created public tables. Failure aborts the DDL; it is not swallowed.
   Each table has an authenticated SELECT policy comparing ownership with the
   organization claim in `auth.jwt()`. The current compact `o.id` claim takes
   precedence, with legacy `org_id` support. Missing claims cannot match rows.
   Anonymous privileges and authenticated writes are revoked. This phase grants
   only authenticated SELECT access.

4. **Resolve advisor findings in a separate recorded migration.**
   `supabase/migrations/20261008101823_phase_02_policy_grants.sql` wraps each
   JWT helper call directly in a SELECT so the planner uses an init plan and the
   advisors recognize the optimization. It also revokes public, anonymous, and
   authenticated execute access to Supabase's pre-existing `rls_auto_enable()`
   DDL helper when that helper exists. A third migration,
   `supabase/migrations/20261008103432_phase_02_analysis_metadata.sql`, adds
   nullable commit SHA, started/finished timestamps, and failure message fields.
   It maps the original running/completed states to parsing/complete and enforces
   valid full hashes, nonblank failure messages, and chronological known times.
   No timestamps are inferred from creation time. All migrations were applied to the
   Cartograph project `lkhikzvvelvmsfdpyhdt` through the existing Supabase MCP
   connection. The local filenames use the versions returned by migration
   history; no CLI or package was installed.

5. **Use a typed, request-specific server database client.**
   `lib/supabase/database.types.ts` is generated from the applied schema.
   `lib/supabase/server.ts` uses that type with the existing Clerk-token client.
   Each request keeps its own token and has no persistent Supabase session.
   No database access is added to client components.

6. **Read the dashboard without choosing an organization.**
   `lib/analyses/dashboard.ts` selects analysis ID, state, seed marker, commit,
   started/finished times, failure message, and the related repository URL. It
   validates the returned metadata and orders newest first, with ID as a
   tie-breaker. It requests at most 51 rows, displays the latest 50, and exposes
   a flag when more exist. There is no organization filter, client-side removal
   of another team's rows, polling, or shared result cache. Query errors and
   malformed rows throw rather than becoming an empty state. The loader supplies
   one snapshot clock reading for relative times; React does not read the clock
   or start an interval during rendering. The installed
   Clerk provider invalidates the router cache before changing active identity
   and refreshes afterward; the existing switcher returns to the same `/` page.

7. **Render a compact read-only list.** `app/(workspace)/page.tsx` retains the
   organization name and ID, with the count beside the name. Its five columns
   are Repository, State, Commit, Started, and Finished. Repository names use
   `owner/repo` for recognized GitHub URLs; other stored values stay visible.
   State labels are plain text, and failed rows display their stored failure
   message beneath the state. Known commits display seven characters with the
   full SHA on hover. Known timestamps display relative ages with their UTC
   value on hover. Missing values show a dash. These formatting functions live
   in `lib/analyses/presentation.ts`. Seed rows are labeled, with text
   explaining that no repository analysis was run. A team without analyses sees
   `No analyses yet`. `app/(workspace)/workspace.css` uses the existing light/dark
   theme tokens for a dense table with horizontal overflow on narrow screens. No animation,
   repository form, empty link, map, or analysis button was added.
   `app/(workspace)/error.tsx` shows a request failure and a retry button.

   The frontend-design skill was used for a second visual pass. The workspace
   now has a grouped toolbar with a compact Cartograph mark, matching team and
   account controls, a clear team-name/count hierarchy, and a framed repository
   ledger. Its header has a separate neutral surface; repository names lead,
   metadata uses quieter tabular numerals, and seed provenance sits in the
   table footer. Plain state labels are retained. Clerk's appearance hooks are
   scoped to the toolbar so they do not resize profile dialogs. The table's
   scroll region accepts keyboard focus; narrow layouts wrap the toolbar and
   scroll the columns horizontally. Empty and error states use the same panel
   treatment. Workspace styles are isolated from the authentication screens,
   and no shadows, gradients, animation, or new analysis actions were added.

8. **Seed two real development teams.** `supabase/seed.sql` contains repeatable
   fixtures for the existing team `org_3KPGVJhPTCOu1EgZ61DmeOGVboj` and the
   development team `Cartograph seed team`, `org_3KPM6MD5gJNOrufWtQtF9wNqToi`.
   The second Clerk team was created with the existing user as its owner so that
   the same account can switch between both. No invitation was sent. The first
   team has four analyses across Next.js and React, one in each state. The second
   has two TypeScript analyses, complete and failed. Seeded lifecycle events and
   timeout messages exercise the metadata display; queued rows have no start or
   finish, and parsing rows have no finish. Commits remain null because no
   repository was fetched. All six are explicitly
   marked as seed data. No files, edges, routes, or AI output were persisted as
   fabricated repository results. Replace the two organization IDs before
   running this seed against a different Clerk instance.

## Verification completed

- Strict TypeScript and Next route type generation passed.
- ESLint passed.
- The production build passed on the host. The initial dashboard build in the
  restricted sandbox failed with `spawn EPERM`; the host rerun completed without
  weakening the build check.
- Git whitespace checks passed.
- Database checks in `supabase/tests/phase_02.sql` passed against Cartograph.
  They check RLS and policies on all nine tables, direct organization cascades
  on all eight application tables, reads for two organizations, both token claim
  formats, missing and unknown claims, anonymous read denial, write denial,
  foreign-key rejection of cross-team references, and cascade cleanup without
  removing another team's data. A new table without a policy was confirmed to
  receive RLS automatically and return no rows. All temporary fixtures, helper
  functions, and the new-table probe were rolled back.
- The same bounded joined query, run as `authenticated` with each real seeded
  organization claim, returned exactly four and two rows respectively.
- Security advisors returned no findings. Performance advisors returned only
  informational unused-index notices expected before real traffic.
- The three migration versions were read back from Supabase migration history.
- Metadata constraint checks reject legacy/unknown states, truncated hashes,
  blank failures, and finish times before start times. Valid 40- and 64-character
  hashes were checked only in temporary fixtures and rolled back.
- Repository-label and relative-time boundary checks passed. Rendering the
  actual server component to HTML confirmed its five columns, shortened values,
  failure detail, seed labels, and empty state without a browser.
- After the visual pass, route type generation, TypeScript, lint, and the host
  production build passed. The compiled output includes the dedicated workspace
  stylesheet. Visual acceptance remains a manual browser check.
- The first refinement lint run rejected a clock read during React render. The
  clock reading now happens once in the server data loader; the lint rule was
  retained. An initial expanded SQL check exposed a fixture setup order error;
  that order was corrected, and the complete database suite then passed.

Database claim injection verifies policies, not Clerk token signature verification
or browser behavior. The browser acceptance check remains for the user.

## Browser acceptance

Run `pnpm dev` and sign in with the existing development account. In the original
team, `/` should show four seeded Next.js/React rows with queued, parsing,
complete, and failed states. The compact name/count heading precedes a five-column
table. Confirm short repository names, a failure message beneath the failed state,
relative ages for known timestamps, and dashes for unknown commits and events.
Hover a timestamp to see its UTC value; ages change on a new render, not a timer.
Switch to `Cartograph seed team`; the same `/`
page should show only the two TypeScript rows, complete and failed. Switch back
and confirm the original four return. A newly created unseeded team should show
`No analyses yet`. Light and dark themes should remain readable, and no repository
analysis form or inactive action should appear.

For the visual pass, confirm the toolbar controls align, the team count and
organization ID have clear hierarchy, and the framed table has a distinct
header and seed footer. At a narrow viewport, the toolbar should wrap and the
table should scroll horizontally without pushing the whole page wider. Tab to
the scroll region and confirm its focus outline is visible. Check both themes.

In Supabase, inspect RLS on `projects`, `analyses`, `files`, `edges`, `routes`,
`explanations`, `file_roles`, and `insights`, plus the organization parent. Every
table should have RLS enabled and the `organization_read` SELECT policy.

## Remaining limitations

- Deleting the database organization row cascades through its data. Creating or
  deleting an organization in Clerk does not automatically synchronize this
  parent table; that boundary was explicitly approved for phase 02. An unseeded
  Clerk team still reads an empty analysis list without requiring a parent row.
- This is a snapshot of the latest 50 analyses. Older rows are not paginated,
  and seeded parsing/queued states do not advance. Realtime progress and actual
  repository analysis belong to later phases.
- The seed is development-instance-specific and is separate from migrations.
- Clerk's CLI account-login token was initially expired. It was subsequently
  renewed through browser login, and `clerk doctor --json` confirmed valid
  authentication, the Cartograph project link, and application access. No
  application keys or authentication settings were changed.
- Browser switching, signed-token transport, and visual acceptance are pending
  the user's manual check. No browser driver or test runner was installed.
