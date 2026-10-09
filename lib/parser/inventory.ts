import { readdir } from "node:fs/promises";
import path from "node:path";
import { compare } from "./graph";
import type { SkippedFile } from "./types";

const extensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const generatedDirectories = new Set(["dist", "build", "out", "coverage"]);

export function relativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

export function isInside(root: string, absolute: string): boolean {
  const relative = path.relative(root, absolute);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function directoryExclusion(name: string): string | null {
  if (name === "node_modules") return "dependency_directory";
  if (name.startsWith(".")) return "hidden_directory";
  if (generatedDirectories.has(name)) return "generated_directory";
  return null;
}

/** Whole directories are retained or excluded; there is no file-size ranking. */
export async function inventory(root: string): Promise<{
  candidates: string[];
  skipped: SkippedFile[];
  found: number;
}> {
  const candidates: string[] = [];
  const skipped: SkippedFile[] = [];
  let found = 0;
  async function walk(directory: string, exclusion: string | null): Promise<void> {
    // Unreadable directories fail loudly: their unknown contents cannot honestly be counted.
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((a, b) => compare(a.name, b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = relativePath(root, absolute);
      if (entry.isDirectory()) {
        await walk(absolute, exclusion ?? directoryExclusion(entry.name));
        continue;
      }
      found++;
      let reason = exclusion;
      if (!reason && entry.isSymbolicLink()) reason = "symbolic_link";
      if (!reason && !entry.isFile()) reason = "not_regular_file";
      if (!reason && !extensions.has(path.extname(entry.name).toLowerCase())) reason = "unsupported_extension";
      if (reason) skipped.push({ path: relative, reason, detail: reason });
      else candidates.push(absolute);
    }
  }
  await walk(root, null);
  return { candidates, skipped, found };
}
