# Phase 11 implementation

Phase 11 adds deterministic path evaluation, a held-out role dataset and prompt
experiments in LangSmith. The implementation and terminal checks are ready;
complete role and prompt measurements still need a run after Gemini's quota resets.

## Implemented behavior

1. **Shared environment.** `scripts/load-environment.ts` uses the already
   installed `@next/env` loader, with Next's environment precedence and expansion.
   It resolves the root app from the compiled script location, rather than from
   the caller's working directory. `scripts/evals.ts` loads it before dynamically
   importing AI/LangSmith code. The independent `deep-agent/.env.local` is not used.

2. **Exact path membership.** `lib/evals/invented-paths.ts` extracts lexical path
   candidates and checks them against an exact, case-sensitive set: the supplied
   file paths plus the selected file/folder path. It returns a binary score,
   every token and each unexpected token's character offset and short excerpt.
   There is no model judge, filesystem lookup, suffix match or path resolution.
   A bare basename, relative spelling, backslash spelling or line suffix fails
   unless it was explicitly in the supplied set.

3. **Live evaluation.** `lib/explanations/service.ts` supplies that set to
   `lib/ai/client.ts`. Every returned explanation is checked, including cached
   and stale cached prose. With tracing configured, `path_grounded` feedback is
   attached to the exact explanation run. Feedback delivery errors are logged
   and do not erase a working explanation. Tracing-disabled calls still run the
   deterministic check. The traced function receives facts as actual arguments,
   so cache-hit roots retain their inputs. `source.prepare` records source and
   staleness checks inside the same trace, after `cache.read`.

4. **Recent traffic.** `evals/traffic.ts` reads at most fifty recent explanation
   roots from the configured project over seven days. New roots carry their
   facts; legacy model children can recover the exact original user message.
   Legacy cache-only roots without facts are reported as unscorable. They are
   never counted as passing. `evals/run.ts` prints the percentage and failures,
   saves local evidence and updates feedback previously written by this
   evaluator, rather than repeatedly appending its own scores.

5. **Real held-out roles.** `evals/datasets.ts` downloads a public repository
   using the existing bounded archive loader and parses it with the existing
   adapters. The default is React Hook Form. Only the exact intersection with
   `semanticRoles` is eligible; `utility`, `context`, tests, types and structural
   roles are excluded rather than relabelled. A round-robin sample of thirty
   files is frozen with source, SHA-256, public repository URL, commit and adapter.
   Insufficient ground truth fails loudly. Role labels live only in reference
   outputs, never in classifier input. `lib/ai/roles.ts` now exposes the same
   classifier operation to production and evals. Evaluation uses production's
   twenty-file batches, with later per-file examples replaying the cached batch.
   Thirty files therefore need two model calls. Results include overall and
   per-role percentages in a LangSmith experiment.

6. **Prompt versions.** The unchanged production prompt is now in
   `lib/explanations/prompt.ts`, named `phase10-v1`. The simpler
   `evals/baseline-prompt.ts` is eval-only. It is explicitly a newly authored
   baseline: there is no historical predecessor in git. The app never imports it.
   Up to four distinct recent contexts, including a file and a folded folder,
   are captured with complete member source. Stored source hashes, members and
   edges are validated; absent or changed source fails rather than being filled in.

7. **Comparison and scoring.** Both versions use the same content-addressed,
   frozen LangSmith dataset, pinned model and judge rubric. The runner checks
   an existing dataset against its snapshot, including outputs, independent of
   JSON key ordering. Separate experiments expose deterministic `path_grounded`
   and subjective `usefulness_model_judge` scores. The usefulness judge uses
   a documented five-point rubric, normalized to 0–1. The console reports which
   prompt the judge rates more useful and the difference in percentage points,
   and provides a dashboard comparison link. `evals/scoring.ts` rejects failed
   predictions, missing feedback, invalid scores or incomplete experiments.
   The runner reads the SDK's completed `results` array; its blocking iterator
   has already been consumed by `evaluate()`.

8. **Eval caching and request limits.** `evals/cache.ts` keeps content-addressed
   answers under ignored `.cartograph/eval-cache/`. Cache reads remain inside
   their traces, including judge cache hits. Misses are spaced fifteen seconds
   apart within a runner to fit the observed five-request-per-minute quota;
   hits remain immediate. Run the role and prompt commands one at a time.
   Four prompt contexts cost at most sixteen prediction/judge calls, plus two
   role calls, before provider failures or unrelated traffic.

## Commands

Run from the project root; no web server is needed for these commands. Live
commands use `LANGSMITH_API_KEY`, `LANGSMITH_TRACING=true` and
`LANGSMITH_PROJECT` from the root `.env.local`. Role/prompt generation also uses
the existing `GEMINI_API_KEY`. No package or credential changes were made.

```sh
corepack pnpm evals:verify
corepack pnpm evals:paths
corepack pnpm evals:dataset:roles
corepack pnpm evals:roles
corepack pnpm evals:dataset:explanations
corepack pnpm evals:prompts
corepack pnpm evals:verify:live
```

An optional public GitHub URL may follow `evals:dataset:roles`. Capture datasets
once, then rerun experiments against those snapshots. Recapturing changes the
dataset and therefore changes what the score measures. Snapshots, cache,
results and trace evidence remain under ignored `.cartograph/`.

## Terminal evidence

- `evals:verify` passes: injected paths, bare/dot filenames, route groups and
  punctuation, exact relative/case/slash rules, captured source validation,
  allowed and hidden roles, fresh/cache path checks, incomplete-result rejection
  and percentage aggregation.
- `evals:verify:live` passes against LangSmith. A recorded real explanation
  replayed through the cache path scores 1; the same prose with an injected
  `src/phase11-invented-file.ts` scores 0. Both feedback records were read back.
  Their roots retain facts, their source/cache children are recorded, and neither
  has an LLM child. This is a cache/feedback test, not a new model measurement.
- Recent path evaluation reports 83.33% over six recovered Phase 10 runs, with
  four older cache-only runs explicitly excluded. Four recovered explanations
  were application traffic and two were terminal verification fixtures. The
  single failure is the literal relative spelling `./b`, absent from the canonical
  supplied path set. This checks the exact-path contract; it does not prove that
  the underlying import was fictitious.
- The role snapshot contains thirty real files from React Hook Form commit
  `9899a278a41394dcda4960ca9c30ee8e8ca42c29`: five config files, thirteen
  components and twelve hooks. The other allowed roles have no support in this
  sample, so its percentage must not be presented as accuracy on those roles.
- Four complete application explanation contexts are frozen for comparison.
  All member source was checked against public GitHub source before execution.
- Typecheck, lint, production build, `ai:verify` and `git diff --check` pass.
  No browser acceptance was automated.

## Failures and remaining limits

- Restricted archive extraction, LangSmith git metadata lookup and the build's
  TypeScript worker failed with `spawn EPERM`. They were rerun with permitted
  process execution. TanStack Query's archive then failed on Windows symlinks;
  the default dataset repository was changed to React Hook Form, whose capture
  completed. No parser or archive safety checks were weakened.
- Automatic approval review initially rejected the prompt run over potentially
  sensitive source export. An audit proved each captured member was either an
  exact SHA-256 match to public GitHub code or an exact generated fixture from
  `scripts/ai-live-verify.ts`. Review then permitted the retry.
- Live experiments encountered HTTP 503 high demand, HTTP 429 minute limits
  and finally the Gemini daily free-tier limit of twenty requests. The provider
  reported roughly eleven hours until reset. The incomplete experiments do not
  establish role accuracy or a prompt winner. Batching, pacing and completed
  result handling were corrected afterward and verified offline; full live
  role and prompt scores still need the commands above after reset. No model pin
  was changed and no fabricated percentage substitutes for missing results.
- Path extraction is lexical. Slash-separated tokens, dotfiles and bare filenames
  with lower/upper-case suffixes or supplied suffixes are candidates; URLs and
  camel-case property suffixes are excluded. Code fragments are tokenized rather
  than treated as one filename. Filenames with spaces work in inline code. A
  dotted symbol that looks exactly like a bare filename remains lexically
  ambiguous; the excerpt makes that visible for hand inspection. The check does
  not measure whether every factual claim or explanation is correct.
- Usefulness is a model judgment, even when expressed as a number. It shares the
  configured model with generation and is not independent human validation.
  The sample is small and the baseline is newly authored, not historical.
- The existing Turbopack dynamic-filesystem warning in
  `lib/parser/resolution.ts` remains. The untracked `deep-agent/` project was
  left untouched.

## Acceptance to run

1. Use Explain on a fresh file and a folded folder, then run `evals:paths`.
   Confirm the score, run IDs and exact excerpts against the displayed paths.
   New cached explanations should also have `path_grounded` feedback in LangSmith.
2. Run `evals:verify` or `evals:verify:live`; the injected filename must fail.
3. After quota reset, run `evals:roles` against the captured thirty-file dataset.
   Expect an overall percentage, per-role results and a dashboard experiment link.
4. Run `evals:prompts` and open its comparison link. Both prompt versions should
   appear beside each other with scores over the same examples. The console
   should state the usefulness winner and difference, labelled as model judgment.
