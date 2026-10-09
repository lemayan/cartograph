import type { ImportCounts, ImportRecord } from "./types";

export function emptyImportCounts(): ImportCounts {
  return { found: 0, resolved: 0, external: 0, excluded: 0, unresolved: 0 };
}

export function countImports(records: readonly ImportRecord[]): ImportCounts {
  const counts = emptyImportCounts();
  for (const record of records) {
    counts.found++;
    counts[record.status]++;
  }
  return counts;
}
