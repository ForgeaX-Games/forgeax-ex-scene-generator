import ts from 'typescript'

import { defineAtomic } from '../contracts/atomic.js'
import type { AtomicNodeFunctionContract, AtomicNodeFunctionContractDefinition } from '../model/types.js'

export interface ParsedAtomicContracts {
  contracts: AtomicNodeFunctionContract[]
  diagnostics: Array<{ code: string; message: string; file: string; start?: number }>
}

function staticValue(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const value = staticValue(node.operand)
    if (typeof value === 'number') return -value
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => staticValue(item as ts.Expression))
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {}
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        throw new TypeError('Atomic Contract objects only allow static property assignments.')
      }
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
        ? property.name.text
        : undefined
      if (!name) throw new TypeError('Atomic Contract property names must be static.')
      if (ts.isShorthandPropertyAssignment(property)) {
        throw new TypeError(`Atomic Contract shorthand '${name}' is not static.`)
      }
      value[name] = staticValue(property.initializer)
    }
    return value
  }
  throw new TypeError(`Unsupported Atomic Contract expression '${ts.SyntaxKind[node.kind]}'.`)
}

/** Parse only exported, static defineAtomic calls; no module code is executed. */
export function parseAtomicContractSource(source: string, file: string): ParsedAtomicContracts {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const contracts: AtomicNodeFunctionContract[] = []
  const diagnostics: ParsedAtomicContracts['diagnostics'] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineAtomic'
    ) {
      try {
        if (node.arguments.length !== 1) throw new TypeError('defineAtomic requires exactly one static object argument.')
        const definition = staticValue(node.arguments[0]) as AtomicNodeFunctionContractDefinition
        contracts.push(defineAtomic(definition))
      } catch (error) {
        diagnostics.push({
          code: 'SCENE_ATOMIC_CONTRACT_STATIC',
          message: error instanceof Error ? error.message : String(error),
          file,
          start: node.getStart(sourceFile),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  for (const statement of sourceFile.statements) {
    const exported = ts.isExportAssignment(statement) ||
      (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword))
    if (exported) visit(statement)
  }
  if (contracts.length === 0 && diagnostics.length === 0) {
    diagnostics.push({
      code: 'SCENE_ATOMIC_CONTRACT_MISSING',
      message: 'No defineAtomic declaration was found.',
      file,
    })
  }
  return { contracts, diagnostics }
}
