import assert from "node:assert/strict";
import { inventedPaths } from "../lib/evals/invented-paths";
import { semanticRoles, classifyFiles } from "../lib/ai/roles";
import { cachedAI, explanationModel, type AICache } from "../lib/ai/client";
import { hash, record, validateExplanation } from "../evals/data";
import { explanationInstructions } from "../lib/explanations/prompt";
import { baselineInstructions } from "../evals/baseline-prompt";
import { experimentScores } from "../evals/scoring";

async function verify() {
  const paths = ["src/a.ts", "src/b.ts", "app/(team)/[id]/page.tsx", "src/core", "README.md", ".env.local", "src/my file.ts"];
  assert.equal(inventedPaths("Uses **`src/a.ts`** and (src/b.ts).\n- `app/(team)/[id]/page.tsx` calls `src/core`.", paths).score, 1);
  assert.equal(inventedPaths("See README.md, .env.local and `src/my file.ts`.", paths).score, 1);
  const injected = inventedPaths("Uses `src/a.ts`, then calls `src/invented-handler.ts`.", paths);
  assert.equal(injected.score, 0);
  assert.deepEqual(injected.invented.map((item) => item.path), ["src/invented-handler.ts"]);
  assert.ok(injected.invented[0].excerpt.includes("src/invented-handler.ts"));
  assert.equal(injected.invented[0].offset, 29);
  for (const filename of ["fake.xyz", "fake.ts", "./src/a.ts", "src/A.ts", "src\\a.ts", "src/unknown", "src/core/", "../src/a.ts", "missing.json", ".inventedrc"])
    assert.equal(inventedPaths(`Uses \`${filename}\`.`, paths).score, 0, filename);
  assert.equal(inventedPaths("Version 1.2.3. See https://example.com/readme.md. No filenames here.", paths).score, 1);
  assert.equal(inventedPaths("Reads `jwt.accessExpirationMinutes`.", paths).score, 1);
  assert.deepEqual(inventedPaths("Uses `import { b } from './b'`.", paths).invented.map((item) => item.path), ["./b"]);
  assert.equal(inventedPaths("Uses `src/a.ts:12`.", paths).score, 0, "Line suffixes are not exact paths");

  const source = "export const a = 1;\n";
  const facts = { selection: { type: "file", path: "src/a.ts" }, members: ["src/a.ts"],
    files: [{ path: "src/a.ts", hash: hash(source), kind: "util", lines: 1 }], imports: [], importers: [] };
  const example = { facts, source: [{ path: "src/a.ts", contents: source }], origin: "verification" };
  assert.equal(validateExplanation(example).paths.length, 1);
  assert.throws(() => validateExplanation({ ...example, paths: ["src/a.ts", "invented.ts"] }));
  assert.throws(() => validateExplanation({ ...example, source: [] }));
  assert.throws(() => validateExplanation({ ...example, source: [{ path: "src/a.ts", contents: "changed" }] }));
  assert.ok(["test", "type", "utility", "context", "page", "route", "controller", "entity"].every((role) => !semanticRoles.some((allowed) => allowed === role)));
  assert.notEqual(baselineInstructions("file"), explanationInstructions("file"));
  const passed = { run: {}, evaluationResults: { results: [{ key: "role_accuracy", score: 1 }] } };
  const failed = { run: {}, evaluationResults: { results: [{ key: "role_accuracy", score: 0 }] } };
  assert.equal(experimentScores([passed, failed], 2, ["role_accuracy"]).role_accuracy, 0.5);
  assert.throws(() => experimentScores([passed], 30, ["role_accuracy"]), /1\/30/);
  assert.throws(() => experimentScores([passed], 1, ["missing"]), /incomplete/);
  assert.throws(() => experimentScores([{ ...passed, run: { error: "provider quota" } }], 1, ["role_accuracy"]), /provider quota/);

  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "offline-verification-only";
  process.env.LANGSMITH_TRACING = "false";
  const values = new Map<string, string>();
  let reads = 0; let calls = 0;
  const cache: AICache = { read: async (task, model, key) => { reads++; return values.get(`${task}:${model}:${key}`) ?? null; },
    write: async (task, model, key, value) => { values.set(`${task}:${model}:${key}`, value); } };
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(input instanceof Request ? input.url : String(input)).hostname, "generativelanguage.googleapis.com");
    const request: unknown = JSON.parse(String(init?.body));
    assert.ok(record(request) && Array.isArray(request.messages));
    const user = request.messages[1]; assert.ok(record(user) && typeof user.content === "string");
    const payload: unknown = JSON.parse(user.content); assert.ok(record(payload));
    calls++;
    let content = "Uses `src/a.ts` and `made-up.ts`.";
    if (request.response_format) {
      assert.ok(Array.isArray(payload.facts));
      assert.deepEqual(payload.facts, [{ path: "src/a.ts", hash: hash(source) }], "Ground truth must never reach the model");
      assert.deepEqual(payload.source, [{ path: "src/a.ts", contents: source }]);
      content = '{"roles":[{"path":"src/a.ts","role":"util"}]}';
    }
    return Response.json({ id: "offline", object: "chat.completion", model: request.model, created: 1,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  };
  try {
    const options = { task: "explain.file", model: explanationModel, key: "offline", cache, input: facts,
      instructions: explanationInstructions("file"), suppliedPaths: ["src/a.ts"], validate: (content: string) => content };
    const first = await cachedAI(options);
    const hit = await cachedAI(options);
    assert.ok("pathCheck" in first && first.pathCheck.score === 0);
    assert.ok("pathCheck" in hit && hit.pathCheck.score === 0);
    assert.equal(hit.cacheHit, true); assert.equal(calls, 1); assert.equal(reads, 2);
    await classifyFiles([{ path: "src/a.ts", hash: hash(source) }], cache, async () => source);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
  console.log("PASS: injected and exact-path checks, route-group punctuation, bare and hidden filenames, exact-case/relative/slash rules, immutable captured contexts, role allowlist and hidden labels, and evaluation on fresh and cached explanations.");
}
verify().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
