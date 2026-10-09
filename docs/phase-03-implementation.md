# Phase 03 implementation

Phase 03 ends in a standalone terminal parser. No UI, database integration,
cloning, network access, or framework detection is part of the parser.

## Implemented steps

1. **Walk and account for the repository.** `lib/parser/inventory.ts` retains
   complete directories of `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`,
   and `.cjs` files, including declaration files. It excludes `node_modules`,
   directories starting with `.`, and directories named `dist`, `build`, `out`,
   or `coverage`. These are structural rules, not framework checks or a ranking
   by size. The walk still enumerates excluded directories to account for every
   regular file and link entry. It never follows symlinks. Unsupported extensions,
   symlinks, special entries, read failures, unsupported encodings, and syntax
   errors each have explicit reasons. An unreadable directory aborts the command,
   because its unknown contents cannot honestly be counted.

2. **Extract facts from real syntax.** `lib/parser/parse.ts` uses ts-morph and its
   TypeScript compiler to parse file snapshots without changing them. Every
   parsed file has a repository-relative path, exact parent `folder`, extension,
   physical line count, SHA-256 of its original bytes, and TypeScript's
   module-versus-script classification. Empty files have zero lines; a final
   newline does not add an empty line. Root files have folder `.`. Static
   imports, re-exports with module specifiers, literal dynamic imports, and
   type import expressions produce occurrence records. Comments and strings
   cannot produce edges. Literal templates without substitutions are accepted;
   computed dynamic imports are unresolved with `non_literal_import`.

3. **Resolve rather than infer.** `lib/parser/resolution.ts` uses TypeScript's
   resolver with the nearest `tsconfig.json` or `jsconfig.json`, including
   inherited options, aliases, package maps, and NodeNext import/require
   conditions. Without a config it uses framework-free bundler resolution.
   Missing or invalid resolver configuration fails loudly. Each occurrence is
   `resolved`, `external`, `excluded`, or `unresolved`. Node builtins, resolved
   dependency packages, targets outside the repository, and declared dependency
   packages absent from disk are external and do not create edges. A declared
   package absent from disk is explicitly marked as such; it is not claimed to
   have a resolved file. Existing exact relative asset paths are excluded, not
   guessed into code nodes. Every unresolved occurrence has its file, position,
   expression, specifier where available, and reason retained.

4. **Compute the graph independently.** `lib/parser/graph.ts` contains pure
   functions over files and edges. There is one directed edge per ordered pair
   of files; its `kinds` preserves every syntax kind that produced it. Fan-in
   and fan-out count distinct neighbouring files after deduplication, rather
   than repeated import statements. An absent endpoint throws an error.

5. **Keep framework knowledge behind an interface.** `lib/parser/types.ts`
   declares `FrameworkAdapter`; `lib/parser/adapter.ts` supplies the `none`
   fallback. An adapter can classify a parsed file but does not create imports
   or edges. The fallback returns `kind: null` for every file. This phase has no
   framework adapter beyond that fallback.

6. **Publish and validate the data contract.** `lib/parser/types.ts` declares
   `ParserResult`, with `schemaVersion: 1`, repository and adapter names, files,
   edges, and coverage. Coverage includes reconciled inventory totals, exact
   folder count, a per-file skip ledger, aggregate/per-kind import totals, and
   the complete import occurrence ledger. `lib/parser/data.ts` reads unknown
   JSON into typed data without unsafe casts, checks paths, fields and enums,
   reconciles counts, checks folders, hashes, uniqueness, fan counts, endpoints,
   and requires the edges to match the resolved occurrence ledger. Unknown
   schema versions and corrupt data fail. `writeParserResult()` validates before
   writing JSON; `readParserResult()` validates on readback.

7. **Run it without the application.** `scripts/parser.ts` accepts a directory
   and optional JSON output, or reads an existing output. The CLI reports skips
   by reason and examples, import totals, re-export gaps, and up to 20 unresolved
   examples. The JSON retains all skipped files and all import occurrences.
   Output writing also performs typed readback and full equality verification.
   `tsconfig.parser.json` compiles just the standalone parser and scripts with
   the existing TypeScript compiler. Only the approved `ts-morph` dependency was
   added; no script runner or test framework was installed. `.cartograph` holds
   generated compiler output and local JSON artifacts and is excluded from git,
   application typechecking, and linting.

## Commands

```sh
pnpm parser . --out .cartograph/project.json
pnpm parser /path/to/repository --out .cartograph/repository.json
pnpm parser --read .cartograph/project.json
pnpm parser:verify
pnpm typecheck
pnpm lint
pnpm build
```

## Acceptance results

Recorded on 9 October 2026. The local inventory includes generated/dependency
files so that skipped files are fully accounted for; these totals change when
build artifacts change. Exact per-file reasons are in `.cartograph/project.json`.

Self-parse: **51,629 found = 39 parsed + 51,590 skipped**, **14 exact folders**,
and **46 unique edges**. The skipped ledger contains **50,287 dependency-directory
entries**, **1,260 hidden-directory entries**, and **43 unsupported-extension
files**. Import coverage is **107 found = 46 resolved + 57 external + 4 excluded + 0 unresolved**.
The four excluded imports point to existing CSS files, which
are not TypeScript/JavaScript nodes.

The two public verification repositories were cloned into the OS temporary
directory. Cloning is a separate acceptance step; the parser itself only reads
the directory supplied to it.

| Repository | Commit | Found | Parsed | Skipped | Exact folders | Unique edges |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Immer | `8848a5b16938e5681a890d73de7bda24b5080498` | 197 | 55 | 142 | 10 | 63 |
| GraphQL.js | `ee5ce41d4b68d1852306d3b56dba2cbbb6c43fea` | 673 | 495 | 178 | 77 | 1,910 |

- **Exact folders:** every node's folder is its full parent path. GraphQL.js's
  495 parsed files occupy 77 distinct folders, demonstrating that several
  hundred files retain dozens of folders rather than a handful of top-level
  buckets. Its 178 skips are 39 hidden-directory entries and 139 unsupported
  files. Immer's 142 skips are 43 hidden-directory entries and 99 unsupported
  files.
- **Barrels:** Immer has 15 re-exports found and 15 resolved. GraphQL.js has 146
  found, 140 resolved, and six excluded SVG targets in `website/icons/index.ts`:
  `discord.svg`, `github.svg`, `graphql.svg`, `graphql-wordmark.svg`,
  `stackoverflow.svg`, and `twitter.svg`. Each is explicitly recorded as
  `unsupported_extension`.
- **Other import coverage:** Immer has 110 occurrences: 64 resolved, 39
  external, one excluded, six unresolved. Five unresolved occurrences reference
  the absent built `dist/immer.mjs`; one references `immer10Perf`, which TypeScript
  could not resolve. GraphQL.js has 2,574 occurrences: 2,055 resolved, 463
  external, seven excluded, 49 unresolved. Its ledger retains the 48
  `module_not_found` occurrences and one computed dynamic import. Nothing is
  silently omitted or redirected to a guessed source.
- **Rename:** `scripts/parser-verify.ts` creates an isolated two-file fixture.
  Before renaming, there are zero unresolved imports. Renaming `leaf.ts` to
  `renamed.ts` produces exactly one unresolved import at `entry.ts:1`, with
  `module_not_found: TypeScript could not resolve "./leaf"`, and zero edges.
  The real project and cloned repositories are never renamed or edited.
- **Typed output:** self, Immer, and GraphQL.js JSON outputs all pass validated
  readback and full equality. Fixture checks reject corrupt schema versions,
  folders, inventory totals, duplicate edges, missing endpoints, wrong fan
  counts, and graph data without matching import provenance.

## Checks and observed failures

`pnpm parser:verify`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass. The
verification script also checks repeated import deduplication, all three import
kinds, type imports, comments/strings, aliases, nested configs, NodeNext
conditional imports, literal/nonliteral dynamic imports, assets, syntax errors,
builtins, dependency declarations, physical lines, deterministic results,
unchanged source, and adapter independence.

The first dependency installation failed because the sandbox's network tunnel
was unavailable. Installation with approved network access succeeded. The first
self-parse hit ts-morph's source cache when adding an already loaded file;
explicitly overwriting the in-memory snapshot resolved it without writing source
files. The initial build compiled but failed to start its TypeScript worker with
`spawn EPERM`; rerunning with process spawning enabled passed without changing
any build checks.

The first external clone, type-fest, failed parsing because its tsconfig extends
the uninstalled `@sindresorhus/tsconfig` package. That failure was retained rather
than hiding it or falling back to different resolver settings. Immer supplied
the successful barrel check, and GraphQL.js supplied the larger folder check.

## Remaining limits and browser acceptance

There is no browser acceptance check or rendering in Phase 03. Existing workspace
behavior is unchanged; this phase adds only terminal parsing and its contract.

Only UTF-8 TypeScript/JavaScript source is parsed. Symlinks are not followed,
and hidden/generated/dependency directories are deliberately excluded even if
they contain source. Unreadable directories and unavailable tsconfig extensions
abort parsing. Nonliteral dynamic imports remain unresolved. `require()` is out
of scope and creates no edges; TypeScript import-equals using `require` is
explicitly recorded as excluded. Framework classifications remain unknown
(`kind: null`). No later-phase features have been added.
