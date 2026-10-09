import path from "node:path";
import { readParserResult, validateParserResult, writeParserResult } from "../lib/parser/data";
import { parseRepository } from "../lib/parser/parse";
import type { ParserResult } from "../lib/parser/types";

function report(result: ParserResult): void {
  const coverage = result.coverage;
  console.log(`Repository: ${result.repository} | schema ${result.schemaVersion} | adapter ${result.adapter}`);
  console.log(`Files found: ${coverage.filesFound} | parsed: ${coverage.filesParsed} | skipped: ${coverage.filesSkipped} | distinct folders: ${coverage.folders}`);
  console.log(`Edges: ${result.edges.length} (unique ordered file pairs)`);
  const skips = new Map<string, { count: number; example: string }>();
  for (const skip of coverage.skipped) {
    const existing = skips.get(skip.reason);
    skips.set(skip.reason, { count: (existing?.count ?? 0) + 1, example: existing?.example ?? skip.path });
  }
  for (const [reason, summary] of skips) console.log(`Skipped ${summary.count}: ${reason} (example: ${summary.example})`);
  for (const [kind, count] of Object.entries({ total: coverage.imports, ...coverage.byKind })) {
    console.log(`${kind}: found ${count.found} | resolved ${count.resolved} | external ${count.external} | excluded ${count.excluded} | unresolved ${count.unresolved}`);
  }
  const failures = coverage.records.filter((record) => record.status === "unresolved");
  for (const record of failures.slice(0, 20)) console.log(`Unresolved ${record.source}:${record.line}:${record.column} ${record.expression}: ${record.reason}`);
  if (failures.length > 20) console.log(`${failures.length - 20} further unresolved imports; all occurrences are retained in the JSON ledger.`);
  const gaps = coverage.records.filter((record) => record.kind === "re-export" && record.status !== "resolved");
  for (const record of gaps.slice(0, 20)) console.log(`Re-export gap ${record.source}:${record.line} ${record.expression}: ${record.status} / ${record.reason}`);
  if (gaps.length > 20) console.log(`${gaps.length - 20} further re-export gaps; all reasons are retained in the JSON ledger.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("pnpm parser <directory> [--out <file.json>]\npnpm parser --read <file.json>");
    return;
  }
  if (args.length === 2 && args[0] === "--read") {
    report(await readParserResult(args[1]));
    console.log("Readback validated: shape, coverage, endpoints, import provenance, folders, and fan counts.");
    return;
  }
  if (!((args.length === 1 || (args.length === 3 && args[1] === "--out")) && !args[0].startsWith("--"))) {
    throw new Error("Usage: pnpm parser <directory> [--out <file.json>] | pnpm parser --read <file.json>");
  }
  const result = validateParserResult(await parseRepository(args[0]));
  report(result);
  if (args[2]) {
    await writeParserResult(args[2], result);
    const readback = await readParserResult(args[2]);
    if (JSON.stringify(readback) !== JSON.stringify(result)) throw new Error("Written result changed during readback");
    console.log(`Wrote ${path.resolve(args[2])}; typed readback and full equality passed.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
