import "server-only";
import { createServerDatabaseClient } from "../supabase/server";
import { explanationModel, tracingConfigured } from "../ai/client";
import { explanationKey } from "./service";
import { repositoryHead } from "./repository";
import type { Explanation, ExplanationSetup } from "./types";
import type { ParserResult } from "../parser/types";
import type { MapSelection } from "../map/scene";

export async function loadExplanations(analysisId: string, result: ParserResult, repositoryUrl: string, commit: string): Promise<ExplanationSetup> {
  const database = await createServerDatabaseClient();
  const { data: analysis, error: metadataError } = await database.from("analyses").select("run_id, commit_sha, status").eq("id", analysisId).single();
  if (metadataError || !analysis) throw new Error("Could not load the analysis run for explanations.");
  if (analysis.status !== "complete" || analysis.commit_sha !== commit) throw new Error("The analysis changed while opening the map. Reload to use its current run.");
  const { data, error } = await database.from("explanations").select("target_type, target_path, context_hash, content")
    .eq("analysis_id", analysisId).eq("run_id", analysis.run_id).eq("model", explanationModel).limit(1001);
  if (error) throw new Error(`Could not load explanations: ${error.message}`);
  if (!data || data.length > 1000) throw new Error("Saved explanation list exceeds the 1,000-target read limit.");
  let stale = false;
  let reason: string | null = null;
  try {
    stale = await repositoryHead(repositoryUrl) !== commit;
    if (stale) reason = "The repository has moved past the analysed commit. Re-analyse to explain the current code.";
  } catch (error) { reason = error instanceof Error ? error.message : "Repository freshness could not be checked."; }
  const saved: Explanation[] = [];
  for (const row of data) {
    if (!(row.target_type === "file" || row.target_type === "folder") || !row.target_path) continue;
    const selection: MapSelection = { type: row.target_type, path: row.target_path };
    try {
      if (row.context_hash === explanationKey(result, selection)) saved.push({ selection, content: row.content, stale, reason, cacheHit: true });
    } catch { /* A superseded folder grouping is absent, never guessed into a new selection. */ }
  }
  return { analysisId, runId: analysis.run_id, model: explanationModel, tracing: tracingConfigured(), stale, reason, saved };
}
