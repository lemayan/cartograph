export const pipelineStages = ["fetching", "selecting", "parsing", "storing"] as const;
export type Stage = typeof pipelineStages[number];
export type Status = "queued" | "running" | "complete" | "failed";
export const stageLabels: Record<Stage, string> = {
  fetching: "Fetch archive", selecting: "Select files", parsing: "Parse imports", storing: "Store results",
};
export const staleAfter = 5 * 60 * 1000;
export interface Analysis {
  id: string;
  status: Status;
  stage: Stage | null;
  message: string | null;
  stageMessages: Partial<Record<Stage, string>>;
  commitSha: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  failureStage: Stage | null;
  failureMessage: string | null;
  repositoryUrl: string;
}
export interface Progress {
  status: Status;
  stage: Stage;
  message: string;
}
export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && pipelineStages.some((stage) => stage === value);
}
export function isStatus(value: unknown): value is Status {
  return value === "queued" || value === "running" || value === "complete" || value === "failed";
}
export function readProgress(value: unknown): Progress {
  if (typeof value !== "object" || value === null || !("stage" in value)
    || !isStage(value.stage) || !("status" in value) || !isStatus(value.status)
    || !("message" in value) || typeof value.message !== "string") throw new Error("Invalid progress event received.");
  return { status: value.status, stage: value.stage, message: value.message };
}
export function isStale(analysis: Analysis, now: number) {
  return (analysis.status === "running" || analysis.status === "queued")
    && now - Date.parse(analysis.updatedAt) >= staleAfter;
}
