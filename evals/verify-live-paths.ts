import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "langsmith";
import { cachedAI, explanationModel } from "../lib/ai/client";
import { inventedPaths } from "../lib/evals/invented-paths";
import { explanationInstructions } from "../lib/explanations/prompt";
import { text } from "./data";
import { readExplanations, save } from "./datasets";
import { recentExplanations } from "./traffic";

/** Exercise real feedback delivery on cache hits using recorded public explanations.
 * No new model request, database write, or browser action is needed.
 */
export async function verifyLivePaths(client: Client) {
  const examples = await readExplanations();
  const { project, runs } = await recentExplanations(client);
  const example = examples.find((example) => {
    const run = runs.find((run) => run.id === example.origin);
    return run && inventedPaths(text(run.outputs?.value), example.paths).score === 1;
  });
  assert.ok(example, "A recorded explanation with supplied facts and passing paths is required.");
  const original = text(runs.find((run) => run.id === example.origin)?.outputs?.value);
  const names = [];
  for (const injected of [false, true]) {
    const name = `eval.verify.${injected ? "injected" : "cached"}.${randomUUID()}`;
    names.push(name);
    const answer: Awaited<ReturnType<typeof cachedAI<string>>> = await cachedAI<string>({ task: name, model: explanationModel, key: example.origin,
      input: example.facts, instructions: explanationInstructions(example.facts.selection.type), suppliedPaths: example.paths,
      cache: { read: async () => original + (injected ? "\nCalls `src/phase11-invented-file.ts`." : ""),
        write: async () => { throw new Error("Live cache verification must not invoke a model."); } },
      prepare: async () => ({ stale: false, reason: null, source: example.source }), validate: text });
    assert.ok(answer.cacheHit && "pathCheck" in answer);
    assert.equal(answer.pathCheck.score, injected ? 0 : 1);
  }
  // Feedback ingestion is asynchronous; these bounded reads do not repeat any AI call.
  const evidence: { id: string; name: string; score: number }[] = [];
  for (const [index, name] of names.entries()) {
    let recorded = false;
    for (let attempt = 0; attempt < 4 && !recorded; attempt++) {
      for await (const run of client.runs.query({ project_ids: [project.id], filter: `eq(name,${JSON.stringify(name)})`,
        selects: ["ID", "NAME", "INPUTS", "OUTPUTS", "TRACE_ID"] })) {
        if (!run.id) continue;
        assert.ok(run.inputs?.facts, "Cache-hit trace must retain exact supplied facts");
        const feedback = [];
        for await (const item of client.listFeedback({ runIds: [run.id], feedbackKeys: ["path_grounded"] })) { feedback.push(item); if (feedback.length >= 2) break; }
        if (!feedback.length) continue;
        assert.equal(feedback[0].score, index === 0 ? 1 : 0);
        let children = 0; let read = false; let source = false;
        for await (const child of client.runs.query({ project_ids: [project.id], trace_id: run.trace_id || run.id,
          selects: ["ID", "NAME", "RUN_TYPE", "OUTPUTS"] })) {
          assert.notEqual(child.run_type?.toLowerCase(), "llm", "Cache-hit verification must contain no model child");
          if (child.name === "cache.read") read = true;
          if (child.name === "source.prepare" && child.outputs?.source) source = true;
          if (++children >= 10) break;
        }
        assert.ok(read && source, "Cache and source preparation must both be recorded");
        evidence.push({ id: run.id, name, score: index === 0 ? 1 : 0 });
        recorded = true;
        break;
      }
      if (!recorded) await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    assert.ok(recorded, "Live feedback must be readable from LangSmith");
  }
  await save(".cartograph/eval-data/live-path-evidence.json", evidence);
  console.log("PASS: live cache-hit feedback (1), injected invented filename feedback (0), recorded facts and source, cache reads, and no model children.");
}
