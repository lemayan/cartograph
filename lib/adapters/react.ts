import { ts } from "ts-morph";
import type { AdapterFile } from "../parser/types";
import { importedName, importedNames, walk } from "./syntax";

export function genericConvention(file: Readonly<AdapterFile>): string | null {
  const stem = file.path.split("/").at(-1)?.replace(/\.[cm]?[jt]sx?$/, "") ?? "";
  if (/(?:^|\/)(__tests__|tests?)(?:\/|$)/.test(file.path) || /\.(test|spec)$/.test(stem)) return "test";
  if (/\.d\.[cm]?ts$/.test(file.path) || /(?:^|\/)types?(?:\/|[.])/.test(file.path)) return "type";
  if (/(?:^|\/)\w*[.-]?config(?:\.[cm]?[jt]s)?$/.test(file.path)) return "config";
  return null;
}
export function reactRole(file: Readonly<AdapterFile>): string | null {
  const conventional = genericConvention(file);
  if (conventional) return conventional;
  const stem = file.path.split("/").at(-1)?.replace(/\.[cm]?[jt]sx?$/, "") ?? "";
  if (/^use[A-Z]/.test(stem)) return "hook";
  const names = importedNames(file.syntax, "react");
  const defaults = new Set(file.syntax.statements.filter(ts.isImportDeclaration)
    .filter((node) => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "react" && !node.importClause?.isTypeOnly)
    .flatMap((node) => node.importClause?.name ? [node.importClause.name.text] : []));
  let context = false; let jsx = false;
  walk(file.syntax, (node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const name = ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && defaults.has(expression.expression.text)
        ? expression.name.text : importedName(expression, names);
      if (name === "createContext") context = true;
      if (name === "createElement") jsx = true;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) jsx = true;
  });
  if (context) return "context";
  if (jsx) return "component";
  if (/(?:^|\/)(utils?|utilities|lib)(?:\/|$)/.test(file.path)) return "utility";
  return null;
}
