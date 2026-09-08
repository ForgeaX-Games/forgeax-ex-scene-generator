import ts from 'typescript'

import {
  generatorContractFromMeta,
  normalizeGeneratorVersion,
  type GeneratorDefinitionMeta,
  type GeneratorPortDescriptor,
} from '../contracts/generator.js'
import { isScenePortTypeName } from '../contracts/portTypes.js'
import type { AtomicNodeFunctionContract, ScenePortTypeName } from '../model/types.js'

export interface ParsedGeneratorExport {
  exportName: string
  meta: GeneratorDefinitionMeta
  contract: AtomicNodeFunctionContract
}

export interface ParsedGeneratorSource {
  exports: ParsedGeneratorExport[]
  imports: Array<{ from: string; names: string[] }>
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
  if (ts.isIdentifier(node) && isScenePortTypeName(node.text)) return node.text
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => staticValue(item as ts.Expression))
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {}
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new TypeError('Generator Contract objects only allow static property assignments.')
      }
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
        ? property.name.text
        : undefined
      if (!name) throw new TypeError('Generator Contract property names must be static.')
      value[name] = staticValue(property.initializer)
    }
    return value
  }
  throw new TypeError(`Unsupported Generator Contract expression '${ts.SyntaxKind[node.kind]}'.`)
}

function parsePortMap(value: unknown, field: 'inputs' | 'outputs'): Record<string, GeneratorPortDescriptor> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`defineGenerator ${field} must be a static object literal.`)
  }
  const ports: Record<string, GeneratorPortDescriptor> = {}
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') {
      if (!isScenePortTypeName(raw)) throw new TypeError(`Unknown Scene port type '${raw}'.`)
      ports[name] = { type: raw }
      continue
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError(`defineGenerator ${field}.${name} must be a type or static descriptor.`)
    }
    const descriptor = raw as Record<string, unknown>
    const type = descriptor.type
    if (typeof type !== 'string' || !isScenePortTypeName(type)) {
      throw new TypeError(`defineGenerator ${field}.${name} requires a known identifier type.`)
    }
    ports[name] = {
      type: type as ScenePortTypeName,
      ...(typeof descriptor.runtimeType === 'string' ? { runtimeType: descriptor.runtimeType } : {}),
      ...(typeof descriptor.runtimePort === 'string' ? { runtimePort: descriptor.runtimePort } : {}),
      ...(descriptor.access === 'item' || descriptor.access === 'list' || descriptor.access === 'tree'
        ? { access: descriptor.access }
        : {}),
      ...(typeof descriptor.required === 'boolean' ? { required: descriptor.required } : {}),
      ...(descriptor.mode === 'parameter' || descriptor.mode === 'value' ? { mode: descriptor.mode } : {}),
      ...(typeof descriptor.label === 'string' ? { label: descriptor.label } : {}),
      ...(typeof descriptor.description === 'string' ? { description: descriptor.description } : {}),
      ...(typeof descriptor.order === 'number' ? { order: descriptor.order } : {}),
      ...(descriptor.defaultValue === null || ['string', 'number', 'boolean'].includes(typeof descriptor.defaultValue)
        ? { defaultValue: descriptor.defaultValue as string | number | boolean | null }
        : {}),
      ...(descriptor.control === true ? { control: true } : {}),
    }
  }
  return ports
}

function parseDefineGeneratorCall(
  call: ts.CallExpression,
  exportName: string,
  file: string,
): ParsedGeneratorExport {
  if (call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0])) {
    throw new TypeError('defineGenerator requires exactly one static object argument.')
  }
  const values = new Map<string, ts.Expression>()
  let hasRun = false
  for (const property of call.arguments[0].properties) {
    if (ts.isMethodDeclaration(property) && ts.isIdentifier(property.name) && property.name.text === 'run') {
      hasRun = true
      continue
    }
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      throw new TypeError('defineGenerator fields must be static named properties.')
    }
    if (property.name.text === 'run') {
      hasRun = true
      continue
    }
    values.set(property.name.text, property.initializer)
  }
  const id = values.get('id')
  if (!id || !ts.isStringLiteral(id)) {
    throw new TypeError('defineGenerator requires a string literal id.')
  }
  const versionNode = values.get('version')
  if (versionNode && !ts.isStringLiteral(versionNode) && !ts.isNoSubstitutionTemplateLiteral(versionNode)) {
    throw new TypeError('defineGenerator version must be a string literal when provided.')
  }
  if (!hasRun) {
    throw new TypeError('defineGenerator requires a run implementation.')
  }
  const description = values.get('description')
  const meta: GeneratorDefinitionMeta = {
    id: id.text,
    version: normalizeGeneratorVersion(
      versionNode && (ts.isStringLiteral(versionNode) || ts.isNoSubstitutionTemplateLiteral(versionNode))
        ? versionNode.text
        : undefined,
    ),
    ...(description && (ts.isStringLiteral(description) || ts.isNoSubstitutionTemplateLiteral(description))
      ? { description: description.text }
      : {}),
    inputs: parsePortMap(values.has('inputs') ? staticValue(values.get('inputs')!) : {}, 'inputs'),
    outputs: parsePortMap(values.has('outputs') ? staticValue(values.get('outputs')!) : {}, 'outputs'),
  }
  return {
    exportName,
    meta,
    contract: generatorContractFromMeta(exportName, meta, file),
  }
}

function isExported(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement)
    && Boolean(ts.getModifiers(statement)?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword))
}

/** Parse only exported, static defineGenerator calls; no module code is executed. */
export function parseGeneratorContractSource(source: string, file: string): ParsedGeneratorSource {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const exports: ParsedGeneratorExport[] = []
  const imports: ParsedGeneratorSource['imports'] = []
  const diagnostics: ParsedGeneratorSource['diagnostics'] = []

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const names: string[] = []
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) names.push(element.name.text)
      }
      imports.push({ from: statement.moduleSpecifier.text, names })
      continue
    }
    if (!isExported(statement) || !ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) {
        continue
      }
      if (!ts.isIdentifier(declaration.initializer.expression) || declaration.initializer.expression.text !== 'defineGenerator') {
        continue
      }
      try {
        exports.push(parseDefineGeneratorCall(declaration.initializer, declaration.name.text, file))
      } catch (error) {
        diagnostics.push({
          code: 'SCENE_GENERATOR_CONTRACT_STATIC',
          message: error instanceof Error ? error.message : String(error),
          file,
          start: declaration.initializer.getStart(sourceFile),
        })
      }
    }
  }

  if (exports.length === 0 && diagnostics.length === 0) {
    diagnostics.push({
      code: 'SCENE_GENERATOR_CONTRACT_MISSING',
      message: 'No exported defineGenerator declaration was found.',
      file,
    })
  }
  return { exports, imports, diagnostics }
}
