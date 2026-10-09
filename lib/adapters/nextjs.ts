import { ts } from "ts-morph";
import type { AdapterFile, FrameworkAdapter, ParsedRoute } from "../parser/types";
import { ownerDirectory, relativeTo, type FrameworkRoot } from "./scope";
import { genericConvention, reactRole } from "./react";
import { exported, hasDirective, httpMethods, joinRoute, literal, objectValue, propertyName, unwrap, walk } from "./syntax";

interface Configuration { known: boolean; base: string; extensions: string[]; trailing: boolean }
function configuration(source: ts.SourceFile | undefined, configured: boolean): Configuration {
  const result: Configuration = { known: !configured, base: "", extensions: ["tsx", "ts", "jsx", "js"], trailing: false };
  if (!source) return result;
  const assignments = source.statements.filter(ts.isExportAssignment).filter((node) => !node.isExportEquals).map((node) => node.expression);
  for (const node of source.statements) if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)
    && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.expression.left.getText(source) === "module.exports") assignments.push(node.expression.right);
  if (assignments.length !== 1) return result;
  const object = objectValue(source, assignments[0]);
  if (!object) return result;
  result.known = true;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || propertyName(property.name) === null) { result.known = false; break; }
    const name = propertyName(property.name);
    if (name === "basePath") {
      const base = literal(property.initializer);
      if (base === null || base !== "" && (!base.startsWith("/") || base.endsWith("/"))) result.known = false;
      else result.base = base;
    } else if (name === "pageExtensions") {
      const value = unwrap(property.initializer);
      const extensions = ts.isArrayLiteralExpression(value) ? value.elements.map(literal) : [];
      if (!extensions.length || extensions.some((entry) => entry === null || !/^[a-z.]+$/.test(entry))) result.known = false;
      else result.extensions = extensions.filter((entry): entry is string => entry !== null).sort((a, b) => b.length - a.length);
    } else if (name === "trailingSlash") {
      const value = unwrap(property.initializer);
      if (value.kind !== ts.SyntaxKind.TrueKeyword && value.kind !== ts.SyntaxKind.FalseKeyword) result.known = false;
      else result.trailing = value.kind === ts.SyntaxKind.TrueKeyword;
    } else if (name === "i18n" || name === "exportPathMap") result.known = false;
  }
  return result;
}
function stem(filename: string, extensions: readonly string[]) {
  const extension = extensions.find((entry) => filename.endsWith("." + entry));
  return extension ? filename.slice(0, -extension.length - 1) : null;
}
function routePath(file: string, root: FrameworkRoot, config: Configuration) {
  if (!config.known) return null;
  if (root.app && file.startsWith(root.app + "/")) {
    const segments = file.slice(root.app.length + 1).split("/");
    const name = stem(segments.pop() ?? "", config.extensions);
    if (name !== "page" && name !== "route" || segments.some((part) => part.startsWith("_") || /^\(\./.test(part))) return null;
    const pattern = joinRoute(config.base, ...segments.filter((part) => !part.startsWith("@") && !/^\(.+\)$/.test(part)));
    return pattern && config.trailing && pattern !== "/" ? pattern + "/" : pattern;
  }
  if (root.pages && file.startsWith(root.pages + "/")) {
    const relative = file.slice(root.pages.length + 1);
    const name = stem(relative, config.extensions);
    if (!name || ["_app", "_document", "_error"].includes(name)) return null;
    const pattern = joinRoute(config.base, name.replace(/(?:^|\/)index$/, ""));
    return pattern && config.trailing && pattern !== "/" ? pattern + "/" : pattern;
  }
  return null;
}
function appMethods(source: ts.SourceFile): { method: string; node: ts.Node }[] {
  const methods: { method: string; node: ts.Node }[] = [];
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && node.body && exported(node) && node.name && httpMethods.has(node.name.text)) methods.push({ method: node.name.text, node });
    if (ts.isVariableStatement(node) && exported(node)) for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && httpMethods.has(declaration.name.text) && declaration.initializer) methods.push({ method: declaration.name.text, node: declaration });
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) if (!element.isTypeOnly && httpMethods.has(element.name.text)) methods.push({ method: element.name.text, node: element });
    }
  }
  return methods.filter((entry, index) => methods.findIndex((candidate) => candidate.method === entry.method) === index);
}
function pagesMethods(source: ts.SourceFile): { method: string; node: ts.Node }[] {
  const handlers: (ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction)[] = source.statements.filter(ts.isFunctionDeclaration).filter((node) => ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
  for (const node of source.statements) if (ts.isExportAssignment(node) && !node.isExportEquals) {
    const value = unwrap(node.expression);
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) handlers.push(value);
    if (ts.isIdentifier(value)) {
      const declaration = source.statements.find((entry): entry is ts.FunctionDeclaration => ts.isFunctionDeclaration(entry) && entry.name?.text === value.text);
      if (declaration) handlers.push(declaration);
    }
  }
  if (handlers.length !== 1) return [];
  const handler = handlers[0]; const parameter = handler.parameters[0];
  if (!parameter || !ts.isIdentifier(parameter.name)) return [];
  const requestName = parameter.name.text;
  const matches = (node: ts.Expression) => ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === requestName && node.name.text === "method";
  const methods: { method: string; node: ts.Node }[] = [];
  walk(handler, (node) => {
    if (node !== handler && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return false;
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(node.operatorToken.kind)) {
      const method = matches(node.left) ? literal(node.right) : matches(node.right) ? literal(node.left) : null;
      if (method && httpMethods.has(method)) methods.push({ method, node });
    }
    if (ts.isSwitchStatement(node) && matches(node.expression)) for (const clause of node.caseBlock.clauses) {
      const method = ts.isCaseClause(clause) ? literal(clause.expression) : null;
      if (method && httpMethods.has(method)) methods.push({ method, node: clause });
    }
  });
  return methods.filter((entry, index) => methods.findIndex((candidate) => candidate.method === entry.method) === index);
}
export function createNextAdapter(roots: readonly FrameworkRoot[], directories: readonly string[]): FrameworkAdapter {
  const configurations = new Map<string, Configuration>();
  const rootFor = (file: AdapterFile) => roots.find((root) => ownerDirectory(file.path, directories) === root.directory);
  return {
    name: "nextjs",
    prepare(files) { for (const root of roots) configurations.set(root.directory, configuration(files.find((file) => file.path === root.config)?.syntax, root.config !== null)); },
    classify(file) {
      const root = rootFor(file); if (!root) return null;
      const conventional = genericConvention(file); if (conventional) return conventional;
      const config = configurations.get(root.directory) ?? configuration(undefined, false);
      const basename = stem(file.path.split("/").at(-1) ?? "", config.extensions);
      if (root.app && file.path.startsWith(root.app + "/")) {
        if (file.path.slice(root.app.length + 1).split("/").slice(0, -1).some((part) => part.startsWith("_"))) return reactRole(file);
        if (basename === "page") return "page";
        if (basename === "route") return "route";
        if (["layout", "template"].includes(basename ?? "")) return "layout";
      }
      if (root.pages && file.path.startsWith(root.pages + "/")) {
        const name = stem(relativeTo(file.path, root.pages), config.extensions);
        if (["_app", "_document", "_error"].includes(name ?? "")) return "layout";
        if (name) return name.startsWith("api/") ? "route" : "page";
      }
      if (hasDirective(file.syntax.statements, "use server")) return "action";
      let action = false;
      walk(file.syntax, (node) => {
        if (ts.isBlock(node) && ts.isFunctionLike(node.parent) && hasDirective(node.statements, "use server")) action = true;
      });
      return action ? "action" : reactRole(file);
    },
    routes(file): ParsedRoute[] {
      const root = rootFor(file); if (!root) return [];
      const config = configurations.get(root.directory); if (!config) return [];
      const pattern = routePath(file.path, root, config); if (!pattern) return [];
      const app = root.app !== null && file.path.startsWith(root.app + "/");
      const api = app ? stem(file.path.split("/").at(-1) ?? "", config.extensions) === "route" : root.pages !== null && relativeTo(file.path, root.pages).startsWith("api/");
      const page = file.syntax.statements.find((node) => ts.isExportAssignment(node) && !node.isExportEquals
        || ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
      const methods = api ? app ? appMethods(file.syntax) : pagesMethods(file.syntax) : page ? [{ method: "GET", node: page }] : [];
      return methods.map(({ method, node }) => ({ file: file.path, method, path: pattern, line: file.syntax.getLineAndCharacterOfPosition(node.getStart(file.syntax)).line + 1 }));
    },
  };
}
