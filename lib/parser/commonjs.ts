import { ts } from "ts-morph";
import { compare } from "./graph";

/** Local parameters/variables named require, module or exports are ordinary code. */
export function commonjsIdentifier(node: ts.Node, name: string, checker: ts.TypeChecker): node is ts.Identifier {
  return ts.isIdentifier(node) && node.text === name
    && !(checker.resolveName(name, node, ts.SymbolFlags.Value, false)?.declarations ?? []).some((declaration) =>
      // Script globals in other files cannot shadow Node's per-file wrapper. Synthetic export symbols aren't bindings.
      declaration.getSourceFile() === node.getSourceFile()
      && !(ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient)
      && (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration) || ts.isBindingElement(declaration)
        || ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration)
        || ts.isEnumDeclaration(declaration) || ts.isModuleDeclaration(declaration)
        || ts.isImportClause(declaration) || ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration)
        || ts.isImportEqualsDeclaration(declaration)));
}

function property(node: ts.Node): { object: ts.Expression; name: string } | null {
  if (ts.isPropertyAccessExpression(node)) return { object: node.expression, name: node.name.text };
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    return { object: node.expression, name: node.argumentExpression.text };
  }
  return null;
}

function moduleExports(node: ts.Node, checker: ts.TypeChecker): boolean {
  const access = property(node);
  return access?.name === "exports" && commonjsIdentifier(access.object, "module", checker);
}

export function commonjsExportNames(source: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const names = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const access = property(node.left);
      if (moduleExports(node.left, checker)) {
        if (ts.isObjectLiteralExpression(node.right)) {
          for (const member of node.right.properties) {
            if (ts.isSpreadAssignment(member)) continue;
            const name = member.name;
            if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) names.add(name.text);
          }
        } else names.add("default");
      } else if (access && (moduleExports(access.object, checker) || commonjsIdentifier(access.object, "exports", checker))) {
        names.add(access.name);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...names].filter((name) => name.length > 0 && !/[\x00-\x1f\x7f]/.test(name)).sort(compare);
}
