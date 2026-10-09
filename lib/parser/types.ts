/** Paths in this contract are repository-relative, use '/', and never contain '..'. */
export type ImportKind = "import" | "re-export" | "dynamic-import";
export type ImportStatus = "resolved" | "external" | "excluded" | "unresolved";

export interface ParsedFile {
  path: string;
  folder: string;
  extension: string;
  lines: number;
  hash: string;
  module: "module" | "script";
  kind: string | null;
  fanIn: number;
  fanOut: number;
}

/** One edge per ordered file pair; kinds retain all syntax that produced it. */
export interface ParsedEdge {
  source: string;
  target: string;
  kinds: ImportKind[];
}

export interface ImportRecord {
  source: string;
  line: number;
  column: number;
  kind: ImportKind;
  specifier: string | null;
  expression: string;
  typeOnly: boolean;
  status: ImportStatus;
  target: string | null;
  reason: string | null;
}

export interface SkippedFile {
  path: string;
  reason: string;
  detail: string;
}

export interface ImportCounts {
  found: number;
  resolved: number;
  external: number;
  excluded: number;
  unresolved: number;
}

export interface ParserCoverage {
  filesFound: number;
  filesParsed: number;
  filesSkipped: number;
  folders: number;
  skipped: SkippedFile[];
  imports: ImportCounts;
  byKind: Record<ImportKind, ImportCounts>;
  /** Complete occurrence ledger, including every failure rather than a sampled count. */
  records: ImportRecord[];
}

export interface ParserResult {
  schemaVersion: 1;
  repository: string;
  adapter: string;
  files: ParsedFile[];
  edges: ParsedEdge[];
  coverage: ParserCoverage;
}

export interface AdapterFile {
  path: string;
  folder: string;
  module: "module" | "script";
  contents: string;
}

/** Syntax extraction and resolution do not depend on adapter classifications. */
export interface FrameworkAdapter {
  name: string;
  classify(file: Readonly<AdapterFile>): string | null;
}
