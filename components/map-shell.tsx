"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DependencyMap } from "./dependency-map";
import { MapDetails } from "./map-details";
import { repositoryDetails } from "@/lib/map/details";
import { createHoverController, createHoverStore } from "@/lib/map/hover";
import { MapHoverProvider } from "./map-hover";
import type { MapSelection } from "@/lib/map/scene";
import { foldFolders } from "@/lib/map/folding";
import type { ParserResult } from "@/lib/parser/types";
import { frameworkCategories, frameworkLabel, roleFiles } from "@/lib/adapters/taxonomy";
import { RoutesTable } from "./routes-table";
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

export function MapShell({ result, sourceBase }: { result: ParserResult; sourceBase?: string }) {
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "routes">("map");
  const matches = useMemo(() => roleFiles(result.files, result.adapter, category), [result.files, result.adapter, category]);
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
  const categories = frameworkCategories(result.adapter).map((role) => ({ ...role, count: roleFiles(result.files, result.adapter, role.id)?.size ?? 0 }));
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
          <h2 id="map-categories-heading">{frameworkLabel(result.adapter)}</h2>
          <span className="map-category-total">{result.files.length} files</span>
        </header>
        <div className="map-shell-body">
          <ul className="map-categories">
            {categories.map(({ id, label, count }) => (
              <li key={id}>
                <button type="button" aria-pressed={category === id}
                  aria-label={`${label}, ${count} files${category === id ? ", click to clear category" : ""}`}
                  onClick={() => setCategory((previous) => previous === id ? null : id)}>
                  <span className="map-category-swatch" data-role={id} aria-hidden="true" />
                  <span className="map-category-label">{label}</span>
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
          <div className="map-view-controls" role="group" aria-label="Repository view">
            <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}>Map</button>
            <button type="button" aria-pressed={view === "routes"} onClick={() => setView("routes")}>Routes {result.routes?.length ?? "—"}</button>
          </div>
          <code className="map-repository-name" title={result.repository}>{result.repository}</code>
          <span className="map-folder-count">{folded.folders.length} folders</span>
        </header>
        <div className="map-shell-body map-canvas-body" hidden={view !== "map"}><DependencyMap files={result.files} edges={result.edges}
          selection={selection} onSelect={setSelection} categoryMatches={matches} /></div>
        <div className="map-shell-body" hidden={view !== "routes"}><RoutesTable routes={result.routes} sourceBase={sourceBase} onSelect={setSelection} /></div>
      </section>
      <MapDetails result={result} folders={folded.folders} details={details} selection={selection}
        onSelect={setSelection} insights={insights} categoryMatches={matches} />
    </div>
    </MapHoverProvider>
  );
}
