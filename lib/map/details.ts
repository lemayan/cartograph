import type { ParsedEdge, ParsedFile } from "../parser/types";
import type { FoldedFolder } from "./folding";
import type { MapScene, MapSelection, SelectionVisibility } from "./scene";
import { compare } from "../parser/graph";

export interface FileDetails {
  file: ParsedFile;
  imports: ParsedFile[];
  dependents: ParsedFile[];
}

export interface FileKindCount {
  kind: string | null;
  count: number;
}

export interface RepositoryDetails {
  files: ReadonlyMap<string, FileDetails>;
  importCount: number;
  unknownCount: number;
  mostImported: FileDetails[];
  startingPoints: FileDetails[];
}

export function countFileKinds(files: readonly ParsedFile[]): FileKindCount[] {
  const counts = new Map<string | null, number>();
  for (const file of files) counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || compare(a.kind ?? "Unknown", b.kind ?? "Unknown"));
}

/** Lists and counts share the same unique, resolved file pairs. */
export function repositoryDetails(files: readonly ParsedFile[], edges: readonly ParsedEdge[]): RepositoryDetails {
  const indexed = new Map(files.map((file): [string, FileDetails] => [file.path, { file, imports: [], dependents: [] }]));
  if (indexed.size !== files.length) throw new Error("Duplicate detail file path");
  const pairs = new Set<string>();
  for (const edge of edges) {
    const source = indexed.get(edge.source);
    const target = indexed.get(edge.target);
    if (!source || !target) throw new Error(`Detail import has an absent endpoint: ${edge.source} -> ${edge.target}`);
    const key = JSON.stringify([edge.source, edge.target]);
    if (pairs.has(key)) throw new Error(`Duplicate detail import: ${edge.source} -> ${edge.target}`);
    pairs.add(key);
    source.imports.push(target.file);
    target.dependents.push(source.file);
  }
  for (const detail of indexed.values()) {
    detail.imports.sort((a, b) => compare(a.path, b.path));
    detail.dependents.sort((a, b) => compare(a.path, b.path));
  }
  return {
    files: indexed,
    importCount: pairs.size,
    unknownCount: files.filter((file) => file.kind === null).length,
    mostImported: [...indexed.values()].filter((detail) => detail.dependents.length > 0)
      .sort((a, b) => b.dependents.length - a.dependents.length || compare(a.file.path, b.file.path)),
    startingPoints: [...indexed.values()].filter((detail) => detail.dependents.length === 0)
      .sort((a, b) => b.imports.length - a.imports.length || compare(a.file.path, b.file.path)),
  };
}

export function selectionFiles(selection: MapSelection | null, folders: readonly FoldedFolder[]): Set<string> {
  if (!selection) return new Set();
  const owner = folders.find((folder) => selection.type === "folder" ? folder.path === selection.path
    : folder.files.some((file) => file.path === selection.path));
  if (!owner) throw new Error(`Cannot hover absent ${selection.type}: ${selection.path}`);
  return new Set(selection.type === "file" ? [selection.path] : owner.files.map((file) => file.path));
}

/** Hover identifies one target without changing selection or walking its imports. */
export function hoverVisibility(scene: MapScene, hover: MapSelection | null): SelectionVisibility | null {
  if (!hover) return null;
  const files = selectionFiles(hover, scene.nodes.map((node) => node.folder));
  return {
    nodes: new Set(scene.nodes.filter((node) => node.folder.files.some((file) => files.has(file.path))).map((node) => node.id)),
    rows: new Set(scene.nodes.flatMap((node) => node.rows.filter((row) => files.has(row.file.path)).map((row) => row.file.path))),
    above: new Set(scene.nodes.filter((node) => node.expanded && node.folder.files.slice(0, node.rowStart).some((file) => files.has(file.path))).map((node) => node.id)),
    below: new Set(scene.nodes.filter((node) => node.expanded && node.folder.files.slice(node.rowEnd).some((file) => files.has(file.path))).map((node) => node.id)),
    edges: new Set(),
  };
}
