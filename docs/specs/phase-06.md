# Phase 6 — Graph maths, the rail, and insights

**Goal.** The tool becomes genuinely useful, with no model involved anywhere.

## Build

- **Blast radius** — everything that breaks if this file changes. **Dependency
  chain** — everything this file needs. Both are the same transitive walk over
  the edge list with a direction argument and a depth limit. Write it once.
- Two levels deep by default. Deeper returns most of the repository and stops
  being an answer.
- Both appear as buttons in the detail pane, and both return instantly.
- **Insights**, four kinds, all of them facts about the edge list: import
  cycles, files nothing imports, files an unusual number of things import, and
  files that are simply too long.
- The left rail becomes real: clicking a category **dims everything that isn't
  in it**, rather than removing it. Each open panel shows how many of its files
  matched, so you can see which parts of the repository the category lives in
  without losing the shape of the whole thing.

## Constraints

- No model is involved in this phase at all. Not to find an insight, not to
  describe one. Each insight's sentence is one of four fixed strings.
- Cycle detection is iterative, not recursive. A real repository will blow a
  call stack.
- **A file nothing imports is not automatically an orphan.** Pages, routes,
  layouts, middleware and config are reached by the framework, and the import
  graph was never going to show that. Reporting them as unused would be the
  parser describing the limits of its own view as a finding about the code.
- Insights render in a panel that starts collapsed, and never as the first
  thing you see. This product explains a codebase; it doesn't grade one.
- Files-nothing-imports leads the list. That one is explanatory for the person
  this is built for. Cycles and oversized read closer to a verdict, so they go
  underneath.

## Acceptance check

1. Select a file, click **Blast radius**: the list appears with no spinner and
   no network request, and it's right — spot-check two entries by opening them.
2. Pick a file you know nothing imports. It appears in the insights panel. Now
   pick a page or a route that nothing imports. It does **not**.
3. The insights panel finds a real cycle in the checked-in repository, and
   walking it by hand confirms the cycle exists.
4. Click a rail category: everything else dims but stays on screen, and each
   panel's match count adds up to the number the rail shows.
5. Nothing in this phase produces a network request. Check once with the
   network tab open and everything clicked.
