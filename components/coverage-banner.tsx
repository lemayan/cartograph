import type { ParserCoverage } from "@/lib/parser/types";

export function CoverageBanner({ coverage }: { coverage: ParserCoverage }) {
  const percent = coverage.filesFound === 0 ? null : 100 * coverage.filesParsed / coverage.filesFound;
  // Rounding must not let a partial graph look complete.
  const figure = percent === null ? "No files found" : `${Math.floor(percent * 10) / 10}% of discovered files parsed`;
  const partial = coverage.filesSkipped > 0 || coverage.imports.unresolved > 0 || coverage.imports.excluded > 0;
  const omitted = coverage.records.filter((record) => record.status === "unresolved" || record.status === "excluded");
  return <details className={`coverage-banner${partial ? " coverage-partial" : ""}`}>
    <summary><strong>{partial ? "Partial graph" : "Parser coverage"}</strong><span>{figure}</span>
      <span>{coverage.imports.unresolved} unresolved imports</span></summary>
    <div className="coverage-body">
      <p>{coverage.filesParsed} parsed / {coverage.filesFound} found; {coverage.filesSkipped} skipped. The percentage counts discovered files, including excluded and unsupported files; it does not measure resolved imports.</p>
      <p>{coverage.imports.resolved} resolved / {coverage.imports.found} import occurrences found, {coverage.imports.external} external, {coverage.imports.excluded} excluded, {coverage.imports.unresolved} unresolved. This includes require calls. External packages are outside this repository’s map.</p>
      {coverage.skipped.length > 0 && <details><summary>Skipped files ({coverage.skipped.length})</summary>
        <ul className="coverage-ledger">{coverage.skipped.map((file) => <li key={file.path}><code>{file.path}</code><span>{file.reason}: {file.detail}</span></li>)}</ul>
      </details>}
      {omitted.length > 0 && <details><summary>Imports without graph edges ({omitted.length})</summary>
        <ul className="coverage-ledger">{omitted.map((record, index) => <li key={index}>
          <code>{record.source}:{record.line}:{record.column}</code><code>{record.expression}</code>
          <span>{record.status}: {record.reason}</span>
        </li>)}</ul>
      </details>}
    </div>
  </details>;
}
