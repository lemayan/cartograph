import type { ParsedFile } from "../parser/types";

const entryKinds = new Set(["page", "route", "action", "controller", "module", "layout", "middleware", "proxy", "config"]);
const appEntries = new Set(["page", "route", "layout", "template", "loading", "error", "global-error", "not-found", "default",
  "sitemap", "robots", "manifest", "icon", "apple-icon", "opengraph-image", "twitter-image", "instrumentation-client"]);

/** Conservative exclusions, not role assignments or proof that a file is used.
 * These also protect nested framework examples while the snapshot has no role adapter.
 */
export function frameworkEntryFiles(files: readonly ParsedFile[]): Set<string> {
  const docusaurusFolders = new Set(files.filter((file) => /(?:^|\/)docusaurus\.config\.[cm]?[jt]s$/.test(file.path)).map((file) => file.folder));
  return new Set(files.filter((file) => {
    if (file.kind !== null && entryKinds.has(file.kind)) return true;
    const parts = file.path.split("/");
    const basename = parts.at(-1) ?? "";
    const stem = basename.replace(/\.(?:[cm]?[jt]sx?)$/, "");
    if (/(?:^|\.)config(?:\.|$)/.test(stem) || /^\.[\w-]+rc$/.test(stem)
      || /^(?:middleware|proxy|instrumentation|instrumentation-client)$/.test(stem)) return true;
    if (parts.includes(".storybook") && ["main", "preview", "manager"].includes(stem)) return true;
    if (stem === "sidebars" && docusaurusFolders.has(file.folder)) return true;
    if (parts.includes("pages") || parts.includes("routes")) return true;
    return parts.includes("app") && appEntries.has(stem);
  }).map((file) => file.path));
}
