# Phase 2 — Dashboard and schema

**Goal.** The workspace exists, it belongs to one team, and it can prove that.

## Build

- The first migration. Eight tables: projects, analyses, files, edges, routes,
  explanations, file roles, insights. Every one of them owns its rows through a
  foreign key to an organization, and deleting the organization removes them.
- Row-level security on all eight, written as database policy, with the
  predicate reading the organization claim off the auth token.
- The dashboard: the list of analyses belonging to the organization you're
  currently in, what state each one is in, and an empty state for a team that
  has never run one.
- Approved dashboard refinement: use the supplied tutor reference for a compact
  team-name/count heading and a table with Repository, State, Commit, Started,
  and Finished. GitHub repositories appear as `owner/repo`, states are plain
  text (`queued`, `parsing`, `complete`, `failed`), and a failed row shows its
  stored failure message beneath the state. Commit hashes are shortened for
  display; timestamps are relative to the page render with the absolute value
  available on hover. Missing metadata appears as a dash, never inferred from
  another field. Relative times do not update on a timer. Keep seed provenance
  clear and retain the organization ID beneath the heading.
- Seeded rows, because nothing creates a real one yet.
- Approved visual refinement: give the workspace an intentional, compact
  developer-tool treatment. Group the toolbar controls, establish clear team
  and metadata typography, and frame the table with a distinct header and seed
  footer. Both themes must remain legible. Preserve plain states, small type,
  visible keyboard focus, and horizontal table scrolling on narrow screens.

## Constraints

- Approved clarification: the eight application tables reference a minimal
  ninth organization parent containing Clerk organization IDs. Cascading
  deletion refers to deleting that database row. Automatic synchronization of
  Clerk organization creation or deletion is outside this phase.

- Authorization is a property of the database, not a check the application
  remembers to perform. No table is readable without a policy on it.
- Migrations are files tracked in version control, not changes made by hand in a
  dashboard.
- The dashboard does not filter by organization in application code. If the
  query returned another organization's row, the bug is the policy.
- Switching organization changes what the same page shows, without a different
  query being written for it.

## Acceptance check

1. With analyses seeded for two different organizations: signed in to the
   first, the dashboard lists only that organization's rows. Switch
   organization, the list changes, and no code went looking for a different
   table.
2. Every one of the eight tables has row-level security enabled. Check all
   eight, not a sample.
3. The dashboard follows the compact reference in both themes. Confirm its five
   columns, short repository names, plain states, failure details, relative
   times, and dashes for unavailable values. Seeded examples remain identifiable.

## Not in this phase

The "analyse a repository" form. There is nothing behind it to call yet, and a
button that does nothing for a long stretch is worse than no button.
