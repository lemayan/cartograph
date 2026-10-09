# Phase 04 implementation: the canvas

Phase 04 provides the real dependency map at public `/preview`: a permanent
three-column shell, directory folding, expandable file panels, fan-in height,
direct-neighbour selection, the reference colour palette, and scrolling through
every file in a large folder. The active input is the complete Excalidraw parser
snapshot. GraphQL.js remains a second snapshot for regression verification.

This is the consolidated record for the shell, canvas, Excalidraw validation,
category rail, selection, palette, and scrolling work. It replaces the separate
Phase 04 reports and describes the final behaviour. The governing behaviour is
in [the Phase 04 spec](specs/phase-04.md), with rationale in
[project-doc.md](project-doc.md).

**Status:** implementation and terminal verification passed. Browser acceptance
belongs to the user under `AGENTS.md` and remains pending. No browser driver or
test runner was installed, and no browser acceptance was automated.

## Scope and settled decisions

- The preview is public `/preview`, outside the signed-in workspace layout.
  The dashboard and organization flows retain their existing behaviour.
- The shell stays a 180px left rail, a flexible center with a 360px minimum,
  and a 320px right detail column. Later phases fill these regions.
- Folding uses the lowest threshold that produces at most 24 nonempty groups
  without singleton groups for the supplied repositories. The user approved
  that cap when the spec's separate suggestion of one node per ten files
  conflicted with keeping these repositories below roughly two dozen.
  Actual files-per-node ratios are reported rather than forced.
- The tutor reference supplies the category rail and colour meanings. The user
  chose to retain the compact graph arrangement rather than copy the reference's
  widely spaced graph with very small fitted labels.
- Large opened folders expose all files through a fixed-height native scrolling
  list. This user-requested behaviour replaces the earlier truncated list with
  a remaining-file summary and is recorded in the spec.
- Preview data is checked-in scaffolding. Rendering the map does not fetch a
  repository, query Supabase, classify file roles, or call an AI model. Existing
  Next.js application environment requirements still apply.

## Implementation locations

| Location | Responsibility |
| --- | --- |
| `app/preview/page.tsx` | Public preview, existing brand/theme header, server-side snapshot validation |
| `app/preview/preview.css` | Viewport-filling preview and narrow-screen horizontal scrolling |
| `proxy.ts` | Exact `/preview` public-route exception within existing protection |
| `components/map-shell.tsx` | Permanent columns, extension categories, repository name and folded count |
| `components/map-shell.css` | Column geometry, dense shell styling, map-scoped themes and palette |
| `components/dependency-map.tsx` | React Flow nodes/edges, panel controls, selection, native scrolling and measured refitting |
| `components/dependency-map.css` | Folder/file styling, handles, scrollbars, counters and focus states |
| `lib/map/folding.ts` | Pure deepest-first folding, file ownership and folder-boundary fan counts |
| `lib/map/scene.ts` | Pure scene geometry, unique labels, edge bundles, selection and scrolling projections |
| `lib/map/layout.ts` | Deterministic dagre ordering and compact placement |
| `lib/parser/contract.ts` | Runtime validation independent of repository traversal |
| `lib/parser/coverage.ts` | Pure import coverage tallying |
| `lib/parser/data.ts` | Validated JSON read/write and compatible validation re-export |
| `data/preview/excalidraw.json` | Complete active parser snapshot |
| `data/preview/graphql.json` | Complete earlier snapshot for regression checks |
| `data/preview/README.md` | Snapshot provenance, commands and hashes |
| `scripts/map-verify.ts` | Standalone terminal assertions over real snapshots and focused fixtures |
| `tsconfig.map.json` | Compilation of standalone map verification |
| `package.json`, `pnpm-lock.yaml` | Approved React Flow/dagre dependencies and verification command |

The user approved `@xyflow/react` and `@dagrejs/dagre` for the canvas and layout.
The installed versions used for this implementation are 12.12.0 and 3.1.1.
The parser's previously approved `ts-morph` dependency remains separate.

## 1. Validate and render real parser output

`app/preview/page.tsx` imports `data/preview/excalidraw.json`, validates the
entire schema-version-1 `ParserResult` on the server, and passes it to
`MapShell`. File and edge lists are the basis for all client-side graph
calculations. Snapshot fields are neither trimmed nor rewritten for display;
folding, labels, positions and highlights are derived views.

GraphQL.js established the map before Excalidraw was added. Both snapshots
retain their complete coverage ledgers and provenance. Skipped files, external
imports, excluded targets and unresolved imports remain reported facts; none
becomes a guessed graph connection.

Preview validation was separated from repository traversal during this phase.
`contract.ts` holds runtime checks and `coverage.ts` holds pure import tallying.
`data.ts` still provides validated JSON read/write and re-exports validation for
compatibility. This prevents preview validation from importing filesystem
parsing and ts-morph. The parser contract and CLI behaviour are unchanged.

### Snapshot provenance

| Snapshot | Repository revision | Role |
| --- | --- | --- |
| Excalidraw | `4c00f31ddcc20086bac1020428819fe0b9a30bce` | Active `/preview` input |
| GraphQL.js | `ee5ce41d4b68d1852306d3b56dba2cbbb6c43fea` | Earlier input and regression fixture |

Both repositories were parsed on 9 October 2026 from separate temporary clones.
The shallow Excalidraw clone is at
`$env:TEMP/cartograph-excalidraw/excalidraw`; GraphQL.js was cloned at
`$env:TEMP/cartograph-phase03-graphql`. The temporary directories are not
required to render the checked-in snapshots. Full provenance is also retained
in [the snapshot README](../data/preview/README.md).

Recorded SHA-256 values:

- Excalidraw: `361811f7e0e858be084cda64f02c5a46864b1b6e35caa12ff965a87e9a92a711`
- GraphQL.js: `7ebb77337f856a516339666716b6cd1aba0dfc980b699be9700e117c16d904d9`

The Excalidraw hash remained unchanged through selection, palette and scrolling
changes. GraphQL.js matches the original Phase 03 output.

### Excalidraw parser coverage

| Measurement | Count |
| --- | ---: |
| Files found | 1,344 |
| Files parsed | 706 |
| Files skipped | 638 |
| Exact folders | 98 |
| Unique real file edges | 3,618 |
| Import occurrences | 5,000 |
| Resolved occurrences | 4,097 |
| External occurrences | 534 |
| Excluded occurrences | 322 |
| Unresolved occurrences | 47 |
| Re-exports: found / resolved / external | 170 / 169 / 1 |
| Dynamic imports: found / resolved / external / unresolved | 20 / 11 / 8 / 1 |

The 638 skips reconcile as 50 hidden-directory entries, 584 unsupported files,
and four files in the installed config package's dependency directory. Every
skip and import occurrence retains a reason in the ledger. Unresolved examples
include Docusaurus virtual modules, missing package files and
`virtual:pwa-register`. Import occurrences and unique file-to-file edges are
different measurements: multiple occurrences can resolve to the same file pair.

## 2. Keep the three-column shell permanent

`MapShell` renders the category rail, center map and right detail pane with
accessible headings. The right body is empty in this phase. The center header
shows the repository name and folded folder count.

`map-shell.css` uses `180px minmax(360px, 1fr) 320px`, an 860px minimum total
width, borders between columns, and 36px headers with small type. The preview
fills the available viewport below the existing header. Below the minimum
width, the focusable main viewport scrolls horizontally while all three
columns stay beside one another. The detail pane remains a column.

The page uses the existing theme controls and skip-link target. Its route does
not look up identity or read the database. `proxy.ts` makes the exact preview
route public while retaining existing workspace protection.

## 3. Derive file categories from parsed extensions

`map-shell.tsx` groups `ParsedFile.extension`, sorts by descending count with
extension order breaking ties, and renders a swatch, monospace extension and
count. The rail remains noninteractive; it does not filter the graph.

| Category | Files | Colour meaning |
| --- | ---: | --- |
| `.ts` | 357 | Purple TypeScript |
| `.tsx` | 320 | Pink TSX |
| `.js` | 25 | Red JavaScript |
| `.mts` | 3 | Neutral grey |
| `.cjs` | 1 | Neutral grey |
| **Total** | **706** | All parsed files |

The initial role-based rail showed `Unknown` because the fallback adapter leaves
roles null. The tutor reference showed extensions, so the rail was corrected to
the parser's real extension field. Roles remain unclassified and distinct from
these categories. The tutor screenshot's total differs from this snapshot;
its repository revision and parsing scope are not established. Counts were not
changed to match the image.

## 4. Fold directories from deepest to shallowest

`foldFolders()` starts with exact file directories and their ancestors. At each
depth, it first decides which groups hold fewer files than the threshold, then
merges those groups into their parents. Applying a merge does not change which
other groups at that same depth were selected to merge.

Thresholds start at two. Every attempt rebuilds from the original file list;
it never continues from the previous attempt's merged tree. It stops at the
lowest threshold satisfying the 24-group cap and no singleton groups for these
inputs. Empty groups are omitted, every parsed file belongs to exactly one
displayed folder, and deterministic sorting makes input order irrelevant.
The repository's own nesting determines the resulting groups.

Folder fan-in counts distinct source files outside the group that import its
files. Fan-out counts distinct target files outside the group imported by its
files. Internal imports do not inflate boundary counts. Missing source or
target ownership throws an error rather than silently discarding an edge.

## 5. Derive scene geometry and real edge bundles

`createScene()` builds folder nodes and displayed connections from folded
groups and original parser edges. Edges sharing the same displayed source,
target and handle pair are bundled, with every original file edge retained in
`imports`. Internal imports are hidden while folded and become visible when
that panel opens. No connection is inferred from placement, names or proximity.

Folded node height is `64 + round(6 * sqrt(fanIn))` pixels. Width comes from the
label with a minimum allowance for controls and counts. Long names affect
width, not dependency height. Open panel height is the larger of its dependency
height and bounded header/list/footer geometry.

`uniqueLabels()` chooses the shortest path suffix that distinguishes visible
folders and file rows. Ambiguous names retain the required parent segments.
Full paths remain in tooltips and accessible labels. To prevent a scroll from
resizing a panel, width reserves room for every reachable file label, extension
swatch, both fan counters and the scrollbar gutter.

## 6. Open a folder into one bounded file panel

`FolderNodeView` renders a custom React Flow node. Clicking the folded button
opens that same node ID as a bordered panel. Its header shows the unique folder
label, file count, fan-in and fan-out. Clicking the header closes it.
Opening or closing also selects the folder. Each real file is a button with
its extension swatch, label and parser-derived file fan-in/fan-out.

Visible file rows have their own incoming and outgoing handles. Internal panel
imports loop around its border rather than disappearing behind rows. Handles
are not connectable. The map disables node dragging, edge reconnection,
deletion and double-click zoom. It retains explicit zoom and fit controls,
with no ambient animation.

Folder buttons expose `aria-expanded`; selected file buttons expose
`aria-pressed`. Full paths and fan counts have accessible labels, and counters
use directional arrows as well as colour.

## 7. Scroll through every file without moving the map

The expanded list has a fixed viewport of at most twelve 24px row heights below
the 48px header. A 26px range footer appears for folders larger than twelve
files. Every file button is rendered inside the native scroller; this is not a
truncated list or a file-virtualization system.

The list provides a thin native scrollbar, stable scrollbar gutter, contained
scrolling, keyboard focus and native keyboard scrolling. React Flow's
`nowheel`, `nopan` and `nodrag` classes and wheel propagation handling confine
list scrolling to the panel. Scrollbar clicks do not replace the selected file
with a folder selection. Closing and reopening clears that folder's offset and
returns its list to the top.

The scene derives intersecting rows from the native scroll offset. A partial
scroll can intersect thirteen rows even though the viewport is twelve row
heights tall. Completely off-screen files above and below the window use
separate counted boundary anchors. Partially visible file ports are clamped
inside the viewport. The footer reports the intersecting range and exact
above/below counts; it does not invent rows for hidden endpoints.

File and boundary handle IDs stay mounted, with unused handles transparent.
`useUpdateNodeInternals` runs when the active handle set or scroll position
changes. When an off-screen file enters view, its connection moves from the
appropriate boundary to its real row handle.

`scrollScene()` projects new row windows and endpoints onto existing geometry
and rejects any change in dimensions. It reuses original node positions.
Scrolling does not rerun dagre, increment the refit revision, change selection,
or request a new pan/zoom. Each panel maintains its own offset.

For the 149-file `components` folder, the initial range is `1–12 of 149` with
`137 below`. The bottom range is `138–149 of 149` with `137 above`. All files
remain reachable, including the final row.

## 8. Highlight only the selection and its direct connections

`selectionHighlight()` starts from one selected file, or every file belonging
to the selected folded folder. It finds only original imports incident on that
fixed selected set. Those edges' source and target files join the bright set.
It does not walk another hop through their imports.

`selectionVisibility()` projects the result onto displayed nodes, visible rows,
above/below indicators and edge bundles. An edge is bright only when its bundle
contains an incident real import. An unrelated edge between two bright
neighbours still dims. Off-screen indicators are bright independently, only
when that side contains a related file.

Selected files/folders, incident edges and direct endpoint content use full
opacity. Unrelated nodes and rows use 20%; unrelated edges use 8%. Without a
selection, edges use normal 45% opacity. Children of an already dimmed node
retain local opacity one, so dimming is applied once. Clicking a dimmed row can
replace selection.

Node-body clicks select the folder. File buttons stop propagation so their
selection cannot turn into a whole-folder selection. Clicking blank canvas or
pressing Escape inside the map clears selection. Selection and clearing do not
change expansion, geometry or the refit revision. Selection survives scrolling
away from its row and back. Absent file/folder selection IDs fail loudly.

## 9. Apply the reference palette with semantic colours

Map-scoped tokens follow the tutor screenshot's visual colour families; these
values are not claimed to be exact sampled pixels. Explicit light, dark and
system themes retain the same meanings. Auth and dashboard palettes are unchanged.

| Meaning | Dark | Light |
| --- | --- | --- |
| Canvas | `#0b0b0e` | `#f6f6f8` |
| Panel | `#1b1b1f` | `#ffffff` |
| Rail | `#111115` | `#f0f0f4` |
| Text | `#e8e8ed` | `#25252d` |
| Muted text | `#a1a1ac` | `#656570` |
| Border | `#34343d` | `#d8d8e0` |
| Selection / internal / mixed imports | `#7d8bd5` | `#596bbd` |
| Incoming imports | `#a4e2b5` | `#28784a` |
| Outgoing imports | `#d9c58e` | `#91651c` |
| TypeScript | `#b79bef` | `#7050c6` |
| TSX | `#e59ccf` | `#b43e85` |
| JavaScript | `#ef91a8` | `#bf3f5b` |
| Neutral edges | `#797984` | `#797984` |

`selectionDirection()` determines edge colour from original incident imports:
the selected target means incoming/green; the selected source means
outgoing/amber. An internal import or bundle containing both directions uses
selection blue. Unrelated edges remain neutral. Green/amber meanings also
apply to fan counters; file text retains the readable foreground colour.

## 10. Lay out deterministically and refit after measurement

`layoutScene()` gives sorted groups and actual grouped connections to dagre,
excluding internal edges from folder positioning. It keeps dagre's dependency
order and packs that order into compact rows. Normal dagre ranks alone made
the initial GraphQL.js graph 1,754 × 1,743, reducing fitted label legibility.
Compact placement preserves connections while using the center more densely.
The same data and expansion state produce the same positions.

Opening/closing recomputes geometry and queues a measured refit. The coordinator
waits for React Flow's canvas, node dimensions, expected positions and required
handles before fitting. Each toggle captures the pre-click zoom and passes it
as the refit's maximum, so the automatic refit can only zoom out. Its duration
is zero. Stable initial-fit options prevent a selection render from replacing
a pending toggle's zoom cap. Selection and scrolling do not trigger a refit;
explicit user fit/zoom controls remain available.

## Terminal verification and results

The most recent implementation checks on 9 October 2026 passed:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed |
| `pnpm build` | Passed; `/preview` appears in production route output |
| `pnpm map:verify` | Passed against the active Excalidraw snapshot |
| Map verification with GraphQL.js input | Passed |
| `git diff --check` | Passed; Git emitted line-ending conversion notices |
| Snapshot integrity | Excalidraw hash unchanged; GraphQL.js matches Phase 03 output |

Parser JSON write/readback equality passed when the snapshots were generated.
`pnpm parser:verify` also passed after validation and coverage were split from
filesystem traversal. These are recorded implementation checks, not a claim
that browser acceptance passed. Consolidating this document changes no
application code and does not require rerunning the application build.

### Measured graph acceptance

| Measurement | Excalidraw: active | GraphQL.js: regression |
| --- | ---: | ---: |
| Parsed files | 706 | 495 |
| Exact folders | 98 | 77 |
| Folded nodes | 20 | 22 |
| Lowest accepted threshold | 11 | 9 |
| Files per folded node | 12–149 | 9–49 |
| Average files per node | 35.3 | 22.5 |
| Singleton nodes | 0 | 0 |
| Omitted or duplicated files | 0 | 0 |
| Visible folded edge bundles | 124 | 70 |
| Edges with absent node endpoints | 0 | 0 |
| Original file edges represented with all panels open | 3,618 / 3,618 | 1,910 / 1,910 |
| Folded layout bounds | 838 × 691 | 1,033 × 686 |
| Files reachable through panel scrolling | 706 / 706 | 495 / 495 |

The two dozen node cap is met; actual files-per-node ratios exceed the spec's
approximate one-per-ten suggestion, as agreed. Folding was not replaced with
largest-N selection, hand-assigned modules or source-file trimming.

### What the verification script checks

`scripts/map-verify.ts` uses Node's built-in assertions and compiles separately
through `tsconfig.map.json`. It checks:

- Exact single ownership of every file, no singleton groups for both snapshots,
  reversed-input stability, deepest-first sparse-sibling folding and handling
  of a root singleton alongside other groups.
- Existing node/handle endpoints, original edge provenance, exact boundary fan
  counts, monotonic fan-in height and shortest unique labels.
- Repeatable geometry, opening every folder independently into a bounded panel,
  and preservation of every original file edge with all folders expanded.
- Full scrolling reachability in every folder, first/middle/last windows,
  clamped extreme offsets, partial-row port positions, exact above/below
  counts, and unchanged dimensions, positions and import provenance.
- Exact selected-file/folder bright sets, incoming/outgoing/self/internal
  imports, isolated files, clearing, hidden neighbours moving to real rows,
  independent boundary highlights, and unchanged selection geometry.
- No second-hop highlighting and no highlight for an unrelated edge merely
  because both endpoints are bright; correct incoming/outgoing/internal/mixed
  colour classifications.
- Loud failure for absent graph endpoints and nonexistent selections, and no
  mutation of parser data.

These establish graph and scene invariants. Browser event handling, native
scrolling, visual readability and measured refitting still need manual acceptance.

### Commands

Use the checkout's actual CLI names, `parser` and `map:verify`:

```powershell
# Reproduce parsing when the temporary clone and its required config exist.
pnpm parser "$env:TEMP/cartograph-excalidraw/excalidraw" --out data/preview/excalidraw.json
pnpm parser --read data/preview/excalidraw.json

# Verify checked-in snapshots without a clone, account or database query.
pnpm map:verify
pnpm map:verify data/preview/graphql.json

# Application checks.
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

## Browser acceptance: user-owned and pending

1. **Shell and initial view.** Open `/preview` signed out. Expect the existing
   header, an Excalidraw map with 20 folded nodes, readable initial labels,
   five extension categories totalling 706, and an empty right detail column.
   The map should use the center rather than huddle in a corner. Narrow the
   window: columns should stay beside each other with horizontal scrolling.
   Check the skip link and focusable main region.
2. **Opening, closing and refitting.** Click a folded folder. It should remain
   one bordered object, show real file rows and header counts, and reconnect
   edges to visible rows or counted boundaries. The panel should fit into view
   without zooming in. Click its header to fold it again. Try opening another
   panel while already zoomed out.
3. **Dependency height.** Compare a folder with zero fan-in to one with many
   incoming dependencies. The latter should be taller. A long label should
   affect width rather than imply greater fan-in.
4. **Direct-neighbour selection.** Open two folders and select a file. Keep the
   selected row, incident edges and their endpoints bright; dim unrelated rows
   even inside related panels. Edges between bright neighbours should still
   dim when they do not touch the selected file. Click a dimmed row to replace
   selection. Click a node/panel body to select the folder. Blank canvas and
   Escape should clear selection without moving the map.
5. **Large-folder scrolling.** Open the 149-file `components` folder and scroll
   to the end using the wheel and scrollbar. Keep its header visible and panel
   size fixed; expect `138–149 of 149` and `137 above` at the bottom. The map
   should not pan or zoom. Select a late file, scroll away and back, and confirm
   selection persists. Related connections should move between real row
   handles and above/below anchors; unrelated boundary counts should dim.
   Dragging the scrollbar should preserve the selected file. Close and reopen:
   expect the first rows again.
6. **Theme and keyboard behaviour.** In Dark, expect the near-black canvas,
   charcoal panels, purple/pink/red swatches and blue selection. Selected
   incoming edges/counters should be green, outgoing amber, and internal/mixed
   bundles blue. Repeat in Light and System for readability and stable colour
   meaning. Use keyboard activation for folder/file buttons and keyboard
   scrolling with the list focused; check visible focus states.

None of these browser interactions or visual checks has been run by the agent.

## Failures encountered and how they were resolved

- **Excalidraw config resolution.** The first parse failed because
  `dev-docs/tsconfig.json` extends an uninstalled
  `@tsconfig/docusaurus/tsconfig.json`. With explicit user approval, version
  1.0.7, matching the docs manifest's `^1.0.5`, was downloaded using
  `npm pack --ignore-scripts`. Only its four files were extracted into the
  temporary clone's `node_modules`. No Excalidraw application dependencies or
  lifecycle scripts ran, and no tracked source or tsconfig was edited.
- **Layout experiment.** An experimental zero-length dagre rank failed in the
  library. The final implementation uses normal dagre edges and deterministic
  compact packing; the failed experiment is not used.
- **Next.js tracing warning.** The first canvas build passed but preview
  validation pulled in dynamic filesystem parsing and caused whole-project
  tracing. Validation and coverage were separated from traversal and file I/O.
  The final build passes without that warning; it was not suppressed.
- **Category mismatch.** The initial rail grouped null roles as `Unknown`.
  It now groups parsed extensions as the reference requires, without inventing
  role classifications or matching reference counts artificially.
- **Verification during scrolling development.** Changing the scene from one
  remaining-file summary to independent above/below anchors initially broke
  assertions referencing the old summary field. They were updated to verify
  both boundaries and full reachability; final type and map checks pass.
- **Restricted build execution.** Next.js worker spawning can fail with
  `spawn EPERM` under restricted execution. Production validation was run with
  approved execution permissions. That environment failure was not treated as
  a passing check or worked around by weakening the build.

## Remaining limitations and phase boundary

- Browser acceptance is pending, including initial label legibility, wheel and
  scrollbar interaction, theme contrast and zoom-out-only refitting.
- Excalidraw retains 47 unresolved and 322 excluded import occurrences;
  GraphQL.js retains 49 unresolved and seven excluded occurrences. These do
  not become graph edges. External packages are coverage facts rather than
  repository nodes.
- File roles remain unknown through the fallback adapter. Extension categories
  do not imply framework or role classification.
- Checked-in snapshots are temporary UI scaffolding. This phase does not add
  repository ingestion, persisted analyses, detail-pane content or AI workflows.
- Off-screen endpoints intentionally share counted above/below anchors. Their
  original file-edge provenance is retained, and every file can be reached by
  scrolling; off-screen files do not each get an individual visible row endpoint.
- Every expanded file button and handle stays mounted. Larger repositories than
  these fixtures have not been benchmarked; no virtualization or performance
  guarantee is claimed.
- The right detail pane stays empty. No later-phase functionality was added
  during this consolidation.
