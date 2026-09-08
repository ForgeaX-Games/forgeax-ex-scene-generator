import { createSceneDiagnostic } from '../diagnostics/diagnostics.js'
import { parseSceneModule } from '../language/parser.js'
import { printSceneModule } from '../language/printer.js'
import type {
  ContractRegistry,
  NodeFunctionContract,
  SceneDefinitionPort,
  SceneDiagnostic,
  SceneExpression,
  SceneModuleAst,
  ScenePortTypeName,
} from '../model/types.js'

export function referencesBinding(expression: SceneExpression, binding: string): boolean {
  if (expression.kind === 'reference') return expression.binding === binding
  if (expression.kind === 'callable') return false
  if (expression.kind === 'array') return expression.items.some((item) => referencesBinding(item, binding))
  if (expression.kind === 'object') return Object.values(expression.properties).some((item) => referencesBinding(item, binding))
  return false
}

export function removeReference(
  expression: SceneExpression,
  binding: string,
  output?: string,
): SceneExpression | undefined {
  if (expression.kind === 'reference') {
    return expression.binding === binding && (output === undefined || expression.output === output)
      ? undefined
      : expression
  }
  if (expression.kind === 'callable') return expression
  if (expression.kind === 'array') {
    const items = expression.items.flatMap((item) => {
      const next = removeReference(item, binding, output)
      return next ? [next] : []
    })
    return items.length ? { ...expression, items } : undefined
  }
  if (expression.kind === 'object') {
    const properties = Object.fromEntries(Object.entries(expression.properties).flatMap(([name, item]) => {
      const next = removeReference(item, binding, output)
      return next ? [[name, next]] : []
    }))
    return Object.keys(properties).length ? { ...expression, properties } : undefined
  }
  return expression
}

export function commandDiagnostic(
  code: string,
  message: string,
  phase: SceneDiagnostic['phase'],
  statementId?: string,
): SceneDiagnostic {
  return createSceneDiagnostic({
    code,
    phase,
    severity: 'error',
    message,
    ...(statementId ? { statementId } : {}),
  })
}

export function cloneExpression(expression: SceneExpression): SceneExpression {
  if (expression.kind === 'callable') return { kind: 'callable', functionName: expression.functionName }
  if (expression.kind === 'array') return { kind: 'array', items: expression.items.map(cloneExpression) }
  if (expression.kind === 'object') {
    return {
      kind: 'object',
      properties: Object.fromEntries(Object.entries(expression.properties).map(([key, value]) => [key, cloneExpression(value)])),
    }
  }
  return { ...expression }
}

export function rewriteExpression(
  expression: SceneExpression,
  rewrite: (reference: Extract<SceneExpression, { kind: 'reference' }>) => SceneExpression | undefined,
): SceneExpression {
  if (expression.kind === 'reference') return rewrite(expression) ?? expression
  if (expression.kind === 'callable') return expression
  if (expression.kind === 'array') return { ...expression, items: expression.items.map((item) => rewriteExpression(item, rewrite)) }
  if (expression.kind === 'object') {
    return {
      ...expression,
      properties: Object.fromEntries(
        Object.entries(expression.properties).map(([key, value]) => [key, rewriteExpression(value, rewrite)]),
      ),
    }
  }
  return expression
}

export function cloneModule(input: SceneModuleAst): SceneModuleAst {
  return {
    ...input,
    imports: input.imports.map((item) => ({
      ...item,
      names: [...item.names],
      specifiers: item.specifiers.map((specifier) => ({ ...specifier })),
      source: { ...item.source },
    })),
    exports: input.exports.map((item) => ({ ...item, source: { ...item.source } })),
    definitions: input.definitions.map((definition) => ({
      ...definition,
      meta: {
        ...definition.meta,
        inputs: Object.fromEntries(Object.entries(definition.meta.inputs).map(([name, port]) => [name, { ...port }])),
        outputs: Object.fromEntries(Object.entries(definition.meta.outputs).map(([name, port]) => [name, { ...port }])),
      },
      paramNames: [...definition.paramNames],
      body: definition.body.map((statement) => ({
        ...statement,
        args: Object.fromEntries(Object.entries(statement.args).map(([name, value]) => [name, cloneExpression(value)])),
        source: { ...statement.source },
      })),
      returnOutputs: Object.fromEntries(
        Object.entries(definition.returnOutputs).map(([name, value]) => [name, cloneExpression(value)]),
      ),
      source: { ...definition.source },
    })),
    statements: input.statements.map((statement) => ({
      ...statement,
      args: Object.fromEntries(Object.entries(statement.args).map(([name, value]) => [name, cloneExpression(value)])),
      source: { ...statement.source },
    })),
  }
}

export function validBinding(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
}

export function uniqueName(base: string, used: Set<string>): string {
  const normalized = base.replace(/[^A-Za-z0-9_$]/g, '') || 'value'
  const candidate = /^[A-Za-z_$]/.test(normalized) ? normalized : `value${normalized}`
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }
  let suffix = 2
  while (used.has(`${candidate}${suffix}`)) suffix += 1
  const result = `${candidate}${suffix}`
  used.add(result)
  return result
}

export function moduleSpecifier(fromFile: string, toFile: string): string {
  const from = fromFile.replace(/\\/g, '/').split('/')
  const to = toFile.replace(/\\/g, '/').split('/')
  from.pop()
  while (from.length && to.length && from[0] === to[0]) {
    from.shift()
    to.shift()
  }
  const relative = `${'../'.repeat(from.length)}${to.join('/')}`
  return relative.startsWith('.') ? relative : `./${relative}`
}

export function resolveModuleFile(fromFile: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  const parts = [...fromFile.replace(/\\/g, '/').split('/').slice(0, -1), ...specifier.split('/')]
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return normalized.join('/')
}

export function addImport(module: SceneModuleAst, from: string, imported: string, preferredLocal = imported): string {
  const existing = module.imports
    .flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
    .find(({ item, specifier }) => item.from === from && specifier.imported === imported)
  if (existing) return existing.specifier.local
  const used = new Set([
    ...module.imports.flatMap((item) => item.specifiers.map((specifier) => specifier.local)),
    ...module.definitions.map((item) => item.exportName),
    ...module.statements.flatMap((item) => item.binding ? [item.binding] : []),
  ])
  const local = uniqueName(preferredLocal, used)
  const target = module.imports.find((item) => item.from === from)
  if (target) {
    target.specifiers.push({ imported, local })
    target.names.push(local)
  } else {
    module.imports.push({
      names: [local],
      specifiers: [{ imported, local }],
      from,
      source: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
    })
  }
  return local
}

export function addExport(module: SceneModuleAst, local: string, exported = local): void {
  if (!module.exports.some((item) => item.local === local && item.exported === exported)) {
    module.exports.push({
      local,
      exported,
      source: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
    })
  }
}

export function contractPortType(contract: NodeFunctionContract | undefined, direction: 'input' | 'output', port: string): SceneDefinitionPort {
  const candidate = (direction === 'input' ? contract?.inputs : contract?.outputs)?.find((item) => item.name === port)
  const hint = candidate?.runtimeType || candidate?.type
  const catalog: Array<[RegExp, ScenePortTypeName]> = [
    [/^plane$/i, 'Plane'],
    [/^work-grid$/i, 'WorkGrid'],
    [/^region-set$/i, 'RegionSet'],
    [/^road-network$/i, 'RoadNetwork'],
    [/^parcel-set$/i, 'ParcelSet'],
    [/^placement-set$/i, 'PlacementSet'],
    [/scene/i, 'Scene'],
    [/number|float|double|int/i, 'NumberValue'],
    [/string|text/i, 'StringValue'],
    [/bool/i, 'BooleanValue'],
    [/grid/i, 'Grid'],
    [/mesh/i, 'Mesh'],
    [/point/i, 'Point2d'],
  ]
  const type = catalog.find(([pattern]) => pattern.test(hint ?? ''))?.[1] ?? 'Any'
  return {
    type,
    ...(type === 'Any' && hint && hint !== 'any' ? { runtimeType: hint } : {}),
    ...(candidate?.access ? { access: candidate.access } : {}),
  }
}

function semanticModule(module: SceneModuleAst): unknown {
  return {
    moduleId: module.moduleId,
    file: module.file,
    imports: module.imports.map(({ from, specifiers }) => ({ from, specifiers })),
    exports: module.exports.map(({ local, exported }) => ({ local, exported })),
    definitions: module.definitions.map((definition) => ({
      definitionId: definition.definitionId,
      exportName: definition.exportName,
      meta: definition.meta,
      paramNames: definition.paramNames,
      body: definition.body.map(({ source: _source, contractKind: _contractKind, ...statement }) => statement),
      returnOutputs: definition.returnOutputs,
    })),
    statements: module.statements.map(({ source: _source, contractKind: _contractKind, ...statement }) => statement),
  }
}

function stableSemantic(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSemantic).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSemantic(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function verifyCanonicalRoundTrip(module: SceneModuleAst, registry: ContractRegistry): SceneDiagnostic[] {
  const printed = printSceneModule(module)
  const reparsed = parseSceneModule(printed, { file: module.file, moduleId: module.moduleId, registry })
  const diagnostics = reparsed.diagnostics.filter((item) => item.severity === 'error')
  if (diagnostics.length) return diagnostics
  if (stableSemantic(semanticModule(reparsed.module)) !== stableSemantic(semanticModule(module))) {
    return [{
      ...commandDiagnostic(
        'SCENE_COMMAND_ROUNDTRIP_MISMATCH',
        `Canonical print/reparse changed the semantics of module '${module.file}'.`,
        'verify',
      ),
      expected: semanticModule(module),
      actual: semanticModule(reparsed.module),
    }]
  }
  return []
}
