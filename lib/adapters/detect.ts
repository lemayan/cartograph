import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fallbackAdapter } from "../parser/adapter";
import type { AdapterFile, FrameworkAdapter } from "../parser/types";
import type { selectRepository } from "../parser/parse";
import { createNextAdapter } from "./nextjs";
import { createNestAdapter } from "./nestjs";
import { createExpressAdapter } from "./express";
import { reactRole } from "./react";
import { ownerDirectory, type FrameworkRoot } from "./scope";

async function exists(root: string, file: string, directory: boolean) {
  try { const value = await stat(path.join(root, file)); return directory ? value.isDirectory() : value.isFile(); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
}
/** Detection is orchestration. Nothing in the parser knows a framework or package name. */
export async function detectAdapter(selection: Awaited<ReturnType<typeof selectRepository>>): Promise<FrameworkAdapter> {
  const manifests = selection.skipped.filter((file) => file.reason === "unsupported_extension" && /(?:^|\/)package\.json$/.test(file.path));
  const packages = await Promise.all(manifests.map(async (file) => {
    const manifest: unknown = JSON.parse(await readFile(path.join(selection.root, file.path), "utf8"));
    const dependencies = new Set<string>();
    if (typeof manifest === "object" && manifest !== null) for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
      if (key in manifest) {
        const value: unknown = Reflect.get(manifest, key);
        if (typeof value === "object" && value !== null && !Array.isArray(value)) for (const name of Object.keys(value)) dependencies.add(name);
      }
    }
    return { directory: path.posix.dirname(file.path), dependencies };
  }));
  const directories = packages.map((item) => item.directory);
  for (const [framework, dependency] of [["nextjs", "next"], ["nestjs", "@nestjs/core"], ["react", "react"], ["express", "express"]] as const) {
    const matching = packages.filter((item) => item.dependencies.has(dependency));
    if (!matching.length) continue;
    if (framework === "express") return createExpressAdapter(matching.map((item) => item.directory), directories);
    const roots = await Promise.all(matching.map(async ({ directory }): Promise<FrameworkRoot> => {
      const at = (file: string) => directory === "." ? file : directory + "/" + file;
      async function first(files: string[], isDirectory: boolean) {
        for (const file of files) if (await exists(selection.root, at(file), isDirectory)) return at(file);
        return null;
      }
      return { directory, app: await first(["app", "src/app"], true), pages: await first(["pages", "src/pages"], true),
        config: await first(["next.config.js", "next.config.mjs", "next.config.ts"], false) };
    }));
    if (framework === "nextjs") return createNextAdapter(roots, directories);
    if (framework === "nestjs") return createNestAdapter(roots, directories);
    return { name: "react", classify: (file: Readonly<AdapterFile>) => roots.some((root) => ownerDirectory(file.path, directories) === root.directory) ? reactRole(file) : null };
  }
  return fallbackAdapter;
}
