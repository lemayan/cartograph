"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider,
  getBezierPath, useReactFlow, useStore, useUpdateNodeInternals,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import { foldFolders } from "@/lib/map/folding";
import { layoutScene } from "@/lib/map/layout";
import { useFolderHover } from "./map-hover";
import { createScene, expectedHandles, panelHeaderHeight, panelRowLimit, rowHandle, rowPortTop, scrollScene, selectionDirection, selectionHighlight, selectionVisibility, type MapSelection, type SceneNode } from "@/lib/map/scene";
import type { ParsedEdge, ParsedFile } from "@/lib/parser/types";
import "@xyflow/react/dist/style.css";
import "./dependency-map.css";

type FolderData = {
  scene: SceneNode;
  highlightedRows: ReadonlySet<string> | null;
  dimmed: boolean;
  aboveBright: boolean;
  belowBright: boolean;
  selection: MapSelection | null;
  onToggle: (id: string) => void;
  onSelect: (selection: MapSelection) => void;
  onScroll: (id: string, scrollTop: number) => void;
};
type FolderNode = Node<FolderData, "folder">;
type ImportEdge = Edge<{ imports: ParsedEdge[]; loopTop: number | null }, "import">;

function Ports({ incoming, outgoing }: { incoming: string; outgoing: string }) {
  return (
    <>
      <Handle id={incoming} type="target" position={Position.Left} isConnectable={false} />
      <Handle id={outgoing} type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

function FolderNodeView({ id, data }: NodeProps<FolderNode>) {
  const { scene, highlightedRows, dimmed, selection, onToggle, onSelect, onScroll } = data;
  const hover = useFolderHover(scene.folder.path);
  const hovered = hover !== null;
  const hoveredFile = hover?.type === "file" ? hover.path : null;
  const hoveredIndex = hoveredFile === null ? -1 : scene.folder.files.findIndex((file) => file.path === hoveredFile);
  const aboveBright = data.aboveBright || (hoveredIndex >= 0 && hoveredIndex < scene.rowStart);
  const belowBright = data.belowBright || (hoveredIndex >= scene.rowEnd && hoveredIndex >= 0);
  const updateNodeInternals = useUpdateNodeInternals();
  const handleKey = expectedHandles(scene, "in").join("|");
  useLayoutEffect(() => { updateNodeInternals(id); }, [id, handleKey, scene.scrollTop, updateNodeInternals]);
  const selected = selection?.type === "folder" ? selection.path === scene.folder.path
    : selection?.type === "file" && scene.folder.files.some((file) => file.path === selection.path);
  const metrics = (
    <span className="map-node-metrics">
      <span>{scene.folder.files.length} files</span>
      <span className="map-incoming" title="Distinct files outside this group importing its files" aria-label={`Fan-in ${scene.folder.fanIn}`}>←{scene.folder.fanIn}</span>
      <span className="map-outgoing" title="Distinct files outside this group imported by its files" aria-label={`Fan-out ${scene.folder.fanOut}`}>{scene.folder.fanOut}→</span>
    </span>
  );
  return (
    <div className={`map-module${scene.expanded ? " map-module-open" : ""}${selected ? " map-module-selected" : ""}${hovered ? " map-module-hovered" : ""}`}
      data-dimmed={dimmed} data-hover-kind={hover?.type}
      data-map-folder={scene.folder.path}>
      <button
        className={`map-module-toggle nodrag nopan${scene.expanded ? " map-panel-header" : ""}`}
        type="button" aria-expanded={scene.expanded}
        aria-label={`${scene.expanded ? "Close" : "Open"} ${scene.folder.path}, ${scene.folder.files.length} files, fan-in ${scene.folder.fanIn}, fan-out ${scene.folder.fanOut}`}
        title={scene.folder.path} onClick={(event) => { event.stopPropagation(); onToggle(id); }}
      >
        <span className="map-node-title"><code>{scene.label}</code><span aria-hidden="true">{scene.expanded ? "−" : "+"}</span></span>
        {metrics}
      </button>
      {!scene.expanded && <Ports incoming="in" outgoing="out" />}
      {scene.expanded && (
        <>
        <div className="map-file-viewport nodrag nopan nowheel" role="region" aria-label={`Files in ${scene.folder.path}`} tabIndex={0}
          style={{ height: scene.viewportHeight }}
          onWheel={(event) => event.stopPropagation()}
          onScroll={(event) => onScroll(id, event.currentTarget.scrollTop)}>
          {scene.allRows.map(({ file, label }) => (
            <div key={file.path} className="map-file-row" data-hovered={hoveredFile === file.path}
              data-map-file={file.path}
              style={{ opacity: highlightedRows && !highlightedRows.has(file.path) && hoveredFile !== file.path ? 0.2 : 1 }}>
              <button type="button" className="map-file-select nodrag nopan" title={file.path}
                aria-pressed={selection?.type === "file" && selection.path === file.path}
                onClick={(event) => { event.stopPropagation(); onSelect({ type: "file", path: file.path }); }}>
                <span className="map-file-name"><span className="map-category-swatch" data-extension={file.extension} aria-hidden="true" /><code>{label}</code></span>
                <span className="map-file-counts">
                  <span className="map-incoming" title="Fan-in" aria-label={`Fan-in ${file.fanIn}`}>←{file.fanIn}</span>
                  <span className="map-outgoing" title="Fan-out" aria-label={`Fan-out ${file.fanOut}`}>{file.fanOut}→</span>
                </span>
              </button>
            </div>
          ))}
        </div>
        {/* Keep handle IDs mounted; scrolling changes their positions, never their identity. */}
        {scene.allRows.map(({ file }, index) => (
          <div key={file.path} className="map-row-ports" style={{ top: rowPortTop(scene, index),
            opacity: index < scene.rowStart || index >= scene.rowEnd ? 0 : highlightedRows && !highlightedRows.has(file.path) && hoveredFile !== file.path ? 0.2 : 1 }}>
            <Ports incoming={rowHandle("in", file.path)} outgoing={rowHandle("out", file.path)} />
          </div>
        ))}
          <div className="map-row-ports" style={{ top: panelHeaderHeight, opacity: scene.aboveFiles === 0 ? 0 : !aboveBright ? 0.2 : 1 }}>
            <Ports incoming="in:above" outgoing="out:above" />
          </div>
          <div className="map-row-ports" style={{ top: panelHeaderHeight + scene.viewportHeight, opacity: scene.belowFiles === 0 ? 0 : !belowBright ? 0.2 : 1 }}>
            <Ports incoming="in:below" outgoing="out:below" />
          </div>
        {scene.folder.files.length > panelRowLimit && (
            <div className="map-overflow-row">
              <span>{scene.rowStart + 1}–{scene.rowEnd} of {scene.folder.files.length}</span>
              <span className="map-scroll-counts">
                {scene.aboveFiles > 0 && <span style={{ opacity: !aboveBright ? 0.2 : 1 }}>{scene.aboveFiles} above</span>}
                {scene.belowFiles > 0 && <span style={{ opacity: !belowBright ? 0.2 : 1 }}>{scene.belowFiles} below</span>}
              </span>
            </div>
        )}
        </>
      )}
    </div>
  );
}

function ImportEdgeView({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style }: EdgeProps<ImportEdge>) {
  const loopTop = data?.loopTop;
  // A panel's internal imports go around its border, rather than behind its rows.
  const edgePath = source === target && loopTop !== null && loopTop !== undefined
    ? `M ${sourceX},${sourceY} C ${sourceX + 24},${sourceY} ${sourceX + 24},${loopTop} ${sourceX},${loopTop} L ${targetX},${loopTop} C ${targetX - 24},${loopTop} ${targetX - 24},${targetY} ${targetX},${targetY}`
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0];
  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} interactionWidth={0} />;
}

const nodeTypes = { folder: FolderNodeView };
const edgeTypes = { import: ImportEdgeView };
// Selection must not overwrite a queued panel refit's captured zoom cap.
const initialFitOptions = { padding: 0.06, minZoom: 0.02, maxZoom: 1 };

function RefitAfterLayout({ nodes, revision, maxZoom }: { nodes: SceneNode[]; revision: number; maxZoom: number }) {
  const { fitView } = useReactFlow<FolderNode, ImportEdge>();
  const handled = useRef(-1);
  const ready = useStore((store) => store.panZoom !== null && store.width > 0 && store.height > 0
    && nodes.length > 0 && nodes.every((node) => {
      const measured = store.nodeLookup.get(node.id);
      if (!measured || Math.abs((measured.measured.width ?? 0) - node.width) > 0.5
        || Math.abs((measured.measured.height ?? 0) - node.height) > 0.5
        || measured.position.x !== node.position.x || measured.position.y !== node.position.y) return false;
      return expectedHandles(node, "in").every((id) => measured.internals.handleBounds?.target?.some((handle) => handle.id === id))
        && expectedHandles(node, "out").every((id) => measured.internals.handleBounds?.source?.some((handle) => handle.id === id));
    }));
  useEffect(() => {
    if (!ready || handled.current === revision) return;
    handled.current = revision;
    void fitView({ nodes: nodes.map((node) => ({ id: node.id })), padding: 0.06, minZoom: 0.02, maxZoom, duration: 0 });
  }, [fitView, maxZoom, nodes, ready, revision]);
  return null;
}

interface MapProps {
  files: ParsedFile[];
  edges: ParsedEdge[];
  selection: MapSelection | null;
  onSelect: (selection: MapSelection | null) => void;
}

function Canvas({ files, edges, selection, onSelect }: MapProps) {
  const folded = useMemo(() => foldFolders(files, edges), [files, edges]);
  const [view, setView] = useState<{ expanded: Set<string>; offsets: Map<string, number>; revision: number; maxZoom: number }>(
    () => ({ expanded: new Set(), offsets: new Map(), revision: 0, maxZoom: 1 }));
  const { getZoom } = useReactFlow<FolderNode, ImportEdge>();
  const geometry = useMemo(() => layoutScene(createScene(folded.folders, edges, view.expanded)), [folded, edges, view.expanded]);
  const scene = useMemo(() => scrollScene(geometry, edges, view.offsets), [geometry, edges, view.offsets]);
  const highlight = useMemo(() => selectionHighlight(selection, folded.folders, edges), [selection, folded, edges]);
  const visible = useMemo(() => selectionVisibility(scene, highlight), [scene, highlight]);
  const toggle = useCallback((id: string) => {
    const folder = folded.folders.find((candidate) => candidate.id === id);
    if (!folder) throw new Error(`Cannot open absent folder ${id}`);
    const currentZoom = getZoom();
    setView((previous) => {
      const expanded = new Set(previous.expanded);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      const offsets = new Map(previous.offsets);
      offsets.delete(id);
      return { expanded, offsets, revision: previous.revision + 1, maxZoom: currentZoom };
    });
    onSelect({ type: "folder", path: folder.path });
  }, [folded, getZoom, onSelect]);
  const clearSelection = useCallback(() => onSelect(null), [onSelect]);
  const scroll = useCallback((id: string, scrollTop: number) => {
    setView((previous) => {
      if ((previous.offsets.get(id) ?? 0) === scrollTop) return previous;
      const offsets = new Map(previous.offsets);
      offsets.set(id, scrollTop);
      return { ...previous, offsets };
    });
  }, []);
  const nodes: FolderNode[] = useMemo(() => scene.nodes.map((node) => ({
    id: node.id, type: "folder", position: node.position, width: node.width, height: node.height,
    style: { width: node.width, height: node.height },
    data: {
      scene: node, selection, highlightedRows: visible?.rows ?? null,
      dimmed: visible !== null && !visible.nodes.has(node.id),
      aboveBright: visible === null || visible.above.has(node.id),
      belowBright: visible === null || visible.below.has(node.id),
      onToggle: toggle, onSelect, onScroll: scroll,
    },
    ariaLabel: `${node.folder.path}, ${node.folder.files.length} files`,
  })), [scene, visible, selection, toggle, onSelect, scroll]);
  const flowEdges: ImportEdge[] = useMemo(() => scene.edges.map((edge) => {
    const related = visible?.edges.has(edge.id) ?? false;
    const direction = selectionDirection(edge, highlight);
    const color = direction === "incoming" ? "var(--map-incoming)" : direction === "outgoing"
      ? "var(--map-outgoing)" : related ? "var(--accent)" : "var(--map-edge)";
    return {
      id: edge.id, type: "import", source: edge.source, target: edge.target,
      sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle,
      data: { imports: edge.imports, loopTop: edge.source === edge.target ? (scene.nodes.find((node) => node.id === edge.source)?.position.y ?? 0) - 20 : null },
      style: { stroke: color, strokeWidth: related ? 1.6 : 1, opacity: visible ? related ? 1 : 0.08 : 0.45 },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
      ariaLabel: `${edge.imports.length} real imports from ${edge.source} to ${edge.target}${direction ? `, ${direction} relative to selection` : ""}`,
    };
  }), [scene, visible, highlight]);
  return (
    <div className="dependency-map" role="region" aria-label="Dependency map" tabIndex={0}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        clearSelection();
      }}>
      <ReactFlow<FolderNode, ImportEdge>
        nodes={nodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        fitView fitViewOptions={initialFitOptions}
        minZoom={0.02} maxZoom={2} nodesDraggable={false} nodesConnectable={false}
        nodesFocusable={false} edgesFocusable={false} edgesReconnectable={false}
        elementsSelectable={false} deleteKeyCode={null} zoomOnDoubleClick={false}
        autoPanOnNodeFocus={false} autoPanOnConnect={false}
        onNodeClick={(event, node) => {
          if (event.target instanceof Element && event.target.closest(".map-file-viewport")) return;
          onSelect({ type: "folder", path: node.data.scene.folder.path });
        }}
        onPaneClick={clearSelection}
      >
        <Controls showInteractive={false} fitViewOptions={initialFitOptions} />
        <RefitAfterLayout nodes={scene.nodes} revision={view.revision} maxZoom={view.maxZoom} />
      </ReactFlow>
    </div>
  );
}

export const DependencyMap = memo(function DependencyMap(props: MapProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
});
