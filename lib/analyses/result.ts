import "server-only";
import { createServerDatabaseClient } from "../supabase/server";
import { validateParserResult } from "../parser/contract";

export async function readStoredAnalysis(analysisId: string) {
  const database = await createServerDatabaseClient();
  // No organization predicate: the invoker RPC and existing RLS policies determine every readable row.
  const { data, error } = await database.rpc("read_repository_analysis", { p_analysis_id: analysisId });
  if (error) throw new Error(`Could not load stored analysis: ${error.message}`);
  if (data === null) return null;
  const result = validateParserResult(data);
  const { data: roles, error: roleError } = await database.from("file_roles").select("role, content_hash, files!inner(path)")
    .eq("analysis_id", analysisId).not("model", "is", null).limit(20001);
  if (roleError) throw new Error(`Could not load file roles: ${roleError.message}`);
  if (!roles || roles.length > 20000) throw new Error("Stored role list exceeds the 20,000-file read limit.");
  const labels = new Map(roles.map((entry) => [entry.files.path, entry]));
  return { ...result, files: result.files.map((file) => {
    const label = labels.get(file.path);
    return file.kind === null && label?.content_hash === file.hash ? { ...file, kind: label.role } : file;
  }) };
}
