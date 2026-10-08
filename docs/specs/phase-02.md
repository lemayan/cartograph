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
- Seeded rows, because nothing creates a real one yet.

## Constraints

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

## Not in this phase

The "analyse a repository" form. There is nothing behind it to call yet, and a
button that does nothing for a long stretch is worse than no button.
