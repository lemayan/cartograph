import { createHash } from "node:crypto";
import type { ParserResult } from "../parser/types";
import type { MapSelection } from "../map/scene";
import { foldFolders } from "../map/folding";

/** Only the parser's direct edges enter a prompt; the model never walks the graph. */
export function explanationContext(result: ParserResult, selection: MapSelection) {
  const files = selection.type === "file" ? result.files.filter((file) => file.path === selection.path)
    : foldFolders(result.files, result.edges).folders.find((folder) => folder.path === selection.path)?.files ?? [];
  if (!files.length) throw new Error("The selected file or folded folder is absent from this analysis.");
  const members = new Set(files.map((file) => file.path));
  const edges = result.edges.filter((edge) => members.has(edge.source) || members.has(edge.target));
  const neighbours = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const supplied = result.files.filter((file) => members.has(file.path) || neighbours.has(file.path));
  return {
    selection,
    members: files.map((file) => file.path),
    files: supplied.map(({ path, hash, kind, lines }) => ({ path, hash, kind, lines })),
    imports: edges.filter((edge) => members.has(edge.source)),
    importers: edges.filter((edge) => members.has(edge.target)),
  };
}

export function contentKey(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
