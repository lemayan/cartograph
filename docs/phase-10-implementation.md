# Phase 10 — Explain, cached and traced

The implementation follows `docs/specs/phase-10.md`. Browser acceptance remains
the user's check. No evaluation, scoring, chat agent or graph traversal by a model
was added.

## Implemented behavior

1. **One wrapped client.** `lib/ai/client.ts` is the only Cartograph runtime
   location that constructs the OpenAI SDK client. It uses Google's OpenAI-compatible
   endpoint and the approved `gemini-3.8-flash` stable release for explanations and
   roles. The two pins are separate constants. Model, task and content hash select
   the cache entry. Prompt/context version numbers are included in content hashes.
   This is a specific stable Gemini release, not a `latest` alias; Google does not
   provide a dated immutable snapshot for this release.

2. **Cache reads inside traces.** `cachedAI` starts an outer task trace, records
   `cache.read` within it, checks freshness, and only then calls the wrapped model
   when needed. Hits and stale responses report zero token usage and contain no
   model call. Trace delivery is awaited before a request ends. An unconfigured
   LangSmith setup does not prevent model calls. The pane displays the tracing
   configuration state; delivery failures are recorded in the server log.

3. **Exact file and folder context.** `lib/explanations/context.ts` selects the
   file or the same folded group used by the map. Every direct import and importer
   touching those members is passed to the model, with the involved file paths,
   hashes, kinds and line counts. Source for every selected member is supplied.
   `lib/explanations/service.ts` asks distinct file/folder questions. Models receive
   facts and source as data, no graph-walking or repository-browsing tools.

4. **Semantic roles outside the parser.** `lib/ai/roles.ts` labels only files
   whose adapter kind is null. Batches contain at most 20 files. Strict JSON schema
   and runtime validation require each supplied path exactly once and restrict
   roles to service, repository, model, util, config, component and hook. Missing,
   duplicate, absent and structural labels fail the call. `lib/pipeline/run.ts`
   labels before source cleanup. The writer commits parser results and separate
   `file_roles` rows in one transaction. Adapter kinds, edges and routes remain
   parser-owned. `lib/analyses/result.ts` overlays matching-hash labels for display;
   `lib/adapters/taxonomy.ts` includes them in the rail.

5. **Persistent, tenant-bound storage.** Migration
   `20261010100406_phase_10_explanations.sql` adds `ai_cache`, explanation target and
   run/hash metadata, and role model/hash metadata. The cache survives reruns;
   displayed explanations are bound to an analysis run and current context hash.
   All tables have forced RLS. Authenticated users can only read their organization's
   AI rows; only the server writer can save them. The new invoker RPCs reject stale
   run IDs, mismatched source hashes and attempts to label convention-owned files.
   Application cache reads use the existing Clerk-token client with no organization
   predicate. Background pipeline cache reads use the writer's captured organization.

6. **Explain endpoint and pane persistence.**
   `app/api/analyses/[analysisId]/explain/route.ts` validates identity, organization,
   origin, analysis state, run ID and selection before explaining. It saves a
   successful answer for its file/folder target. `lib/explanations/load.ts` restores
   saved matching answers on page load. `components/explanation-pane.tsx` retains
   answers and per-target request/error state when selection changes, including
   clearing selection. Late responses update their own target. Clicking Explain
   again keeps the existing prose visible while the server records a fresh traced
   cache read and checks GitHub; it does not call the model on a hit.

7. **Formatting and navigation.** `components/explanation-prose.tsx` renders only
   inline code, bold and bullets, including nested bold/code. Unsupported Markdown
   is reduced to prose and HTML is escaped. Known file and folded-folder paths
   become map-navigation buttons. `components/dependency-map.tsx` opens the owner
   folder, scrolls to the file row, waits for measured layout/handles and fits that
   folder into view. The event also clears a category filter and returns to Map.
   Pane styling uses the existing small type, neutral surfaces and meaningful accent.

8. **Staleness.** `lib/explanations/repository.ts` reads GitHub's current default-
   branch commit and bounded raw source. Each Explain request compares every member's
   SHA-256 content hash and the analysed commit. Changed/deleted files or a newer
   commit prevent a model call. A cached old answer may remain visible with a stale
   notice and Re-analyse action, using the existing rerun flow. Reload checks the
   current commit before restoring explanations. GitHub failures remain visible;
   an unknown freshness state is never treated as permission to generate an answer.

## Terminal checks

- `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm build` pass.
- `corepack pnpm ai:verify` passes: direct-neighbour/folder context, content and
  commit staleness, cache/model pin isolation, role provenance/allowlist, visible
  freshness failures, formatting, known-path boundaries and escaped HTML.
- Parser, CommonJS, adapter, pipeline, map and graph verification pass. Map input
  is the current Cartograph parser snapshot; graph input is the cycle-containing
  GraphQL snapshot required by that verifier.
- `supabase/tests/phase_10.sql` passes both in the migration rollback trial and
  against the applied schema. It checks atomic writes, structural-role rejection,
  unchanged adapter kinds, file/folder persistence, superseded-run rejection,
  authenticated write denial, cross-tenant invisibility and forced RLS.
- Supabase migration history confirms local/remote parity, database lint finds no
  schema errors, and database types were regenerated from the applied schema.
- `corepack pnpm ai:verify:live` passed. LangSmith readback recorded successful
  classification, file and folder model runs with 507, 577 and 664 tokens respectively;
  their cache hits and the stale-file response recorded zero tokens with `cache.read`
  children and no model children. Three cache rows, four role rows and two explanation
  targets were read back from the temporary organization. Cleanup confirmed zero
  remaining verification organizations. The migration's local/remote version matches.
  Live AI/cache/GitHub/trace evidence is produced by this command.
  It uses a parsed temporary fixture, real model and cache calls, independently
  retrieves real public GitHub source, reads traces back and deletes its temporary
  analysis/organization afterwards. Trace IDs are saved only in ignored local output.

## Browser acceptance to run

1. Analyse or deliberately re-analyse a public repository so unmatched files gain
   semantic roles. Open a file's Explanation tab and click Explain.
2. Check the paragraph describes the file in relation to its real neighbours;
   clicking a named path opens and focuses that file in the map.
3. Check inline code, bold and bullets render cleanly. Move away, clear selection,
   return and reload: the fetched answer should remain available without another click.
4. Click Explain again. The prose remains visible; LangSmith should show another
   task run with a cache read, zero tokens and no model child.
5. Explain a folded folder and check that the prose discusses its complete group
   and incoming connections, rather than explaining only one member.
6. Push a commit to the analysed repository, reload and explain the changed file.
   Expect a stale notice and Re-analyse action. No fresh prose is generated from
   the old map. Confirm rerunning replaces the map and labels the current sources.
7. Confirm an adapter-unmatched file has a non-structural role. Structural categories
   and route rows must still come only from adapters.

## Limits and failures

- Pre-Phase-10 analyses require a deliberate rerun to acquire AI roles.
- Gemini's free-tier availability/quotas apply. A live verification attempt returned
  HTTP 503 high demand; the same fixed model was retried, never replaced by a fallback.
  An AI failure is reported as a parsing-stage failure in the pipeline or an error in
  the explanation pane, retaining an already fetched answer.
- Source and complete AI input are bounded at 1 MiB. A selection/batch exceeding
  the bound fails explicitly without dropping members or neighbours. Saved list
  reads are bounded to 1,000 explanation targets and 20,000 AI role rows.
- Public GitHub checks use anonymous requests and can hit GitHub's rate limit.
  Repeated Explain checks still make freshness requests even when the model is cached.
- The stable Gemini release has no documented immutable dated serving snapshot.
- The existing Turbopack warning about dynamic filesystem access in the parser's
  configuration resolver remains. Restricted build/archive subprocesses failed with
  `spawn EPERM` and passed when rerun with process execution permission. Type generation
  initially failed through the sandbox proxy and passed with network access.
- No browser acceptance was automated. The independent, untracked `deep-agent/`
  project was left untouched.
