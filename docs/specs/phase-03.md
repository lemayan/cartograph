# Phase 3 — The parser

**Goal.** Turn a repository on disk into a list of files and the real
connections between them, and be able to prove it's right.

## Build

- Walking a repository: deciding which files become nodes, counting lines,
  hashing contents, and working out what a module is.
- Reading each file's imports with a real TypeScript parser, and turning three
  kinds of thing into edges: a plain import, a re-export, and a dynamic import
  with a literal string.
- Fan-in and fan-out, computed from the edge list after duplicates are removed.
- **Coverage.** For every import seen: did it resolve to a file inside the
  repository, point outside it, get deliberately excluded, or fail — and when
  it failed, why. Keep examples of the failures, not just a count.
- The adapter interface, plus the fallback that assumes no framework at all.
- A command that runs the parser against a directory, prints what it found, and
  can write the whole result out as a typed data file. Everything built after
  this reads that output, so the shape it writes is a contract.

## Constraints

- This code imports no web framework, no UI library and no database client. It
  takes a directory path, returns data, and runs from a plain script with
  nothing else started.
- **It runs against any directory on disk**, including this project. The parser
  itself fetches nothing — no network calls, no URLs, no cloning inside it. It
  takes a path. How a repository got onto disk is not its problem, so clone
  whatever you need to test against.
- No framework-specific check anywhere in it. The only framework knowledge in
  this phase is the fallback that has none.
- **File selection is structural.** Seed from entry points and walk outward, or
  keep whole directories. Never take the largest N files by line count — that
  keeps a file and drops the leaf it imports, which produces edges pointing at
  nodes that do not exist. It never shows on a small demo repository.
- An import that can't be resolved is reported as unresolved with a reason. It
  is never quietly dropped and never guessed at.

## Acceptance check

**Run these and report the numbers.** All terminal, all yours.

1. Run it against this project. Files found, files parsed, files skipped, and a
   reason for every skip. The three numbers add up and nothing is skipped
   without saying why.
2. Every file in the output carries the folder it belongs to, and the number of
   distinct folders is in the dozens for a few-hundred-file repository rather
   than a handful. Everything built on this groups by that value, so a missing
   or too-coarse one poisons everything downstream.
3. Clone a repository that uses barrel files and parse it. Report re-exports
   found against re-exports resolved. Those two numbers match, or every gap has
   a named reason.
4. Rename a file an import points at and re-run. Exactly one unresolved import,
   and the output names why.
5. Write the output to a file and read it back. Types hold.

## Not in this phase

Framework adapters beyond the fallback. `require()`. And nothing renders yet:
this phase ends in a terminal, which is the point.
