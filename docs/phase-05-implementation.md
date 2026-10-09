# Phase 05 implementation: detail pane

The permanent right column at `/preview` now explains the repository, selected
files and selected folded folders. It uses the same checked-in parser snapshot
as the canvas. Selection and hover are shared browser state; none of the detail
interactions fetches data or calls a model.

The governing behaviour is [Phase 05](specs/phase-05.md). The preceding canvas
implementation is recorded in [Phase 04](phase-04-implementation.md).

## Agreed handling of missing data

The current parser contract has an adapter name and nullable file kinds, but
no route records. Both snapshots use the fallback adapter, `none`, and all their
file kinds are null. The user explicitly approved displaying missing data
honestly instead of expanding this phase to add framework/route detection:

- Framework: **Not detected**.
- Routes: **Not available**, displayed as a dash with `no adapter` in the
  compact summary. Coverage details explain that route information is absent
  from the analysis. This is not presented as zero routes.
- File kind: **Unknown**, preserving null classifications and counting them.

The rail continues grouping factual extensions; those categories are not used
to invent file kinds. No parser contract, snapshot or framework adapter was
changed for this phase.

## Implementation locations

| Location | Responsibility |
| --- | --- |
| `components/map-shell.tsx` | Shared selection, delegated pointer/keyboard hover publisher, memoized folding and repository detail data |
| `components/map-details.tsx` | Repository summary, file/folder structure, persistent tabs, clickable paths and pane hover events |
| `components/map-details.css` | Compact detail typography, path lists, facts, tabs, independent scrolling and hover/focus states |
| `components/dependency-map.tsx` | Controlled shared selection, folder-local hover subscriptions and stable canvas data |
| `components/dependency-map.css` | Hovered folder border and highlighted file rows |
| `lib/map/details.ts` | Pure neighbour indexes, summary rankings, kind counts and hover projections |
| `lib/map/hover.ts` | Frame-coalesced hover commits, selective snapshots, identical-target deduplication and cancellation |
| `components/map-hover.tsx` | Hover context and subscriptions through `useSyncExternalStore` |
| `scripts/map-verify.ts` | Terminal verification of detail counts/lists and hover, alongside existing canvas regressions |
| `README.md` | Current preview behaviour and links to implementation reports |

No packages were installed. The three-column geometry, existing theme palette,
folding algorithm and repository data remain as established in Phase 04.

## Implemented steps

### 1. Derive complete neighbours and repository rankings

`repositoryDetails()` indexes every parsed file and walks the original unique,
resolved file-pair edges. Each edge contributes its target to the source's
imports and its source to the target's dependents. Both lists are sorted by full
path. Their lengths provide the corresponding counts, so a count cannot be
computed from a different subset than the displayed list.

Multiple syntax kinds on one parser edge do not become duplicate list rows.
Self-imports are retained as real edges. Absent endpoints, duplicate file paths
and duplicate edges fail loudly. The function does not mutate parser input.

Repository import count means resolved imports **between repository files**:
3,618 unique pairs for Excalidraw. It is distinct from the coverage ledger's
5,000 import occurrences, which also includes external/excluded/unresolved
occurrences. The summary label makes that scope explicit.

The most-depended-on list contains every file with at least one dependent,
ordered by descending dependent count, with full path breaking ties. The
reading-start list contains every file with zero incoming edges, ordered by
descending outgoing count with paths breaking ties, following the supplied
reference. These are described as files with no
incoming imports, not as unused files or orphans.

### 2. Show repository structure before any selection

The pane's resting state follows the supplied reference: a compact repository
name and framework heading, followed by three bordered count cells for Files,
Imports and Routes. Files shows the actual skipped count beneath it; Imports
shows unresolved occurrences. The info button toggles an inline coverage
breakdown of found files, import occurrences, external/excluded imports and
the missing route data. Unknown-kind count stays visible below the lists.

Both ranked lists show the first ten paths, with totals in their headings and
an exact `more not listed` count. Single-line paths shorten directory text
while preserving the filename when space permits; full paths remain in
tooltips and accessible labels. Green incoming-arrow badges show dependent
counts in Most depended on; amber outgoing-arrow badges show dependency counts
in Imported by nothing. Excalidraw has 505 and 181 more entries respectively.
The complete rankings remain derived in memory. The pane body scrolls, while
summary lists do not introduce nested scrolling. Selected-file and folder lists
remain complete and scrollable. Deselecting via
blank canvas or Escape returns to this summary, including when Explanation was
the previously chosen tab.

### 3. Fill file Structure from the selected file

File Structure shows the full clickable path, parser kind, line count, import
count and dependent count. Imports and dependents each have a separate full
list, with outgoing amber and incoming green headings. Zero-length lists state
`None.` without inventing paths. A large list scrolls; no row limit changes its
count or removes its later entries.

### 4. Fill folder Structure from the folded group's actual files

Folder Structure shows its path and file total, then groups its actual files
by parser kind using `countFileKinds()`. Kind counts reconcile to the folder's
file count. Null kinds appear as Unknown. The complete file list follows and
every file path is selectable, including files folded in from descendant
directories.

### 5. Keep Structure and Explanation tabs stable

Selected files and folders have Structure and Explanation tabs. Explanation
shows `No explanation has been generated.` and identifies the current target;
there is no model output, request button or network call.

The tab state belongs to the persistent detail component and is not keyed to
selection. Changing files or selecting a folder keeps the chosen tab. Clearing
selection shows the repository summary and hides selection tabs; choosing a
new target restores the previously chosen tab. Tabs support arrow keys,
Home/End, roving focus, tab/panel roles and selected-state attributes.

### 6. Share selection between the canvas and every pane path

`MapShell` owns one nullable file/folder selection. Both the canvas and pane
receive it and update it through the same callback. All displayed file paths
are real buttons, including the selected path and Explanation target path.
Selecting any path changes both the detail target and the existing map's
direct-neighbour highlighting.

Pane path clicks do not open folders, scroll file panels or move the viewport.
If the file is folded or off-screen, its owner node and incident displayed
edges carry its selection using the Phase 04 projection. This preserves the
map's expansion, panel offsets, geometry and zoom while changing selection.
The user can open or scroll the owner panel through its existing controls.

### 7. Highlight hover in both directions without replacing selection

Hover is a separate transient file/folder target. One delegated handler at the
shell resolves pointer targets from data attributes on file rows, pane paths
and folder containers. The nearest file wins over its containing folder. On
pointer exit it resolves the destination directly, rather than first restoring
the folder or clearing. Keyboard-visible focus uses the same target resolver;
mouse-click focus does not overwrite the pointer target. Touch events do not
leave sticky hover. Leaving the shell, cancelling a pointer or losing window
focus clears the hover.

The hover controller commits only the final target in each animation frame,
deduplicates identical file/folder paths and cancels stale clear events on
re-entry. Pending frames are cancelled during cleanup. Moving across a file's
label, swatch and counters therefore does not rerender the shared hover state.
Map folder hover identifies the group's files in the pane; file-row hover
identifies that exact path, including matching entries in neighbour lists.

The shared hover store indexes each file's actual folded owner. Its stable
per-folder snapshots let `useSyncExternalStore` update only the previous and
next owner views, plus the detail pane. Unrelated folder snapshots remain null.
Hover is no longer a prop of the canvas, and does not reconstruct React Flow's
node or edge objects. The memoized canvas receives only files, edges, selection
and the selection callback. Its handles and measured refit coordinator do not
participate in hover updates.

Each owner view marks its hovered file row or folder border. A folded file
highlights its owner; an off-screen file marks the appropriate counted boundary.
The pane highlights matching path buttons. Unrepresented pane paths are not
fabricated or added on hover. The pure `hoverVisibility()` projection remains
covered by graph verification; rendering now uses the owner's local snapshot
and existing row window directly.

Selection dimming applies independently to headers, rows, handles and module
surfaces rather than to the entire React Flow node wrapper. This allows one
hovered file to become readable without changing every other row's brightness.
Folder hover accents its border/header and does not brighten or colour all its
rows. Other selected-edge colours, row opacities and geometry remain fixed.
Hover does not traverse imports, change selection, expand a panel or queue a
refit. Clearing hover restores only the previous target's normal appearance.

Both surfaces use shared hover state rather than competing CSS `:hover` fills.
Hover fades were removed after the user reported continued flickering: accents
now change directly, with no background, border or opacity animation and no
fading trails. This also respects reduced-motion preferences without a separate
animated mode.

The earlier event-coalescing repair passed terminal checks but did not satisfy
the user's browser review: hover still rebuilt the controlled node data and
restored whole-node opacity. The isolated subscription model replaces that
rendering path instead of adding further hover delays.

### 8. Preserve the shell and existing map mechanics

The pane remains the original 320px right column. Narrow screens keep the same
side-by-side columns and horizontal scrolling; no modal, drawer or overlay was
introduced. Text and paths use compact type and the existing palette.

Folder expansion and panel offsets remain canvas-local. Opening/closing still
uses the measured zoom-out-only refit. Selection and hover do not increment its
revision or replace the stable initial-fit options. The native file scroller,
row/boundary handles, direct-neighbour scope and existing controls remain.

## Terminal verification

`pnpm typecheck`, `pnpm lint`, and `pnpm build` passed on 9 October 2026.
The production build lists `/preview` and reports no build warning. Map
verification passed against both Excalidraw and GraphQL.js. Whitespace and
documentation-link checks passed. Both snapshot hashes remain unchanged.

`scripts/map-verify.ts` now checks every real file's displayed import/dependent
lists against its exact parser edge pairs and fan counts. It also checks:

- Repository rankings and counts, unknown-kind totals and deterministic results
  when file/edge input order is reversed.
- Folder kind totals, mixed known/unknown kinds, self-imports and multiple
  syntax kinds without duplicated list rows.
- Loud failures for duplicate edges and absent endpoints.
- File/folder hover scope, folded owner nodes, off-screen boundary indicators,
  bottom-row hover after scrolling, clearing and unchanged scene geometry/data.
- Hover event coalescing, identical-target deduplication, direct row-to-row
  handoff, cancelled stale clears, pending-frame cleanup and reuse after cleanup.
- Stable unrelated folder snapshots, exact previous/next owner changes, invalid
  hover-target failures and subscription cleanup for the isolated hover store.
- All prior Phase 04 folding, edge provenance, selection, direction colours,
  deterministic layout and full-scrolling-reachability regressions.

| Measurement | Excalidraw | GraphQL.js |
| --- | ---: | ---: |
| Parsed files / unknown kinds | 706 / 706 | 495 / 495 |
| Imports between files | 3,618 | 1,910 |
| Files with dependents | 515 | 220 |
| Files with no incoming imports | 191 | 275 |
| Folded nodes / folded edges | 20 / 124 | 22 / 70 |
| Files reachable through panel scrolling | 706 / 706 | 495 / 495 |

Commands:

```powershell
pnpm map:verify
pnpm map:verify data/preview/graphql.json
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

These terminal assertions verify data and graph projections. Browser event
handling, tab interaction and visual readability remain manual acceptance.

## Browser acceptance to run

1. Load `/preview` without selecting anything. Expect repository `excalidraw`,
   706 files, 3,618 imports between files, framework Not detected, routes Not
   available as a dash with `no adapter`, and 706 unknown kinds below the lists.
   Expect 638 skipped files and 47 unresolved imports in the count cells.
   Both ranked lists should show ten clickable single-line paths, incoming
   green counts and outgoing amber counts respectively, with 505 and 181
   `more not listed`. Hover shortened paths to see their full names. Toggle
   the info button to inspect coverage and click a ranked path.
2. Select a file on the map or through the pane. Its full path, Unknown kind,
   line count, import count, dependent count and both complete neighbour lists
   should appear. Count rows in a small example: each total must match exactly.
   Check large lists can scroll to their last entry.
3. Open browser network recording, then select files/folders, hover paths and
   switch tabs. Expect zero new requests from these interactions.
4. Hover a neighbour path in the pane: its visible row or folded owner should
   highlight immediately, without replacing selection. For an off-screen file,
   expect the appropriate above/below indicator. Hover a map file row or folder:
   matching paths already in the pane should highlight. Move away and verify
   the selected appearance returns. Repeat using keyboard focus on paths.
   Sweep across adjacent rows and their text, swatches and counters: expect no
   intervening folder-wide or cleared flash. Check header-to-row transitions,
   leaving the window, pane-to-map moves and reduced-motion mode. Selection,
   scroll position and map geometry should remain fixed throughout hover.
   With a selected file, move over unrelated rows: only the pointed-at row or
   folder header should become accented. The rest of each panel should stay
   steadily dim, with no panel-wide brightness change or trailing fade.
5. Select a folded folder. Expect the same tabs, its file count, Unknown kind
   count matching that total, and every file listed. Click a listed path and
   verify the pane and map switch to that file without panning or changing the
   open/closed panels.
6. Open Explanation, then select another file and a folder. Explanation should
   remain selected with an honest empty state and current target. Clear through
   blank canvas or Escape: the repository summary should return. Select again:
   the remembered tab should reappear. Check arrow/Home/End tab navigation.
7. Check both themes and a narrow viewport. The right pane should stay a column,
   counts/paths should be readable, list scrolling should stay contained, and
   Phase 04 expansion, selection, scrolling and refitting should still work.

Browser acceptance has not been run or automated by the agent.

## Remaining limits

- Framework detection, route extraction and kind classification are unavailable
  in these snapshots, as agreed. The UI reports that absence rather than
  guessing or displaying a zero route count.
- The import/dependent lists cover resolved repository-file connections.
  External, unresolved and excluded import occurrences remain in the unchanged
  coverage ledger and do not become neighbour paths.
- Hover can highlight only matching paths currently represented in the pane;
  it does not change the pane's target or scroll it automatically.
- Repository summary lists show only ten entries each, matching the reference;
  omitted totals are explicit. Selected-file neighbour lists and folder file
  lists still contain every entry.
- Explanation remains empty until a later model-call phase. Blast radius,
  dependency chains, category filtering and insights were not added.
- No browser acceptance, network recording or visual checks have been performed
  by the agent. Readiness is based on code and terminal verification.
