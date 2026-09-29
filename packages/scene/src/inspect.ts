import ts from 'typescript'

import { stableEntityId } from '@forgeax/scene-authoring'

import { sceneCallId, sceneIdFromTrivia } from './ids.js'

export interface SceneInspectArg {
  kind: 'literal' | 'reference' | 'other'
  binding?: string
  /** `world.geometry` keeps the port name so an untraced wire can still draw. */
  output?: string
  value?: string | number | boolean | object
  /** `[origin.geometry, plaza.geometry]` — each slot is itself an inspect arg. */
  items?: SceneInspectArg[]
}

export interface SceneInspectSite {
  id: string
  binding?: string
  functionName?: string
  kind: 'call' | 'literal'
  span: { start: number; end: number; line: number; column: number }
  args: Record<string, SceneInspectArg>
  value?: string | number | boolean | object
}

function trivia(source: string, node: ts.Node, sourceFile: ts.SourceFile): string {
  return source.slice(node.getFullStart(), node.getStart(sourceFile))
}

function literalValue(node: ts.Expression): string | number | boolean | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return -Number(node.operand.text)
  }
  return undefined
}

function calleeName(node: ts.CallExpression, sourceFile: ts.SourceFile): string {
  return node.expression.getText(sourceFile)
}

function jsonValue(node: ts.Expression): unknown | undefined {
  const primitive = literalValue(node)
  if (primitive !== undefined) return primitive
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isObjectLiteralExpression(node)) {
    const record: Record<string, unknown> = {}
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) return undefined
      const name = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined
      if (!name) return undefined
      const value = jsonValue(prop.initializer)
      if (value === undefined && prop.initializer.kind !== ts.SyntaxKind.NullKeyword) return undefined
      record[name] = value
    }
    return record
  }
  if (ts.isArrayLiteralExpression(node)) {
    const items: unknown[] = []
    for (const element of node.elements) {
      if (!ts.isExpression(element)) return undefined
      const value = jsonValue(element)
      if (value === undefined && element.kind !== ts.SyntaxKind.NullKeyword) return undefined
      items.push(value)
    }
    return items
  }
  return undefined
}

function isJsonDictLiteral(value: unknown, allowEmptyArray = false): boolean {
  if (value && typeof value === 'object' && !Array.isArray(value)) return true
  if (!Array.isArray(value)) return false
  if (value.length === 0) return allowEmptyArray
  return value.every((item) => item && typeof item === 'object' && !Array.isArray(item))
}

function inspectArg(node: ts.Expression): SceneInspectArg {
  if (ts.isIdentifier(node)) return { kind: 'reference', binding: node.text }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    return { kind: 'reference', binding: node.expression.text, output: node.name.text }
  }
  const dict = jsonValue(node)
  if (dict !== undefined && isJsonDictLiteral(dict)) return { kind: 'literal', value: dict as object }
  if (ts.isArrayLiteralExpression(node)) {
    return { kind: 'other', items: node.elements.filter(ts.isExpression).map(inspectArg) }
  }
  const value = literalValue(node)
  if (value !== undefined) return { kind: 'literal', value }
  return { kind: 'other' }
}

/** Call-marked slots on an arg, including each item of `[a, b]`. */
export function inspectArgReferences(info: SceneInspectArg): SceneInspectArg[] {
  if (info.items && info.items.length > 0) {
    return info.items.flatMap(inspectArgReferences)
  }
  return info.kind === 'reference' && info.binding ? [info] : []
}

export function inspectSceneSource(source: string, file: string): SceneInspectSite[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const sites: SceneInspectSite[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        const start = node.getStart(sourceFile)
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(start)
        if (ts.isCallExpression(declaration.initializer)) {
          const id = sceneCallId(source, file, declaration.initializer, sourceFile)
          const args: Record<string, SceneInspectArg> = {}
          const arg0 = declaration.initializer.arguments[0]
          if (arg0 && ts.isObjectLiteralExpression(arg0)) {
            for (const prop of arg0.properties) {
              if (ts.isShorthandPropertyAssignment(prop)) {
                args[prop.name.text] = { kind: 'reference', binding: prop.name.text }
                continue
              }
              if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue
              args[prop.name.text] = inspectArg(prop.initializer)
            }
          }
          sites.push({
            id,
            binding: declaration.name.text,
            functionName: calleeName(declaration.initializer, sourceFile),
            kind: 'call',
            span: { start, end: node.getEnd(), line: line + 1, column: character + 1 },
            args,
          })
          continue
        }
        const json = jsonValue(declaration.initializer)
        if (json !== undefined && isJsonDictLiteral(json, true)) {
          const id = sceneIdFromTrivia(trivia(source, node, sourceFile))
            ?? stableEntityId('stmt', `${file}:${line + 1}:${character + 1}:${declaration.name.text}`)
          sites.push({
            id,
            binding: declaration.name.text,
            kind: 'literal',
            span: { start, end: node.getEnd(), line: line + 1, column: character + 1 },
            args: {},
            value: json as object,
          })
          continue
        }
        const value = literalValue(declaration.initializer)
        if (value !== undefined) {
          const id = sceneIdFromTrivia(trivia(source, node, sourceFile))
            ?? stableEntityId('stmt', `${file}:${line + 1}:${character + 1}:${declaration.name.text}`)
          sites.push({
            id,
            binding: declaration.name.text,
            kind: 'literal',
            span: { start, end: node.getEnd(), line: line + 1, column: character + 1 },
            args: {},
            value,
          })
        }
      }
    } else if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const start = node.getStart(sourceFile)
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(start)
      const id = sceneCallId(source, file, node.expression, sourceFile)
      const args: Record<string, SceneInspectArg> = {}
      const arg0 = node.expression.arguments[0]
      if (arg0 && ts.isObjectLiteralExpression(arg0)) {
        for (const prop of arg0.properties) {
          if (ts.isShorthandPropertyAssignment(prop)) {
            args[prop.name.text] = { kind: 'reference', binding: prop.name.text }
            continue
          }
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue
          args[prop.name.text] = inspectArg(prop.initializer)
        }
      }
      sites.push({
        id,
        functionName: calleeName(node.expression, sourceFile),
        kind: 'call',
        span: { start, end: node.getEnd(), line: line + 1, column: character + 1 },
        args,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return sites
}

export function findSceneSite(source: string, file: string, id: string): SceneInspectSite | undefined {
  return inspectSceneSource(source, file).find((site) => site.id === id)
}
