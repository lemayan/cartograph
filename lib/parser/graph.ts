import type { ImportKind, ParsedEdge, ParsedFile } from "./types";

const kindOrder: ImportKind[] = ["import", "re-export", "dynamic-import"];

export function deduplicateEdges(edges: readonly ParsedEdge[]): ParsedEdge[] {
  const pairs = new Map<string, ParsedEdge>();
  for (const edge of edges) {
    const key = JSON.stringify([edge.source, edge.target]);
    const existing = pairs.get(key);
    pairs.set(key, {
      source: edge.source,
      target: edge.target,
      kinds: kindOrder.filter((kind) =>
        existing?.kinds.includes(kind) || edge.kinds.includes(kind)),
    });
  }
  return [...pairs.values()].sort((a, b) =>
    compare(a.source, b.source) || compare(a.target, b.target));
}

export function withFanCounts(
  files: readonly ParsedFile[],
  edges: readonly ParsedEdge[],
): ParsedFile[] {
  const counts = new Map(files.map((file) => [file.path, { fanIn: 0, fanOut: 0 }]));
  for (const edge of deduplicateEdges(edges)) {
    const source = counts.get(edge.source);
    const target = counts.get(edge.target);
    if (!source || !target) throw new Error(`Edge has an absent endpoint: ${edge.source} -> ${edge.target}`);
    source.fanOut++;
    target.fanIn++;
  }
  return files.map((file) => ({ ...file, ...counts.get(file.path) }));
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
