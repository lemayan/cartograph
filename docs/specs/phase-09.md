# Phase 9 — CommonJS and Express

**Goal.** Codebases that use `require()` stop drawing empty graphs.

## Build

- Collecting `require()` calls with a literal string argument, resolving them
  the same way imports are resolved, and reading the names a CommonJS module
  exports.
- An Express adapter — roles from directory convention, accepting both singular
  and plural folder names, because real repositories use both.

## Constraints

- This touches the parser core, which nothing else in the build does. Resolution
  behaviour for existing imports must not change: re-run the parser against a
  repository parsed before this change and get an identical edge list.
- A file that mixes `require()` and `import` reports both, without duplicates.
- Express routes are **not** extracted. They're assembled at runtime from
  routers, variables and middleware chains, and the route rule says exact or
  absent. An Express repository gets roles and an empty route table.

## Acceptance check

1. Analyse an Express repository that previously drew nothing. It now draws a
   real graph with a believable number of edges.
2. That same repository previously reported **100% coverage** — because it
   resolved 100% of the zero imports it knew how to look for. Confirm coverage
   now reports a real denominator.
3. Re-run the parser against a repository analysed before this change. The
   edge list is byte-identical.

## Not in this phase

Express route extraction. Any other module system.
