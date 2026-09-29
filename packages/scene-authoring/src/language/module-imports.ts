import ts from 'typescript'

export interface ModuleImport {
  specifier: string
  start: number
  end: number
  dynamic: boolean
  typeOnly: boolean
  names: string[]
}

/** TS syntax is the authority: comments and quoted examples are never imports. */
export function inspectModuleImports(source: string): {
  imports: ModuleImport[]
  dynamicExpressions: number[]
} {
  const file = ts.createSourceFile(
    'module.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  const imports: ModuleImport[] = [],
    dynamicExpressions: number[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const clause = ts.isImportDeclaration(node)
        ? node.importClause
        : undefined
      const bindings = clause?.namedBindings
      const named =
        bindings && ts.isNamedImports(bindings) ? bindings.elements : undefined
      const exports =
        ts.isExportDeclaration(node) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements
          : undefined
      const elements = named ?? exports
      imports.push({
        specifier: node.moduleSpecifier.text,
        start: node.moduleSpecifier.getStart(file) + 1,
        end: node.moduleSpecifier.end - 1,
        dynamic: false,
        typeOnly:
          !!(ts.isExportDeclaration(node)
            ? node.isTypeOnly
            : clause?.isTypeOnly) ||
          !!(!clause?.name && elements?.length && elements.every((e) => e.isTypeOnly)),
        names: elements
          ? [...(clause?.name ? ['default'] : []), ...elements
              .filter((e) => !e.isTypeOnly)
              .map((e) => (e.propertyName ?? e.name).text)]
          : ['*'],
      })
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteralLike(arg))
        imports.push({
          specifier: arg.text,
          start: arg.getStart(file) + 1,
          end: arg.end - 1,
          dynamic: true,
          typeOnly: false,
          names: ['*'],
        })
      else dynamicExpressions.push(node.getStart(file))
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { imports, dynamicExpressions }
}

export function rewriteModuleImports(
  source: string,
  rewrite: (specifier: string) => string | undefined,
): string {
  let result = source
  for (const item of inspectModuleImports(source).imports.sort(
    (a, b) => b.start - a.start,
  )) {
    const replacement = rewrite(item.specifier)
    if (replacement !== undefined)
      result =
        result.slice(0, item.start) + replacement + result.slice(item.end)
  }
  return result
}
