"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ParserResult, ParsedFile } from "@/lib/parser/types";
import { frameworkLabel } from "@/lib/adapters/taxonomy";
import type { FoldedFolder } from "@/lib/map/folding";
import type { MapSelection } from "@/lib/map/scene";
import { countFileKinds, selectionFiles, type RepositoryDetails } from "@/lib/map/details";
import { useMapHover } from "./map-hover";
import { insightSentences, walkDependencies, type RepositoryInsights, type WalkDirection } from "@/lib/graph/analysis";
import "./map-details.css";

type Tab = "structure" | "explanation";
interface DetailProps {
  result: ParserResult;
  folders: FoldedFolder[];
  details: RepositoryDetails;
  selection: MapSelection | null;
  onSelect: (selection: MapSelection) => void;
  insights: RepositoryInsights;
  categoryMatches: ReadonlySet<string> | null;
}

export function MapDetails({ result, folders, details, selection, onSelect, insights, categoryMatches }: DetailProps) {
  const hover = useMapHover();
  const [tab, setTab] = useState<Tab>("structure");
  const [showCoverage, setShowCoverage] = useState(false);
  const [walk, setWalk] = useState<{ path: string; direction: WalkDirection; depth: number } | null>(null);
  const structureRef = useRef<HTMLButtonElement>(null);
  const explanationRef = useRef<HTMLButtonElement>(null);
  const hoveredFiles = selectionFiles(hover, folders);
  const file = selection?.type === "file" ? details.files.get(selection.path) : undefined;
  const folder = selection?.type === "folder" ? folders.find((item) => item.path === selection.path) : undefined;
  const activeWalk = file && walk?.path === file.file.path ? walk : null;
  const walkedFiles = useMemo(() => activeWalk === null ? []
    : walkDependencies(result.files, result.edges, activeWalk.path, activeWalk.direction, activeWalk.depth), [result, activeWalk]);
  if (selection && !file && !folder) throw new Error(`Absent detail selection: ${selection.path}`);

  function switchTab(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "structure" : event.key === "End" ? "explanation"
      : tab === "structure" ? "explanation" : "structure";
    setTab(next);
    (next === "structure" ? structureRef : explanationRef).current?.focus();
  }

  function pathButton(item: ParsedFile, count?: number, direction: "incoming" | "outgoing" = "incoming", compact = false, fact?: string) {
    const slash = item.path.lastIndexOf("/");
    return (
      <button type="button" className={`map-detail-path${compact ? " map-summary-path" : ""}`} data-hovered={hoveredFiles.has(item.path)}
        data-category-dimmed={categoryMatches !== null && !categoryMatches.has(item.path)}
        data-map-file={item.path}
        aria-pressed={selection?.type === "file" && selection.path === item.path}
        aria-label={`${item.path}${count === undefined ? "" : direction === "incoming" ? `, ${count} files importing it` : `, ${count} files imported`}${fact ? `, ${fact}` : ""}`}
        title={item.path} onClick={() => onSelect({ type: "file", path: item.path })}>
        <code>{compact && slash >= 0 ? <><span className="map-path-directory">{item.path.slice(0, slash + 1)}</span><span className="map-path-filename">{item.path.slice(slash + 1)}</span></> : item.path}</code>
        {count !== undefined && <span className={`map-detail-count map-${direction}`} aria-hidden="true">{direction === "incoming" ? `←${count}` : `${count}→`}</span>}
        {fact && <span className="map-detail-count">{fact}</span>}
      </button>
    );
  }

  function fileList(title: string, items: ParsedFile[], direction?: "incoming" | "outgoing") {
    return (
      <section className="map-detail-section">
        <h3 className={direction ? `map-${direction}` : undefined}>{title}<span>{categoryMatches === null ? items.length
          : `${items.filter((item) => categoryMatches.has(item.path)).length} / ${items.length} matched`}</span></h3>
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
                  <p><span>Framework</span> {frameworkLabel(result.adapter)}</p>
                </div>
                <button className="map-summary-info" type="button" aria-label="Repository coverage details"
                  aria-expanded={showCoverage} aria-controls="map-summary-coverage" onClick={() => setShowCoverage((previous) => !previous)}>
                  <span aria-hidden="true">i</span>
                </button>
              </section>
              <dl className="map-summary-stats">
                <div><dt>Files</dt><dd>{result.files.length}</dd><dd className="map-summary-subcount">{result.coverage.filesSkipped} skipped</dd></div>
                <div title="Resolved imports between repository files"><dt>Imports</dt><dd>{details.importCount}</dd><dd className="map-summary-subcount">{result.coverage.imports.unresolved} unresolved</dd></div>
                <div><dt>Routes</dt><dd>{result.routes?.length ?? "—"}</dd><dd className="map-summary-subcount">{result.routes === undefined ? "not extracted" : "recovered patterns"}</dd></div>
              </dl>
              <div id="map-summary-coverage" className="map-summary-coverage" hidden={!showCoverage}>
                <dl className="map-detail-facts">
                  <div><dt>Files found</dt><dd>{result.coverage.filesFound}</dd></div>
                  <div><dt>Import occurrences</dt><dd>{result.coverage.imports.found}</dd></div>
                  <div><dt>External imports</dt><dd>{result.coverage.imports.external}</dd></div>
                  <div><dt>Excluded imports</dt><dd>{result.coverage.imports.excluded}</dd></div>
                </dl>
                <p className="map-detail-note">Imports counts resolved connections between files. The Routes view lists only complete recovered patterns.</p>
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
              <p className="map-summary-unknown">{details.unknownCount} generic files</p>
            </>
          )}
          {file && (
            <>
              <section className="map-detail-section">
                <h3>File</h3>{pathButton(file.file)}
                <dl className="map-detail-facts">
                  <div><dt>Kind</dt><dd>{file.file.kind ?? "Generic"}</dd></div>
                  <div><dt>Lines</dt><dd>{file.file.lines}</dd></div>
                  <div><dt>Imports</dt><dd className="map-outgoing">{file.imports.length}</dd></div>
                  <div><dt>Dependents</dt><dd className="map-incoming">{file.dependents.length}</dd></div>
                </dl>
              </section>
              <section className="map-detail-section">
                <div className="map-walk-actions" aria-label="Explore dependencies">
                  {([ ["incoming", "Blast radius"], ["outgoing", "Dependency chain"] ] as const).map(([direction, label]) => (
                    <button key={direction} type="button" aria-pressed={activeWalk?.direction === direction}
                      onClick={() => setWalk({ path: file.file.path, direction, depth: activeWalk?.depth ?? 2 })}>{label}</button>
                  ))}
                </div>
                {activeWalk && <>
                  <label className="map-walk-depth">Levels deep
                    <input type="number" min={1} max={Math.max(2, result.files.length)} value={activeWalk.depth}
                      onChange={(event) => {
                        const depth = event.currentTarget.valueAsNumber;
                        if (Number.isSafeInteger(depth) && depth >= 1 && depth <= Math.max(2, result.files.length)) setWalk({ ...activeWalk, depth });
                      }} />
                  </label>
                  <h3 className={`map-${activeWalk.direction}`}>{activeWalk.direction === "incoming" ? "Blast radius" : "Dependency chain"}<span>{walkedFiles.length}</span></h3>
                  <p className="map-detail-note">{activeWalk.direction === "incoming" ? "Files that depend on this file, through resolved imports."
                    : "Files this file depends on, through resolved imports."}</p>
                  {walkedFiles.length ? <ul className="map-detail-list">{walkedFiles.map((entry) => <li key={entry.file.path}>
                    {pathButton(entry.file, undefined, activeWalk.direction, false, `Depth ${entry.depth}`)}
                  </li>)}</ul> : <p className="map-detail-empty">None within {activeWalk.depth} levels.</p>}
                </>}
              </section>
              {fileList("Imports", file.imports, "outgoing")}
              {fileList("Dependents", file.dependents, "incoming")}
            </>
          )}
          {folder && (
            <>
              <section className="map-detail-section">
                <h3>Folder</h3><code className="map-detail-name">{folder.path}</code>
                <dl className="map-detail-facts"><div><dt>Files</dt><dd>{folder.files.length}</dd></div>
                  {categoryMatches !== null && <div><dt>Category matches</dt><dd>{folder.files.filter((item) => categoryMatches.has(item.path)).length}</dd></div>}
                </dl>
              </section>
              <section className="map-detail-section">
                <h3>File kinds</h3>
                <dl className="map-detail-facts">{countFileKinds(folder.files).map(({ kind, count }) => (
                  <div key={kind ?? "unknown"}><dt>{kind ?? "Generic"}</dt><dd>{count}</dd></div>
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
        <details className="map-insights">
          <summary>Insights <span>From parsed files and imports</span></summary>
          <section className="map-detail-section">
            <h3>Imported by nothing<span>{insights.unimported.length}</span></h3>
            <p className="map-detail-note">{insightSentences.unimported}</p>
            <p className="map-detail-note">Framework entry conventions and config files are excluded. This does not mean unused.</p>
            {insights.unimported.length ? <ul className="map-detail-list">{insights.unimported.map((item) => <li key={item.path}>{pathButton(item)}</li>)}</ul>
              : <p className="map-detail-empty">None.</p>}
          </section>
          <section className="map-detail-section">
            <h3>Many importers<span>{insights.highlyImported.length}</span></h3>
            <p className="map-detail-note">{insightSentences.highlyImported}</p>
            <p className="map-detail-note">At least 10 importers and more than twice the repository average ({insights.averageFanIn.toFixed(1)}).</p>
            {insights.highlyImported.length ? <ul className="map-detail-list">{insights.highlyImported.map((item) => <li key={item.file.path}>{pathButton(item.file, item.importers)}</li>)}</ul>
              : <p className="map-detail-empty">None.</p>}
          </section>
          <section className="map-detail-section">
            <h3>Import cycles<span>{insights.cycles.length} groups</span></h3>
            <p className="map-detail-note">{insightSentences.cycles}</p>
            <p className="map-detail-note">Each group shows one closed import path. A group can contain more than one cycle.</p>
            {insights.cycles.length ? insights.cycles.map((cycle) => <details className="map-cycle" key={cycle.files[0].path}>
              <summary>{cycle.files.length} files <code>{cycle.files[0].path}</code></summary>
              <h4>Import path, returning to its first file</h4>
              <ol className="map-detail-list map-cycle-path">{cycle.witness.map((path, index) => {
                const item = details.files.get(path);
                if (!item) throw new Error(`Absent cycle file: ${path}`);
                return <li key={`${index}:${path}`}>{pathButton(item.file)}</li>;
              })}</ol>
              <h4>All files in this group</h4>
              <ul className="map-detail-list">{cycle.files.map((item) => <li key={item.path}>{pathButton(item)}</li>)}</ul>
            </details>) : <p className="map-detail-empty">None.</p>}
          </section>
          <section className="map-detail-section">
            <h3>Long files<span>{insights.longFiles.length}</span></h3>
            <p className="map-detail-note">{insightSentences.longFiles}</p>
            {insights.longFiles.length ? <ul className="map-detail-list">{insights.longFiles.map((item) => <li key={item.path}>{pathButton(item, undefined, "incoming", false, `${item.lines} lines`)}</li>)}</ul>
              : <p className="map-detail-empty">None.</p>}
          </section>
        </details>
      </div>
    </aside>
  );
}
