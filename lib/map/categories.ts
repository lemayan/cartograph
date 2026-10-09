import type { ParsedFile } from "../parser/types";
import type { MapScene, SelectionVisibility } from "./scene";

export function categoryFiles(files: readonly ParsedFile[], extension: string | null): Set<string> | null {
  return extension === null ? null : new Set(files.filter((file) => file.extension === extension).map((file) => file.path));
}

/** Filtering changes brightness only; even zero-match panels keep their rows and geometry. */
export function categoryVisibility(scene: MapScene, matches: ReadonlySet<string> | null): SelectionVisibility | null {
  if (matches === null) return null;
  return {
    nodes: new Set(scene.nodes.filter((node) => node.folder.files.some((file) => matches.has(file.path))).map((node) => node.id)),
    rows: new Set(matches),
    above: new Set(scene.nodes.filter((node) => node.folder.files.slice(0, node.rowStart).some((file) => matches.has(file.path))).map((node) => node.id)),
    below: new Set(scene.nodes.filter((node) => node.folder.files.slice(node.rowEnd).some((file) => matches.has(file.path))).map((node) => node.id)),
    edges: new Set(scene.edges.filter((edge) => edge.imports.some((pair) => matches.has(pair.source) || matches.has(pair.target))).map((edge) => edge.id)),
  };
}
