import ts from 'typescript'

import { stableEntityId } from '@forgeax/scene-authoring'

const SCENE_ID_RE = /@scene-id\s+([A-Za-z0-9_.:-]+)/
const SCENE_MODULE_ID_RE = /@scene-module-id\s+([A-Za-z0-9_.:-]+)/

export function sceneIdFromTrivia(trivia: string): string | undefined {
  const match = trivia.match(SCENE_ID_RE)
  return match?.[1]
}

export function sceneModuleIdFromSource(source: string): string | undefined {
  const match = source.match(SCENE_MODULE_ID_RE)
  return match?.[1]
}

function leadingTrivia(source: string, node: ts.Node, sourceFile: ts.SourceFile): string {
  return source.slice(node.getFullStart(), node.getStart(sourceFile))
}

function statementOf(node: ts.Node): ts.Node {
  let current: ts.Node = node
  while (current.parent && !ts.isSourceFile(current.parent) && !ts.isBlock(current.parent)) {
    if (ts.isVariableStatement(current) || ts.isExpressionStatement(current) || ts.isExportAssignment(current)) {
      return current
    }
    current = current.parent
  }
  return current
}

export function sceneCallId(
  source: string,
  file: string,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): string {
  const statement = statementOf(call)
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile))
  return sceneIdFromTrivia(leadingTrivia(source, statement, sourceFile))
    ?? stableEntityId('stmt', `${file}:${line + 1}:${character + 1}:${call.expression.getText(sourceFile)}`)
}

export function injectSceneCallIds(source: string, file: string): string {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const insertions: Array<{ at: number; text: string }> = []
  const sdkCalls = new Set<string>(), sdkNamespaces = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !['@forgeax/scene', '@forgeax/scene/runtime'].includes(statement.moduleSpecifier.text)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) if (!element.isTypeOnly) sdkCalls.add(element.name.text)
    if (bindings && ts.isNamespaceImport(bindings)) sdkNamespaces.add(bindings.name.text)
  }
  const isSdkCall = (call: ts.CallExpression): boolean => ts.isIdentifier(call.expression)
    ? sdkCalls.has(call.expression.text)
    : ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression) && sdkNamespaces.has(call.expression.expression.text)


  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isSdkCall(node) && node.arguments.length > 0) {
      const arg0 = node.arguments[0]
      if (ts.isObjectLiteralExpression(arg0)) {
        const already = arg0.properties.some((prop) => (
          ts.isPropertyAssignment(prop)
          && ts.isIdentifier(prop.name)
          && prop.name.text === '__sceneId'
        ))
        if (!already) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          const id = sceneCallId(source, file, node, sourceFile)
          insertions.push({
            at: arg0.getStart(sourceFile) + 1,
            text: ` __sceneId: ${JSON.stringify(id)}, __sceneFile: ${JSON.stringify(file)}, __sceneLine: ${line + 1}, __sceneColumn: ${character + 1},`,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  insertions.sort((a, b) => b.at - a.at)
  let next = source
  for (const item of insertions) {
    next = `${next.slice(0, item.at)}${item.text}${next.slice(item.at)}`
  }
  return next
}
