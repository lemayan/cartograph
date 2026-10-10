import { ts } from "ts-morph";
import type { AdapterFile, FrameworkAdapter, ParsedRoute } from "../parser/types";
import { ownerDirectory, type FrameworkRoot } from "./scope";
import { genericConvention } from "./react";
import { importedName, importedNames, joinRoute, literal, literalPaths, objectValue, propertyName, walk } from "./syntax";

interface Prefix { known: boolean; path: string }
function conditional(node: ts.Node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent) || ts.isIterationStatement(parent, false) || ts.isSwitchStatement(parent) || ts.isTryStatement(parent)) return true;
  }
  return false;
}
function prefix(files: readonly Readonly<AdapterFile>[]): Prefix {
  let factories = 0; let known = true; let path = ""; let prefixes = 0;
  for (const file of files) {
    const names = importedNames(file.syntax, "@nestjs/core");
    const applications = new Set<string>();
    walk(file.syntax, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        let value = node.initializer;
        if (ts.isAwaitExpression(value)) value = value.expression;
        if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)
          && importedName(value.expression.expression, names) === "NestFactory" && ["create", "createApplicationContext"].includes(value.expression.name.text)) {
          factories++; applications.add(node.name.text);
          if (conditional(node) || value.expression.name.text !== "create") known = false;
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && importedName(node.expression.expression, names) === "RouterModule" && node.expression.name.text === "register") known = false;
    });
    walk(file.syntax, (node) => {
      if (ts.isCallExpression(node) && node.arguments.some((argument) => ts.isIdentifier(argument) && applications.has(argument.text))
        && !ts.isPropertyAccessExpression(node.expression)) known = false;
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      const name = node.expression.name.text;
      if (name === "setGlobalPrefix" || name === "enableVersioning") {
        const own = ts.isIdentifier(node.expression.expression) && applications.has(node.expression.expression.text);
        if (!own || name === "enableVersioning" || conditional(node) || node.arguments.length !== 1) { known = false; return; }
        const value = literal(node.arguments[0]); prefixes++;
        if (value === null || joinRoute(value) === null) known = false;
        else path = value;
      }
    });
  }
  return { known: known && factories === 1 && prefixes <= 1, path };
}
function decorations(node: ts.Node, names: ReadonlyMap<string, string>) {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).flatMap((decorator) => {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression)) return [];
    const name = importedName(expression.expression, names);
    return name ? [{ name, arguments: expression.arguments, node: decorator }] : [];
  });
}
function controllerPaths(source: ts.SourceFile, expression: ts.Expression | undefined): string[] | null {
  if (!expression) return [""];
  const object = objectValue(source, expression);
  if (!object) return literalPaths(expression);
  let paths: string[] | null = [""];
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const name = propertyName(property.name);
    if (name !== "path") return null;
    paths = literalPaths(property.initializer);
  }
  return paths;
}
const suffixes: Readonly<Record<string, string>> = {
  controller: "controller", service: "service", module: "module", entity: "entity", dto: "dto",
  guard: "guard", interceptor: "interceptor", middleware: "middleware", pipe: "pipe", filter: "filter",
};
export function createNestAdapter(roots: readonly FrameworkRoot[], directories: readonly string[]): FrameworkAdapter {
  const prefixes = new Map<string, Prefix>();
  const rootFor = (file: AdapterFile) => roots.find((root) => ownerDirectory(file.path, directories) === root.directory);
  return {
    name: "nestjs",
    prepare(files) { for (const root of roots) prefixes.set(root.directory, prefix(files.filter((file) => ownerDirectory(file.path, directories) === root.directory))); },
    classify(file) {
      if (!rootFor(file)) return null;
      const conventional = genericConvention(file); if (conventional) return conventional;
      const suffix = /\.([a-z]+)\.[cm]?[jt]s$/.exec(file.path)?.[1];
      return suffix && suffixes[suffix] ? suffixes[suffix] : /(?:^|\/)(utils?|lib)(?:\/|$)/.test(file.path) ? "utility" : null;
    },
    routes(file): ParsedRoute[] {
      const root = rootFor(file); if (!root) return [];
      const global = prefixes.get(root.directory); if (!global?.known) return [];
      const names = importedNames(file.syntax, "@nestjs/common");
      const routes: ParsedRoute[] = [];
      for (const declaration of file.syntax.statements) {
        if (!ts.isClassDeclaration(declaration)) continue;
        const controllers = decorations(declaration, names).filter((entry) => entry.name === "Controller");
        if (controllers.length !== 1 || controllers[0].arguments.length > 1 || decorations(declaration, names).some((entry) => entry.name === "Version")) continue;
        const controller = controllerPaths(file.syntax, controllers[0].arguments[0]); if (!controller) continue;
        for (const member of declaration.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          const decorators = decorations(member, names);
          if (decorators.some((entry) => entry.name === "Version")) continue;
          const methods = decorators.filter((entry) => /^(Get|Post|Put|Patch|Delete|Head|Options|All)$/.test(entry.name));
          // Multiple method decorators overwrite metadata rather than declaring multiple routes.
          if (methods.length !== 1 || methods[0].arguments.length > 1) continue;
          const method = methods[0]; const paths = literalPaths(method.arguments[0]); if (!paths) continue;
          for (const prefix of controller) for (const path of paths) {
            const pattern = joinRoute(global.path, prefix, path);
            if (pattern) routes.push({ file: file.path, method: method.name.toUpperCase(), path: pattern,
              line: file.syntax.getLineAndCharacterOfPosition(method.node.getStart(file.syntax)).line + 1 });
          }
        }
      }
      return routes.filter((route, index) => routes.findIndex((entry) => entry.method === route.method && entry.path === route.path && entry.line === route.line) === index);
    },
  };
}
