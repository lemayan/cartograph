# Phase 5 — Detail pane

**Goal.** Click anything on the map and understand what it is.

## Build

- **What the pane shows when nothing is selected**, which is the first thing
  anyone sees. A summary of the repository as a whole: its name, the framework
  detected, and counts of files, imports and routes. Then two ranked lists —
  what the rest of the repository leans on most, ordered by how many things
  import it, and the files nothing imports at all, which is where reading
  starts. And a count of how many files no convention could identify.
  At the user's request, the repository summary follows the supplied reference:
  a compact repository/framework heading, three count cells for files, imports
  and routes, skipped/unresolved supporting counts, and ten single-line paths
  per ranked list with exact remaining counts. The files nothing imports are
  ordered by outgoing dependency count, with paths breaking ties. Full paths
  remain available on hover and to assistive technology; selected-file import
  and dependent lists remain complete.
- The right-hand pane fills from whatever is selected: the file's path, what
  kind of file it is, how long it is, how many things it depends on and how many
  depend on it, then the full list of each.
- Two tabs in that pane: **Structure** and **Explanation**. Structure is
  everything above. Explanation is an empty state for now — nothing fills it
  until there is a model call to fill it with.
- Selecting a folded folder shows the same two tabs, with Structure listing
  what kind of files are inside it and how many of each.
- Every file path shown in the pane is clickable, and clicking one moves the
  map's selection to that file.
- Hovering a neighbour in the pane highlights it on the map. Hovering a node on
  the map highlights it in the pane. Both directions.
  Moving between file rows or between a file's label and counters must keep a
  stable target, without briefly highlighting the whole folder or clearing.
  Pointer and keyboard focus share the same highlight treatment. Hover never
  changes selection or geometry, and reduced-motion preferences are respected.
  Hover must not re-brighten unrelated rows or rebuild the canvas node/edge
  objects. It marks only the target row or folder, with no fading trail.

## Constraints

- Deselecting returns to the repository summary. It is the pane's resting
  state, not a placeholder.
- Selecting something fires no network request. Everything in this pane is
  already in the browser.
- Which tab is open survives changing the selection. Someone comparing
  explanations across three files should not have to reopen the tab three times.
- The pane does not become a modal on small screens in this phase. One layout.

## Acceptance check

1. Load the map and click nothing. The pane already tells you what this
   repository is — counts, the most depended-on files, and where to start
   reading. Not an empty state asking you to select something.
2. Select a file: the pane fills, and the network tab records zero new
   requests. Hover a neighbour and it lights up on the map with no perceptible
   delay, for the same reason.
3. The import and dependent counts in the pane match the number of rows listed
   underneath them. If it says seven, seven paths are listed.
4. Open the Explanation tab, select a different file. The Explanation tab is
   still the one showing.

## Not in this phase

Blast radius and dependency chain buttons.
