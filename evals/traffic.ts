import { Client } from "langsmith";
import { record, text } from "./data";

export async function recentExplanations(client: Client, limit = 50) {
  const project = await client.readProject({ projectName: process.env.LANGSMITH_PROJECT || "default" });
  const runs = [];
  let inspected = 0;
  for await (const run of client.runs.query({ project_ids: [project.id],
    min_start_time: new Date(Date.now() - 7 * 86400000).toISOString(),
    filter: 'and(eq(is_root,true),or(eq(name,"explain.file"),eq(name,"explain.folder")))',
    selects: ["ID", "NAME", "INPUTS", "OUTPUTS", "END_TIME", "TRACE_ID"] })) {
    if (run.end_time && record(run.outputs) && typeof run.outputs.value === "string") runs.push(run);
    if (++inspected >= limit) break;
  }
  if (!runs.length) throw new Error("No completed explanations in the last seven days. Use Explain in Cartograph first.");
  return { project, runs };
}

/** Phase 10 roots had empty inputs. Recover the actual user message from their model child. */
export async function suppliedInput(client: Client, projectId: string, run: { inputs?: unknown; trace_id?: string; id?: string }) {
  const facts = record(run.inputs) && record(run.inputs.facts) ? run.inputs : null;
  if (facts?.source) return facts;
  let inspected = 0;
  for await (const child of client.runs.query({ project_ids: [projectId], trace_id: run.trace_id || text(run.id),
    selects: ["ID", "NAME", "INPUTS", "OUTPUTS", "RUN_TYPE"] })) {
    if (++inspected > 20) break;
    if (facts && child.name === "source.prepare" && record(child.outputs) && child.outputs.source) return { ...facts, source: child.outputs.source };
    if (child.run_type?.toLowerCase() !== "llm" || !record(child.inputs) || !Array.isArray(child.inputs.messages)) continue;
    const message = child.inputs.messages.find((item: unknown) => record(item) && item.role === "user");
    if (!record(message)) continue;
    let content: unknown = message.content;
    if (Array.isArray(content)) content = content.filter(record).map((item) => item.text).join("");
    if (typeof content !== "string") continue;
    const value: unknown = JSON.parse(content);
    if (record(value) && record(value.facts)) return value;
  }
  return facts;
}

export function pathsFromFacts(input: unknown): string[] {
  if (!record(input) || !record(input.facts) || !Array.isArray(input.facts.files) || !record(input.facts.selection)) throw new Error("Trace has no supplied paths.");
  return [...new Set([...input.facts.files.map((file: unknown) => {
    if (!record(file)) throw new Error("Invalid file in trace.");
    return text(file.path);
  }), text(input.facts.selection.path)])];
}
