import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createDedupeFetch } from "next/dist/server/lib/dedupe-fetch";
import { fetchPublicRepository, validateArchivePaths } from "../lib/pipeline/archive";
import { publicRepository } from "../lib/pipeline/repository";
import { runRepositoryAnalysis } from "../lib/pipeline/run";
import { parseRepository, selectRepository, parseSelectedRepository } from "../lib/parser/parse";
import { validateParserResult } from "../lib/parser/contract";
import { parseFrameworkRepository } from "../lib/adapters/parse-repository";

const run = promisify(execFile);
const fixtureSha = "a".repeat(40);

function archivedFetch(archive: Uint8Array, sha = fixtureSha): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    assert.equal(init?.redirect, "manual");
    if (url.hostname === "codeload.github.com") return new Response(new Uint8Array(archive));
    if (url.pathname.includes("/commits/")) return Response.json({ sha });
    if (url.pathname.includes("/tarball/")) {
      assert.ok(url.pathname.endsWith(`/${sha}`), "The archive must be pinned to the resolved commit");
      return new Response("Redirecting to the public archive.", { status: 302, headers: { location: `https://codeload.github.com/fixture/repo/tar.gz/${sha}` } });
    }
    return Response.json({ private: false, default_branch: "main" });
  };
}

async function fixtureArchive(root: string, directory: string, invalidConfig = false): Promise<Uint8Array> {
  const source = path.join(root, directory);
  await mkdir(source);
  await writeFile(path.join(source, "entry.ts"), "import { value } from './leaf';\nexport { value } from './leaf';\nvoid import('./leaf');\n");
  await writeFile(path.join(source, "leaf.ts"), "export const value = 1;\n");
  await writeFile(path.join(source, "README.md"), "A verification fixture.\n");
  if (invalidConfig) await writeFile(path.join(source, "tsconfig.json"), '{"extends":"./absent-config.json"}');
  const filename = path.join(root, `${directory}.tar.gz`);
  await run("tar", ["-czf", filename, "-C", root, directory], { windowsHide: true });
  return new Uint8Array(await readFile(filename));
}

function sqlLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

async function databaseQuery(query: string): Promise<unknown> {
  const connection = new URL((await readFile(".cartograph/supabase-cli/supabase/.temp/pooler-url", "utf8")).trim());
  const password = process.env.PASSWORD;
  if (!password) throw new Error("Live verification needs the confirmed database PASSWORD in .env.local.");
  if (decodeURIComponent(connection.username) !== "postgres.lkhikzvvelvmsfdpyhdt") throw new Error("Unexpected verification database");
  const { stdout } = await run("C:/Program Files/PostgreSQL/18/bin/psql.exe", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet", "--tuples-only", "--no-align",
    "--host", connection.hostname, "--port", connection.port, "--username", decodeURIComponent(connection.username), "--dbname", "postgres", "--command", query], {
    env: { ...process.env, PGPASSWORD: password, PGSSLMODE: "require" }, maxBuffer: 24 * 1024 * 1024, windowsHide: true,
  });
  const output = stdout.trim();
  return output === "" ? null : JSON.parse(output);
}

async function readAsOrganization(analysisId: string, organizationId: string) {
  const claims = JSON.stringify({ role: "authenticated", o: { id: organizationId } });
  return databaseQuery(`begin; set local role authenticated; do $$ begin perform set_config('request.jwt.claims', ${sqlLiteral(claims)}, true); end; $$;
    select coalesce(public.read_repository_analysis(${sqlLiteral(analysisId)}::uuid), 'null'::jsonb); rollback;`);
}

async function liveVerification(archive: Uint8Array, invalidArchive: Uint8Array, repositoryUrl: string) {
  const organization = `org_cartograph_pipeline_${randomUUID().replaceAll("-", "")}`;
  let capturedArchive: Uint8Array | null = null;
  let capturedSha = "";
  const recordingFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.includes("/commits/") && response.ok) {
      const data: unknown = await response.clone().json();
      assert.ok(typeof data === "object" && data !== null && "sha" in data && typeof data.sha === "string");
      capturedSha = data.sha;
    }
    if (url.hostname === "codeload.github.com" && response.ok) capturedArchive = new Uint8Array(await response.clone().arrayBuffer());
    return response;
  };
  try {
    const started = performance.now();
    const outcome = await runRepositoryAnalysis(repositoryUrl, organization, recordingFetch);
    const elapsedSeconds = (performance.now() - started) / 1000;
    assert.equal(outcome.status, "complete", outcome.failure?.message);
    console.log(`PASS: repository reservation -> fetch -> select -> parse -> committed storage: ${elapsedSeconds.toFixed(1)} seconds.`);
    assert.ok(capturedArchive && capturedSha);
    const stored = validateParserResult(await readAsOrganization(outcome.analysisId, organization));
    const replay = await fetchPublicRepository(publicRepository(repositoryUrl), archivedFetch(capturedArchive, capturedSha));
    try { assert.deepEqual(stored, validateParserResult(await parseFrameworkRepository(replay.directory))); }
    finally { await replay.cleanup(); }
    const metadata = await databaseQuery(`select jsonb_build_object('commit', commit_sha, 'status', status, 'stage', stage,
      'finished', finished_at is not null, 'failure', failure_message) from public.analyses where id = ${sqlLiteral(outcome.analysisId)}::uuid;`);
    assert.deepEqual(metadata, { commit: capturedSha, status: "complete", stage: "storing", finished: true, failure: null });
    const repeated = await runRepositoryAnalysis(repositoryUrl, organization, async () => { throw new Error("A repeated submission must not fetch"); });
    assert.equal(repeated.created, false);
    assert.equal(repeated.analysisId, outcome.analysisId);
    assert.equal(await readAsOrganization(outcome.analysisId, `${organization}_other`), null);
    console.log(`PASS: live archive -> select -> parse -> atomic storage -> RLS readback: ${stored.repository}, adapter ${stored.adapter}, commit ${capturedSha}, ${stored.files.length} files, ${stored.edges.length} edges, ${stored.routes?.length ?? 0} routes, ${stored.coverage.filesSkipped} skips; full result unchanged.`);

    const concurrent = await Promise.all([1, 2, 3].map(() => runRepositoryAnalysis("https://github.com/cartograph/concurrency-fixture", organization, archivedFetch(archive))));
    assert.equal(new Set(concurrent.map((item) => item.analysisId)).size, 1);
    assert.equal(concurrent.filter((item) => item.created).length, 1);
    const missing = await runRepositoryAnalysis("https://github.com/cartograph/missing-fixture", organization, async () => new Response(null, { status: 404 }));
    assert.equal(missing.status, "failed");
    assert.equal(missing.failure?.stage, "fetching");
    const malformed = await runRepositoryAnalysis("https://github.com/cartograph/config-fixture", organization, archivedFetch(invalidArchive));
    assert.equal(malformed.status, "failed");
    assert.equal(malformed.failure?.stage, "parsing");
    const failures = await databaseQuery(`select jsonb_agg(jsonb_build_object('status', status, 'stage', failure_stage,
      'hasMessage', failure_message is not null, 'finished', finished_at is not null,
      'files', (select count(*) from public.files f where f.analysis_id = a.id)) order by failure_stage)
      from public.analyses a where id in (${sqlLiteral(missing.analysisId)}::uuid, ${sqlLiteral(malformed.analysisId)}::uuid);`);
    assert.deepEqual(failures, [
      { status: "failed", stage: "fetching", hasMessage: true, finished: true, files: 0 },
      { status: "failed", stage: "parsing", hasMessage: true, finished: true, files: 0 },
    ]);
    console.log("PASS: repeated and three concurrent submissions reuse one analysis; fetching/parsing failures persist their stage, message and finish time without partial files; another organization cannot read the result.");
  } finally {
    if (!organization.startsWith("org_cartograph_pipeline_") || !/^org_cartograph_pipeline_[a-f0-9]{32}$/.test(organization)) throw new Error("Unsafe verification organization cleanup");
    await databaseQuery(`delete from public.organizations where id = ${sqlLiteral(organization)};`);
    console.log("Live verification organization and its rows removed by cascade.");
  }
}

async function verify() {
  assert.deepEqual(publicRepository("https://github.com/GraphQL/GraphQL-JS.git/"), { owner: "graphql", name: "graphql-js", url: "https://github.com/graphql/graphql-js" });
  for (const url of ["http://github.com/a/b", "https://evil.example/a/b", "https://github.com/a/b/tree/main", "https://token@github.com/a/b", "https://github.com/a/b?token=value", "https://github.com/a/b#fragment", "https://github.com/a"]) assert.throws(() => publicRepository(url));
  validateArchivePaths("repo-sha/\nrepo-sha/src/\nrepo-sha/src/file.ts\n");
  for (const listing of ["", "/absolute/file.ts\n", "root/../escape.ts\n", "root/C:/file.ts\n", "root/back\\slash.ts\n", "first/a.ts\nsecond/b.ts\n", "root/a.ts\nroot/a.ts\n"]) assert.throws(() => validateArchivePaths(listing));
  assert.throws(() => validateArchivePaths(Array.from({ length: 25001 }, (_, i) => `root/${i}.ts`).join("\n")));
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-pipeline-check-"));
  try {
    const archive = await fixtureArchive(root, "fixture-root");
    const invalidArchive = await fixtureArchive(root, "invalid-root", true);
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    const nextFetch = fetchPublicRepository(publicRepository("https://github.com/fixture/repo"), createDedupeFetch(archivedFetch(archive)));
    let nextArchive: Awaited<typeof nextFetch> | null = null;
    // Exercise the installed wrapper, not just native fetch: its unread tee branch
    // previously left the application waiting forever at redirect cancellation.
    try {
      nextArchive = await Promise.race([nextFetch, new Promise<never>((_resolve, reject) => {
        redirectTimer = setTimeout(() => reject(new Error("Next fetch redirect cancellation did not finish within five seconds.")), 5_000);
      })]);
      console.log("PASS: archive redirect/download/cleanup completes through the installed Next fetch wrapper without waiting for a cached stream.");
    } finally {
      clearTimeout(redirectTimer);
      if (nextArchive) await nextArchive.cleanup();
    }
    const fetched = await fetchPublicRepository(publicRepository("https://github.com/fixture/repo"), archivedFetch(archive));
    try {
      assert.equal(fetched.commitSha, fixtureSha);
      const selected = await selectRepository(fetched.directory);
      const originalSelection = JSON.stringify(selected);
      const parsed = validateParserResult(await parseSelectedRepository(selected));
      assert.deepEqual(parsed, validateParserResult(await parseRepository(fetched.directory)));
      assert.equal(JSON.stringify(selected), originalSelection);
      assert.equal(parsed.files.length, 2);
      assert.equal(parsed.coverage.filesFound, 3);
      assert.equal(parsed.coverage.filesSkipped, 1);
      assert.deepEqual(parsed.edges, [{ source: "entry.ts", target: "leaf.ts", kinds: ["import", "re-export", "dynamic-import"] }]);
      assert.equal(parsed.coverage.imports.resolved, 3);
    } finally { await fetched.cleanup(); }
    await assert.rejects(fetchPublicRepository(publicRepository("https://github.com/fixture/repo"), archivedFetch(archive, "short-sha")), /full commit SHA/);
    await assert.rejects(fetchPublicRepository(publicRepository("https://github.com/fixture/repo"), async () => Response.json({ private: true, default_branch: "main" })), /public repository/);
    await assert.rejects(fetchPublicRepository(publicRepository("https://github.com/fixture/repo"), async () => new Response(null, { status: 302, headers: { location: "https://evil.example/archive" } })), /unsupported archive redirect/);
    await assert.rejects(fetchPublicRepository(publicRepository("https://github.com/fixture/repo"), archivedFetch(new Uint8Array([1, 2, 3]))), /header|gzip|compression/i);
    console.log("PASS: URL normalization/rejections, commit pinning, anonymous requests, bounded safe paths, archive extraction, three real import kinds, complete skips, unchanged selection and parser contract, corrupt archives/private repos/unsafe redirects.");
    const args = process.argv.slice(2);
    if (args.length === 0) return;
    if (args[0] !== "--live" || args.length > 2) throw new Error("Usage: pnpm pipeline:verify [--live [public-repository-url]]");
    await liveVerification(archive, invalidArchive, args[1] ?? "https://github.com/graphql/graphql-js");
  } finally {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    if (relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(root).startsWith("cartograph-pipeline-check-")) throw new Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
}

verify().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
