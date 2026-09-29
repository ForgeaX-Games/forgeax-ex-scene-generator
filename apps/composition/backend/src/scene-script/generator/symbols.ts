import ts from 'typescript'

export interface GeneratorSymbolInfo {
  name: string
  kind: 'generator' | 'function' | 'variable' | 'method'
  span: { start: number; end: number }
  signature?: string
  snippet: string
}

export function extractGeneratorSymbols(source: string, targetSymbol?: string): {
  symbols: GeneratorSymbolInfo[]
  target?: GeneratorSymbolInfo | null
} {
  const sourceFile = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true)
  const symbols: GeneratorSymbolInfo[] = []
  let matchedTarget: GeneratorSymbolInfo | null = null

  function visit(node: ts.Node) {
    // 1. Function declaration: function name(...) { ... }
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text
      const start = node.getStart(sourceFile)
      const end = node.getEnd()
      const snippet = source.slice(start, end)
      const sym: GeneratorSymbolInfo = {
        name,
        kind: 'function',
        span: { start, end },
        signature: `function ${name}(...)`,
        snippet,
      }
      symbols.push(sym)
      if (targetSymbol && (targetSymbol === name || targetSymbol === `function:${name}`)) {
        matchedTarget = sym
      }
    }

    // 2. Variable statement: export const coastalRelief = defineGenerator({ ... })
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text
          const start = node.getStart(sourceFile)
          const end = node.getEnd()
          const snippet = source.slice(start, end)
          const isGen = decl.initializer && ts.isCallExpression(decl.initializer)
            && (
              (ts.isIdentifier(decl.initializer.expression) && decl.initializer.expression.text === 'defineGenerator')
              || (ts.isPropertyAccessExpression(decl.initializer.expression) && decl.initializer.expression.name.text === 'defineGenerator')
            )
          const sym: GeneratorSymbolInfo = {
            name,
            kind: isGen ? 'generator' : 'variable',
            span: { start, end },
            signature: isGen ? `generator ${name}` : `const ${name}`,
            snippet,
          }
          symbols.push(sym)
          if (targetSymbol && (targetSymbol === name || targetSymbol === `generator:${name}`)) {
            matchedTarget = sym
          }

          // If this is a generator and targetSymbol is 'run' (or generatorName.run)
          if (isGen && decl.initializer && ts.isCallExpression(decl.initializer)) {
            const arg = decl.initializer.arguments[0]
            if (arg && ts.isObjectLiteralExpression(arg)) {
              for (const prop of arg.properties) {
                if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
                  const propName = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : ''
                  if (propName === 'run') {
                    const runStart = prop.getStart(sourceFile)
                    const runEnd = prop.getEnd()
                    const runSym: GeneratorSymbolInfo = {
                      name: `${name}.run`,
                      kind: 'method',
                      span: { start: runStart, end: runEnd },
                      signature: 'run(ctx, args)',
                      snippet: source.slice(runStart, runEnd),
                    }
                    symbols.push(runSym)
                    if (targetSymbol === 'run' || targetSymbol === `${name}.run` || targetSymbol === 'method:run') {
                      matchedTarget = runSym
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { symbols, target: matchedTarget }
}
