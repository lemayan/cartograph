# Phase 08 implementation

Framework adapters now annotate real parsed files, recover complete route
patterns, and store those routes with the dependency map. The explorer uses
framework role categories and a Routes table. No package was installed, and
no AI classification or import-edge inference was added.

## Detection and parser boundary

`lib/adapters/detect.ts` reads package manifests retained by repository selection
and checks declared dependencies, dev dependencies, and peer dependencies in
the confirmed order: Next.js, NestJS, React. The first framework match wins.
Roles and routes apply only within that framework's package roots; a nearer
unmatched package remains generic. Excluded dependency/generated manifests do
not participate. App/pages root precedence and Next configuration filenames
are resolved outside the parser.

`lib/adapters/parse-repository.ts` provides standalone detection and parsing.
Both `scripts/parser.ts` and `lib/pipeline/run.ts` use the adapters. The core
`lib/parser/parse.ts` supplies syntax trees of successfully parsed files through
the generic adapter interface, calls preparation once, and records classifications
and routes. It contains no framework-specific checks or web/database imports.
Import resolution, edge provenance, file hashes, coverage, and fan counts still
come from the same parser operations.

`lib/parser/types.ts` adds route records containing repository-relative file,
HTTP method, full pattern, and one-based source line. `lib/parser/contract.ts`
checks their file references, methods, complete patterns, line bounds, and
duplicates. Old version-1 results without routes remain readable. A missing
route field means extraction predates this phase; an empty array means the new
extraction recovered no complete routes.

## Framework behavior

- `lib/adapters/nextjs.ts` identifies pages, endpoints, layouts/templates, and
  real module/function server-action directives. App routes remove route groups
  and parallel-slot directories while retaining dynamic/catch-all segment
  syntax. Private and intercepted routes are omitted. Pages routes remove
  `index` and omit reserved framework pages. Static `basePath`, `pageExtensions`,
  and `trailingSlash` are respected. Page GET methods follow the known framework
  convention; App endpoint methods require explicit exports. Pages API methods
  require literal request-method comparisons or switch cases in a known handler.
  Automatic HEAD/OPTIONS are not invented. Source positions identify the actual
  default page export or explicit method declaration.
- `lib/adapters/nestjs.ts` identifies controller, service, module, entity, DTO,
  guard, interceptor, middleware, pipe, and filter suffixes. Imported and aliased
  Nest decorators supply literal controller/method paths, including arrays.
  A single recoverable Nest bootstrap supplies the literal global prefix.
  Unknown/conditional prefixes, prefix exclusions, versioning, router-module
  registration, opaque bootstrap configuration, and host-based decorators leave
  affected patterns absent. Local decorators with matching names are not Nest
  decorators; multiple HTTP decorators are not treated as multiple routes.
- `lib/adapters/react.ts` shares component, hook, context, utility, type, test,
  and configuration roles with Next.js. JSX/createElement and imported
  createContext syntax support component/context classification. Unmatched
  files retain a null kind, presented as Generic files. React has no route
  extractor, and repositories matching nothing use the generic fallback.

Literal syntax helpers live in `lib/adapters/syntax.ts`; package ownership lives
in `lib/adapters/scope.ts`. No fetched configuration is executed and no fetched
dependencies are installed. Unknown wrappers, mutable configuration, and
unsupported runtime configuration are omitted rather than evaluated.

## Explorer

`lib/adapters/taxonomy.ts` is a browser-safe list of concrete role names and fixed
reading order. Its only parser import is a type. Category counts partition all
parsed files, including generic files, and zero-count categories retain their
positions. Routable roles come first, then their implementation layers and
shared plumbing. The rail never imports filesystem code or the syntax parser.

`components/map-shell.tsx` replaces extension categories with these roles and
adds Map/Routes buttons in the central pane. Selecting a role preserves the
existing brightness filter. The map stays mounted while the route table is
shown, preserving its interaction state. `components/dependency-map.tsx` uses
the same role swatches for file rows; `components/map-details.tsx` reports the
framework and route count. Existing graph entry filtering recognizes the new
explicit action/controller/module roles in `lib/adapters/entry-files.ts`.

`components/routes-table.tsx` shows Method, Pattern, and Source. A source-path
button selects the real file in the detail column. View source opens GitHub at
the stored commit and line; the map server page supplies the normalized commit
URL. Empty extraction and pre-extraction saved results have distinct messages.
`components/map-shell.css` keeps the existing compact, themed three-column
layout, restrained role colors, keyboard focus, and explicit-click view changes.
The browser rendering and interaction acceptance remain user-owned.

## Applied storage migration

`supabase/migrations/20261009205115_phase_08_framework_routes.sql` is applied
to the linked Cartograph database, in an explicit transaction. It adds route
source lines and parser order, plus `analyses.routes_extracted` to distinguish
legacy results from an empty extraction. Database types were regenerated in
`lib/supabase/database.types.ts`.

The existing secret-only store RPC inserts routes after files and edges in the
same transaction. Every route must reference a stored file in that analysis
and organization, use a supported method and full pattern, and have a valid
source line. Any rejected route rejects the complete batch, including files,
edges, and completion. The invoker read RPC returns routes in original parser
order under existing row policies. It preserves the old JSON shape for old
analyses. Reruns clear routes and reset extraction alongside previous map data.
Existing writer isolation, run-ID protection, tenant RLS, and progress broadcasts
are preserved; no browser database reads or polling were introduced.

## Terminal verification

- `corepack pnpm typecheck`, `corepack pnpm lint`, and `corepack pnpm build`
  passed. The existing Turbopack dynamic parser filesystem-tracing warning
  remains; all 13 generated server traces exclude private artifacts, and none
  of the 23 browser chunks contain the parser or detection implementation.
- `corepack pnpm adapters:verify` passed. It covers detection precedence,
  nearest package ownership, fixed taxonomy totals/order, App/Pages routes,
  literal prefixes/configuration, Next actions, React contexts, Nest aliases,
  unknown configuration omission, source lines, and legacy JSON compatibility.
  It also verifies adapters leave import edges, coverage, hashes, and fan counts
  identical to a fallback parse of the same source.
- Standalone parser verification passed. Parsing Cartograph itself through the
  standalone CLI recovered Next.js, 84 files, 184 edges, and eight explicit
  routes. The output is ignored local verification data, not a checked-in fixture.
- Map and graph verification passed on a real Excalidraw parse: 706 files,
  3,618 edges, every file row reachable, and three cyclic groups.
- The full real Next.js fetch/parse/store/readback verification passed on
  `lemayan/msingi-learning-platform`: 149 files, 197 edges, 462 skips, about
  23.3 seconds in that isolated run. The adapter result survives storage unchanged.
- A real `nestjs/typescript-starter` run at commit
  `a122dea65cd0610ee205d7765ed46f9d73629141` recovered eight files, seven edges,
  one route, and ten skips in about 7.6 seconds. Full readback equality passed.
  Live checks remove their own temporary organizations and analysis data.
- `supabase/tests/phase_08.sql` passed against the applied database: exact ordered
  route readback, own-tenant visibility versus zero other-tenant rows, no browser
  route insertion, invalid-file/method/pattern/line whole-batch rollback, and
  deliberate rerun cleanup. Test fixtures roll back.
- Combined existing Phase 07/realtime and Phase 08 SQL checks passed in a
  rollback trial before application. Supabase public/private function lint
  passed with warnings treated as failures. Whitespace and private-artifact
  checks passed, including new untracked source files. The lockfile is unchanged;
  environment files and local verification artifacts remain ignored.

The first migration trial was blocked by the automatic approval usage limit;
after the user continued, retry succeeded. A subsequent rollback trial caught
a generated SQL syntax error before application; it was fixed and the trial
rerun successfully. No failed trial was applied partially.

## Browser acceptance and limits

Re-run an existing Next.js analysis to obtain new classifications and routes.
Confirm Page routes, API endpoints, and Server actions appear with correct
counts; use Routes to open three source links and compare both method and full
pattern at the analysed commit. Analyse a NestJS repository and confirm the
Controllers/Services/Modules rail and decorated methods with complete prefixes.
Analyse a repository matching no adapter and confirm generic roles and an empty
route table. Confirm role filtering, file selection from the route table, view
switching, themes, narrow layout, keyboard focus, and organization isolation.
Searching the parser core for `nextjs` returns no framework checks.

Routes are a conservative list of recoverable declarations, not a complete
runtime router simulation. Unknown configuration, wrapped handlers, dynamic
methods/prefixes, intercepted paths, host/version configuration, and unsupported
routing setups are omitted. Roles are deterministic conventions and parsed
syntax, not AI guesses. Existing stored analyses are not upgraded automatically.
The Phase 07 in-process execution and archive/parser limits still apply.
Browser acceptance has not been automated or claimed as passed.
