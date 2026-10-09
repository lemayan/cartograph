import "server-only";
import { createServerDatabaseClient } from "@/lib/supabase/server";
import { isStage, isStatus, type Analysis } from "./types";

export const dashboardPageSize = 50;
const columns = "id, status, stage, stage_message, stage_messages, commit_sha, started_at, finished_at, updated_at, failure_stage, failure_message, projects!inner(repository_url)";
function isTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function isNullableTimestamp(value: unknown): value is string | null { return value === null || isTimestamp(value); }
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function readAnalysis(row: unknown): Analysis {
  if (typeof row !== "object" || row === null
    || !("id" in row) || typeof row.id !== "string"
    || !("status" in row) || !isStatus(row.status)
    || !("stage" in row) || !(row.stage === null || isStage(row.stage))
    || !("stage_message" in row) || !isNullableString(row.stage_message)
    || !("stage_messages" in row) || typeof row.stage_messages !== "object" || row.stage_messages === null || Array.isArray(row.stage_messages)
    || !("commit_sha" in row) || !(row.commit_sha === null || (typeof row.commit_sha === "string" && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(row.commit_sha)))
    || !("started_at" in row) || !isNullableTimestamp(row.started_at)
    || !("finished_at" in row) || !isNullableTimestamp(row.finished_at)
    || !("updated_at" in row) || !isTimestamp(row.updated_at)
    || !("failure_stage" in row) || !(row.failure_stage === null || isStage(row.failure_stage))
    || !("failure_message" in row) || !isNullableString(row.failure_message)
    || !("projects" in row) || typeof row.projects !== "object" || row.projects === null
    || !("repository_url" in row.projects) || typeof row.projects.repository_url !== "string") {
    throw new Error("The analyses query returned an invalid row.");
  }
  const stageMessages: Analysis["stageMessages"] = {};
  for (const [key, message] of Object.entries(row.stage_messages)) {
    if (!isStage(key) || typeof message !== "string") throw new Error("Invalid stored stage message.");
    stageMessages[key] = message;
  }
  return { id: row.id, status: row.status, stage: row.stage, message: row.stage_message, stageMessages, commitSha: row.commit_sha,
    startedAt: row.started_at, finishedAt: row.finished_at, updatedAt: row.updated_at,
    failureStage: row.failure_stage, failureMessage: row.failure_message, repositoryUrl: row.projects.repository_url };
}
export async function listDashboardAnalyses() {
  const database = await createServerDatabaseClient();
  // The token and RLS choose the team. This query stays identical after a switch.
  const { data, error } = await database.from("analyses").select(columns)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(dashboardPageSize + 1);
  if (error) throw new Error(`Could not load analyses: ${error.message}`);
  if (!data) throw new Error("The analyses query returned no response.");
  return { asOf: Date.now(), analyses: data.slice(0, dashboardPageSize).map(readAnalysis), hasMore: data.length > dashboardPageSize };
}
export async function readAnalysisMetadata(id: string) {
  const database = await createServerDatabaseClient();
  const { data, error } = await database.from("analyses").select(columns).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load analysis: ${error.message}`);
  return data === null ? null : readAnalysis(data);
}
export async function readAnalysisSnapshot(id: string) {
  return { analysis: await readAnalysisMetadata(id), asOf: Date.now() };
}
