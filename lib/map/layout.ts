import { Graph, layout, type EdgeLabel, type GraphLabel, type NodeLabel } from "@dagrejs/dagre";
import type { MapScene } from "./scene";
import { compare } from "../parser/graph";

export function layoutScene(scene: MapScene): MapScene {
  if (!scene.nodes.length) return scene;
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>();
  graph.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 56, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of scene.nodes) graph.setNode(node.id, { width: node.width, height: node.height });
  // Internal file edges stay visible in panels, but do not change the folder layout.
  const pairs = new Set<string>();
  for (const edge of scene.edges) {
    if (edge.source === edge.target) continue;
    const key = JSON.stringify([edge.source, edge.target]);
    if (pairs.has(key)) continue;
    pairs.add(key);
    graph.setEdge(edge.source, edge.target);
  }
  layout(graph);
  const ordered = scene.nodes.map((node) => {
    const placed = graph.node(node.id);
    if (!placed || placed.x === undefined || placed.y === undefined) throw new Error(`Layout did not position ${node.id}`);
    return { node, x: placed.x, y: placed.y };
  }).sort((a, b) => a.x - b.x || a.y - b.y || compare(a.node.id, b.node.id));
  // Long cyclic ranks create acres of blank canvas. Keep dagre's dependency order,
  // but pack it into compact rows so fitting the map does not make its labels tiny.
  const columns = Math.ceil(Math.sqrt(ordered.length));
  const widths = Array.from({ length: columns }, (_, column) => Math.max(0,
    ...ordered.filter((_, index) => index % columns === column).map(({ node }) => node.width)));
  const heights = Array.from({ length: Math.ceil(ordered.length / columns) }, (_, row) => Math.max(0,
    ...ordered.slice(row * columns, (row + 1) * columns).map(({ node }) => node.height)));
  const positions = new Map(ordered.map(({ node }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return [node.id, {
      x: 16 + widths.slice(0, column).reduce((sum, width) => sum + width + 36, 0),
      y: 16 + heights.slice(0, row).reduce((sum, height) => sum + height + 36, 0),
    }];
  }));
  return { ...scene, nodes: scene.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })) };
}
