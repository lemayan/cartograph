# Phase 09 implementation

CommonJS dependencies now produce real graph edges and contribute to the import
coverage denominator. Express repositories receive directory roles and an empty
route table. No dependency was installed and no later-phase feature was added.

## Parser and CommonJS declarations

`lib/parser/parse.ts` collects direct `require()` calls and TypeScript's
`import name = require("...")` form. Literal targets use the existing
`ImportResolver`; `lib/parser/resolution.ts` is unchanged. Relative files,
directory indexes, explicit extensions, configured aliases, Node builtins,
declared packages and excluded files retain the existing resolution rules.
NodeNext import/require conditions are obtained by the same resolver for each
syntax occurrence.

Nonliteral targets are recorded as unresolved with their source position and
reason, without an edge. Comments, strings, `require.resolve`, property calls
and locally shadowed loader functions do not create CommonJS edges. Scope checks
in `lib/parser/commonjs.ts` distinguish local bindings from TypeScript's
synthetic CommonJS symbols. A binding in another script cannot shadow Node's
per-file wrapper names.

`lib/parser/types.ts`, `graph.ts` and `contract.ts` add the `require` occurrence
kind and coverage bucket. Repeated calls remain separate ledger occurrences;
one ordered file pair remains one graph edge. A file using both import and
require retains both kinds on that edge, without inflating fan-in or fan-out.
The parser still imports no framework, UI or database implementation.

`lib/parser/commonjs.ts` collects explicit names from `exports.name`,
`module.exports.name`, literal string property access and literal object keys.
Object methods, getters and shorthand keys are included. Whole-module values
use the agreed `default` label. Names are unique and sorted, and appear in each
new parsed file's `commonjsExports` array. These are syntax declarations, not a
simulation of the final runtime export object. Computed keys, opaque spreads,
aliases, dynamically defined properties, empty names and control-character
names are omitted. The forms follow Node's
[CommonJS declarations](https://nodejs.org/api/modules.html#moduleexports).

Old schema-version-1 results remain readable without export metadata or the
new require bucket. Validation preserves their original shape; it rejects a
missing require denominator when require occurrences are present.

## Express adapter and explorer

`lib/adapters/detect.ts` detects declared Express dependencies after Next.js,
NestJS and React. Existing precedence is preserved. `lib/adapters/express.ts`
applies roles only inside matching package roots and respects the nearest
package manifest. A nearer unmatched package remains generic.

The adapter accepts route/routes/router/routers, controller/controllers,
service/services, model/models, middleware/middlewares, utility variants,
test/tests and config/configs. Shared test/config filename conventions apply;
tests take precedence, and the closest role folder otherwise wins. Unmatched
files remain generic. No path, HTTP method or middleware chain is evaluated;
Express routes are always an empty array.

`lib/adapters/taxonomy.ts` supplies the Express label and fixed rail order:
Routers, Controllers, Services, Models, Middleware, Utilities, Tests,
Configuration and Generic files. The existing role filter handles these roles.
`components/map-shell.css` gives models the existing implementation-role swatch.

`components/coverage-banner.tsx` shows resolved occurrences against the real
found denominator, explicitly including require calls. Its existing percentage
still measures discovered files parsed, not import resolution. The information
panel in `components/map-details.tsx` includes require occurrences; selected
files show explicit CommonJS export names. `components/map-details.css` allows
long names to wrap within the existing compact detail column.

## Applied storage migration

`supabase/migrations/20261010085833_phase_09_commonjs.sql` is applied to the
linked Cartograph database and recorded in migration history. It accepts all
four edge kinds and adds nullable `files.commonjs_exports`. Null means old
metadata was never extracted; an empty array means extraction found no names.
`lib/supabase/database.types.ts` was regenerated from the applied schema.

The existing atomic store RPC validates export arrays and names before inserting
files, then stores exports alongside files, edges and routes. Invalid export
metadata or an invalid edge kind rolls back the complete batch. The read RPC
preserves name order and omits the optional field for legacy rows. Function
permissions, invoker behavior, tenant policies, progress broadcasts and rerun
cleanup remain in force. No client database reads or polling were added.

## Terminal verification

- Typecheck, lint and production build passed. The existing Turbopack dynamic
  filesystem-tracing warning remains. Fifteen server trace manifests exclude
  private environment/workspace artifacts; twenty browser chunks contain no
  parser implementation.
- `pnpm parser:verify`, `pnpm parser:verify:commonjs` and
  `pnpm adapters:verify` passed. They cover the existing resolver behavior,
  mixed syntax, deduplication, coverage reasons and positions, NodeNext
  conditions, local/cross-file shadowing, explicit export forms, old JSON,
  Express singular/plural roles, package ownership, detection precedence and
  empty routes. These are plain terminal scripts, with no new test runner.
- A frozen `git archive` of phase-08 commit `2c9f18a` was parsed by both the old
  and final parser. All 184 edges are byte-identical, with edge-list SHA-256
  `2c76b3a1a1368a372c45be19091d4f883d45cbb83be1024be60362ef3c5c5db7`.
  Its existing occurrence ledger is unchanged. A second real ESM/Express
  repository, `gothinkster/node-express-realworld-example-app` at
  `30b68e1e881462b2f4164ea09ab4c4f5699c7b0b`, retains its 49 byte-identical edges
  and existing import ledger.
- `sahat/hackathon-starter` at
  `574a99344855a2f18dac7181636e400bd55ab578` has 56 parsed files and 104 skips.
  Its graph changes from zero edges to 37. The old parser counted five ESM
  occurrences; the new parser counts 242 total: 62 resolved, 179 external and
  one unresolved dynamic import. Of these, 237 are require calls, with 62
  resolved and 175 external. No literal require is unresolved. Routes remain
  empty. Roles include seven controllers, two models, seven configuration
  files, 36 tests and four generic files.
- Map verification passed on that Express result: every file is reachable,
  fan counts and endpoint provenance are preserved, and all 37 edges survive
  folding/expansion. Graph verification passed on the existing Excalidraw
  snapshot, including three real cyclic groups.
- Existing pipeline verification and the live Express fetch/parse/store/RLS
  readback check passed. The real run finished in 11.1 seconds and its full
  result survived storage unchanged. Repeat/concurrent submissions, failure
  persistence and cross-tenant isolation passed. Its temporary organization
  and analysis rows were removed by cascade.
- Combined phase-08/09 SQL checks passed in a rollback trial before application.
  `supabase/tests/phase_09.sql` passed again after application: ordered export
  readback, four mixed edge kinds, invalid-batch rollback, empty Express routes,
  legacy shape, tenant isolation, browser write restrictions and rerun cleanup.
  Public/private schema lint passed with warnings treated as failures.
  Local/remote migration histories agree. Whitespace checks passed; local
  archives, snapshots and helper scripts remain ignored under `.cartograph/`.

The first export check caught synthetic symbols being mistaken for bindings;
a later isolation check caught cross-file script bindings. Both were fixed
and their regression checks pass. The first SQL trial lacked an update grant
on its temporary test table; the fixture grant was corrected and the complete
trial rerun successfully. Build/pipeline subprocesses and type-generation
network access initially failed under the sandbox; permitted execution passed.
One optional comparison repository returned 404, so the real checks use the
available public repositories named above. The first graph-check input had no
cycle; the existing cycle-bearing Excalidraw snapshot passed the unchanged check.

## Browser acceptance and limits

Re-run a previously saved Express analysis, or analyse
`https://github.com/sahat/hackathon-starter`. At the pinned commit above, expect
56 files and 37 real edges, the Express role rail, and no recovered routes.
Open coverage to confirm 242 import occurrences and 237 require occurrences;
external packages are counted but remain outside the repository graph. Select
a controller/model with explicit assignments to see its CommonJS export names.
Confirm role filtering and the empty Routes view behave normally.

Re-run an unchanged previously analysed ESM repository and compare its edge
list. The frozen baseline comparison above already verifies this from the
terminal. A repository that also contains previously invisible require calls
can correctly gain edges; preservation applies to the existing import syntax
and resolution behavior.

Existing analyses are upgraded only by a deliberate rerun. Express detection
still requires a declared dependency and follows the accepted framework
precedence. Roles depend on the named conventions. Dynamic loading and runtime
export composition are not evaluated; no other module loader or Express route
extractor was added. The phase-07 repository limits still apply. Browser
acceptance remains user-owned and has not been automated or claimed as passed.
