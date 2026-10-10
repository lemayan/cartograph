import "server-only";
import OpenAI from "openai";
import { Client } from "langsmith";
import { traceable } from "langsmith/traceable";
import { wrapOpenAI } from "langsmith/wrappers/openai";

// Specific stable release, approved after live verification; never use Gemini's latest aliases.
export const explanationModel = "gemini-3.8-flash";
export const roleModel = "gemini-3.8-flash";
export function tracingConfigured() {
  return process.env.LANGSMITH_TRACING === "true" && Boolean(process.env.LANGSMITH_API_KEY?.trim());
}
const traces = new Client();
let client: ReturnType<typeof wrapOpenAI<OpenAI>> | undefined;
/** No caller gets the raw client. Construction and wrapping cannot drift apart. */
function aiClient() {
  if (!client) {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new Error("Set GEMINI_API_KEY in the root .env.local before using AI explanations or roles.");
    client = wrapOpenAI(new OpenAI({ apiKey: key,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", timeout: 120000, maxRetries: 0 }),
    { client: traces, tracingEnabled: tracingConfigured() });
  }
  return client;
}
export interface AICache {
  read(task: string, model: string, key: string): Promise<string | null>;
  write(task: string, model: string, key: string, content: string): Promise<void>;
}
export async function cachedAI<T>(options: {
  task: string; model: string; key: string; cache: AICache; input: unknown;
  instructions: string; schema?: Record<string, unknown>;
  validate: (content: string) => T;
  prepare?: () => Promise<{ stale: boolean; reason: string | null; source: unknown }>;
}) {
  const run = traceable(async () => {
    const cached = await traceable(() => options.cache.read(options.task, options.model, options.key),
      { name: "cache.read", client: traces, tracingEnabled: tracingConfigured() })();
    if (Buffer.byteLength(JSON.stringify(options.input)) > 1024 * 1024) throw new Error("AI facts exceed the 1 MiB input limit; no paths were omitted.");
    const prepared = await options.prepare?.();
    if (prepared?.stale) return { value: cached === null ? null : options.validate(cached), stale: true,
      reason: prepared.reason, cacheHit: cached !== null, usage_metadata: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } };
    if (cached !== null) return { value: options.validate(cached), stale: false, reason: null,
      cacheHit: true, usage_metadata: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } };
    const input = JSON.stringify({ facts: options.input, source: prepared?.source });
    // Reject oversized context explicitly; never silently omit a neighbour or truncate source.
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error("AI context exceeds 1 MiB. This selection cannot be explained without omitting source.");
    const response = await aiClient().chat.completions.create({ model: options.model,
      reasoning_effort: "low", max_tokens: 8192,
      messages: [{ role: "system", content: options.instructions }, { role: "user", content: input }],
      ...(options.schema ? { response_format: { type: "json_schema", json_schema: { name: "file_roles", strict: true, schema: options.schema } } } : {}),
    });
    const content = response.choices[0]?.message.content;
    if (!content || response.choices[0]?.finish_reason !== "stop") throw new Error("The model did not return a complete answer. Retry Explain.");
    const value = options.validate(content);
    await options.cache.write(options.task, options.model, options.key, content);
    return { value, stale: false, reason: null, cacheHit: false,
      usage_metadata: { input_tokens: response.usage?.prompt_tokens ?? 0, output_tokens: response.usage?.completion_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0 } };
  }, { name: options.task, client: traces, tracingEnabled: tracingConfigured(),
    metadata: { model: options.model, content_key: options.key } });
  try { return await run(); }
  finally {
    // Delivery is awaited before the request ends. Tracing cannot make a working model call fail.
    if (tracingConfigured()) await traces.awaitPendingTraceBatches().catch((error: unknown) => console.error("LangSmith trace delivery failed:", error));
  }
}
