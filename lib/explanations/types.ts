import type { MapSelection } from "../map/scene";
export interface Explanation {
  selection: MapSelection;
  content: string | null;
  stale: boolean;
  reason: string | null;
  cacheHit: boolean;
}
export interface ExplanationSetup {
  analysisId: string;
  runId: string;
  model: string;
  tracing: boolean;
  stale: boolean;
  reason: string | null;
  saved: Explanation[];
}
export function selectionKey(selection: MapSelection) { return `${selection.type}:${selection.path}`; }
export function isExplanation(value: unknown): value is Explanation {
  if (typeof value !== "object" || value === null || !("selection" in value)
    || typeof value.selection !== "object" || value.selection === null
    || !("type" in value.selection) || !["file", "folder"].includes(String(value.selection.type))
    || !("path" in value.selection) || typeof value.selection.path !== "string") return false;
  return "content" in value && (value.content === null || typeof value.content === "string")
    && "stale" in value && typeof value.stale === "boolean"
    && "reason" in value && (value.reason === null || typeof value.reason === "string")
    && "cacheHit" in value && typeof value.cacheHit === "boolean";
}
