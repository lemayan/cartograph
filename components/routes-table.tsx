"use client";
import type { ParsedRoute } from "@/lib/parser/types";
import type { MapSelection } from "@/lib/map/scene";

export function RoutesTable({ routes, sourceBase, onSelect }: {
  routes: ParsedRoute[] | undefined; sourceBase?: string; onSelect: (selection: MapSelection) => void;
}) {
  return <div className="map-routes">
    <p className="map-routes-note">Only recovered methods and complete patterns are listed. Source links use the analysed commit.</p>
    <table className="map-routes-table"><caption className="sr-only">Recovered framework routes</caption>
      <thead><tr><th scope="col">Method</th><th scope="col">Pattern</th><th scope="col">Source</th></tr></thead>
      <tbody>{(routes ?? []).map((route) => <tr key={JSON.stringify(route)}>
        <td><code>{route.method}</code></td><td><code>{route.path}</code></td>
        <td><button type="button" data-map-file={route.file} onClick={() => onSelect({ type: "file", path: route.file })}><code>{route.file}:{route.line}</code></button>
          {sourceBase && <a href={`${sourceBase}${route.file.split("/").map(encodeURIComponent).join("/")}#L${route.line}`}
            target="_blank" rel="noopener noreferrer" aria-label={`Open ${route.file}, line ${route.line}, at the analysed commit`}>View source</a>}
        </td>
      </tr>)}</tbody>
    </table>
    {!routes?.length && <p className="map-routes-empty">{routes === undefined ? "This saved analysis predates route extraction. Re-run the repository to detect its framework and routes." : "No complete framework route patterns were recovered."}</p>}
  </div>;
}
