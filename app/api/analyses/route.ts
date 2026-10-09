import { auth } from "@clerk/nextjs/server";
import { publicRepository } from "@/lib/pipeline/repository";
import { executeRepositoryAnalysis } from "@/lib/pipeline/run";
import { analysisWriter } from "@/lib/pipeline/writer";
import { after } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { isAuthenticated, orgId } = await auth();
  if (!isAuthenticated) return Response.json({ error: "Sign in before starting an analysis." }, { status: 401 });
  if (!orgId) return Response.json({ error: "Select an organization before starting an analysis." }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) return Response.json({ error: "Submit from this application." }, { status: 403 });
  let repositoryUrl: string;
  try {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new Error("Submit an application/json body.");
    const text = await request.text();
    if (text.length > 4096) throw new Error("Repository submission is too large.");
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body) || !("repositoryUrl" in body)
      || typeof body.repositoryUrl !== "string" || Object.keys(body).some((key) => key !== "repositoryUrl")) {
      throw new Error("Submit only repositoryUrl. Organization ownership comes from your session.");
    }
    repositoryUrl = publicRepository(body.repositoryUrl).url;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid repository submission." }, { status: 400 });
  }
  try {
    const result = await analysisWriter(orgId).begin(repositoryUrl);
    // Start fetching now. Next tracks the promise past the response without a separate worker.
    if (result.created) after(executeRepositoryAnalysis(repositoryUrl, orgId, result));
    return Response.json(result, { status: result.created ? 202 : 200 });
  } catch (error) {
    console.error("Analysis pipeline could not finish:", error);
    return Response.json({ error: "The analysis could not be recorded. Check the server error for details." }, { status: 500 });
  }
}
