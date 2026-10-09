import { compare } from "../parser/graph";
import type { ParsedEdge, ParsedFile } from "../parser/types";

export type WalkDirection = "incoming" | "outgoing";
export interface WalkEntry { file: ParsedFile; depth: number }

function indexGraph(files: readonly ParsedFile[], edges: readonly ParsedEdge[]) {
  const indexed = new Map(files.map((file) => [file.path, file]));
  if (indexed.size !== files.length) throw new Error("Duplicate graph file path");
  const incoming = new Map(files.map((file) => [file.path, new Set<string>()]));
  const outgoing = new Map(files.map((file) => [file.path, new Set<string>()]));
  for (const edge of edges) {
    const source = outgoing.get(edge.source);
    const target = incoming.get(edge.target);
    if (!source || !target) throw new Error(`Graph import has an absent endpoint: ${edge.source} -> ${edge.target}`);
    source.add(edge.target);
    target.add(edge.source);
  }
  return { files: indexed, incoming, outgoing };
}

/** Breadth first: a file appears once, at its shortest distance, and never includes the seed. */
export function walkDependencies(files: readonly ParsedFile[], edges: readonly ParsedEdge[], seed: string,
  direction: WalkDirection, depthLimit = 2): WalkEntry[] {
  if (!Number.isSafeInteger(depthLimit) || depthLimit < 0) throw new Error("Walk depth must be a nonnegative integer");
  const graph = indexGraph(files, edges);
  if (!graph.files.has(seed)) throw new Error(`Cannot walk absent file: ${seed}`);
  const adjacency = graph[direction];
  const visited = new Set([seed]);
  const queue = [{ path: seed, depth: 0 }];
  const result: WalkEntry[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current.depth >= depthLimit) continue;
    for (const path of adjacency.get(current.path) ?? []) {
      if (visited.has(path)) continue;
      visited.add(path);
      const file = graph.files.get(path);
      if (!file) throw new Error(`Walk reached absent file: ${path}`);
      const depth = current.depth + 1;
      result.push({ file, depth });
      queue.push({ path, depth });
    }
  }
  return result.sort((a, b) => a.depth - b.depth || compare(a.file.path, b.file.path));
}

export interface ImportCycle {
  files: ParsedFile[];
  /** One real, closed import path per cyclic component, not every possible circuit. */
  witness: string[];
}

export interface RepositoryInsights {
  unimported: ParsedFile[];
  highlyImported: { file: ParsedFile; importers: number }[];
  cycles: ImportCycle[];
  longFiles: ParsedFile[];
  averageFanIn: number;
}

export const insightSentences = {
  unimported: "No parsed file imports these files.",
  highlyImported: "Many parsed files import these files.",
  cycles: "These files participate in cyclic imports.",
  longFiles: "These files have more than 500 lines.",
} as const;

function cyclicComponents(graph: ReturnType<typeof indexGraph>): ImportCycle[] {
  const paths = [...graph.files.keys()].sort(compare);
  const outgoing = new Map(paths.map((path) => [path, [...(graph.outgoing.get(path) ?? [])].sort(compare)]));
  const visited = new Set<string>();
  const finished: string[] = [];
  const backEdges: { source: string; target: string }[] = [];
  const parents = new Map<string, string>();
  // Explicit DFS frames preserve finishing order without using the call stack.
  for (const root of paths) {
    if (visited.has(root)) continue;
    const stack = [{ path: root, next: 0 }];
    const active = new Map([[root, 0]]);
    visited.add(root);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const neighbours = outgoing.get(frame.path) ?? [];
      if (frame.next >= neighbours.length) {
        finished.push(frame.path);
        active.delete(frame.path);
        stack.pop();
        continue;
      }
      const target = neighbours[frame.next++];
      const start = active.get(target);
      if (start !== undefined) {
        backEdges.push({ source: frame.path, target });
      } else if (!visited.has(target)) {
        visited.add(target);
        parents.set(target, frame.path);
        active.set(target, stack.length);
        stack.push({ path: target, next: 0 });
      }
    }
  }
  visited.clear();
  const cycles: ImportCycle[] = [];
  const componentOf = new Map<string, ImportCycle>();
  for (let index = finished.length - 1; index >= 0; index--) {
    const root = finished[index];
    if (visited.has(root)) continue;
    const component: string[] = [];
    const stack = [root];
    visited.add(root);
    while (stack.length) {
      const path = stack.pop();
      if (path === undefined) throw new Error("Empty cycle stack");
      component.push(path);
      for (const source of graph.incoming.get(path) ?? []) {
        if (visited.has(source)) continue;
        visited.add(source);
        stack.push(source);
      }
    }
    if (component.length === 1 && !graph.outgoing.get(root)?.has(root)) continue;
    const cycle: ImportCycle = { files: component.sort(compare).map((path) => {
      const file = graph.files.get(path);
      if (!file) throw new Error(`Cycle contains absent file: ${path}`);
      return file;
    }), witness: [] };
    cycles.push(cycle);
    for (const path of component) componentOf.set(path, cycle);
  }
  for (const edge of backEdges) {
    const cycle = componentOf.get(edge.source);
    if (!cycle || cycle.witness.length > 0) continue;
    const chain = [edge.source];
    while (chain[chain.length - 1] !== edge.target) {
      const parent = parents.get(chain[chain.length - 1]);
      if (parent === undefined) throw new Error("Cycle witness has no ancestor");
      chain.push(parent);
    }
    cycle.witness = [...chain.reverse(), edge.target];
  }
  if (cycles.some((cycle) => cycle.witness.length < 2)) throw new Error("Cyclic component has no real cycle witness");
  return cycles.sort((a, b) => compare(a.files[0].path, b.files[0].path));
}

/** All counts come from real edge pairs; framework exclusions are supplied by an adapter. */
export function repositoryInsights(files: readonly ParsedFile[], edges: readonly ParsedEdge[],
  entryFiles: ReadonlySet<string>): RepositoryInsights {
  const graph = indexGraph(files, edges);
  const averageFanIn = files.length === 0 ? 0
    : [...graph.incoming.values()].reduce((sum, neighbours) => sum + neighbours.size, 0) / files.length;
  const importerCount = (file: ParsedFile) => graph.incoming.get(file.path)?.size ?? 0;
  return {
    unimported: files.filter((file) => importerCount(file) === 0 && !entryFiles.has(file.path))
      .sort((a, b) => compare(a.path, b.path)),
    highlyImported: files.map((file) => ({ file, importers: importerCount(file) }))
      .filter((item) => item.importers >= 10 && item.importers > 2 * averageFanIn)
      .sort((a, b) => b.importers - a.importers || compare(a.file.path, b.file.path)),
    cycles: cyclicComponents(graph),
    longFiles: files.filter((file) => file.lines > 500).sort((a, b) => b.lines - a.lines || compare(a.path, b.path)),
    averageFanIn,
  };
}
