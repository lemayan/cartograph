# Phase 06 implementation

Implemented against `docs/specs/phase-06.md`. Browser acceptance remains pending
and belongs to the user. No package was installed, no model was called, and the
checked-in parser snapshots were not changed.

## Graph walks

`lib/graph/analysis.ts` implements one breadth-first walk with incoming/outgoing
direction and a depth limit. Incoming is blast radius; outgoing is dependency
chain. Both default to two levels. Each file appears once at its shortest
distance, the selected file is excluded even when a cycle leads back to it, and
missing endpoints fail loudly.

`components/map-details.tsx` adds both buttons under the selected file's facts,
an adjustable depth input, a complete scrollable result list, and hop counts.
Every result path selects that file. The calculation runs synchronously over
the data already held by the client; there is no loading state or request.

## Insights

`lib/graph/analysis.ts` derives four groups. Counts use distinct source/target
pairs rather than trusting stored fan counts. The approved rules for many
importers are at least ten and strictly more than twice the repository average
fan-in. Long files have strictly more than 500 parsed lines.

Cycle detection uses two iterative graph passes to find strongly connected
components, including self-imports. Each cyclic group includes all its files
and one closed path made entirely of real imports. It does not enumerate every
possible circuit. Four fixed sentences describe the four groups.

`lib/adapters/entry-files.ts` supplies exclusions to the pure graph calculation.
It protects explicit entry kinds, conventional `app` entry names, `pages` and
`routes` trees, middleware/proxy/instrumentation names, configuration filenames,
dot-rc files, Storybook configuration, and Docusaurus sidebars beside a
Docusaurus config. It assigns no roles and changes no parser output. The
page/layout and proxy rules follow the official [Next.js routing
conventions](https://nextjs.org/docs/app/getting-started/layouts-and-pages) and
[Proxy convention](https://nextjs.org/docs/app/getting-started/proxy).

`components/map-details.tsx` places Insights after the existing detail content
in a native disclosure that starts collapsed. Imported-by-nothing comes first;
cycles and long files follow underneath. All paths remain clickable. Counts,
thresholds, cycle membership, and the ordered import witness are visible.
Nothing is labelled unused, rated, or assigned a severity.

## Rail and panel matching

`components/map-shell.tsx` turns the existing extension categories into toggle
buttons. Clicking the active category again, or Clear category, resets it.
`lib/map/categories.ts` projects matching files onto the existing scene without
removing nodes, rows, or imports or altering geometry.

`components/dependency-map.tsx` dims unmatched rows and folders and reports
matched/total counts in every folder header. Counts include off-screen files.
Edges incident to a matching file remain visible; unrelated edges dim. Above
and below anchors reflect matching off-screen files. While a category is active,
its brightness takes precedence over selection; clearing it restores the
existing selection highlighting. Hover marks its target without making an
unmatched row bright. Detail-pane paths also dim and folder lists report matches.

The three columns, existing typefaces, and semantic colours are preserved.
Styling is in the existing three map CSS files. Filtering does not refit the
canvas, reset scrolling, or change pan/zoom.

## Terminal verification

- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed.
- `corepack pnpm build` passed with process permission. The first sandboxed
  attempt compiled but failed at the TypeScript worker with `spawn EPERM`.
- `corepack pnpm map:verify` passed the existing map/detail/hover checks: 706
  files, 20 folded nodes, 3,618 real imports, and every file reachable by scrolling.
- `corepack pnpm graph:verify` passed fixtures, independent reachability checks
  on 20 graphs, 20,000-file acyclic/cyclic stress checks, two-hop walks in both
  directions, real cycle ledger checks, and category totals at both ends of
  panel scroll ranges. The command is backed by `scripts/graph-verify.ts`.
- `git diff --check` passed.

Final Excalidraw insight counts: 179 imported by nothing after entry exclusions,
56 with many importers, 3 cyclic groups, and 111 over 500 lines.

## Browser acceptance at `/preview`

1. Select `packages/common/src/index.ts`. Blast radius defaults to two levels
   and contains 520 files; dependency chain contains 21. Both should appear
   immediately without a spinner or a feature-triggered network request.
   Spot-check paths against the repository, then change depth and direction.
2. Expand Insights. `dev-docs/src/components/Highlight.js` is imported by nothing.
   `examples/with-nextjs/src/app/page.tsx` and its layout are excluded from that
   insight, as are config files. The original repository summary still lists
   framework starting points as required by Phase 05.
3. Expand the group containing `excalidraw-app/collab/Collab.tsx` and `Portal.tsx`.
   The witness is Collab -> Portal -> Collab. The local clone confirms the
   imports at Collab line 92 and Portal line 22; the reverse import is type-only,
   which the parser intentionally records.
4. Click an extension category. Every panel stays in place, unmatched rows dim,
   and matched counts across all 20 headers sum to the rail's count. Open and
   scroll a mixed panel; counts remain exact. Clear the category to restore
   selection highlighting.
5. Keep the network tab open while using the new controls and disclosures.
   No Phase 06 interaction should produce a request. Browser behavior has not
   been automated or claimed as verified.

## Remaining limits

The exclusions are conservative conventions, not framework detection or proof
of use. Custom entry/config names need explicit adapter metadata; unknown kinds
remain unknown. The graph includes only the imports resolved by the existing
parser, so walks do not prove runtime breakage or find dynamic/unparsed usage.
Cycles include type-only imports. The preview's existing skipped/unresolved
coverage and framework/route limitations remain visible and unchanged.
