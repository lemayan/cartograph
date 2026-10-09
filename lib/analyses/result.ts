import "server-only";
import { createServerDatabaseClient } from "../supabase/server";
import { validateParserResult } from "../parser/contract";

export async function readStoredAnalysis(analysisId: string) {
  const database = await createServerDatabaseClient();
  // No organization predicate: the invoker RPC and existing RLS policies determine every readable row.
  const { data, error } = await database.rpc("read_repository_analysis", { p_analysis_id: analysisId });
  if (error) throw new Error(`Could not load stored analysis: ${error.message}`);
  return data === null ? null : validateParserResult(data);
}
