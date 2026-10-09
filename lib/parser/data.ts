import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateParserResult } from "./contract";
import type { ParserResult } from "./types";

export { validateParserResult } from "./contract";

export async function readParserResult(filename: string): Promise<ParserResult> {
  const value: unknown = JSON.parse(await readFile(filename, "utf8"));
  return validateParserResult(value);
}

export async function writeParserResult(filename: string, result: ParserResult): Promise<void> {
  if (path.extname(filename) !== ".json") throw new Error("Parser output must be a .json file");
  validateParserResult(result);
  await mkdir(path.dirname(path.resolve(filename)), { recursive: true });
  await writeFile(filename, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
