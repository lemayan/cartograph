import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { Client } from "langsmith";
import { analysisWriter } from "../lib/pipeline/writer";
import { parseFrameworkRepository } from "../lib/adapters/parse-repository";
import { classifyUnmatched } from "../lib/ai/roles";
import { explanationModel, tracingConfigured } from "../lib/ai/client";
import { explainSelection, explanationKey } from "../lib/explanations/service";
import { explanationContext } from "../lib/explanations/context";
import { repositoryHead, repositorySource } from "../lib/explanations/repository";
import type { MapSelection } from "../lib/map/scene";

const exec = promisify(execFile);
function literal(value: string) { return `'${value.replaceAll("'", "''")}'`; }
async function query(sql: string): Promise<unknown> {
  const connection = new URL((await readFile(".cartograph/supabase-cli/supabase/.temp/pooler-url", "utf8")).trim());
  if (decodeURIComponent(connection.username) !== "postgres.lkhikzvvelvmsfdpyhdt" || !process.env.PASSWORD) throw new Error("Confirmed Cartograph database connection/password required.");
  const { stdout } = await exec("C:/Program Files/PostgreSQL/18/bin/psql.exe", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet", "--tuples-only", "--no-align",
    "--host", connection.hostname, "--port", connection.port, "--username", decodeURIComponent(connection.username), "--dbname", "postgres", "--command", sql],
  { env: { ...process.env, PGPASSWORD: process.env.PASSWORD, PGSSLMODE: "require" }, windowsHide: true, maxBuffer: 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout.trim()) : null;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function verify() {
  assert.ok(tracingConfigured(), "Live verification requires working LangSmith tracing.");
  const started = new Date().toISOString();
  const organization = `org_phase10_live_${randomUUID().replaceAll("-", "")}`;
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-ai-live-"));
  const sources = new Map([
    ["src/core/a.ts", "import { b } from './b'; export const a = b;\n"], ["src/core/b.ts", "export const b = 1;\n"],
    ["src/ui/view.ts", "import { a } from '../core/a'; export const view = a;\n"], ["src/ui/state.ts", "export const state = 1;\n"],
  ]);
  try {
    for (const [file, content] of sources) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), content); }
    const result = await parseFrameworkRepository(root);
    const writer = analysisWriter(organization);
    const reservation = await writer.begin("https://github.com/cartograph/phase10-live-verification");
    const commit = "a".repeat(40);
    await writer.advance(reservation.analysisId, reservation.runId, "selecting", "Selecting fixture", commit);
    await writer.advance(reservation.analysisId, reservation.runId, "parsing", "Parsing fixture");
    const roles = await classifyUnmatched(result, root, writer.cache);
    assert.equal(roles.length, result.files.length);
    assert.deepEqual(await classifyUnmatched(result, root, writer.cache), roles);
    console.log("PASS: live Gemini structured roles and persistent classification cache hit.");
    await writer.advance(reservation.analysisId, reservation.runId, "storing", "Storing fixture");
    await writer.store(reservation.analysisId, reservation.runId, result, roles);
    const labelled = { ...result, files: result.files.map((file) => ({ ...file, kind: roles.find((role) => role.path === file.path)?.role ?? file.kind })) };
    let head = commit;
    const repository = { head: async () => head, source: async (_url: string, _commit: string, file: string) => {
      const contents = sources.get(file); assert.ok(contents);
      return { contents, hash: createHash("sha256").update(contents).digest("hex") };
    } };
    for (const selection of [{ type: "file", path: "src/core/a.ts" }, { type: "folder", path: "src/core" }] satisfies MapSelection[]) {
      const fresh = await explainSelection(labelled, selection, "https://github.com/cartograph/fixture", commit, writer.cache, repository);
      assert.ok(fresh.content && !fresh.cacheHit && !fresh.stale);
      const context = explanationContext(labelled, selection);
      await writer.saveExplanation(reservation.analysisId, reservation.runId, selection.type, selection.path, explanationModel,
        explanationKey(labelled, selection), Object.fromEntries(context.files.filter((file) => context.members.includes(file.path)).map((file) => [file.path, file.hash])), fresh.content);
      const cached = await explainSelection(labelled, selection, "https://github.com/cartograph/fixture", commit, writer.cache, repository);
      assert.equal(cached.cacheHit, true); assert.equal(cached.content, fresh.content);
      console.log(`PASS: live ${selection.type} explanation, saved target and persistent cache hit.`);
    }
    head = "b".repeat(40);
    const stale = await explainSelection(labelled, { type: "file", path: "src/core/a.ts" }, "https://github.com/cartograph/fixture", commit, writer.cache, repository);
    assert.ok(stale.stale && stale.cacheHit && stale.content);
    assert.deepEqual(await query(`select jsonb_build_object('roles',(select count(*) from public.file_roles where organization_id=${literal(organization)}),
      'explanations',(select count(*) from public.explanations where organization_id=${literal(organization)}),
      'cache',(select count(*) from public.ai_cache where organization_id=${literal(organization)}));`), { roles: 4, explanations: 2, cache: 3 });
    // A real GitHub request separately verifies production source retrieval and the SHA-256 calculation.
    const actualHead = await repositoryHead("https://github.com/expressjs/express");
    const actualSource = await repositorySource("https://github.com/expressjs/express", actualHead, "index.js");
    assert.ok(actualSource && actualSource.contents.includes("module.exports"));
    assert.equal(actualSource.hash, createHash("sha256").update(actualSource.contents).digest("hex"));
    console.log("PASS: current public GitHub commit and source hash retrieval.");
    const traces = new Client();
    const project = await traces.readProject({ projectName: process.env.LANGSMITH_PROJECT || "default" });
    // Ingestion is asynchronous. Readback is retried without repeating any model call.
    let stored: { id: string; name: string; tokens: number; hit: boolean; trace: string }[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const found: typeof stored = [];
      for await (const run of traces.runs.query({ project_ids: [project.id], min_start_time: started,
        filter: 'and(eq(is_root,true),or(eq(name,"classify.files"),eq(name,"explain.file"),eq(name,"explain.folder")))',
        selects: ["ID", "NAME", "END_TIME", "OUTPUTS", "TOTAL_TOKENS", "TRACE_ID"] })) {
        if (run.id && run.name && run.end_time && record(run.outputs) && typeof run.outputs.cacheHit === "boolean") {
          found.push({ id: run.id, name: run.name, tokens: run.total_tokens ?? 0, hit: run.outputs.cacheHit, trace: run.trace_id ?? run.id });
        }
        if (found.length >= 20) break;
      }
      stored = found;
      if (stored.length >= 7) break;
    }
    assert.equal(stored.length, 7, "All seven implemented AI/cache/stale runs must be recorded");
    assert.equal(stored.filter((run) => !run.hit && run.tokens > 0).length, 3);
    assert.equal(stored.filter((run) => run.hit && run.tokens === 0).length, 4);
    for (const hit of stored.filter((run) => run.hit)) {
      const children = [];
      for await (const run of traces.runs.query({ project_ids: [project.id], trace_id: hit.trace,
        selects: ["ID", "NAME", "RUN_TYPE"] })) { children.push(run); if (children.length >= 10) break; }
      assert.ok(children.some((run) => run.name === "cache.read"));
      assert.equal(children.some((run) => run.run_type === "LLM"), false);
    }
    await writeFile(".cartograph/phase10-live-traces.json", JSON.stringify({ projectId: project.id, runs: stored }, null, 2));
    console.log("PASS: LangSmith readback: three model runs with tokens; four cache/stale runs with zero tokens, recorded cache reads and no model children.");
  } finally {
    await query(`delete from public.organizations where id=${literal(organization)};`);
    const resolved = path.resolve(root);
    if (!resolved.startsWith(`${path.resolve(tmpdir())}${path.sep}`) || !path.basename(root).startsWith("cartograph-ai-live-")) throw new Error("Unsafe live verification cleanup");
    await rm(root, { recursive: true, force: true });
  }
}
verify().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
