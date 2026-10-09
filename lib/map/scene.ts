import { compare } from "../parser/graph";
import type { ParsedEdge, ParsedFile } from "../parser/types";
import type { FoldedFolder } from "./folding";

export const panelRowLimit = 12;
export const panelHeaderHeight = 48;
export const fileRowHeight = 24;
export const overflowRowHeight = 26;

export type MapSelection = { type: "folder"; path: string } | { type: "file"; path: string };

export interface FileRow {
  file: ParsedFile;
  label: string;
}

export interface SceneNode {
  id: string;
  folder: FoldedFolder;
  label: string;
  expanded: boolean;
  allRows: FileRow[];
  rows: FileRow[];
  hiddenFiles: number;
  rowStart: number;
  rowEnd: number;
  scrollTop: number;
  viewportHeight: number;
  aboveFiles: number;
  belowFiles: number;
  width: number;
  height: number;
  position: { x: number; y: number };
}

export interface SceneEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  imports: ParsedEdge[];
}

export interface MapScene {
  nodes: SceneNode[];
  edges: SceneEdge[];
}

/** The shortest path suffix that identifies each visible folder or file. */
export function uniqueLabels(paths: readonly string[]): Map<string, string> {
  const parts = paths.map((pathname) => pathname.split("/"));
  return new Map(paths.map((pathname, index) => {
    const segments = parts[index];
    for (let length = 1; length <= segments.length; length++) {
      const suffix = segments.slice(-length).join("/");
      if (!parts.some((other, otherIndex) => otherIndex !== index && other.slice(-length).join("/") === suffix)) {
        return [pathname, suffix];
      }
    }
    return [pathname, pathname];
  }));
}

export function fanInHeight(fanIn: number): number {
  return 64 + Math.round(6 * Math.sqrt(fanIn));
}

export function rowHandle(direction: "in" | "out", filepath: string): string {
  return `${direction}:${encodeURIComponent(filepath)}`;
}

function endpoint(node: SceneNode, filepath: string, direction: "in" | "out"): string {
  if (!node.expanded) return direction;
  const index = node.folder.files.findIndex((file) => file.path === filepath);
  if (index < 0) throw new Error(`Unknown file endpoint: ${filepath}`);
  if (index < node.rowStart) return `${direction}:above`;
  if (index >= node.rowEnd) return `${direction}:below`;
  return rowHandle(direction, filepath);
}

export function createScene(folders: readonly FoldedFolder[], edges: readonly ParsedEdge[], expanded: ReadonlySet<string>, offsets: ReadonlyMap<string, number> = new Map()): MapScene {
  const windows = new Map(folders.map((folder) => {
    const viewportHeight = Math.min(panelRowLimit, folder.files.length) * fileRowHeight;
    const requested = offsets.get(folder.id) ?? 0;
    const scrollTop = Math.max(0, Math.min(Number.isFinite(requested) ? requested : 0, folder.files.length * fileRowHeight - viewportHeight));
    return [folder.id, { viewportHeight, scrollTop, start: Math.floor(scrollTop / fileRowHeight),
      end: Math.min(folder.files.length, Math.ceil((scrollTop + viewportHeight) / fileRowHeight)) }];
  }));
  // Size for every reachable label once; scrolling must never resize or relayout a panel.
  const sizingLabels = uniqueLabels(folders.flatMap((folder) => [folder.path,
    ...(expanded.has(folder.id) ? folder.files.map((file) => file.path) : [])]));
  const labels = uniqueLabels(folders.flatMap((folder) => {
    const window = windows.get(folder.id);
    if (!window) throw new Error(`Missing folder viewport: ${folder.id}`);
    return [folder.path, ...(expanded.has(folder.id) ? folder.files.slice(window.start, window.end).map((file) => file.path) : [])];
  }));
  const nodes = folders.map((folder): SceneNode => {
    const opened = expanded.has(folder.id);
    const window = windows.get(folder.id);
    if (!window) throw new Error(`Missing folder viewport: ${folder.id}`);
    const allRows = opened ? folder.files.map((file, index) => ({ file,
      label: (index >= window.start && index < window.end ? labels : sizingLabels).get(file.path) ?? file.path })) : [];
    const rows = opened ? allRows.slice(window.start, window.end) : [];
    const label = labels.get(folder.path) ?? folder.path;
    const hiddenFiles = opened ? folder.files.length - rows.length : 0;
    return {
      id: folder.id, folder, label, expanded: opened, allRows, rows, hiddenFiles,
      rowStart: opened ? window.start : 0, rowEnd: opened ? window.end : 0,
      scrollTop: opened ? window.scrollTop : 0, viewportHeight: opened ? window.viewportHeight : 0,
      aboveFiles: opened ? window.start : 0, belowFiles: opened ? folder.files.length - window.end : 0,
      width: opened ? Math.max(220, (sizingLabels.get(folder.path) ?? folder.path).length * 7 + 40,
        ...folder.files.map((file) => (sizingLabels.get(file.path) ?? file.path).length * 7 + 128)) : Math.max(132, (sizingLabels.get(folder.path) ?? folder.path).length * 7 + 36),
      height: opened ? Math.max(fanInHeight(folder.fanIn), panelHeaderHeight + window.viewportHeight + (folder.files.length > panelRowLimit ? overflowRowHeight : 0) + 2) : fanInHeight(folder.fanIn),
      position: { x: 0, y: 0 },
    };
  });
  const owners = new Map(nodes.flatMap((node) => node.folder.files.map((file) => [file.path, node] as const)));
  const grouped = new Map<string, SceneEdge>();
  for (const edge of [...edges].sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target))) {
    const source = owners.get(edge.source);
    const target = owners.get(edge.target);
    if (!source || !target) throw new Error(`Scene import has an absent endpoint: ${edge.source} -> ${edge.target}`);
    if (source.id === target.id && !source.expanded) continue;
    const sourceHandle = endpoint(source, edge.source, "out");
    const targetHandle = endpoint(target, edge.target, "in");
    const key = JSON.stringify([source.id, target.id, sourceHandle, targetHandle]);
    const existing = grouped.get(key);
    if (existing) existing.imports.push(edge);
    else grouped.set(key, { id: `edge:${key}`, source: source.id, target: target.id, sourceHandle, targetHandle, imports: [edge] });
  }
  return { nodes, edges: [...grouped.values()] };
}

export function scrollScene(geometry: MapScene, edges: readonly ParsedEdge[], offsets: ReadonlyMap<string, number>): MapScene {
  const scene = createScene(geometry.nodes.map((node) => node.folder), edges,
    new Set(geometry.nodes.filter((node) => node.expanded).map((node) => node.id)), offsets);
  const placed = new Map(geometry.nodes.map((node) => [node.id, node]));
  return { ...scene, nodes: scene.nodes.map((node) => {
    const original = placed.get(node.id);
    if (!original || node.width !== original.width || node.height !== original.height) throw new Error(`Scrolling changed panel geometry: ${node.id}`);
    return { ...node, position: original.position };
  }) };
}

export function rowPortTop(node: SceneNode, index: number): number {
  return panelHeaderHeight + Math.max(2, Math.min(node.viewportHeight - 2, (index + 0.5) * fileRowHeight - node.scrollTop));
}

export interface SelectionHighlight {
  selected: Set<string>;
  files: Set<string>;
  folders: Set<string>;
  pairs: Set<string>;
}

export interface SelectionVisibility {
  nodes: Set<string>;
  rows: Set<string>;
  above: Set<string>;
  below: Set<string>;
  edges: Set<string>;
}

export function selectionHighlight(selection: MapSelection | null, folders: readonly FoldedFolder[], edges: readonly ParsedEdge[]): SelectionHighlight | null {
  if (!selection) return null;
  const owner = folders.find((folder) => selection.type === "folder" ? folder.path === selection.path
    : folder.files.some((file) => file.path === selection.path));
  if (!owner) throw new Error(`Cannot select absent ${selection.type}: ${selection.path}`);
  const selected = selection.type === "file" ? new Set([selection.path]) : new Set(owner.files.map((file) => file.path));
  const related = new Set(selected);
  const pairs = new Set<string>();
  for (const edge of edges) {
    if (!selected.has(edge.source) && !selected.has(edge.target)) continue;
    related.add(edge.source);
    related.add(edge.target);
    pairs.add(JSON.stringify([edge.source, edge.target]));
  }
  return {
    selected,
    files: related,
    folders: new Set(folders.filter((folder) => folder.files.some((file) => related.has(file.path))).map((folder) => folder.id)),
    pairs,
  };
}

export function selectionDirection(edge: SceneEdge, highlight: SelectionHighlight | null): "incoming" | "outgoing" | "both" | null {
  if (!highlight) return null;
  let incoming = false;
  let outgoing = false;
  for (const pair of edge.imports) {
    if (!highlight.pairs.has(JSON.stringify([pair.source, pair.target]))) continue;
    incoming ||= highlight.selected.has(pair.target);
    outgoing ||= highlight.selected.has(pair.source);
  }
  if (incoming && outgoing) return "both";
  return incoming ? "incoming" : outgoing ? "outgoing" : null;
}

/** Project real incident imports onto the existing display, without changing its geometry. */
export function selectionVisibility(scene: MapScene, highlight: SelectionHighlight | null): SelectionVisibility | null {
  if (!highlight) return null;
  return {
    nodes: new Set(scene.nodes.filter((node) => highlight.folders.has(node.id)).map((node) => node.id)),
    rows: new Set(scene.nodes.flatMap((node) => node.rows.filter((row) => highlight.files.has(row.file.path)).map((row) => row.file.path))),
    above: new Set(scene.nodes.filter((node) => node.expanded && node.aboveFiles > 0
      && node.folder.files.slice(0, node.rowStart).some((file) => highlight.files.has(file.path))).map((node) => node.id)),
    below: new Set(scene.nodes.filter((node) => node.expanded && node.belowFiles > 0
      && node.folder.files.slice(node.rowEnd).some((file) => highlight.files.has(file.path))).map((node) => node.id)),
    edges: new Set(scene.edges.filter((edge) => edge.imports.some((pair) => highlight.pairs.has(JSON.stringify([pair.source, pair.target])))).map((edge) => edge.id)),
  };
}

export function expectedHandles(node: SceneNode, direction: "in" | "out"): string[] {
  return node.expanded ? [...node.rows.map((row) => rowHandle(direction, row.file.path)),
    ...(node.aboveFiles ? [`${direction}:above`] : []), ...(node.belowFiles ? [`${direction}:below`] : [])] : [direction];
}
