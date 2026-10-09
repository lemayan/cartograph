import path from "node:path";
import { deduplicateEdges, withFanCounts } from "./graph";
import { countImports } from "./coverage";
import type { ImportCounts, ImportKind, ImportRecord, ImportStatus, ParsedEdge, ParsedFile, ParserResult, SkippedFile } from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error("Expected an object in parser data");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a string in parser data");
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Expected a nonnegative integer in parser data");
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected an array in parser data");
  return value;
}

function relative(value: unknown): string {
  const result = string(value);
  if (!result || result.includes("\\") || result.startsWith("/") || /^[A-Za-z]:/.test(result)
    || result.split("/").some((part) => !part || part === ".." || part === ".")) {
    throw new Error(`Invalid repository-relative file path: ${result}`);
  }
  return result;
}

function kind(value: unknown): ImportKind {
  if (value === "import" || value === "re-export" || value === "dynamic-import") return value;
  throw new Error("Invalid import kind in parser data");
}

function status(value: unknown): ImportStatus {
  if (value === "resolved" || value === "external" || value === "excluded" || value === "unresolved") return value;
  throw new Error("Invalid import status in parser data");
}

function counts(value: unknown): ImportCounts {
  const row = object(value);
  const result = { found: integer(row.found), resolved: integer(row.resolved), external: integer(row.external), excluded: integer(row.excluded), unresolved: integer(row.unresolved) };
  if (result.found !== result.resolved + result.external + result.excluded + result.unresolved) throw new Error("Import coverage does not add up");
  return result;
}

function sameCounts(actual: ImportCounts, expected: ImportCounts): boolean {
  return actual.found === expected.found && actual.resolved === expected.resolved && actual.external === expected.external
    && actual.excluded === expected.excluded && actual.unresolved === expected.unresolved;
}

/** Reconstruct typed data from unknown JSON, then enforce the graph/coverage invariants. */
export function validateParserResult(value: unknown): ParserResult {
  const data = object(value);
  if (data.schemaVersion !== 1) throw new Error("Unsupported parser schemaVersion; expected 1");
  const files: ParsedFile[] = array(data.files).map((value) => {
    const row = object(value);
    const filename = relative(row.path);
    const folder = string(row.folder);
    if (folder !== path.posix.dirname(filename)) throw new Error(`Wrong folder for ${filename}`);
    const hash = string(row.hash);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid SHA-256 for ${filename}`);
    if (row.module !== "module" && row.module !== "script") throw new Error(`Invalid module classification for ${filename}`);
    const extension = string(row.extension);
    if (extension !== path.posix.extname(filename)) throw new Error(`Wrong extension for ${filename}`);
    return { path: filename, folder, hash, extension, lines: integer(row.lines), module: row.module,
      kind: nullableString(row.kind), fanIn: integer(row.fanIn), fanOut: integer(row.fanOut) };
  });
  const edges: ParsedEdge[] = array(data.edges).map((value) => {
    const row = object(value);
    const kinds = array(row.kinds).map(kind);
    if (!kinds.length || new Set(kinds).size !== kinds.length) throw new Error("Edge kinds must be nonempty and unique");
    return { source: relative(row.source), target: relative(row.target), kinds };
  });
  const coverage = object(data.coverage);
  const byKind = object(coverage.byKind);
  const skipped: SkippedFile[] = array(coverage.skipped).map((value) => {
    const row = object(value);
    const reason = string(row.reason);
    const detail = string(row.detail);
    if (!reason || !detail) throw new Error("Every skipped file needs a reason and detail");
    return { path: relative(row.path), reason, detail };
  });
  const records: ImportRecord[] = array(coverage.records).map((value) => {
    const row = object(value);
    if (typeof row.typeOnly !== "boolean") throw new Error("Expected typeOnly boolean");
    const line = integer(row.line);
    const column = integer(row.column);
    if (!line || !column) throw new Error("Import positions must be one-based");
    const disposition = status(row.status);
    const target = row.target === null ? null : relative(row.target);
    const reason = nullableString(row.reason);
    const specifier = nullableString(row.specifier);
    if (disposition === "resolved" && (!target || reason !== null || specifier === null)) throw new Error("Resolved import needs a target and literal specifier, and no failure reason");
    if (disposition !== "resolved" && !reason) throw new Error("Every non-resolved import needs a reason");
    if ((disposition === "external" || disposition === "unresolved") && target !== null) throw new Error("External/unresolved import cannot have a repository target");
    return { source: relative(row.source), line, column, kind: kind(row.kind), specifier,
      expression: string(row.expression), typeOnly: row.typeOnly, status: disposition, target, reason };
  });
  const result: ParserResult = {
    schemaVersion: 1, repository: string(data.repository), adapter: string(data.adapter), files, edges,
    coverage: { filesFound: integer(coverage.filesFound), filesParsed: integer(coverage.filesParsed), filesSkipped: integer(coverage.filesSkipped),
      folders: integer(coverage.folders), skipped, records, imports: counts(coverage.imports),
      byKind: { import: counts(byKind.import), "re-export": counts(byKind["re-export"]), "dynamic-import": counts(byKind["dynamic-import"]) } },
  };
  if (!result.repository || !result.adapter) throw new Error("Repository and adapter names must be present");
  if (result.coverage.filesParsed !== files.length || result.coverage.filesSkipped !== skipped.length
    || result.coverage.filesFound !== files.length + skipped.length) throw new Error("File coverage does not add up");
  const paths = new Set(files.map((file) => file.path));
  if (data.routes !== undefined) {
    result.routes = array(data.routes).map((value) => {
      const row = object(value);
      const file = relative(row.file);
      const method = string(row.method);
      const pattern = string(row.path);
      const line = integer(row.line);
      if (!paths.has(file) || !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL)$/.test(method)
        || !pattern.startsWith("/") || /[\x00-\x1f\x7f?#]/.test(pattern) || !line
        || line > (files.find((item) => item.path === file)?.lines ?? 0)) throw new Error("Invalid recovered route");
      return { file, method, path: pattern, line };
    });
    const keys = result.routes.map((route) => JSON.stringify(route));
    if (new Set(keys).size !== keys.length) throw new Error("Duplicate recovered route");
  }
  if (paths.size !== files.length || new Set(skipped.map((file) => file.path)).size !== skipped.length
    || skipped.some((file) => paths.has(file.path))) throw new Error("Duplicate file or overlap in skipped/parsed inventory");
  if (result.coverage.folders !== new Set(files.map((file) => file.folder)).size) throw new Error("Folder count is wrong");
  const counted = withFanCounts(files, edges);
  if (counted.some((file, index) => file.fanIn !== files[index].fanIn || file.fanOut !== files[index].fanOut)) throw new Error("Fan counts are wrong");
  if (deduplicateEdges(edges).length !== edges.length) throw new Error("Duplicate edges in parser data");
  if (records.some((record) => !paths.has(record.source) || (record.status === "resolved" && (!record.target || !paths.has(record.target))))) throw new Error("Import references an absent parsed file");
  const fromRecords = deduplicateEdges(records.flatMap((record): ParsedEdge[] => record.status === "resolved" && record.target
    ? [{ source: record.source, target: record.target, kinds: [record.kind] }] : []));
  if (JSON.stringify(deduplicateEdges(edges)) !== JSON.stringify(fromRecords)) throw new Error("Edge list does not match resolved imports");
  if (!sameCounts(result.coverage.imports, countImports(records))) throw new Error("Import totals do not match the ledger");
  for (const importKind of ["import", "re-export", "dynamic-import"] as const) {
    if (!sameCounts(result.coverage.byKind[importKind], countImports(records.filter((record) => record.kind === importKind)))) throw new Error(`Wrong coverage for ${importKind}`);
  }
  return result;
}
