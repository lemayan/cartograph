# Phase 07 implementation

The dashboard now submits a public GitHub URL, reserves one analysis, starts
fetching before responding, and opens `/analyses/<id>` already in `running` /
`fetching`. Progress is private database broadcast traffic. Completed analyses
render the existing explorer from stored parser results. No package was installed.

## Submission, execution, and provenance

- `components/repository-form.tsx` sits in the dashboard header in
  `app/(workspace)/page.tsx`. It shows submission failures inline and navigates
  to the reserved analysis. A repeated URL returns the same analysis without
  fetching or parsing again.
- `app/api/analyses/route.ts` verifies Clerk authentication and captures the
  active organization before beginning work. It rejects client-supplied ownership,
  oversized JSON, and cross-origin browser submission. It returns 202 for a new
  run and 200 for an existing analysis. `after(executionPromise)` starts execution
  before the response and keeps it tracked afterward in the same Next process.
- `lib/pipeline/repository.ts` accepts only HTTPS GitHub repository roots and
  normalizes case, trailing slash, and `.git`. `lib/pipeline/archive.ts` makes
  anonymous requests, resolves the default branch to a full SHA, and fetches
  that exact commit. It restricts redirects and validates archive entries,
  paths, collisions, and links before extraction with native `tar`.
- Archive limits are 50 MiB compressed, 250 MiB uncompressed, and 25,000 entries.
  Limits reject the run instead of silently trimming it. Temporary source is
  removed after parsing and on failures; recursive cleanup checks its target.
- `lib/parser/parse.ts` separates selection from parsing while preserving the
  original standalone entry point. `lib/pipeline/run.ts` records fetch, select,
  parse, and store, including actual selected/skipped and file/edge counts.
  Its top-level catch persists the failed stage and reason. Failed failure writes
  raise loudly instead of being suppressed.
- `lib/pipeline/writer.ts` alone constructs the privileged client, guarded by
  `server-only`. Every mutation includes the captured organization, analysis ID,
  and run ID. Expiring Clerk tokens are never reused for long-running writes.
  Result JSON is contract-validated and limited to 20 MiB.

## Applied database changes

All five Phase 07 migrations are applied to the linked Cartograph project:

1. `20261009181544_phase_07_pipeline.sql` adds complete parser metadata and
   transactional reservation, stage advancement, storage, failure, and read RPCs.
2. `20261009184351_phase_07_parser_order.sql` preserves original file/edge array
   order. The first equality check caught path-sorted reads changing the contract.
3. `20261009185643_phase_07_live_analysis_contract.sql` deletes flagged seed
   analyses and their unused projects, preserving organizations and actual runs.
   It rejects reseeding, enforces one analysis per project, changes active status
   to `running`, and requires complete file/edge metadata. The migration uses an
   explicit transaction because this installed CLI sends statements individually.
4. `20261009192206_phase_07_realtime.sql` declares private topic patterns before
   publication, adds the analysis-table trigger and subscription policy, and adds
   the deliberate rerun RPC.
5. `20261009193644_phase_07_progress_contract.sql` matches the supplied reference:
   payloads contain exactly `status`, `stage`, and `message`; each stage's actual
   message is retained in `stage_messages`; stale runs may be restarted; a new
   `run_id` prevents an abandoned process from modifying its replacement.

The store RPC inserts files and resolves every edge endpoint against files in
that same analysis and organization. If any edge is missing an endpoint, the
entire batch rolls back, including files and completion. Completion is committed
with all result rows. Writer RPCs are callable only by `service_role`.

`lib/analyses/dashboard.ts` makes named-column, bounded server reads. The list
shows at most 50 analyses and indicates more rows. `lib/analyses/result.ts` uses
the invoker read RPC to reconstruct the full parser contract, including every
skip and import occurrence. Neither reader supplies an organization filter:
the existing forced RLS policies decide ownership. Database types were regenerated.

## Private realtime and progress

- `private.progress_topic_patterns` declares `analysis:<uuid>` and an organization
  topic used only to discover new/restarted dashboard rows. The registry is
  forced-RLS, read-only for application roles, and is checked before each publish.
  Undeclared publication aborts the write.
- `private.publish_analysis_progress()` runs only from our `analyses` trigger.
  It inserts native Realtime messages containing exactly the three approved
  fields. The installed `realtime.send()` swallows insertion errors and adds
  a payload ID, so the trigger uses its documented table shape directly to keep
  errors loud and the payload exact. No trigger is attached to Realtime machinery.
- Realtime's SELECT policy goes through the `analyses` row policy for per-analysis
  topics. Other organizations and missing organization claims are denied. There
  is no browser publication policy. The additional organization topic checks the
  same Clerk organization claim and registry.
- Native Realtime creates daily message partitions on socket connection, not
  on database publication. `lib/supabase/initialize-realtime.ts` briefly connects
  a public socket before reservation/restart. It publishes nothing and cannot
  receive private progress. Connection failure blocks reservation visibly.
- `lib/supabase/browser.ts` creates the authenticated realtime client;
  `components/analysis-live.ts` obtains fresh Clerk tokens through the SDK's
  heartbeat callback, reconnects, and removes channels on unmount/org changes.
  Browser code does not query application tables.
- `components/analysis-progress.tsx` lists the four stages with retained actual
  messages, marks a failed step, and shows its reason. Completion replaces the
  progress URL with `/analyses/<id>/map`, which loads the committed result.
  Subscription/reconnection also refreshes once to close the
  snapshot-to-subscription gap; there is no polling.
- `components/analysis-dashboard.tsx` subscribes every unfinished row to its own
  analysis channel. The stage/message update from that stream, and terminal
  events refresh the server snapshot. Five minutes without a stage update marks
  and counts stale rows. A local one-shot deadline updates that label without
  reading the database. Counts apply to the displayed, bounded list.

Supabase documents [database broadcasts and partition initialization](https://supabase.com/docs/guides/realtime/broadcast)
and [private-channel authorization](https://supabase.com/docs/guides/realtime/authorization).
The installed Next implementation supports [tracking an already-started promise with after](https://nextjs.org/docs/app/api-reference/functions/after).

## Reruns and explorer

`components/analysis-rerun.tsx` shows an explicit replace-map confirmation on
complete, failed, and stale analyses. Its API handler verifies the session,
reads the analysis through RLS, and calls the secret-only restart RPC. Row locking
prevents concurrent reruns from resetting a fresh active job. A stale restart
changes the run ID, clears previous results/metadata/history, and retains the
analysis URL. Old advancement/store calls are rejected; old failure calls cannot
fail the replacement. Nothing restarts automatically.

`app/(workspace)/analyses/[analysisId]/page.tsx` renders progress and redirects
completed analyses to `/analyses/<id>/map`. The map route renders the existing
`MapShell`, with commit provenance and RLS-protected data. Opening a map before
completion, or restarting a saved map, returns to progress. The server redirect
also handles a completion event missed before subscription. A restart racing
the metadata/result reads returns to progress. The map follows rerun broadcasts too.
`components/coverage-banner.tsx` keeps the parsed/discovered file percentage
visible even when collapsed, explicitly marks partial graphs, and exposes all
skipped files and unresolved/excluded import reasons. The percentage includes
unsupported/excluded files; it is not an import-resolution score. Partial figures
are rounded down so they cannot appear to be 100%.

The preview route and both checked-in parser outputs are deleted. Map and graph
verification now require an explicit real parser output; absent input fails loudly.
The current UI remains compact, uses monospace paths, supports existing themes,
and introduces no autonomous animation. Framework roles and routes remain absent.

## Verification and acceptance

Terminal checks performed:

- TypeScript, ESLint, production build, and whitespace checks.
- A temporary production server returned JSON 401 for signed-out submission and
  rerun POST requests. The temporary server was stopped after these terminal checks.
- Standalone parser checks; map and graph checks using a fresh local Excalidraw
  parse: 706 files, 3,618 edges, all file rows reachable, all edge endpoints and
  provenance retained, and three real cyclic groups.
- Offline pipeline checks for normalization, anonymous requests, commit pinning,
  archive safety, corrupt archives, all three import kinds, coverage, and unchanged
  selection/parser output.
- Real GraphQL.js fetch/parse/store/readback at
  `ee5ce41d4b68d1852306d3b56dba2cbbb6c43fea`: 495 parsed files, 149 skips, 1,910
  edges; full parser result unchanged through the actual HTTP secret writer and
  RLS readback. Repeat and concurrent submission reuse, persisted fetch/parse
  failures, and cross-organization isolation pass. Test organizations are removed.
- Phase 02 and Phase 07 SQL checks explicitly roll back their fixtures.
  Realtime verification simulates the native subscription authorization function:
  own topics are readable, other/missing orgs are denied, and browsers cannot
  publish. On the same analysis topic, own org sees exactly seven messages and
  the other sees zero. Payload shape, fresh/stale reruns, old-run write rejection,
  stage-history reset, and undeclared-publication rollback are checked.
- Supabase function lint over `public,private` passes with warnings treated as
  failures. Deployment trace audit checks for environment files, private caches,
  and git metadata.

The browser acceptance remains the user's check: submit a public repository,
watch named messages into its stored map, repeat the URL and confirm reuse,
submit a missing repository and see a persisted failure, watch a second dashboard
tab update, and inspect/collapse a partial coverage banner. Also confirm stale
mark/count/rerun, terminal reruns, org switching/channel isolation, keyboard use,
themes, and narrow layout. No browser automation or test runner was installed.

## Limitations and observed failures

This is an in-process local pipeline, without a durable queue or overall run
timeout. Killing the app leaves a stale row until a deliberate rerun. A superseded
parser may finish its current work before its next guarded write; it cannot alter
the replacement. Native `tar` is required. Dependencies/config packages from a
fetched repository are not installed: missing extended tsconfig packages fail
loudly, while unresolved imports are retained as coverage.

A browser run for `lemayan/msingi-learning-platform` exposed a fetch-stage hang.
The installed Next fetch wrapper tees even no-store GET responses. Awaiting
cancellation of the GitHub redirect body waits for its unread cached branch:
the same installed clone helper reproduced the wait, while native cancellation
completed in about 0.5 ms. `githubRequest()` now supplies a job-owned AbortSignal,
which the installed wrapper treats as an opt-out from response deduplication.
This introduces no overall run timeout. The regression check exercises the
installed Next wrapper and requires redirect/download/cleanup to finish within
five seconds for a local fixture. Existing hung runs need a deliberate stale rerun.
An isolated fetch/parse benchmark of that repository completed in 16.2 seconds:
12.2 seconds fetching/extraction, 0.2 selection, and 3.7 parsing (149 files,
197 edges). Actual timing varies with network, repository contents, and storage.
The full pipeline, including reservation and committed storage through the
actual secret writer, then completed in 16.9 seconds in an isolated verification
organization. Full RLS readback equality and fixture cleanup passed.

The temporary Next reproduction unexpectedly triggered pnpm's auto-install,
contrary to the no-install rule. Its stopped private folder and dependencies
were removed; application dependencies and the main lockfile were unchanged.
The subsequent reproduction and regression use the already installed Next helper.

The first replacement-key check previously failed with `Invalid API key`; the
current replacement passed. Earlier automatic review rejected screenshot-only
seed deletion authorization; the user's explicit text approval resolved it and
cleanup is applied. A SQL check initially lacked its own transaction and failed
its role assertion; its temporary fixtures were removed and explicit BEGIN /
ROLLBACK added before the successful rerun. Restricted build execution initially
failed with `spawn EPERM`; the permitted build succeeded. Turbopack still warns
about dynamic parser filesystem tracing; the generated traces were audited for
private artifacts. Browser Clerk-token refresh and end-to-end UI acceptance are
not claimed as terminal-verified.
