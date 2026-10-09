import { ts } from "ts-morph";

export const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node;
}
export function literal(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  const value = unwrap(node);
  return ts.isStringLiteralLike(value) ? value.text : null;
}
export function literalPaths(node: ts.Expression | undefined): string[] | null {
  if (!node) return [""];
  const value = unwrap(node);
  if (ts.isArrayLiteralExpression(value)) {
    const paths = value.elements.map(literal);
    return paths.every((entry): entry is string => entry !== null) ? paths : null;
  }
  const path = literal(value);
  return path === null ? null : [path];
}
export function importedNames(source: ts.SourceFile, from: string) {
  const names = new Map<string, string>();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== from || node.importClause?.isTypeOnly) continue;
    const binding = node.importClause?.namedBindings;
    if (binding && ts.isNamedImports(binding)) for (const element of binding.elements) {
      if (!element.isTypeOnly) names.set(element.name.text, element.propertyName?.text ?? element.name.text);
    }
    if (binding && ts.isNamespaceImport(binding)) names.set(binding.name.text, "*");
  }
  return names;
}
export function importedName(expression: ts.Expression, names: ReadonlyMap<string, string>): string | null {
  if (ts.isIdentifier(expression)) return names.get(expression.text) ?? null;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && names.get(expression.expression.text) === "*") return expression.name.text;
  return null;
}
export function walk(node: ts.Node, visit: (node: ts.Node) => void | boolean): void {
  if (visit(node) === false) return;
  ts.forEachChild(node, (child) => walk(child, visit));
}
export function hasDirective(statements: ts.NodeArray<ts.Statement>, directive: string) {
  for (const node of statements) {
    if (!ts.isExpressionStatement(node) || !ts.isStringLiteralLike(node.expression)) return false;
    if (node.expression.text === directive) return true;
  }
  return false;
}
export function exported(node: ts.Node) {
  return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}
export function objectValue(source: ts.SourceFile, expression: ts.Expression): ts.ObjectLiteralExpression | null {
  const value = unwrap(expression);
  if (ts.isObjectLiteralExpression(value)) return value;
  if (!ts.isIdentifier(value)) return null;
  const declarations = source.statements.filter(ts.isVariableStatement).flatMap((node) => [...node.declarationList.declarations])
    .filter((node) => ts.isIdentifier(node.name) && node.name.text === value.text);
  if (declarations.length !== 1 || !(declarations[0].parent.flags & ts.NodeFlags.Const)) return null;
  let references = 0;
  walk(source, (node) => {
    if (!ts.isIdentifier(node) || node.text !== value.text) return;
    if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
      || ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
    references++;
  });
  // A declaration and its one export/decorator use are recoverable. Other uses may
  // mutate the object; evaluating them would invent configuration.
  if (references !== 2) return null;
  const initializer = declarations[0].initializer;
  if (!initializer) return null;
  const object = unwrap(initializer);
  return ts.isObjectLiteralExpression(object) ? object : null;
}
export function propertyName(node: ts.PropertyName): string | null {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;
}
export function joinRoute(...parts: string[]): string | null {
  if (parts.some((part) => /[\x00-\x1f\x7f?#]/.test(part))) return null;
  return "/" + parts.map((part) => part.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
}
