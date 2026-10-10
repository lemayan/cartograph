import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { parseFrameworkRepository } from "../lib/adapters/parse-repository";
import { classifyUnmatched, validateRoles } from "../lib/ai/roles";
import { cachedAI, explanationModel, type AICache } from "../lib/ai/client";
import { explanationContext } from "../lib/explanations/context";
import { explainSelection } from "../lib/explanations/service";
import { foldFolders } from "../lib/map/folding";

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function verify() {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-ai-verify-"));
  const originalFetch = globalThis.fetch;
  const sources = new Map([
    ["src/core/a.ts", "import { b } from './b'; export const a = b;\n"], ["src/core/b.ts", "export const b = 1;\n"],
    ["src/ui/view.ts", "import { a } from '../core/a'; export const view = a;\n"], ["src/ui/state.ts", "export const state = 1;\n"],
  ]);
  let modelCalls = 0;
  const payloads: Record<string, unknown>[] = [];
  process.env.GEMINI_API_KEY = "offline-verification-only";
  process.env.LANGSMITH_TRACING = "false";
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://generativelanguage.googleapis.com", "Offline verification must never call another network endpoint");
    assert.ok(url.pathname.endsWith("/chat/completions"));
    const body: unknown = JSON.parse(String(init?.body));
    assert.ok(record(body) && Array.isArray(body.messages));
    const user = body.messages[1];
    assert.ok(record(user) && typeof user.content === "string");
    const value: unknown = JSON.parse(user.content);
    assert.ok(record(value));
    payloads.push(value);
    modelCalls++;
    const facts = value.facts;
    const roles = Array.isArray(facts) ? facts.map((file: unknown) => {
      assert.ok(record(file) && typeof file.path === "string"); return { path: file.path, role: "util" };
    }) : [];
    const content = body.response_format ? JSON.stringify({ roles }) : "Uses **`src/core/b.ts`** through the supplied import.\n\n- `src/ui/view.ts` imports this file.";
    return Response.json({ id: "chatcmpl-offline-verification", object: "chat.completion", model: body.model,
      created: 1, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
  };
  try {
    for (const [file, content] of sources) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), content); }
    const result = await parseFrameworkRepository(root);
    const values = new Map<string, string>();
    let reads = 0;
    const cache: AICache = { read: async (task, model, key) => { reads++; return values.get(`${task}:${model}:${key}`) ?? null; },
      write: async (task, model, key, content) => { values.set(`${task}:${model}:${key}`, content); } };
    const sha = "a".repeat(40);
    let currentHead = sha;
    let changed = false;
    const repository = { head: async () => currentHead, source: async (_url: string, _commit: string, file: string) => {
      const contents = sources.get(file);
      assert.ok(contents);
      return { contents, hash: createHash("sha256").update(changed ? `${contents}//changed` : contents).digest("hex") };
    } };
    const selection = { type: "file", path: "src/core/a.ts" } as const;
    const facts = explanationContext(result, selection);
    assert.deepEqual(facts.imports.map((edge) => edge.target), ["src/core/b.ts"]);
    assert.deepEqual(facts.importers.map((edge) => edge.source), ["src/ui/view.ts"]);
    await explainSelection(result, selection, "https://github.com/cartograph/fixture", sha, cache, repository);
    const again = await explainSelection(result, selection, "https://github.com/cartograph/fixture", sha, cache, repository);
    assert.equal(modelCalls, 1); assert.equal(again.cacheHit, true); assert.equal(reads, 2);
    assert.deepEqual(payloads[0].facts, facts);
    changed = true;
    const stale = await explainSelection(result, selection, "https://github.com/cartograph/fixture", sha, cache, repository);
    assert.equal(stale.stale, true); assert.ok(stale.reason?.includes("changed")); assert.equal(modelCalls, 1);
    changed = false; currentHead = "b".repeat(40);
    assert.equal((await explainSelection(result, selection, "https://github.com/cartograph/fixture", sha, cache, repository)).stale, true);
    assert.equal(modelCalls, 1); currentHead = sha;
    const folder = foldFolders(result.files, result.edges).folders.find((folder) => folder.path === "src/core");
    assert.ok(folder);
    await explainSelection(result, { type: "folder", path: folder.path }, "https://github.com/cartograph/fixture", sha, cache, repository);
    const folderPayload = payloads.at(-1)?.facts;
    assert.ok(record(folderPayload)); assert.deepEqual(folderPayload.members, folder.files.map((file) => file.path));
    const beforeRoles = modelCalls;
    const labelled = { ...result, files: result.files.map((file) => file.path === "src/ui/view.ts" ? { ...file, kind: "component" } : file) };
    const roles = await classifyUnmatched(labelled, root, cache);
    assert.equal(roles.length, 3); assert.ok(roles.every((role) => role.path !== "src/ui/view.ts"));
    await classifyUnmatched(labelled, root, cache); assert.equal(modelCalls, beforeRoles + 1);
    assert.throws(() => validateRoles('{"roles":[{"path":"src/core/a.ts","role":"page"}]}', result.files));
    assert.throws(() => validateRoles('{"roles":[{"path":"absent.ts","role":"util"}]}', result.files));
    const beforeRepin = modelCalls;
    await cachedAI({ task: "explain.file", model: "verification-other-pin", key: "a".repeat(64), cache,
      input: {}, instructions: "Verification", validate: (content) => content });
    await cachedAI({ task: "explain.file", model: "verification-other-pin", key: "a".repeat(64), cache,
      input: {}, instructions: "Verification", validate: (content) => content });
    await cachedAI({ task: "explain.file", model: explanationModel, key: "a".repeat(64), cache,
      input: {}, instructions: "Verification", validate: (content) => content });
    assert.equal(modelCalls, beforeRepin + 2);
    await assert.rejects(explainSelection(result, selection, "https://github.com/cartograph/fixture", sha, cache,
      { ...repository, head: async () => { throw new Error("GitHub unavailable"); } }), /GitHub unavailable/);
    console.log("PASS: exact direct neighbours and folded membership, persistent-cache contract, source/commit staleness without model calls, role provenance and allowlist, model pin isolation, and freshness failures.");
  } finally {
    globalThis.fetch = originalFetch;
    const parent = path.resolve(tmpdir()); const resolved = path.resolve(root);
    if (!resolved.startsWith(`${parent}${path.sep}`) || !path.basename(root).startsWith("cartograph-ai-verify-")) throw new Error("Unsafe verification cleanup path");
    await rm(root, { recursive: true, force: true });
  }
}
verify().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
