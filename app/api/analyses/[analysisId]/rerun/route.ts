import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { readAnalysisMetadata } from "@/lib/analyses/dashboard";
import { analysisWriter } from "@/lib/pipeline/writer";
import { executeRepositoryAnalysis } from "@/lib/pipeline/run";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ analysisId: string }> }) {
  const { isAuthenticated, orgId } = await auth();
  if (!isAuthenticated) return Response.json({ error: "Sign in before starting an analysis." }, { status: 401 });
  if (!orgId) return Response.json({ error: "Select an organization before starting an analysis." }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) return Response.json({ error: "Submit from this application." }, { status: 403 });
  const { analysisId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(analysisId)) return Response.json({ error: "Analysis not found." }, { status: 404 });
  try {
    if (!await readAnalysisMetadata(analysisId)) return Response.json({ error: "Analysis not found." }, { status: 404 });
    const reservation = await analysisWriter(orgId).restart(analysisId);
    if (reservation.created) after(executeRepositoryAnalysis(reservation.repositoryUrl, orgId, reservation));
    return Response.json({ analysisId, status: reservation.status }, { status: reservation.created ? 202 : 200 });
  } catch (error) {
    console.error("Analysis could not restart:", error);
    return Response.json({ error: "The analysis could not restart. Check the server error for details." }, { status: 500 });
  }
}
