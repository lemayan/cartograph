import "server-only";
import { fetchPublicRepository } from "./archive";
import { publicRepository } from "./repository";
import { analysisWriter, type AnalysisStatus, type PipelineStage } from "./writer";
import { selectRepository, parseSelectedRepository } from "../parser/parse";
import { validateParserResult } from "../parser/contract";
import { detectAdapter } from "../adapters/detect";
import { classifyUnmatched } from "../ai/roles";

export interface PipelineOutcome {
  analysisId: string;
  runId: string;
  created: boolean;
  status: AnalysisStatus;
  failure?: { stage: PipelineStage; message: string };
}

/** The caller captures organizationId from verified auth once, before any long-running work. */
export async function runRepositoryAnalysis(repositoryUrl: string, organizationId: string, fetcher: typeof fetch = fetch): Promise<PipelineOutcome> {
  const repository = publicRepository(repositoryUrl);
  const writer = analysisWriter(organizationId);
  const reserved = await writer.begin(repository.url);
  if (!reserved.created) return reserved;
  return executeRepositoryAnalysis(repository.url, organizationId, reserved, fetcher);
}

/** Execution starts before the response; Next's after(promise) keeps the request alive until it settles. */
export async function executeRepositoryAnalysis(repositoryUrl: string, organizationId: string,
  reserved: PipelineOutcome, fetcher: typeof fetch = fetch): Promise<PipelineOutcome> {
  const repository = publicRepository(repositoryUrl);
  const writer = analysisWriter(organizationId);
  let stage: PipelineStage = "fetching";
  let archive: Awaited<ReturnType<typeof fetchPublicRepository>> | null = null;
  try {
    archive = await fetchPublicRepository(repository, fetcher);
    stage = "selecting";
    await writer.advance(reserved.analysisId, reserved.runId, stage, "Selecting TypeScript and JavaScript files by repository structure.", archive.commitSha);
    const selected = await selectRepository(archive.directory);
    stage = "parsing";
    await writer.advance(reserved.analysisId, reserved.runId, stage, `Parsing ${selected.candidates.length} files and labelling unmatched roles, ${selected.skipped.length} skipped.`);
    const result = validateParserResult(await parseSelectedRepository(selected, await detectAdapter(selected)));
    const roles = await classifyUnmatched(result, archive.directory, writer.cache);
    // Source is no longer needed after role labelling. Clean up before committing a complete result.
    await archive.cleanup();
    archive = null;
    stage = "storing";
    await writer.advance(reserved.analysisId, reserved.runId, stage, `Storing ${result.files.length} files and ${result.edges.length} resolved imports.`);
    await writer.store(reserved.analysisId, reserved.runId, result, roles);
    return { ...reserved, status: "complete" };
  } catch (error) {
    const errors: unknown[] = [error];
    if (archive) {
      try { await archive.cleanup(); } catch (cleanupError) { errors.push(cleanupError); }
    }
    const message = errors.map((item) => item instanceof Error ? item.message : "Unknown pipeline failure.").join(" ");
    try { await writer.fail(reserved.analysisId, reserved.runId, stage, message); }
    catch (failureWriteError) {
      throw new AggregateError([...errors, failureWriteError], `Pipeline failed during ${stage} and the failed state could not be saved.`);
    }
    return { ...reserved, status: "failed", failure: { stage, message } };
  }
}
