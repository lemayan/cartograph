import { auth } from "@clerk/nextjs/server";
import { createServerDatabaseClient } from "@/lib/supabase/server";
import { readAnalysisMetadata } from "@/lib/analyses/dashboard";
import { readStoredAnalysis } from "@/lib/analyses/result";
import { analysisWriter } from "@/lib/pipeline/writer";
import { explanationModel } from "@/lib/ai/client";
import { explainSelection, explanationKey } from "@/lib/explanations/service";
import { explanationContext } from "@/lib/explanations/context";
import type { MapSelection } from "@/lib/map/scene";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ analysisId: string }> }) {
  const { isAuthenticated, orgId } = await auth();
  if (!isAuthenticated || !orgId) return Response.json({ error: "Sign in and select an organization before explaining code." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) return Response.json({ error: "Submit from this application." }, { status: 403 });
  const { analysisId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(analysisId)) return Response.json({ error: "Analysis not found." }, { status: 404 });
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("type" in body) || !(body.type === "file" || body.type === "folder")
      || !("path" in body) || typeof body.path !== "string" || body.path.length > 2048
      || !("runId" in body) || typeof body.runId !== "string") return Response.json({ error: "Select a file or folded folder." }, { status: 400 });
    const selection: MapSelection = { type: body.type, path: body.path };
    const analysis = await readAnalysisMetadata(analysisId);
    if (!analysis) return Response.json({ error: "Analysis not found." }, { status: 404 });
    const database = await createServerDatabaseClient();
    const { data: current, error } = await database.from("analyses").select("run_id").eq("id", analysisId).single();
    if (error || !current || current.run_id !== body.runId || analysis.status !== "complete" || !analysis.commitSha) {
      return Response.json({ error: "Analysis was replaced; reload the map." }, { status: 409 });
    }
    const result = await readStoredAnalysis(analysisId);
    if (!result) return Response.json({ error: "Analysis was replaced; reload the map." }, { status: 409 });
    const context = explanationContext(result, selection);
    const writer = analysisWriter(orgId);
    const explanation = await explainSelection(result, selection, analysis.repositoryUrl, analysis.commitSha, {
      read: async (task, model, key) => {
        // RLS chooses the organization. Only the exact content key limits this read.
        const { data, error } = await database.from("ai_cache").select("content")
          .eq("task", task).eq("model", model).eq("input_hash", key).limit(1).maybeSingle();
        if (error) throw new Error(`Could not read AI cache: ${error.message}`);
        return data?.content ?? null;
      }, write: writer.cache.write,
    });
    if (!explanation.stale && explanation.content !== null) await writer.saveExplanation(analysisId, current.run_id,
      selection.type, selection.path, explanationModel, explanationKey(result, selection),
      Object.fromEntries(context.files.filter((file) => context.members.includes(file.path)).map((file) => [file.path, file.hash])), explanation.content);
    return Response.json(explanation);
  } catch (error) {
    console.error("Explanation failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Explanation failed. Retry Explain." }, { status: 500 });
  }
}
