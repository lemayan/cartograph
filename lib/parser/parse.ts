import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Project, ts } from "ts-morph";
import { fallbackAdapter } from "./adapter";
import { compare, deduplicateEdges, withFanCounts } from "./graph";
import { inventory, relativePath } from "./inventory";
import { ImportResolver } from "./resolution";
import { countImports } from "./coverage";
import { commonjsExportNames, commonjsIdentifier } from "./commonjs";
import type { AdapterFile, FrameworkAdapter, ImportKind, ImportRecord, ParsedEdge, ParsedFile, ParserResult } from "./types";

export async function selectRepository(directory: string) {
  const root = await realpath(path.resolve(directory));
  if (!(await stat(root)).isDirectory()) throw new Error(`Not a directory: ${root}`);
  const walked = await inventory(root);
  return { root, ...walked };
}

export async function parseRepository(directory: string, adapter: FrameworkAdapter = fallbackAdapter): Promise<ParserResult> {
  return parseSelectedRepository(await selectRepository(directory), adapter);
}

export async function parseSelectedRepository(selection: Awaited<ReturnType<typeof selectRepository>>,
  adapter: FrameworkAdapter = fallbackAdapter): Promise<ParserResult> {
  const { root, ...walked } = selection;
  // Parsing can add syntax/read exclusions without changing the selection supplied by the caller.
  walked.skipped = [...walked.skipped];
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, noResolve: true, jsx: ts.JsxEmit.Preserve },
  });
  const files: ParsedFile[] = [];
  for (const absolute of walked.candidates) {
    const relative = relativePath(root, absolute);
    let buffer: Buffer;
    try {
      buffer = await readFile(absolute);
    } catch (error) {
      walked.skipped.push({ path: relative, reason: "read_error", detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    let contents: string;
    try {
      contents = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (contents.includes("\0")) throw new Error("NUL bytes in source");
    } catch (error) {
      walked.skipped.push({ path: relative, reason: "unsupported_encoding", detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    project.createSourceFile(absolute, contents, { overwrite: true });
    files.push({
      path: relative,
      folder: path.posix.dirname(relative),
      extension: path.extname(relative),
      lines: contents.length === 0 ? 0 : contents.split(/\r\n|\r|\n/).length - (/[\r\n]$/.test(contents) ? 1 : 0),
      hash: createHash("sha256").update(buffer).digest("hex"),
      module: "script",
      kind: null,
      fanIn: 0,
      fanOut: 0,
    });
  }
  const program = project.getProgram().compilerObject;
  const checker = program.getTypeChecker();
  const parsed: ParsedFile[] = [];
  for (const file of files) {
    const source = project.getSourceFileOrThrow(path.join(root, file.path)).compilerNode;
    const diagnostics = program.getSyntacticDiagnostics(source);
    if (diagnostics.length) {
      walked.skipped.push({ path: file.path, reason: "syntax_error", detail: diagnostics.map((diagnostic) => {
        const position = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        return `${position.line + 1}:${position.character + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
      }).join("; ") });
      continue;
    }
    file.module = ts.isExternalModule(source) ? "module" : "script";
    file.commonjsExports = commonjsExportNames(source, checker);
    parsed.push(file);
  }
  const adapterFiles: AdapterFile[] = parsed.map((file) => {
    const syntax = project.getSourceFileOrThrow(path.join(root, file.path)).compilerNode;
    return { path: file.path, folder: file.folder, module: file.module, contents: syntax.text, syntax };
  });
  adapter.prepare?.(adapterFiles);
  const routes = adapterFiles.flatMap((file, index) => {
    parsed[index].kind = adapter.classify(file);
    return adapter.routes?.(file) ?? [];
  });
  const resolver = new ImportResolver(root, parsed.map((file) => file.path), walked.skipped);
  const records: ImportRecord[] = [];
  const edges: ParsedEdge[] = [];
  for (const file of parsed) {
    const source = project.getSourceFileOrThrow(path.join(root, file.path)).compilerNode;
    function record(node: ts.Node, expression: ts.Node | undefined, kind: ImportKind, typeOnly: boolean): void {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      const literal = expression && ts.isStringLiteralLike(expression) ? expression : null;
      const resolution = literal ? resolver.resolve(literal.text, source, literal)
          : { status: "unresolved" as const, target: null, reason: "non_literal_import: target is not a literal string" };
      const found: ImportRecord = {
        source: file.path, line: position.line + 1, column: position.character + 1,
        kind, specifier: literal?.text ?? null, expression: expression?.getText(source) ?? "",
        typeOnly, ...resolution,
      };
      records.push(found);
      if (found.status === "resolved" && found.target) edges.push({ source: file.path, target: found.target, kinds: [kind] });
    }
    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node)) {
        const bindings = node.importClause?.namedBindings;
        const allTypeOnly = bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0
          && !node.importClause?.name && bindings.elements.every((element) => element.isTypeOnly);
        record(node, node.moduleSpecifier, "import", Boolean(node.importClause?.isTypeOnly || allTypeOnly));
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const allTypeOnly = node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0
          && node.exportClause.elements.every((element) => element.isTypeOnly);
        record(node, node.moduleSpecifier, "re-export", Boolean(node.isTypeOnly || allTypeOnly));
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        record(node, node.arguments[0], "dynamic-import", false);
      } else if (ts.isCallExpression(node) && commonjsIdentifier(node.expression, "require", checker)) {
        record(node, node.arguments.length === 1 ? node.arguments[0] : undefined, "require", false);
      } else if (ts.isImportTypeNode(node)) {
        record(node, ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument, "import", true);
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        record(node, node.moduleReference.expression, "require", node.isTypeOnly);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const deduplicated = deduplicateEdges(edges);
  walked.skipped.sort((a, b) => compare(a.path, b.path));
  return {
    schemaVersion: 1,
    repository: path.basename(root),
    adapter: adapter.name,
    files: withFanCounts(parsed, deduplicated),
    edges: deduplicated,
    routes,
    coverage: {
      filesFound: walked.found,
      filesParsed: parsed.length,
      filesSkipped: walked.skipped.length,
      folders: new Set(parsed.map((file) => file.folder)).size,
      skipped: walked.skipped,
      imports: countImports(records),
      byKind: {
        import: countImports(records.filter((record) => record.kind === "import")),
        "re-export": countImports(records.filter((record) => record.kind === "re-export")),
        "dynamic-import": countImports(records.filter((record) => record.kind === "dynamic-import")),
        require: countImports(records.filter((record) => record.kind === "require")),
      },
      records,
    },
  };
}
