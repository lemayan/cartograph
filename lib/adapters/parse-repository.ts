import { parseSelectedRepository, selectRepository } from "../parser/parse";
import { detectAdapter } from "./detect";

export async function parseFrameworkRepository(directory: string) {
  const selected = await selectRepository(directory);
  return parseSelectedRepository(selected, await detectAdapter(selected));
}
