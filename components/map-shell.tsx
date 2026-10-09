"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DependencyMap } from "./dependency-map";
import { MapDetails } from "./map-details";
import { repositoryDetails } from "@/lib/map/details";
import { createHoverController, createHoverStore } from "@/lib/map/hover";
import { MapHoverProvider } from "./map-hover";
import type { MapSelection } from "@/lib/map/scene";
import { foldFolders } from "@/lib/map/folding";
import { compare } from "@/lib/parser/graph";
import type { ParserResult } from "@/lib/parser/types";
import { categoryFiles } from "@/lib/map/categories";
import { repositoryInsights } from "@/lib/graph/analysis";
import { frameworkEntryFiles } from "@/lib/adapters/entry-files";
import "./map-shell.css";

function hoverTarget(target: EventTarget | null, root: HTMLElement): MapSelection | null {
  if (!(target instanceof Element)) return null;
  const owner = target.closest<HTMLElement>("[data-map-file], [data-map-folder]");
  if (!owner || !root.contains(owner)) return null;
  if (owner.dataset.mapFile !== undefined) return { type: "file", path: owner.dataset.mapFile };
  if (owner.dataset.mapFolder !== undefined) return { type: "folder", path: owner.dataset.mapFolder };
  return null;
}

export function MapShell({ result }: { result: ParserResult }) {
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const matches = useMemo(() => categoryFiles(result.files, category), [result.files, category]);
  const insights = useMemo(() => repositoryInsights(result.files, result.edges, frameworkEntryFiles(result.files)), [result]);
  const folded = useMemo(() => foldFolders(result.files, result.edges), [result]);
  const hoverStore = useMemo(() => createHoverStore(folded.folders), [folded]);
  const hoverController = useMemo(() => createHoverController(hoverStore.set, {
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (frame) => window.cancelAnimationFrame(frame),
  }), [hoverStore]);
  const keyboardHover = useRef(false);
  useEffect(() => {
    const clear = () => hoverController.queue(null);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("blur", clear);
      hoverController.cancel();
    };
  }, [hoverController]);
  const details = useMemo(() => repositoryDetails(result.files, result.edges), [result]);
  const categories = new Map<string, number>();
  for (const file of result.files) {
    categories.set(file.extension, (categories.get(file.extension) ?? 0) + 1);
  }
  const sortedCategories = [...categories].sort(([a, countA], [b, countB]) => countB - countA || compare(a, b));
  return (
    <MapHoverProvider value={hoverStore}>
    <div className="map-shell"
      onPointerOver={(event) => {
        if (event.pointerType === "touch") return;
        keyboardHover.current = false;
        hoverController.queue(hoverTarget(event.target, event.currentTarget));
      }}
      onPointerOut={(event) => {
        if (event.pointerType === "touch") return;
        keyboardHover.current = false;
        hoverController.queue(hoverTarget(event.relatedTarget, event.currentTarget));
      }}
      onPointerLeave={(event) => { if (event.pointerType !== "touch") hoverController.queue(null); }}
      onPointerCancel={() => hoverController.queue(null)}
      onPointerDownCapture={() => { keyboardHover.current = false; }}
      onFocusCapture={(event) => {
        keyboardHover.current = event.target.matches(":focus-visible");
        if (keyboardHover.current) hoverController.queue(hoverTarget(event.target, event.currentTarget));
      }}
      onBlurCapture={(event) => {
        if (keyboardHover.current) hoverController.queue(hoverTarget(event.relatedTarget, event.currentTarget));
      }}>
      <aside className="map-shell-pane" aria-labelledby="map-categories-heading">
        <header className="map-shell-heading">
          <h2 id="map-categories-heading">File categories</h2>
          <span className="map-category-total">{result.files.length} files</span>
        </header>
        <div className="map-shell-body">
          <ul className="map-categories">
            {sortedCategories.map(([extension, count]) => (
              <li key={extension}>
                <button type="button" aria-pressed={category === extension}
                  aria-label={`${extension}, ${count} files${category === extension ? ", click to clear category" : ""}`}
                  onClick={() => setCategory((previous) => previous === extension ? null : extension)}>
                  <span className="map-category-swatch" data-extension={extension} aria-hidden="true" />
                  <code>{extension}</code>
                  <span className="map-category-count">{count}</span>
                </button>
              </li>
            ))}
          </ul>
          {category !== null && <button className="map-category-clear" type="button" onClick={() => setCategory(null)}>Clear category</button>}
        </div>
      </aside>
      <section className="map-shell-pane map-shell-canvas" aria-labelledby="map-canvas-heading">
        <header className="map-shell-heading">
          <h2 id="map-canvas-heading">Map</h2>
          <code className="map-repository-name" title={result.repository}>{result.repository}</code>
          <span className="map-folder-count">{folded.folders.length} folders</span>
        </header>
        <div className="map-shell-body map-canvas-body"><DependencyMap files={result.files} edges={result.edges}
          selection={selection} onSelect={setSelection} categoryMatches={matches} /></div>
      </section>
      <MapDetails result={result} folders={folded.folders} details={details} selection={selection}
        onSelect={setSelection} insights={insights} categoryMatches={matches} />
    </div>
    </MapHoverProvider>
  );
}
