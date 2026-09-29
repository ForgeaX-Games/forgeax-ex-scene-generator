import ts from 'typescript'

import { createSceneDiagnostic, stableEntityId, type SceneDiagnostic } from '@forgeax/scene-authoring'

import { HOST_FUNCTION_NAMES, primaryOutputPort } from './host.js'
import { sceneIdFromTrivia } from './ids.js'
import { inspectArgReferences, inspectSceneSource } from './inspect.js'

export type SourceEdit =
  | { type: 'updateLiteral'; id: string; path?: string[]; value: number | string | boolean | object | null }
  | { type: 'removeCall'; id: string }
  | { type: 'connectBinding'; id: string; arg: string; binding: string; output?: string; list?: boolean }
  | { type: 'disconnectArg'; id: string; arg: string; fallback?: number | string | boolean | object | null; unset?: boolean; binding?: string; output?: string }
  | {
      type: 'insertCall'
      functionName: string
      id: string
      binding?: string
      args?: Record<string, unknown>
      afterId?: string
    }
  | { type: 'insertLiteral'; id: string; binding: string; value: number | string | boolean | object | null; afterId?: string }
  | { type: 'renameBinding'; id: string; binding: string }

export interface ApplySourceEditsResult {
  source: string
  diagnostics: SceneDiagnostic[]
  applied: number
}

function printValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) return `[${value.map((item) => printValue(item)).join(', ')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith('__'))
      .map(([key, item]) => `${key}: ${printValue(item)}`)
    return `{ ${entries.join(', ')} }`
  }
  return 'undefined'
}

function ensureImport(source: string, names: string[]): string {
  const wanted = names.filter((name) => HOST_FUNCTION_NAMES.includes(name as (typeof HOST_FUNCTION_NAMES)[number]))
  if (wanted.length === 0) return source
  const match = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]@forgeax\/scene['"]/)
  if (match) {
    const existing = new Set(match[1]!.split(',').map((item) => item.trim()).filter(Boolean))
    const missing = wanted.filter((name) => !existing.has(name))
    if (missing.length === 0) return source
    const next = `import { ${[...existing, ...missing].join(', ')} } from '@forgeax/scene'`
    return source.replace(match[0], next)
  }
  return `import { ${wanted.join(', ')} } from '@forgeax/scene'\n${source}`
}

function findStatementById(source: string, file: string, id: string): ts.Statement | undefined {
  const site = inspectSceneSource(source, file).find((item) => item.id === id)
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (site) {
    const bySpan = sourceFile.statements.find((statement) => statement.getStart(sourceFile) === site.span.start)
    if (bySpan) return bySpan
  }
  return sourceFile.statements.find((statement) => (
    sceneIdFromTrivia(source.slice(statement.getFullStart(), statement.getStart(sourceFile))) === id
  ))
}

/** Graph ports for primitive literals. `const n = 16` is a number; `n.value` is undefined. */
const LITERAL_PROJECTION_PORTS = new Set(['value', 'output', 'enabled'])

function literalProjectionPort(value: unknown): string | undefined {
  if (typeof value === 'number') return 'value'
  if (typeof value === 'string') return 'output'
  if (typeof value === 'boolean') return 'enabled'
  if (value && typeof value === 'object') return 'value'
  return undefined
}

function isLiteralBinding(sites: ReturnType<typeof inspectSceneSource>, binding: string): boolean {
  return sites.some((site) => site.kind === 'literal' && site.binding === binding)
}

function printedConnectRef(
  source: string,
  file: string,
  binding: string,
  output: string | undefined,
): string {
  if (!output) return binding
  const sites = inspectSceneSource(source, file)
  if (isLiteralBinding(sites, binding) && LITERAL_PROJECTION_PORTS.has(output)) return binding
  const producer = sites.find((site) => site.binding === binding && site.kind === 'call')
  if (producer && primaryOutputPort(producer.functionName) === output) return binding
  return `${binding}.${output}`
}

/** `createGrid({ columns: n.value })` → `columns: n` when `n` is a number literal. */
export function rewriteLiteralPortAccess(source: string, file: string): string {
  const sites = inspectSceneSource(source, file)
  const ports = new Map<string, string>()
  for (const site of sites) {
    const port = site.kind === 'literal' && site.binding
      ? literalProjectionPort(site.value)
      : site.kind === 'call' && site.binding
        ? primaryOutputPort(site.functionName)
        : undefined
    if (site.binding && port) ports.set(site.binding, port)
  }
  if (ports.size === 0) return source
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const replacements: Array<{ start: number; end: number; text: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const expected = ports.get(node.expression.text)
      if (expected && node.name.text === expected) {
        replacements.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          text: node.expression.text,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  let next = source
  for (const item of replacements.sort((a, b) => b.start - a.start)) {
    next = replaceRange(next, item.start, item.end, item.text)
  }
  return next
}

/** `const` bindings TDZ if the consumer is written above the producer. Canvas drops append, so a later BasePlane wired into an earlier Heightfield must move. */
export function ensureBindingDeclaredBefore(
  source: string,
  file: string,
  binding: string,
  consumerId: string,
): string {
  const sites = inspectSceneSource(source, file)
  const producer = sites.find((item) => item.binding === binding)
  const consumer = sites.find((item) => item.id === consumerId)
  if (!producer || !consumer || producer.span.start <= consumer.span.start) return source
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const producerStmt = sourceFile.statements.find((statement) => statement.getStart(sourceFile) === producer.span.start)
  const consumerStmt = sourceFile.statements.find((statement) => statement.getStart(sourceFile) === consumer.span.start)
  if (!producerStmt || !consumerStmt) return source
  const from = producerStmt.getFullStart()
  const to = producerStmt.getEnd()
  const insertAt = consumerStmt.getFullStart()
  if (from <= insertAt) return source
  const block = source.slice(from, to)
  const text = block.startsWith('\n') ? block : `\n${block}`
  return `${source.slice(0, insertAt)}${text}${source.slice(insertAt, from)}${source.slice(to)}`
}

/** Repair leftover inverted `const` order (`field` above `world` while reading `world.geometry`). */
export function orderReferencedBindings(source: string, file: string): string {
  let next = rewriteLiteralPortAccess(source, file)
  const moved = new Set<string>()
  for (let step = 0; step < 64; step += 1) {
    const sites = inspectSceneSource(next, file)
    let pair: { binding: string; consumerId: string } | undefined
    for (const site of sites) {
      if (site.kind !== 'call') continue
      for (const info of Object.values(site.args)) {
        for (const ref of inspectArgReferences(info)) {
          if (!ref.binding) continue
          const producer = sites.find((item) => item.binding === ref.binding)
          if (!producer || producer.span.start <= site.span.start) continue
          const key = `${producer.id}->${site.id}`
          if (moved.has(key)) continue
          pair = { binding: ref.binding, consumerId: site.id }
          moved.add(key)
          break
        }
        if (pair) break
      }
      if (pair) break
    }
    if (!pair) break
    next = ensureBindingDeclaredBefore(next, file, pair.binding, pair.consumerId)
  }
  return next
}

function replaceRange(source: string, start: number, end: number, text: string): string {
  return `${source.slice(0, start)}${text}${source.slice(end)}`
}

function updateObjectProperty(
  source: string,
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  path: string[],
  printed: string,
): string | undefined {
  const [head, ...rest] = path
  if (!head) return undefined
  const prop = object.properties.find((item): item is ts.PropertyAssignment => (
    ts.isPropertyAssignment(item) && ts.isIdentifier(item.name) && item.name.text === head
  ))
  if (!prop) {
    const insertAt = object.getEnd() - 1
    const inserted = object.properties.length > 0 ? `, ${head}: ${printed}` : ` ${head}: ${printed} `
    return replaceRange(source, insertAt, insertAt, inserted)
  }
  if (rest.length === 0) {
    return replaceRange(source, prop.initializer.getStart(sourceFile), prop.initializer.getEnd(), printed)
  }
  if (ts.isObjectLiteralExpression(prop.initializer)) {
    return updateObjectProperty(source, prop.initializer, sourceFile, rest, printed)
  }
  return undefined
}

function propertyAssignment(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find((item): item is ts.PropertyAssignment => (
    ts.isPropertyAssignment(item) && ts.isIdentifier(item.name) && item.name.text === name
  ))
}

function appendListRef(
  source: string,
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  arg: string,
  printed: string,
): string | undefined {
  const prop = propertyAssignment(object, arg)
  if (!prop) {
    return updateObjectProperty(source, object, sourceFile, [arg], `[${printed}]`)
  }
  if (ts.isArrayLiteralExpression(prop.initializer)) {
    const already = prop.initializer.elements.some((item) => item.getText(sourceFile) === printed)
    if (already) return source
    const insertAt = prop.initializer.getEnd() - 1
    const prefix = prop.initializer.elements.length > 0 ? ', ' : ''
    return replaceRange(source, insertAt, insertAt, `${prefix}${printed}`)
  }
  const old = prop.initializer.getText(sourceFile)
  if (old === printed) return source
  return replaceRange(source, prop.initializer.getStart(sourceFile), prop.initializer.getEnd(), `[${old}, ${printed}]`)
}

function removeListRef(
  source: string,
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  arg: string,
  printed: string,
): string | undefined {
  const prop = propertyAssignment(object, arg)
  if (!prop) return source
  if (!ts.isArrayLiteralExpression(prop.initializer)) {
    return prop.initializer.getText(sourceFile) === printed
      ? removeObjectProperty(source, object, sourceFile, arg)
      : undefined
  }
  const index = prop.initializer.elements.findIndex((item) => item.getText(sourceFile) === printed)
  if (index < 0) return undefined
  if (prop.initializer.elements.length === 1) {
    return removeObjectProperty(source, object, sourceFile, arg)
  }
  const elements = prop.initializer.elements
  const node = elements[index]!
  if (index < elements.length - 1) {
    return replaceRange(source, node.getStart(sourceFile), elements[index + 1]!.getStart(sourceFile), '')
  }
  return replaceRange(source, elements[index - 1]!.getEnd(), node.getEnd(), '')
}

function removeObjectProperty(
  source: string,
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  name: string,
): string | undefined {
  const props = object.properties
  const index = props.findIndex((item) => (
    (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item))
    && ts.isIdentifier(item.name)
    && item.name.text === name
  ))
  if (index < 0) return undefined
  const prop = props[index]!
  if (props.length === 1) {
    return replaceRange(source, prop.getStart(sourceFile), prop.getEnd(), '')
  }
  if (index < props.length - 1) {
    return replaceRange(source, prop.getStart(sourceFile), props[index + 1]!.getStart(sourceFile), '')
  }
  return replaceRange(source, props[index - 1]!.getEnd(), prop.getEnd(), '')
}

function editsToRemoveInlineHelper(source: string, file: string, removedId: string): SourceEdit[] {
  for (const site of inspectSceneSource(source, file)) {
    if (site.kind !== 'call') continue
    for (const arg of Object.keys(site.args)) {
      const info = site.args[arg]
      if (info?.kind !== 'literal' || info.value === undefined) continue
      if (stableEntityId('stmt', `${site.id}:${arg}:literal`) !== removedId) continue
      return [{ type: 'disconnectArg', id: site.id, arg, unset: true }]
    }
  }
  return []
}

function editsToClearRemovedBinding(source: string, file: string, removedId: string): SourceEdit[] {
  const sites = inspectSceneSource(source, file)
  const producer = sites.find((item) => item.id === removedId)
  if (!producer?.binding) return []
  const edits: SourceEdit[] = []
  for (const consumer of sites) {
    if (consumer.id === removedId) continue
    for (const [arg, info] of Object.entries(consumer.args)) {
      const refs = inspectArgReferences(info)
      if (!refs.some((item) => item.binding === producer.binding)) continue
      if (
        producer.kind === 'literal'
        && producer.value !== undefined
        && refs.every((item) => !item.output || LITERAL_PROJECTION_PORTS.has(item.output))
      ) {
        edits.push({ type: 'disconnectArg', id: consumer.id, arg, binding: producer.binding, fallback: producer.value })
        continue
      }
      edits.push({ type: 'disconnectArg', id: consumer.id, arg, binding: producer.binding, output: refs.find((item) => item.binding === producer.binding)?.output, unset: true })
    }
  }
  return edits
}

function applyOne(source: string, file: string, edit: SourceEdit): { source: string; ok: boolean; diagnostic?: SceneDiagnostic } {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = 'id' in edit ? findStatementById(source, file, edit.id) : undefined

  if (edit.type === 'insertCall' || edit.type === 'insertLiteral') {
    const comment = `// @scene-id ${edit.id}\n`
    const text = edit.type === 'insertCall'
      ? `${comment}${edit.binding ? `const ${edit.binding} = ` : ''}${edit.functionName}(${printValue(edit.args ?? {})})\n`
      : `${comment}const ${edit.binding} = ${printValue(edit.value)}\n`
    const after = edit.afterId ? findStatementById(source, file, edit.afterId) : undefined
    const at = after ? after.getEnd() : sourceFile.end
    const prefix = at > 0 && source[at - 1] !== '\n' ? '\n' : ''
    let next = replaceRange(source, at, at, `${prefix}${text}`)
    if (edit.type === 'insertCall') next = ensureImport(next, [edit.functionName])
    return { source: next, ok: true }
  }

  if (!statement) {
    if (edit.type === 'removeCall' || edit.type === 'disconnectArg' || edit.type === 'updateLiteral') {
      return { source, ok: true }
    }
    return {
      source,
      ok: false,
      diagnostic: createSceneDiagnostic({
        code: 'SCENE_WRITEBACK_MISSING',
        phase: 'platform',
        severity: 'error',
        message: `No statement with @scene-id '${'id' in edit ? edit.id : ''}'.`,
        operation: edit.type,
      }),
    }
  }

  if (edit.type === 'removeCall') {
    return { source: replaceRange(source, statement.getFullStart(), statement.getEnd(), ''), ok: true }
  }

  if (edit.type === 'renameBinding' && ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations[0]
    if (declaration && ts.isIdentifier(declaration.name)) {
      return {
        source: replaceRange(source, declaration.name.getStart(sourceFile), declaration.name.getEnd(), edit.binding),
        ok: true,
      }
    }
  }

  if (edit.type === 'updateLiteral') {
    if (ts.isVariableStatement(statement)) {
      const initializer = statement.declarationList.declarations[0]?.initializer
      if (initializer && (!edit.path || edit.path.length === 0) && !ts.isCallExpression(initializer)) {
        return {
          source: replaceRange(source, initializer.getStart(sourceFile), initializer.getEnd(), printValue(edit.value)),
          ok: true,
        }
      }
      if (initializer && ts.isCallExpression(initializer)) {
        const arg0 = initializer.arguments[0]
        if (arg0 && ts.isObjectLiteralExpression(arg0)) {
          const path = edit.path && edit.path.length > 0 ? edit.path : []
          if (path.length === 0) {
            return { source, ok: false }
          }
          const next = updateObjectProperty(source, arg0, sourceFile, path, printValue(edit.value))
          if (next) return { source: next, ok: true }
        }
      }
    }
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      const arg0 = statement.expression.arguments[0]
      if (arg0 && ts.isObjectLiteralExpression(arg0) && edit.path && edit.path.length > 0) {
        const next = updateObjectProperty(source, arg0, sourceFile, edit.path, printValue(edit.value))
        if (next) return { source: next, ok: true }
      }
    }
  }

  if (edit.type === 'connectBinding' || edit.type === 'disconnectArg') {
    const call = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]?.initializer
      : ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
        ? statement.expression
        : undefined
    if (call && ts.isCallExpression(call)) {
      const arg0 = call.arguments[0]
      if (arg0 && ts.isObjectLiteralExpression(arg0)) {
        if (edit.type === 'disconnectArg' && (edit.unset || edit.fallback === undefined)) {
          if (edit.binding) {
            const printed = printedConnectRef(source, file, edit.binding, edit.output)
            const next = removeListRef(source, arg0, sourceFile, edit.arg, printed)
              ?? removeObjectProperty(source, arg0, sourceFile, edit.arg)
            return next ? { source: next, ok: true } : { source, ok: false }
          }
          const next = removeObjectProperty(source, arg0, sourceFile, edit.arg)
          return next ? { source: next, ok: true } : { source, ok: false }
        }
        const printed = edit.type === 'connectBinding'
          ? printedConnectRef(source, file, edit.binding, edit.output)
          : printValue(edit.fallback)
        const existing = propertyAssignment(arg0, edit.arg)?.initializer
        const append = edit.type === 'connectBinding' && (edit.list || (existing && ts.isArrayLiteralExpression(existing)))
        const next = append
          ? appendListRef(source, arg0, sourceFile, edit.arg, printed)
          : updateObjectProperty(source, arg0, sourceFile, [edit.arg], printed)
        if (!next) return { source, ok: false }
        if (edit.type === 'connectBinding') {
          return { source: ensureBindingDeclaredBefore(next, file, edit.binding, edit.id), ok: true }
        }
        return { source: next, ok: true }
      }
    }
  }

  return {
    source,
    ok: false,
    diagnostic: createSceneDiagnostic({
      code: 'SCENE_WRITEBACK_UNSUPPORTED',
      phase: 'platform',
      severity: 'error',
      message: `Could not apply ${edit.type} to '${'id' in edit ? edit.id : ''}'.`,
      operation: edit.type,
    }),
  }
}

export function applySceneSourceEdits(
  source: string,
  edits: readonly SourceEdit[],
  file = 'main.scene.ts',
): ApplySourceEditsResult {
  const removedIds = new Set(
    edits.flatMap((edit) => edit.type === 'removeCall' ? [edit.id] : []),
  )
  const expanded: SourceEdit[] = []
  for (const edit of edits) {
    if (edit.type === 'removeCall') {
      const helper = editsToRemoveInlineHelper(source, file, edit.id)
      expanded.push(...(helper.length > 0 ? helper : editsToClearRemovedBinding(source, file, edit.id)).filter((item) => (
        item.type !== 'disconnectArg' || !removedIds.has(item.id)
      )))
    }
    expanded.push(edit)
  }
  const connectedArgs = new Set(
    expanded
      .filter((item): item is Extract<SourceEdit, { type: 'connectBinding' }> => item.type === 'connectBinding')
      .map((item) => `${item.id}:${item.arg}`),
  )
  const scheduled = expanded.filter((item) => (
    item.type !== 'disconnectArg' || !connectedArgs.has(`${item.id}:${item.arg}`)
  ))
  let next = source
  const diagnostics: SceneDiagnostic[] = []
  let applied = 0
  for (const edit of scheduled) {
    const result = applyOne(next, file, edit)
    next = result.source
    if (result.ok) applied += 1
    else if (result.diagnostic) diagnostics.push(result.diagnostic)
  }
  return { source: next, diagnostics, applied }
}
