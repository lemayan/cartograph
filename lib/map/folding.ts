import type { ParsedEdge, ParsedFile } from "../parser/types";
import { compare } from "../parser/graph";

export interface FoldedFolder {
  id: string;
  path: string;
  files: ParsedFile[];
  fanIn: number;
  fanOut: number;
}

export interface FoldedMap {
  folders: FoldedFolder[];
  threshold: number;
}

export function parentFolder(folder: string): string {
  const slash = folder.lastIndexOf("/");
  return slash === -1 ? "." : folder.slice(0, slash);
}

function depth(folder: string): number {
  return folder === "." ? 0 : folder.split("/").length;
}

function foldAtThreshold(files: readonly ParsedFile[], threshold: number): Map<string, ParsedFile[]> {
  const directories = new Map<string, ParsedFile[]>();
  for (const file of files) {
    let folder = file.folder;
    while (!directories.has(folder)) {
      directories.set(folder, []);
      if (folder === ".") break;
      folder = parentFolder(folder);
    }
    directories.get(file.folder)?.push(file);
  }
  const deepest = Math.max(0, ...[...directories.keys()].map(depth));
  for (let level = deepest; level > 0; level--) {
    // Decide every merge at this depth before applying any of them.
    const merges = [...directories.entries()]
      .filter(([folder, contents]) => depth(folder) === level && contents.length < threshold)
      .sort(([a], [b]) => compare(a, b));
    for (const [folder, contents] of merges) {
      const parent = directories.get(parentFolder(folder));
      if (!parent) throw new Error(`Missing parent directory for ${folder}`);
      parent.push(...contents);
      directories.delete(folder);
    }
  }
  return new Map([...directories].filter(([, contents]) => contents.length > 0));
}

export function foldFolders(files: readonly ParsedFile[], edges: readonly ParsedEdge[]): FoldedMap {
  const sorted = [...files].sort((a, b) => compare(a.path, b.path));
  let threshold = 2;
  let groups = foldAtThreshold(sorted, threshold);
  while (groups.size > 24 || (groups.size > 1 && [...groups.values()].some((group) => group.length < 2))) {
    threshold++;
    // Each threshold starts from the original directory tree, never the previous folding.
    groups = foldAtThreshold(sorted, threshold);
  }
  const folders = [...groups].sort(([a], [b]) => compare(a, b)).map(([folder, contents]): FoldedFolder => ({
    id: `folder:${folder}`, path: folder,
    files: [...contents].sort((a, b) => compare(a.path, b.path)), fanIn: 0, fanOut: 0,
  }));
  const owners = new Map(folders.flatMap((folder) => folder.files.map((file) => [file.path, folder.id] as const)));
  const incoming = new Map(folders.map((folder) => [folder.id, new Set<string>()]));
  const outgoing = new Map(folders.map((folder) => [folder.id, new Set<string>()]));
  for (const edge of edges) {
    const source = owners.get(edge.source);
    const target = owners.get(edge.target);
    if (!source || !target) throw new Error(`Import has an absent endpoint: ${edge.source} -> ${edge.target}`);
    if (source === target) continue;
    incoming.get(target)?.add(edge.source);
    outgoing.get(source)?.add(edge.target);
  }
  for (const folder of folders) {
    folder.fanIn = incoming.get(folder.id)?.size ?? 0;
    folder.fanOut = outgoing.get(folder.id)?.size ?? 0;
  }
  return { folders, threshold };
}
