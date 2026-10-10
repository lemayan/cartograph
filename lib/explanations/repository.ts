import "server-only";
import { createHash } from "node:crypto";
import { publicRepository } from "../pipeline/repository";

async function github(url: string, missing = false) {
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Cartograph", Accept: "application/vnd.github+json" } });
  if (missing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not check repository freshness (GitHub HTTP ${response.status}). Retry after GitHub is available.`);
  return response;
}
export async function repositoryHead(repositoryUrl: string) {
  const repository = publicRepository(repositoryUrl);
  const response = await github(`https://api.github.com/repos/${repository.owner}/${repository.name}/commits/HEAD`);
  const value: unknown = await response?.json();
  if (typeof value !== "object" || value === null || !("sha" in value) || typeof value.sha !== "string" || !/^[0-9a-f]{40}$/.test(value.sha)) {
    throw new Error("GitHub did not return the current repository commit.");
  }
  return value.sha;
}
export async function repositorySource(repositoryUrl: string, commit: string, file: string) {
  const repository = publicRepository(repositoryUrl);
  if (!/^[0-9a-f]{40}$/.test(commit) || file.split("/").some((part) => !part || part === "." || part === "..") || /[\\\x00-\x1f]/.test(file)) {
    throw new Error("Invalid source path or commit.");
  }
  const response = await github(`https://raw.githubusercontent.com/${repository.owner}/${repository.name}/${commit}/${file.split("/").map(encodeURIComponent).join("/")}`, true);
  if (!response) return null;
  if (!response.body) throw new Error(`Empty source response for ${file}.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error(`Source ${file} exceeds the 1 MiB AI input limit.`);
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  return { contents: bytes.toString("utf8"), hash: createHash("sha256").update(bytes).digest("hex") };
}
