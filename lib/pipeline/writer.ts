import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../supabase/database.types";
import { validateParserResult } from "../parser/contract";
import type { ParserResult } from "../parser/types";
import { initializeRealtime } from "../supabase/initialize-realtime";
import type { AICache } from "../ai/client";
import type { FileRole } from "../ai/roles";

export type PipelineStage = "fetching" | "selecting" | "parsing" | "storing";
export type AnalysisStatus = "queued" | "running" | "complete" | "failed";

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return typeof value === "object" && Object.values(value).every(isJson);
}

function isStatus(value: string): value is AnalysisStatus {
  return ["queued", "running", "complete", "failed"].includes(value);
}

/** Privileged writes and pipeline cache access live here; application reads use token-bound RLS. */
export function analysisWriter(organizationId: string) {
  if (!/^org_[A-Za-z0-9_]+$/.test(organizationId)) throw new Error("A verified Clerk organization is required for the writer.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret?.startsWith("sb_secret_")) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local before running the pipeline.");
  const database = createClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    cache: {
      async read(task: string, model: string, key: string) {
        const { data, error } = await database.from("ai_cache").select("content")
          .eq("organization_id", organizationId).eq("task", task).eq("model", model).eq("input_hash", key).limit(1).maybeSingle();
        if (error) throw new Error(`Could not read AI cache: ${error.message}`);
        return data?.content ?? null;
      },
      async write(task: string, model: string, key: string, content: string) {
        const { error } = await database.from("ai_cache").upsert({ organization_id: organizationId,
          task, model, input_hash: key, content }, { onConflict: "organization_id,task,model,input_hash", ignoreDuplicates: true });
        if (error) throw new Error(`Could not save AI cache: ${error.message}`);
      },
    } satisfies AICache,
    async saveExplanation(analysisId: string, runId: string, type: string, path: string, model: string,
      key: string, hashes: Record<string, string>, content: string) {
      const { error } = await database.rpc("save_explanation", { p_organization_id: organizationId,
        p_analysis_id: analysisId, p_run_id: runId, p_type: type, p_path: path,
        p_model: model, p_context_hash: key, p_hashes: hashes, p_content: content });
      if (error) throw new Error(`Could not save explanation: ${error.message}`);
    },
    async begin(repositoryUrl: string) {
      await initializeRealtime();
      const { data, error } = await database.rpc("begin_repository_analysis", {
        p_organization_id: organizationId, p_repository_url: repositoryUrl,
      }).single();
      if (error) throw new Error(`Could not reserve analysis: ${error.message}`);
      if (!data || !isStatus(data.status)) throw new Error("The writer returned an invalid analysis reservation.");
      return { analysisId: data.analysis_id, runId: data.run_id, created: data.created, status: data.status };
    },
    async restart(analysisId: string) {
      await initializeRealtime();
      const { data, error } = await database.rpc("restart_repository_analysis", {
        p_organization_id: organizationId, p_analysis_id: analysisId,
      }).single();
      if (error) throw new Error(`Could not restart analysis: ${error.message}`);
      if (!data || !isStatus(data.status)) throw new Error("The writer returned an invalid analysis reservation.");
      return { analysisId: data.analysis_id, runId: data.run_id, created: data.created, status: data.status, repositoryUrl: data.repository_url };
    },
    async advance(analysisId: string, runId: string, stage: Exclude<PipelineStage, "fetching">, message: string, commitSha?: string) {
      const { error } = await database.rpc("advance_repository_analysis", {
        p_organization_id: organizationId, p_analysis_id: analysisId, p_run_id: runId, p_stage: stage, p_message: message,
        ...(commitSha === undefined ? {} : { p_commit_sha: commitSha }),
      });
      if (error) throw new Error(`Could not record ${stage}: ${error.message}`);
    },
    async store(analysisId: string, runId: string, result: ParserResult, roles: FileRole[] = []) {
      const encoded = JSON.stringify(validateParserResult(result));
      if (Buffer.byteLength(encoded) > 20 * 1024 * 1024) throw new Error("Parser result exceeds the 20 MiB storage limit.");
      // Runtime validation bridges the parser interface to Supabase's JSON contract without a cast.
      const payload: unknown = JSON.parse(encoded);
      if (!isJson(payload)) throw new Error("Parser result is not valid JSON.");
      const encodedRoles: unknown = JSON.parse(JSON.stringify(roles));
      if (!isJson(encodedRoles)) throw new Error("Roles are not valid JSON.");
      const { error } = await database.rpc("store_repository_analysis_with_roles", {
        p_organization_id: organizationId, p_analysis_id: analysisId, p_run_id: runId, p_result: payload, p_roles: encodedRoles,
      });
      if (error) throw new Error(`Could not store analysis: ${error.message}`);
    },
    async fail(analysisId: string, runId: string, stage: PipelineStage, message: string) {
      const { data, error } = await database.rpc("fail_repository_analysis", {
        p_organization_id: organizationId, p_analysis_id: analysisId, p_run_id: runId, p_stage: stage, p_message: message,
      });
      if (error) throw new Error(`Could not record failed analysis: ${error.message}`);
      if (data === false) console.info(`Analysis ${analysisId}: old run ${runId} was superseded by a deliberate rerun.`);
    },
  };
}
