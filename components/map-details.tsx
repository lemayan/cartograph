"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { ParserResult, ParsedFile } from "@/lib/parser/types";
import type { FoldedFolder } from "@/lib/map/folding";
import type { MapSelection } from "@/lib/map/scene";
import { countFileKinds, selectionFiles, type RepositoryDetails } from "@/lib/map/details";
import { useMapHover } from "./map-hover";
import "./map-details.css";

type Tab = "structure" | "explanation";
interface DetailProps {
  result: ParserResult;
  folders: FoldedFolder[];
  details: RepositoryDetails;
  selection: MapSelection | null;
  onSelect: (selection: MapSelection) => void;
}

export function MapDetails({ result, folders, details, selection, onSelect }: DetailProps) {
  const hover = useMapHover();
  const [tab, setTab] = useState<Tab>("structure");
  const [showCoverage, setShowCoverage] = useState(false);
  const structureRef = useRef<HTMLButtonElement>(null);
  const explanationRef = useRef<HTMLButtonElement>(null);
  const hoveredFiles = selectionFiles(hover, folders);
  const file = selection?.type === "file" ? details.files.get(selection.path) : undefined;
  const folder = selection?.type === "folder" ? folders.find((item) => item.path === selection.path) : undefined;
  if (selection && !file && !folder) throw new Error(`Absent detail selection: ${selection.path}`);

  function switchTab(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "structure" : event.key === "End" ? "explanation"
      : tab === "structure" ? "explanation" : "structure";
    setTab(next);
    (next === "structure" ? structureRef : explanationRef).current?.focus();
  }

  function pathButton(item: ParsedFile, count?: number, direction: "incoming" | "outgoing" = "incoming", compact = false) {
    const slash = item.path.lastIndexOf("/");
    return (
      <button type="button" className={`map-detail-path${compact ? " map-summary-path" : ""}`} data-hovered={hoveredFiles.has(item.path)}
        data-map-file={item.path}
        aria-pressed={selection?.type === "file" && selection.path === item.path}
        aria-label={`${item.path}${count === undefined ? "" : direction === "incoming" ? `, ${count} files importing it` : `, ${count} files imported`}`}
        title={item.path} onClick={() => onSelect({ type: "file", path: item.path })}>
        <code>{compact && slash >= 0 ? <><span className="map-path-directory">{item.path.slice(0, slash + 1)}</span><span className="map-path-filename">{item.path.slice(slash + 1)}</span></> : item.path}</code>
        {count !== undefined && <span className={`map-detail-count map-${direction}`} aria-hidden="true">{direction === "incoming" ? `←${count}` : `${count}→`}</span>}
      </button>
    );
  }

  function fileList(title: string, items: ParsedFile[], direction?: "incoming" | "outgoing") {
    return (
      <section className="map-detail-section">
        <h3 className={direction ? `map-${direction}` : undefined}>{title}<span>{items.length}</span></h3>
        {items.length ? <ul className="map-detail-list">{items.map((item) => <li key={item.path}>{pathButton(item)}</li>)}</ul>
          : <p className="map-detail-empty">None.</p>}
      </section>
    );
  }

  return (
    <aside className="map-shell-pane map-details" aria-labelledby={!selection ? "map-summary-name" : "map-details-heading"}>
      {selection && <header className="map-shell-heading"><h2 id="map-details-heading">Details</h2></header>}
      <div className="map-detail-tabs" role="tablist" aria-label="Detail view" hidden={!selection}>
        <button ref={structureRef} id="map-structure-tab" type="button" role="tab" aria-selected={tab === "structure"}
          aria-controls="map-structure-panel" tabIndex={tab === "structure" ? 0 : -1}
          onClick={() => setTab("structure")} onKeyDown={switchTab}>Structure</button>
        <button ref={explanationRef} id="map-explanation-tab" type="button" role="tab" aria-selected={tab === "explanation"}
          aria-controls="map-explanation-panel" tabIndex={tab === "explanation" ? 0 : -1}
          onClick={() => setTab("explanation")} onKeyDown={switchTab}>Explanation</button>
      </div>
      <div className="map-shell-body map-detail-body">
        <div id="map-structure-panel" role="tabpanel" aria-labelledby={selection ? "map-structure-tab" : "map-summary-name"}
          hidden={selection !== null && tab !== "structure"}>
          {!selection && (
            <>
              <section className="map-summary-heading">
                <div>
                  <h2 id="map-summary-name"><code>{result.repository}</code></h2>
                  <p><span>Framework</span> {result.adapter === "none" ? "none detected" : result.adapter}</p>
                </div>
                <button className="map-summary-info" type="button" aria-label="Repository coverage details"
                  aria-expanded={showCoverage} aria-controls="map-summary-coverage" onClick={() => setShowCoverage((previous) => !previous)}>
                  <span aria-hidden="true">i</span>
                </button>
              </section>
              <dl className="map-summary-stats">
                <div><dt>Files</dt><dd>{result.files.length}</dd><dd className="map-summary-subcount">{result.coverage.filesSkipped} skipped</dd></div>
                <div title="Resolved imports between repository files"><dt>Imports</dt><dd>{details.importCount}</dd><dd className="map-summary-subcount">{result.coverage.imports.unresolved} unresolved</dd></div>
                <div><dt>Routes</dt><dd aria-label="Not available">—</dd><dd className="map-summary-subcount">no adapter</dd></div>
              </dl>
              <div id="map-summary-coverage" className="map-summary-coverage" hidden={!showCoverage}>
                <dl className="map-detail-facts">
                  <div><dt>Files found</dt><dd>{result.coverage.filesFound}</dd></div>
                  <div><dt>Import occurrences</dt><dd>{result.coverage.imports.found}</dd></div>
                  <div><dt>External imports</dt><dd>{result.coverage.imports.external}</dd></div>
                  <div><dt>Excluded imports</dt><dd>{result.coverage.imports.excluded}</dd></div>
                </dl>
                <p className="map-detail-note">Imports counts resolved connections between files. Route information is not present in this analysis.</p>
              </div>
              <section className="map-summary-section">
                <h3><span>Most depended on <small>by files importing it</small></span><span>{details.mostImported.length}</span></h3>
                {details.mostImported.length ? <ol className="map-summary-list">
                  {details.mostImported.slice(0, 10).map((item) => <li key={item.file.path}>{pathButton(item.file, item.dependents.length, "incoming", true)}</li>)}
                </ol> : <p className="map-detail-empty">No files have dependents.</p>}
                {details.mostImported.length > 10 && <p className="map-summary-more">{details.mostImported.length - 10} more not listed</p>}
              </section>
              <section className="map-summary-section">
                <h3><span>Imported by nothing <small>where reading starts</small></span><span>{details.startingPoints.length}</span></h3>
                {details.startingPoints.length ? <ol className="map-summary-list">
                  {details.startingPoints.slice(0, 10).map((item) => <li key={item.file.path}>{pathButton(item.file, item.imports.length, "outgoing", true)}</li>)}
                </ol> : <p className="map-detail-empty">Every file has an incoming import.</p>}
                {details.startingPoints.length > 10 && <p className="map-summary-more">{details.startingPoints.length - 10} more not listed</p>}
              </section>
              <p className="map-summary-unknown">{details.unknownCount} files with unknown kind</p>
            </>
          )}
          {file && (
            <>
              <section className="map-detail-section">
                <h3>File</h3>{pathButton(file.file)}
                <dl className="map-detail-facts">
                  <div><dt>Kind</dt><dd>{file.file.kind ?? "Unknown"}</dd></div>
                  <div><dt>Lines</dt><dd>{file.file.lines}</dd></div>
                  <div><dt>Imports</dt><dd className="map-outgoing">{file.imports.length}</dd></div>
                  <div><dt>Dependents</dt><dd className="map-incoming">{file.dependents.length}</dd></div>
                </dl>
              </section>
              {fileList("Imports", file.imports, "outgoing")}
              {fileList("Dependents", file.dependents, "incoming")}
            </>
          )}
          {folder && (
            <>
              <section className="map-detail-section">
                <h3>Folder</h3><code className="map-detail-name">{folder.path}</code>
                <dl className="map-detail-facts"><div><dt>Files</dt><dd>{folder.files.length}</dd></div></dl>
              </section>
              <section className="map-detail-section">
                <h3>File kinds</h3>
                <dl className="map-detail-facts">{countFileKinds(folder.files).map(({ kind, count }) => (
                  <div key={kind ?? "unknown"}><dt>{kind ?? "Unknown"}</dt><dd>{count}</dd></div>
                ))}</dl>
              </section>
              {fileList("Files", folder.files)}
            </>
          )}
        </div>
        <div id="map-explanation-panel" role="tabpanel" aria-labelledby="map-explanation-tab" hidden={!selection || tab !== "explanation"}>
          <section className="map-detail-section">
            <h3>Explanation</h3>
            <p className="map-detail-empty">No explanation has been generated.</p>
            {file && pathButton(file.file)}
            {folder && <code className="map-detail-name">{folder.path}</code>}
            {!selection && <p className="map-detail-name">{result.repository}</p>}
          </section>
        </div>
      </div>
    </aside>
  );
}
