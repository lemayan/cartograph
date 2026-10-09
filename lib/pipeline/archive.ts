import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, readlink, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGunzip } from "node:zlib";
import type { PublicRepository } from "./repository";

const run = promisify(execFile);
const compressedLimit = 50 * 1024 * 1024;
const unpackedLimit = 250 * 1024 * 1024;
const entryLimit = 25000;

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function githubRequest(url: string, fetcher: typeof fetch): Promise<Response> {
  // This job owns the response stream. Next otherwise tees even no-store GETs for
  // deduplication, making redirect cancellation wait on its unread cached branch.
  const signal = new AbortController().signal;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const target = new URL(url);
    if (target.protocol !== "https:" || !["api.github.com", "codeload.github.com"].includes(target.hostname)
      || target.username || target.password || target.port) throw new Error("GitHub returned an unsupported archive redirect.");
    const response = await fetcher(target, { signal, redirect: "manual", cache: "no-store", headers: { "User-Agent": "Cartograph", Accept: "application/vnd.github+json" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("GitHub returned a redirect without a destination.");
      url = new URL(location, target).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 404 ? "The repository was not found or is not public."
        : response.status === 403 || response.status === 429 ? "GitHub refused the request; its anonymous rate limit may have been reached."
          : `GitHub request failed (HTTP ${response.status}).`);
    }
    return response;
  }
  throw new Error("GitHub returned too many redirects.");
}

export function validateArchivePaths(listing: string): void {
  const entries = listing.replace(/\r?\n$/, "").split("\n").map((entry) => entry.replace(/\r$/, ""));
  if (entries.length === 0 || entries.length > entryLimit) throw new Error(`Archive must contain between 1 and ${entryLimit} entries.`);
  const roots = new Set<string>();
  const seen = new Set<string>();
  for (const entry of entries) {
    const parts = entry.replace(/\/$/, "").split("/");
    if (!entry || /[\\:\x00-\x1f\x7f]/.test(entry) || parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error("Archive contains an unsafe or unsupported path.");
    }
    roots.add(parts[0]);
    const key = process.platform === "win32" ? entry.toLowerCase() : entry;
    if (seen.has(key)) throw new Error("Archive contains colliding paths.");
    seen.add(key);
  }
  if (roots.size !== 1) throw new Error("Archive must have exactly one repository root.");
}

async function validateExtractedTree(root: string): Promise<void> {
  const directories = [root];
  let bytes = 0;
  for (let cursor = 0; cursor < directories.length; cursor++) {
    for (const entry of await readdir(directories[cursor], { withFileTypes: true })) {
      const filename = path.join(directories[cursor], entry.name);
      if (entry.isSymbolicLink()) {
        const destination = path.resolve(path.dirname(filename), await readlink(filename));
        if (!inside(root, destination)) throw new Error("Archive contains a symbolic link outside the repository.");
        const resolved = await realpath(filename).catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return destination;
          throw error;
        });
        if (!inside(root, resolved)) throw new Error("Archive contains a symbolic link outside the repository.");
      } else if (entry.isDirectory()) directories.push(filename);
      else if (entry.isFile()) bytes += (await lstat(filename)).size;
      else throw new Error("Archive contains an unsupported filesystem entry.");
      if (bytes > unpackedLimit) throw new Error("Extracted repository exceeds 250 MiB.");
    }
  }
}

/** Repository contents are data: no install, lifecycle script, or repository command is run. */
export async function fetchPublicRepository(repository: PublicRepository, fetcher: typeof fetch = fetch) {
  const endpoint = `https://api.github.com/repos/${repository.owner}/${repository.name}`;
  const metadata: unknown = await (await githubRequest(endpoint, fetcher)).json();
  if (typeof metadata !== "object" || metadata === null || !("private" in metadata) || metadata.private !== false
    || !("default_branch" in metadata) || typeof metadata.default_branch !== "string" || !metadata.default_branch) {
    throw new Error("GitHub did not return a public repository with a default branch.");
  }
  const commit: unknown = await (await githubRequest(`${endpoint}/commits/${encodeURIComponent(metadata.default_branch)}`, fetcher)).json();
  if (typeof commit !== "object" || commit === null || !("sha" in commit) || typeof commit.sha !== "string" || !/^[0-9a-f]{40}$/.test(commit.sha)) {
    throw new Error("GitHub did not return a full commit SHA.");
  }
  const commitSha = commit.sha;
  const workspace = await mkdtemp(path.join(tmpdir(), "cartograph-fetch-"));
  const directory = path.join(workspace, repository.name);
  const cleanup = async () => {
    if (!inside(path.resolve(tmpdir()), path.resolve(workspace)) || !path.basename(workspace).startsWith("cartograph-fetch-")) {
      throw new Error("Refusing to remove a directory outside the fetch workspace.");
    }
    await rm(workspace, { recursive: true, force: true });
  };
  try {
    const archive = path.join(workspace, "archive.tar.gz");
    const response = await githubRequest(`${endpoint}/tarball/${commitSha}`, fetcher);
    if (!response.body) throw new Error("GitHub returned an empty archive body.");
    const reader = response.body.getReader();
    const handle = await open(archive, "wx");
    let downloaded = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        downloaded += chunk.value.byteLength;
        if (downloaded > compressedLimit) throw new Error("Repository archive exceeds 50 MiB compressed.");
        await handle.writeFile(chunk.value);
      }
    } finally { await reader.cancel(); await handle.close(); }
    const uncompressed = path.join(workspace, "archive.tar");
    let expanded = 0;
    const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      expanded += chunk.length;
      callback(expanded > unpackedLimit ? new Error("Repository archive exceeds 250 MiB uncompressed.") : null, chunk);
    } });
    await pipeline(createReadStream(archive), createGunzip(), bound, createWriteStream(uncompressed, { flags: "wx" }));
    const { stdout } = await run("tar", ["-tf", uncompressed], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    validateArchivePaths(stdout);
    await mkdir(directory);
    // Native tar's default path/link protections remain enabled; never use -P.
    await run("tar", ["-xf", uncompressed, "-C", directory, "--strip-components=1", "--no-same-owner", "--no-same-permissions"], { windowsHide: true });
    await validateExtractedTree(directory);
    return { directory, commitSha, cleanup };
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Fetch failed and its temporary files could not be removed."); }
    throw error;
  }
}
