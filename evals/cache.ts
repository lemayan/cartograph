import { readFile } from "node:fs/promises";
import type { AICache } from "../lib/ai/client";
import { contentKey } from "../lib/explanations/context";
import { save } from "./datasets";

/** Eval-only content-addressed disk cache. Each read still happens inside cachedAI's trace. */
export function evaluationCache(): AICache {
  const filename = (task: string, model: string, key: string) => `.cartograph/eval-cache/${contentKey({ task, model, key })}.json`;
  let lastMiss = 0;
  let pacing = Promise.resolve();
  return {
    async read(task, model, key) {
      try {
        const value: unknown = JSON.parse(await readFile(filename(task, model, key), "utf8"));
        if (typeof value !== "string") throw new Error("Invalid eval cache entry.");
        return value;
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          // Evaluation only: five requests/minute on the configured free tier.
          // Share the schedule between prediction and judge, while hits stay instant.
          pacing = pacing.then(async () => {
            const wait = Math.max(0, 15000 - (Date.now() - lastMiss));
            if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
            lastMiss = Date.now();
          });
          await pacing;
          return null;
        }
        throw error;
      }
    },
    async write(task, model, key, content) { await save(filename(task, model, key), content); },
  };
}
