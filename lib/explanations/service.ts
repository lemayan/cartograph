import "server-only";
import { cachedAI, explanationModel, type AICache } from "../ai/client";
import { contentKey, explanationContext } from "./context";
import { repositoryHead, repositorySource } from "./repository";
import type { ParserResult } from "../parser/types";
import type { MapSelection } from "../map/scene";
import type { Explanation } from "./types";
import { explanationInstructions } from "./prompt";

export function explanationKey(result: ParserResult, selection: MapSelection) {
  return contentKey({ version: 1, context: explanationContext(result, selection) });
}
export async function explainSelection(result: ParserResult, selection: MapSelection, repositoryUrl: string,
  analysedCommit: string, cache: AICache,
  repository = { head: repositoryHead, source: repositorySource }): Promise<Explanation> {
  const context = explanationContext(result, selection);
  const answer = await cachedAI({ task: `explain.${selection.type}`, model: explanationModel,
    key: explanationKey(result, selection), cache, input: context,
    instructions: explanationInstructions(selection.type),
    suppliedPaths: [...new Set([...context.files.map((file) => file.path), context.selection.path])],
    validate: (content) => {
      if (!content.trim()) throw new Error("The model returned an empty explanation.");
      return content;
    },
    prepare: async () => {
      const head = await repository.head(repositoryUrl);
      const sources: { path: string; contents: string }[] = [];
      const changed: string[] = [];
      let bytes = 0;
      // Fetch at most four files concurrently. Every member's stored hash is checked, including cache hits.
      for (let start = 0; start < context.members.length; start += 4) {
        await Promise.all(context.members.slice(start, start + 4).map(async (file) => {
          const live = await repository.source(repositoryUrl, head, file);
          const stored = context.files.find((entry) => entry.path === file);
          if (!live || live.hash !== stored?.hash) changed.push(file);
          else {
            bytes += Buffer.byteLength(live.contents);
            if (bytes > 1024 * 1024) throw new Error("Selected source exceeds the 1 MiB AI input limit; no files were omitted.");
            sources.push({ path: file, contents: live.contents });
          }
        }));
      }
      sources.sort((a, b) => a.path.localeCompare(b.path));
      const stale = head !== analysedCommit || changed.length > 0;
      return { stale, reason: changed.length ? `${changed.length} selected file${changed.length === 1 ? " has" : "s have"} changed or been removed. Re-analyse to explain the current code.`
        : stale ? "The repository has moved past the analysed commit. Re-analyse to explain the current code." : null, source: sources };
    },
  });
  return { selection, content: answer.value, stale: answer.stale, reason: answer.reason, cacheHit: answer.cacheHit };
}
