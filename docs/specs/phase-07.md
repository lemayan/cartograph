# Phase 7 — The pipeline

**Goal.** Paste a URL and watch your own repository become a map.

## Build

- Fetching a public repository as an archive. No repository scope is requested
  and no token is ever stored.
- Record which commit the archive came from. A later phase needs to know
  whether the repository has moved on since.
- The run: fetch, select, parse, store — with named stages, and a catch at the
  top that writes a failed state rather than leaving a row stuck mid-parse
  forever.
- The form on the dashboard, finally wired to something.
- **One analysis per repository.** Submitting a URL that has already been
  analysed does not create a second one — it takes you to the existing analysis.
  Re-running the same repository is a deliberate act from that analysis, not
  something you get by pasting the URL again.
- The dashboard form sits in its header bar. Re-run is available for complete,
  failed, or stale analyses. A stale restart invalidates the previous run's writes.
- A progress page that names the stage as it happens, updated live.
- After storage commits successfully, redirect from progress to that analysis's
  stored map. Opening an already completed analysis also goes to its map.
- The explorer, now reading real stored rows instead of the checked-in file.
- A coverage banner on the map, which says the graph is partial when it is.

## Constraints

- **Backend contract confirmed for this phase:** remove seeded analysis rows and
  their unused projects; every project has at most one analysis. Active analyses
  use status `running`, with the current step recorded separately in `stage`.
  Files and edges retain the complete parser contract. A secret-key-only
  database function inserts edges and rejects the entire batch if any endpoint
  does not match a stored file in that analysis.

- Live progress is driven from the database, not from the browser polling.
  Something in the database publishes when the stage moves, and the page
  subscribes. Publish only status, stage, and message, not the whole row — then the
  page has nothing to filter and nothing to interpret.
- **The channel has to be declared before anything can publish to it.** A
  pattern for per-analysis channels is registered as part of the migration,
  alongside the tables. Publishing to an unregistered channel silently goes
  nowhere, and the symptom is a progress page that simply never updates.
- Publish from a trigger on our own table. Never attach a trigger to the
  realtime machinery itself.
- **Who may subscribe is also a policy.** Another organization's analysis
  channel is not subscribable, for the same reason its rows aren't selectable.
  The progress stream is protected the same way the data is.
- The browser side uses the authenticated client, not a bare one — it needs the
  access token cookie to open the socket, which is why that cookie is readable
  in the first place.
- A run that fails writes _why_ it failed and which stage it failed in.
- **A run that dies without failing has to be visible too.** Nothing here has a
  queue or a timeout, so a process that stops mid-parse leaves a row that will
  say "running" forever. The dashboard marks any unfinished run past a few
  minutes old as stale, so the difference between working and abandoned is
  legible without opening it.
- Every unfinished dashboard row subscribes to its own private analysis channel.
  Stale rows are marked and counted; progress retains the real message for each stage.
- The coverage banner may collapse, but it collapses to a single line that
  still names the figure. A graph that is quietly thirty percent complete must
  never be able to look complete.
- **Delete the checked-in parser output and the preview route as part of this
  phase.** It was scaffolding to build the interface against; analyses are
  stored properly now. Everything built on it keeps working, on live data.

## Acceptance check

1. Paste a public repository URL. The stages tick past with real names, not a
   spinner, then storage completes and the URL changes to that analysis's map.
2. Paste a repository you've already analysed. You land on the existing
   analysis. There is still one row for it, not two.
3. Paste a URL for a repository that doesn't exist. It fails with a message
   that says what went wrong, and the dashboard row reads failed — not
   "parsing" forever.
4. Open the dashboard in a second tab during a run. The stage updates there
   too, without a refresh.
5. Analyse a repository with a deliberately awkward setup — aliases, or a
   nested app — and confirm the coverage banner appears and names a figure
   under 95%.

## Not in this phase

Framework-specific roles, and routes.
