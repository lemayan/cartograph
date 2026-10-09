import "server-only";

import { createServerDatabaseClient } from "@/lib/supabase/server";

export const dashboardPageSize = 50;

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function readAnalysis(row: unknown) {
  if (
    typeof row !== "object" || row === null
    || !("id" in row) || typeof row.id !== "string"
    || !("status" in row) || typeof row.status !== "string"
    || !["queued", "parsing", "complete", "failed"].includes(row.status)
    || !("is_seed" in row) || typeof row.is_seed !== "boolean"
    || !("commit_sha" in row)
    || !(row.commit_sha === null || (typeof row.commit_sha === "string" && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(row.commit_sha)))
    || !("started_at" in row) || !isNullableTimestamp(row.started_at)
    || !("finished_at" in row) || !isNullableTimestamp(row.finished_at)
    || !("failure_message" in row) || !(row.failure_message === null || typeof row.failure_message === "string")
    || !("projects" in row) || typeof row.projects !== "object" || row.projects === null
    || !("repository_url" in row.projects) || typeof row.projects.repository_url !== "string"
  ) {
    throw new Error("The analyses query returned an invalid dashboard row.");
  }
  return {
    id: row.id,
    status: row.status,
    isSeed: row.is_seed,
    commitSha: row.commit_sha,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    failureMessage: row.failure_message,
    repositoryUrl: row.projects.repository_url,
  };
}

export async function listDashboardAnalyses() {
  const database = await createServerDatabaseClient();
  // The token and RLS choose the team. This query stays identical after a switch.
  const { data, error } = await database
    .from("analyses")
    .select("id, status, is_seed, commit_sha, started_at, finished_at, failure_message, projects!inner(repository_url)")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(dashboardPageSize + 1);

  if (error) throw new Error(`Could not load analyses: ${error.message}`);
  if (!data) throw new Error("The analyses query returned no response.");

  return {
    // One server snapshot time keeps all relative labels consistent without a UI timer.
    asOf: Date.now(),
    analyses: data.slice(0, dashboardPageSize).map(readAnalysis),
    hasMore: data.length > dashboardPageSize,
  };
}
