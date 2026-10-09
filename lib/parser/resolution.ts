import { isBuiltin } from "node:module";
import { realpathSync } from "node:fs";
import path from "node:path";
import { ts } from "ts-morph";
import { directoryExclusion, isInside, relativePath } from "./inventory";
import type { ImportStatus, SkippedFile } from "./types";

interface Resolution {
  status: ImportStatus;
  target: string | null;
  reason: string | null;
}

const defaults: ts.CompilerOptions = {
  allowJs: true,
  resolveJsonModule: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
};

export class ImportResolver {
  private readonly configurations = new Map<string, ts.CompilerOptions>();
  private readonly packages = new Map<string, Set<string>>();
  private readonly selected: Set<string>;
  private readonly skipped: Map<string, SkippedFile>;

  constructor(private readonly root: string, paths: readonly string[], skipped: readonly SkippedFile[]) {
    this.selected = new Set(paths);
    this.skipped = new Map(skipped.map((file) => [file.path, file]));
  }

  private options(directory: string): ts.CompilerOptions {
    const cached = this.configurations.get(directory);
    if (cached) return cached;
    const config = ["tsconfig.json", "jsconfig.json"]
      .map((name) => path.join(directory, name)).find(ts.sys.fileExists);
    let options: ts.CompilerOptions;
    if (config) {
      const read = ts.readConfigFile(config, ts.sys.readFile);
      if (read.error) throw new Error(`${config}: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`);
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, directory, undefined, config);
      // File inclusion is our structural walk. An empty tsc input list is not a broken resolver config.
      const errors = parsed.errors.filter((error) => error.code !== 18003);
      if (errors.length) throw new Error(`${config}: ${errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, " ")).join("; ")}`);
      options = parsed.options;
    } else {
      options = directory === this.root ? defaults : this.options(path.dirname(directory));
    }
    this.configurations.set(directory, options);
    return options;
  }

  private declaredPackages(directory: string): Set<string> {
    const cached = this.packages.get(directory);
    if (cached) return cached;
    const declared = directory === this.root ? new Set<string>() : new Set(this.declaredPackages(path.dirname(directory)));
    const filename = path.join(directory, "package.json");
    const contents = ts.sys.readFile(filename);
    if (contents !== undefined) {
      const json: unknown = JSON.parse(contents);
      if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error(`Invalid package object: ${filename}`);
      for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const values: unknown = Reflect.get(json, section);
        if (typeof values === "object" && values !== null && !Array.isArray(values)) {
          for (const name of Object.keys(values)) declared.add(name);
        }
      }
    }
    this.packages.set(directory, declared);
    return declared;
  }

  resolve(specifier: string, source: ts.SourceFile, literal: ts.StringLiteralLike): Resolution {
    if (isBuiltin(specifier)) return { status: "external", target: null, reason: "node_builtin" };
    const directory = path.dirname(path.resolve(source.fileName));
    const options = this.options(directory);
    // Node's import/require conditions depend on the real extension and nearest package.json.
    source.impliedNodeFormat = ts.getImpliedNodeFormatForFile(source.fileName, undefined, ts.sys, options);
    const mode = ts.getModeForUsageLocation(source, literal, options);
    const resolved = ts.resolveModuleName(specifier, source.fileName, options, ts.sys, undefined, undefined, mode).resolvedModule;
    // TypeScript does not resolve assets like CSS. Only an existing exact path is accepted here.
    const exact = specifier.startsWith(".") || path.isAbsolute(specifier)
      ? path.resolve(path.dirname(source.fileName), specifier) : null;
    const filename = resolved?.resolvedFileName ?? (exact && ts.sys.fileExists(exact) ? exact : null);
    if (filename) {
      const absolute = realpathSync(filename);
      if (!isInside(this.root, absolute)) return { status: "external", target: null, reason: `outside_repository: ${absolute}` };
      const target = relativePath(this.root, absolute);
      if (target.split("/").includes("node_modules")) return { status: "external", target: null, reason: "dependency_package" };
      if (this.selected.has(target)) return { status: "resolved", target, reason: null };
      const skip = this.skipped.get(target);
      const exclusion = target.split("/").slice(0, -1).map(directoryExclusion).find(Boolean);
      return { status: "excluded", target, reason: skip?.reason ?? exclusion ?? "not_selected" };
    }
    const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
    const matchesAlias = Object.keys(options.paths ?? {}).some((alias) => {
      const star = alias.indexOf("*");
      return star === -1 ? alias === specifier : specifier.startsWith(alias.slice(0, star)) && specifier.endsWith(alias.slice(star + 1));
    });
    if (!matchesAlias && this.declaredPackages(directory).has(packageName)) {
      return { status: "external", target: null, reason: "declared_dependency_not_resolved_on_disk" };
    }
    return { status: "unresolved", target: null, reason: `module_not_found: TypeScript could not resolve ${JSON.stringify(specifier)}` };
  }
}
