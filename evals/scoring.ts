import type { EvaluationResult } from "langsmith/evaluation";

export function experimentScores(rows: readonly { run: { error?: string | null };
  evaluationResults: { results: EvaluationResult[] } }[], count: number, keys: readonly string[]) {
  if (rows.length !== count) throw new Error(`Experiment returned ${rows.length}/${count} examples.`);
  const means: Record<string, number> = {};
  for (const key of keys) {
    const scores = rows.map((row) => {
      if (row.run.error) throw new Error(`Experiment prediction failed: ${row.run.error}`);
      const metric = row.evaluationResults.results.find((item) => item.key === key);
      if (typeof metric?.score !== "number" || !Number.isFinite(metric.score) || metric.score < 0 || metric.score > 1)
        throw new Error(`Missing or invalid ${key} feedback; experiment is incomplete.`);
      return metric.score;
    });
    means[key] = scores.reduce((sum, value) => sum + value, 0) / count;
  }
  return means;
}
