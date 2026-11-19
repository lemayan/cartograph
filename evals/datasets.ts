import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "langsmith";
import { parseFrameworkRepository } from "../lib/adapters/parse-repository";
import { semanticRoles, type SemanticRole } from "../lib/ai/roles";
import { contentKey } from "../lib/explanations/context";
import { fetchPublicRepository } from "../lib/pipeline/archive";
import { publicRepository } from "../lib/pipeline/repository";
import { hash, record, text, validateExplanation, type RoleExample } from "./data";
import { recentExplanations, suppliedInput } from "./traffic";

export const roleDataFile = ".cartograph/eval-data/roles.json";
export const explanationDataFile = ".cartograph/eval-data/explanations.json";
export async function save(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}
export async function captureRoles(url = "https://github.com/react-hook-form/react-hook-form") {
  const repository = publicRepository(url);
  const archive = await fetchPublicRepository(repository);
  try {
    const parsed = await parseFrameworkRepository(archive.directory);
    // Exact intersection: utility, context, entity, test and structural roles are excluded.
    const buckets = semanticRoles.map((role) => parsed.files.filter((file) => file.kind === role).sort((a, b) => a.path.localeCompare(b.path)));
    const selected = [];
    while (selected.length < 30 && buckets.some((bucket) => bucket.length)) {
      for (const bucket of buckets) {
        const file = bucket.shift();
        if (file && selected.length < 30) selected.push(file);
      }
    }
    if (selected.length < 30) throw new Error(`Only ${selected.length} eligible convention-labelled files in ${repository.url}; use a repository with at least thirty.`);
    const examples: RoleExample[] = [];
    for (const file of selected) {
      const expected = semanticRoles.find((role) => role === file.kind);
      if (!expected) throw new Error("Held-out role outside the classifier allowlist.");
      const contents = await readFile(path.join(archive.directory, file.path), "utf8");
      if (hash(contents) !== file.hash) throw new Error("Held-out source changed after parsing.");
      examples.push({ path: file.path, hash: file.hash, contents, expected,
        repository: repository.url, commit: archive.commitSha, framework: parsed.adapter });
    }
    await save(roleDataFile, examples);
    console.log(`Captured ${examples.length} real held-out files at ${archive.commitSha} in ${roleDataFile}.`);
    console.log("Ground truth distribution:", Object.fromEntries(semanticRoles.map((role) => [role, examples.filter((item) => item.expected === role).length])));
  } finally { await archive.cleanup(); }
}

export async function readRoles(): Promise<RoleExample[]> {
  const data: unknown = JSON.parse(await readFile(roleDataFile, "utf8"));
  if (!Array.isArray(data) || data.length < 30) throw new Error("Capture a role dataset of at least thirty files first.");
  const seen = new Set<string>();
  return data.map((item: unknown) => {
    if (!record(item)) throw new Error("Invalid role dataset entry.");
    const expected: SemanticRole | undefined = semanticRoles.find((role) => role === item.expected);
    if (!expected) throw new Error("Role ground truth is outside the classifier allowlist.");
    const entry = { path: text(item.path), hash: text(item.hash), contents: text(item.contents), expected,
      repository: text(item.repository), commit: text(item.commit), framework: text(item.framework) };
    const id = `${entry.repository}:${entry.commit}:${entry.path}`;
    if (seen.has(id) || !/^[a-f0-9]{40}$/.test(entry.commit) || hash(entry.contents) !== entry.hash) throw new Error("Duplicate or changed held-out source.");
    seen.add(id);
    return entry;
  });
}

export async function captureExplanations(client: Client) {
  const { project, runs } = await recentExplanations(client);
  const examples = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const run of runs) {
    if (run.outputs?.stale) { skipped++; continue; }
    const input = await suppliedInput(client, project.id, run);
    if (!input || !input.source) { skipped++; continue; }
    const example = validateExplanation({ ...input, origin: run.id });
    const key = contentKey({ facts: example.facts, source: example.source });
    if (!seen.has(key)) { examples.push(example); seen.add(key); }
    if (examples.length === 4) break;
  }
  if (examples.length < 2 || !examples.some((item) => item.facts.selection.type === "file")
    || !examples.some((item) => item.facts.selection.type === "folder")) throw new Error("Need at least one fresh file and one fresh folder explanation with captured source. Use Explain on both, then capture again.");
  await save(explanationDataFile, examples);
  console.log(`Froze ${examples.length} distinct real contexts in ${explanationDataFile}; skipped ${skipped} stale or uncaptured runs.`);
}

export async function readExplanations() {
  const data: unknown = JSON.parse(await readFile(explanationDataFile, "utf8"));
  if (!Array.isArray(data) || data.length < 2) throw new Error("Capture explanation contexts first.");
  return data.map(validateExplanation);
}

/** Content-addressed datasets are immutable. A rerun compares precisely the same examples. */
export async function dataset(client: Client, prefix: string,
  examples: { inputs: Record<string, unknown>; outputs?: Record<string, unknown>; metadata?: Record<string, unknown> }[]) {
  const snapshot = contentKey(examples);
  const name = `${prefix}-${snapshot.slice(0, 16)}`;
  if (await client.hasDataset({ datasetName: name })) {
    const stored = [];
    for await (const example of client.listExamples({ datasetName: name, limit: examples.length + 1 })) stored.push(example);
    const canonical = (items: typeof examples) => items.map((item) => contentKey(stableValue({ inputs: item.inputs, outputs: item.outputs ?? {} }))).sort();
    if (JSON.stringify(canonical(stored)) !== JSON.stringify(canonical(examples))) throw new Error("Stored dataset differs from its frozen snapshot. Refusing comparison.");
    return client.readDataset({ datasetName: name });
  }
  const created = await client.createDataset(name, { description: "Cartograph Phase 11 frozen inputs", metadata: { snapshot } });
  await client.createExamples(examples.map((example) => ({ ...example, dataset_id: created.id })));
  return created;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}
