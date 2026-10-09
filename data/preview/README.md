# Preview snapshots

## Excalidraw (active preview)

`excalidraw.json` is unmodified, schema-version-1 parser output from
[Excalidraw](https://github.com/excalidraw/excalidraw), commit
`4c00f31ddcc20086bac1020428819fe0b9a30bce`, parsed on 9 October 2026.

The shallow clone sits at `$env:TEMP/cartograph-excalidraw/excalidraw`.
Its documentation tsconfig requires `@tsconfig/docusaurus`; version 1.0.7,
matching its declared `^1.0.5` range, was installed into the clone with explicit
user approval. Only the config package was extracted, using `npm pack
--ignore-scripts`; no application dependencies or lifecycle scripts ran.
The clone's tracked files were unchanged.

```powershell
pnpm parser "$env:TEMP/cartograph-excalidraw/excalidraw" --out data/preview/excalidraw.json
pnpm map:verify data/preview/excalidraw.json
```

Output: 1,344 found = 706 parsed + 638 skipped, 98 exact folders, and 3,618 real
file edges. Coverage retains all 47 unresolved occurrences and 322 excluded
imports. The SHA-256 is
`361811f7e0e858be084cda64f02c5a46864b1b6e35caa12ff965a87e9a92a711`.

The unchanged folding logic produces 20 nodes at threshold 11, holding 12–149
files each, and 124 visible folded edges. All endpoints exist. The snapshot
includes the complete ledger rather than a trimmed graph.

## GraphQL.js (earlier verification)

`graphql.json` is unmodified, schema-version-1 parser output from the public
[GraphQL.js repository](https://github.com/graphql/graphql-js), commit
`ee5ce41d4b68d1852306d3b56dba2cbbb6c43fea`, parsed on 9 October 2026.

The input was cloned separately into the OS temporary directory at
`cartograph-phase03-graphql`. The command was:

```powershell
pnpm parser "$env:TEMP/cartograph-phase03-graphql" --out data/preview/graphql.json
```

The output contains 495 parsed files, 77 exact folders, 1,910 unique real file
edges, and the complete coverage ledger. Its SHA-256 is
`7ebb77337f856a516339666716b6cd1aba0dfc980b699be9700e117c16d904d9`, matching the
Phase 03 verification output. No node or edge was added to suit the canvas.

The preview validates the complete `ParserResult` on the server. The client
derives its folded view from the file and edge lists. This snapshot is Phase 04
scaffolding; it is not a stored analysis or a repository-fetching workflow.
