import { createHash } from "node:crypto";
import type { SemanticRole } from "../lib/ai/roles";
import type { explanationContext } from "../lib/explanations/context";
import type { ImportKind } from "../lib/parser/types";

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Expected a non-empty string in eval data.");
  return value;
}
export function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item: unknown) => typeof item === "string")) throw new Error("Expected a path list in eval data.");
  return value;
}
export function hash(contents: string) { return createHash("sha256").update(contents).digest("hex"); }
export interface RoleExample {
  path: string; hash: string; contents: string; expected: SemanticRole;
  repository: string; commit: string; framework: string;
}
export interface ExplanationExample {
  facts: ReturnType<typeof explanationContext>;
  source: { path: string; contents: string }[];
  paths: string[];
  origin: string;
}

export function validateExplanation(value: unknown): ExplanationExample {
  if (!record(value) || !record(value.facts) || !record(value.facts.selection)
    || !["file", "folder"].includes(text(value.facts.selection.type)) || !Array.isArray(value.facts.files)
    || !Array.isArray(value.source)) throw new Error("Explanation dataset needs selection, files and source.");
  text(value.facts.selection.path);
  const files = value.facts.files.map((file: unknown) => {
    if (!record(file)) throw new Error("Invalid file facts.");
    return { path: text(file.path), hash: text(file.hash), kind: file.kind === null ? null : text(file.kind), lines: Number(file.lines) };
  });
  function edges(value: unknown) {
    if (!Array.isArray(value)) throw new Error("Explanation facts lack edges.");
    return value.map((edge: unknown) => {
      if (!record(edge)) throw new Error("Invalid edge facts.");
      const source = text(edge.source); const target = text(edge.target);
      if (!files.some((file) => file.path === source) || !files.some((file) => file.path === target)) throw new Error("Edge names absent facts.");
      const kinds = strings(edge.kinds).map((value): ImportKind => {
        if (value !== "import" && value !== "re-export" && value !== "dynamic-import" && value !== "require") throw new Error("Unknown import kind.");
        return value;
      });
      return { source, target, kinds };
    });
  }
  const facts = { selection: { type: value.facts.selection.type === "file" ? "file" as const : "folder" as const,
    path: text(value.facts.selection.path) }, files, members: strings(value.facts.members),
    imports: edges(value.facts.imports), importers: edges(value.facts.importers) };
  const source = value.source.map((item: unknown) => {
    if (!record(item)) throw new Error("Invalid source data.");
    const path = text(item.path); const contents = text(item.contents);
    if (!facts.members.includes(path) || files.find((file) => file.path === path)?.hash !== hash(contents)) throw new Error("Source differs from captured facts.");
    return { path, contents };
  });
  if (new Set(source.map((file) => file.path)).size !== facts.members.length
    || facts.members.some((path) => !source.some((file) => file.path === path))) throw new Error("Dataset source omitted a member.");
  const paths = [...new Set([...files.map((file) => file.path), facts.selection.path])];
  if (value.paths && JSON.stringify(strings(value.paths)) !== JSON.stringify(paths)) throw new Error("Path allowlist differs from supplied facts.");
  return { facts, source, paths, origin: text(value.origin) };
}
