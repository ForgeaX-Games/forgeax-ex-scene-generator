import ts from 'typescript'

import { createSceneDiagnostic } from '../diagnostics/diagnostics.js'
import { stableEntityId } from '../model/identity.js'
import type {
  ContractRegistry,
  ParseSceneModuleResult,
  SceneCallStatement,
  SceneDiagnostic,
  SceneExpression,
  SceneGroupDefinition,
  SceneGroupDefinitionMeta,
  SceneImport,
  SceneExport,
  SceneDefinitionPort,
  SourceRange,
} from '../model/types.js'
import { isScenePortTypeName } from '../contracts/portTypes.js'

const ANCHOR_PATTERN = /@scene-id\s+([A-Za-z0-9_.:-]+)/
const MODULE_ANCHOR_PATTERN = /@scene-module-id\s+([A-Za-z0-9_.:-]+)/
const COMPILER_BUILTINS = new Set(['repeat', 'choose'])

function rangeOf(file: string, sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  const start = node.getStart(sourceFile)
  const point = sourceFile.getLineAndCharacterOfPosition(start)
  return {
    file,
    start,
    end: node.getEnd(),
    line: point.line + 1,
    column: point.character + 1,
  }
}

function syntaxKindAtPosition(sourceFile: ts.SourceFile, position: number): string {
  let current: ts.Node = sourceFile
  while (true) {
    const child = current.getChildren(sourceFile).find((item) => item.pos <= position && position < item.end)
    if (!child) return ts.SyntaxKind[current.kind]
    current = child
  }
}

function diagnostic(
  code: string,
  message: string,
  source: SourceRange,
  phase: SceneDiagnostic['phase'] = 'parse',
): SceneDiagnostic {
  return createSceneDiagnostic({ code, phase, severity: 'error', message, source })
}

function leadingAnchor(source: string, sourceFile: ts.SourceFile, node: ts.Node): string | undefined {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []
  for (const range of [...ranges].reverse()) {
    const match = source.slice(range.pos, range.end).match(ANCHOR_PATTERN)
    if (match?.[1]) return match[1]
  }
  const trivia = source.slice(node.getFullStart(), node.getStart(sourceFile))
  return trivia.match(ANCHOR_PATTERN)?.[1]
}

function parseExpression(
  expression: ts.Expression,
  file: string,
  sourceFile: ts.SourceFile,
  diagnostics: SceneDiagnostic[],
): SceneExpression | undefined {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return { kind: 'literal', value: expression.text }
  }
  if (ts.isNumericLiteral(expression)) return { kind: 'literal', value: Number(expression.text) }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', value: true }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: false }
  if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: null }
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken) {
    const value = parseExpression(expression.operand, file, sourceFile, diagnostics)
    if (value?.kind === 'literal' && typeof value.value === 'number') {
      return { kind: 'literal', value: -value.value }
    }
  }
  if (ts.isIdentifier(expression)) return { kind: 'reference', binding: expression.text }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return {
      kind: 'reference',
      binding: expression.expression.text,
      output: expression.name.text,
    }
  }
  if (ts.isArrayLiteralExpression(expression)) {
    const items: SceneExpression[] = []
    for (const item of expression.elements) {
      if (ts.isSpreadElement(item)) {
        diagnostics.push(
          diagnostic('SCENE_PARSE_SPREAD', 'Spread syntax is not allowed in Scene Script.', rangeOf(file, sourceFile, item)),
        )
        continue
      }
      const parsed = parseExpression(item, file, sourceFile, diagnostics)
      if (parsed) items.push(parsed)
    }
    return { kind: 'array', items }
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const properties: Record<string, SceneExpression> = {}
    for (const property of expression.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        properties[property.name.text] = { kind: 'reference', binding: property.name.text }
        continue
      }
      if (!ts.isPropertyAssignment(property)) {
        diagnostics.push(
          diagnostic(
            'SCENE_PARSE_OBJECT_MEMBER',
            'Only explicit property assignments are allowed in Scene Script objects.',
            rangeOf(file, sourceFile, property),
          ),
        )
        continue
      }
      const name =
        ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : undefined
      if (!name) {
        diagnostics.push(
          diagnostic('SCENE_PARSE_PROPERTY_NAME', 'Scene Script property names must be static.', rangeOf(file, sourceFile, property.name)),
        )
        continue
      }
      const parsed = parseExpression(property.initializer, file, sourceFile, diagnostics)
      if (parsed) properties[name] = parsed
    }
    return { kind: 'object', properties }
  }
  diagnostics.push(
    diagnostic(
      'SCENE_PARSE_EXPRESSION',
      `Unsupported Scene Script expression: ${ts.SyntaxKind[expression.kind]}.`,
      rangeOf(file, sourceFile, expression),
    ),
  )
  return undefined
}

function parseArgs(
  call: ts.CallExpression,
  file: string,
  sourceFile: ts.SourceFile,
  diagnostics: SceneDiagnostic[],
): Record<string, SceneExpression> {
  if (call.arguments.length === 0) return {}
  if (call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0])) {
    diagnostics.push(
      diagnostic(
        'SCENE_PARSE_CALL_ARGUMENTS',
        'Scene node functions accept one object argument so parameters and typed inputs stay explicit.',
        rangeOf(file, sourceFile, call),
      ),
    )
    return {}
  }
  const value = parseExpression(call.arguments[0], file, sourceFile, diagnostics)
  return value?.kind === 'object' ? value.properties : {}
}

function callName(call: ts.CallExpression): string | undefined {
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined
}

function parseCallStatement(
  statement: ts.Statement,
  call: ts.CallExpression,
  binding: string | undefined,
  file: string,
  moduleId: string,
  source: string,
  sourceFile: ts.SourceFile,
  registry: ContractRegistry,
  diagnostics: SceneDiagnostic[],
): SceneCallStatement | undefined {
  const functionName = callName(call)
  const sourceRange = rangeOf(file, sourceFile, statement)
  if (!functionName) {
    diagnostics.push(
      diagnostic('SCENE_PARSE_CALL_TARGET', 'Scene node functions must use a direct identifier.', sourceRange),
    )
    return undefined
  }
  const contract = registry.get(functionName)
  if (!contract && !COMPILER_BUILTINS.has(functionName)) {
    diagnostics.push({
      ...diagnostic('SCENE_RESOLVE_FUNCTION', `Unknown Scene node function '${functionName}'.`, sourceRange, 'resolve'),
      operation: functionName,
      howToFix: ['Use a function from the versioned Scene Function Catalog.'],
      possibleCauses: [
        'The identifier is not in the current contract registry.',
        'The import was omitted or the Generator failed to compile.',
      ],
    })
  }
  const statementId =
    leadingAnchor(source, sourceFile, statement) ??
    stableEntityId('stmt', `${moduleId}:${binding ?? functionName}:${statement.getStart(sourceFile)}`)
  const args = parseArgs(call, file, sourceFile, diagnostics)
  if (functionName === 'repeat') {
    const step = args.step
    if (step?.kind === 'reference' && step.output === undefined) {
      args.step = { kind: 'callable', functionName: step.binding }
    }
  }
  return {
    kind: 'call',
    statementId,
    ...(binding ? { binding } : {}),
    functionName,
    args,
    ...(contract ? { contractKind: contract.kind } : {}),
    source: sourceRange,
  }
}

function parseImport(file: string, sourceFile: ts.SourceFile, node: ts.ImportDeclaration): SceneImport | undefined {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return undefined
  const names: string[] = []
  const specifiers: SceneImport['specifiers'] = []
  const bindings = node.importClause?.namedBindings
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      names.push(element.name.text)
      specifiers.push({
        imported: element.propertyName?.text ?? element.name.text,
        local: element.name.text,
      })
    }
  }
  return {
    names,
    specifiers,
    from: node.moduleSpecifier.text,
    source: rangeOf(file, sourceFile, node),
  }
}

function parsePortMap(
  expression: ts.Expression | undefined,
  file: string,
  sourceFile: ts.SourceFile,
  diagnostics: SceneDiagnostic[],
): Record<string, SceneDefinitionPort> {
  if (!expression || !ts.isObjectLiteralExpression(expression)) {
    diagnostics.push(diagnostic('SCENE_DEFINE_PORT_MAP', 'defineGroup inputs and outputs must be static object literals.', rangeOf(file, sourceFile, expression ?? sourceFile)))
    return {}
  }
  const ports: Record<string, SceneDefinitionPort> = {}
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      diagnostics.push(diagnostic('SCENE_DEFINE_PORT', 'Definition ports must be static names mapped to a Scene port type.', rangeOf(file, sourceFile, property)))
      continue
    }
    const raw = property.initializer
    if (ts.isIdentifier(raw)) {
      if (!isScenePortTypeName(raw.text)) {
        diagnostics.push(diagnostic('SCENE_DEFINE_PORT_TYPE', `Unknown Scene port type '${raw.text}'.`, rangeOf(file, sourceFile, raw)))
        continue
      }
      ports[property.name.text] = { type: raw.text }
      continue
    }
    if (!ts.isObjectLiteralExpression(raw)) {
      diagnostics.push(diagnostic('SCENE_DEFINE_PORT', 'Definition ports must be a type identifier or static descriptor object.', rangeOf(file, sourceFile, raw)))
      continue
    }
    const values = new Map<string, ts.Expression>()
    for (const item of raw.properties) {
      if (ts.isPropertyAssignment(item) && ts.isIdentifier(item.name)) values.set(item.name.text, item.initializer)
      else diagnostics.push(diagnostic('SCENE_DEFINE_PORT', 'Definition port descriptor fields must be static properties.', rangeOf(file, sourceFile, item)))
    }
    const type = values.get('type')
    if (!type || !ts.isIdentifier(type) || !isScenePortTypeName(type.text)) {
      diagnostics.push(diagnostic('SCENE_DEFINE_PORT_TYPE', 'Definition port descriptor requires a known identifier `type`.', rangeOf(file, sourceFile, raw)))
      continue
    }
    const port: SceneDefinitionPort = { type: type.text }
    const runtimePort = values.get('runtimePort')
    if (runtimePort) {
      if (!ts.isStringLiteral(runtimePort)) diagnostics.push(diagnostic('SCENE_DEFINE_PORT', 'runtimePort must be a string literal.', rangeOf(file, sourceFile, runtimePort)))
      else port.runtimePort = runtimePort.text
    }
    for (const key of ['runtimeType', 'labelEn', 'description'] as const) {
      const value = values.get(key)
      if (!value) continue
      if (!ts.isStringLiteral(value)) diagnostics.push(diagnostic('SCENE_DEFINE_PORT', `${key} must be a string literal.`, rangeOf(file, sourceFile, value)))
      else port[key] = value.text
    }
    for (const key of ['hidden', 'required'] as const) {
      const value = values.get(key)
      if (!value) continue
      if (value.kind !== ts.SyntaxKind.TrueKeyword && value.kind !== ts.SyntaxKind.FalseKeyword) diagnostics.push(diagnostic('SCENE_DEFINE_PORT', `${key} must be a boolean literal.`, rangeOf(file, sourceFile, value)))
      else port[key] = value.kind === ts.SyntaxKind.TrueKeyword
    }
    const access = values.get('access')
    if (access && ts.isStringLiteral(access) && ['item', 'list', 'tree'].includes(access.text)) port.access = access.text as SceneDefinitionPort['access']
    else if (access) diagnostics.push(diagnostic('SCENE_DEFINE_PORT', 'access must be item, list, or tree.', rangeOf(file, sourceFile, access)))
    const label = values.get('label')
    if (label && ts.isStringLiteral(label)) port.label = label.text
    else if (label) diagnostics.push(diagnostic('SCENE_DEFINE_PORT', 'label must be a string literal.', rangeOf(file, sourceFile, label)))
    const mode = values.get('mode')
    if (mode && ts.isStringLiteral(mode) && ['parameter', 'value'].includes(mode.text)) port.mode = mode.text as SceneDefinitionPort['mode']
    else if (mode) diagnostics.push(diagnostic('SCENE_DEFINE_PORT', 'mode must be parameter or value.', rangeOf(file, sourceFile, mode)))
    const order = values.get('order')
    if (order && ts.isNumericLiteral(order)) port.order = Number(order.text)
    else if (order) diagnostics.push(diagnostic('SCENE_DEFINE_PORT', 'order must be a numeric literal.', rangeOf(file, sourceFile, order)))
    const defaultValue = values.get('defaultValue')
    if (defaultValue) {
      const parsedDefault = parseExpression(defaultValue, file, sourceFile, diagnostics)
      if (parsedDefault?.kind === 'literal') port.defaultValue = parsedDefault.value
      else diagnostics.push(diagnostic('SCENE_DEFINE_PORT', 'defaultValue must be a primitive static literal.', rangeOf(file, sourceFile, defaultValue)))
    }
    ports[property.name.text] = port
  }
  return ports
}

function parseGroupDefinition(
  statement: ts.VariableStatement,
  declaration: ts.VariableDeclaration,
  call: ts.CallExpression,
  file: string,
  moduleId: string,
  source: string,
  sourceFile: ts.SourceFile,
  registry: ContractRegistry,
  diagnostics: SceneDiagnostic[],
): SceneGroupDefinition | undefined {
  if (!ts.isIdentifier(declaration.name)) return undefined
  const sourceRange = rangeOf(file, sourceFile, statement)
  if ((call.arguments.length !== 1 && call.arguments.length !== 2) || !ts.isObjectLiteralExpression(call.arguments[0])) {
    diagnostics.push(diagnostic('SCENE_DEFINE_SHAPE', 'defineGroup requires static metadata, optionally followed by one arrow-function body.', sourceRange))
    return undefined
  }
  const metaObject = call.arguments[0]
  const property = (name: string): ts.Expression | undefined => {
    const hit = metaObject.properties.find((item) => ts.isPropertyAssignment(item) && ts.isIdentifier(item.name) && item.name.text === name)
    return hit && ts.isPropertyAssignment(hit) ? hit.initializer : undefined
  }
  const id = property('id')
  const version = property('version')
  if (!id || !version || !ts.isStringLiteral(id) || !ts.isStringLiteral(version)) {
    diagnostics.push(diagnostic('SCENE_DEFINE_META', 'defineGroup metadata requires string literal id and version.', sourceRange))
    return undefined
  }
  if (property('rawDefinition')) {
    diagnostics.push(diagnostic('SCENE_DEFINE_RAW_FORBIDDEN', 'rawDefinition is forbidden; every node must be an auditable call in the Definition body.', sourceRange))
    return undefined
  }
  const meta: SceneGroupDefinitionMeta = {
    id: id.text,
    version: version.text,
    inputs: parsePortMap(property('inputs'), file, sourceFile, diagnostics),
    outputs: parsePortMap(property('outputs'), file, sourceFile, diagnostics),
  }
  const sealed = property('sealed')
  if (sealed) {
    if (sealed.kind !== ts.SyntaxKind.TrueKeyword && sealed.kind !== ts.SyntaxKind.FalseKeyword) {
      diagnostics.push(diagnostic('SCENE_DEFINE_META', 'defineGroup sealed must be a boolean literal.', rangeOf(file, sourceFile, sealed)))
    } else {
      meta.sealed = sealed.kind === ts.SyntaxKind.TrueKeyword
    }
  }
  if (call.arguments.length !== 2 || !ts.isArrowFunction(call.arguments[1])) {
    diagnostics.push(diagnostic('SCENE_DEFINE_SHAPE', 'Authored defineGroup requires one arrow-function body.', sourceRange))
    return undefined
  }
  const fn = call.arguments[1]
  if (fn.parameters.length !== 1 || !ts.isObjectBindingPattern(fn.parameters[0].name) || !ts.isBlock(fn.body)) {
    diagnostics.push(diagnostic('SCENE_DEFINE_PARAMS', 'defineGroup body must destructure exactly one input object and use a block body.', sourceRange))
    return undefined
  }
  const paramNames = fn.parameters[0].name.elements
    .filter((item) => ts.isBindingElement(item) && ts.isIdentifier(item.name) && !item.dotDotDotToken && !item.initializer)
    .map((item) => ts.isIdentifier(item.name) ? item.name.text : '')
  if (paramNames.length !== fn.parameters[0].name.elements.length || new Set(paramNames).size !== paramNames.length ||
      paramNames.length !== Object.keys(meta.inputs).length || paramNames.some((name) => !(name in meta.inputs))) {
    diagnostics.push(diagnostic('SCENE_DEFINE_PARAMS', 'Definition parameter names must exactly match declared inputs; defaults and rest are not allowed.', sourceRange))
    return undefined
  }
  const body: SceneCallStatement[] = []
  let returnOutputs: Record<string, SceneExpression> | undefined
  for (const inner of fn.body.statements) {
    if (ts.isVariableStatement(inner)) {
      for (const innerDecl of inner.declarationList.declarations) {
        if (!ts.isIdentifier(innerDecl.name) || !innerDecl.initializer || !ts.isCallExpression(innerDecl.initializer)) {
          diagnostics.push(diagnostic('SCENE_DEFINE_BODY', 'Definition body declarations must bind direct Scene function calls.', rangeOf(file, sourceFile, innerDecl)))
          continue
        }
        const parsed = parseCallStatement(inner, innerDecl.initializer, innerDecl.name.text, file, `${moduleId}:${id.text}`, source, sourceFile, registry, diagnostics)
        if (parsed) body.push(parsed)
      }
      continue
    }
    if (ts.isReturnStatement(inner)) {
      const parsed = inner.expression ? parseExpression(inner.expression, file, sourceFile, diagnostics) : undefined
      if (parsed?.kind === 'object') returnOutputs = parsed.properties
      else diagnostics.push(diagnostic('SCENE_DEFINE_RETURN', 'Definition body must end with return { output: reference }.', rangeOf(file, sourceFile, inner)))
      continue
    }
    diagnostics.push(diagnostic('SCENE_DEFINE_BODY', 'Only const calls and one final return are allowed in defineGroup.', rangeOf(file, sourceFile, inner)))
  }
  if (!returnOutputs || Object.keys(returnOutputs).length !== Object.keys(meta.outputs).length ||
      Object.keys(meta.outputs).some((name) => !returnOutputs![name])) {
    diagnostics.push(diagnostic('SCENE_DEFINE_RETURN', 'Definition return keys must exactly match declared outputs.', sourceRange))
    return undefined
  }
  return {
    kind: 'group-definition',
    definitionId: leadingAnchor(source, sourceFile, statement) ?? stableEntityId('def', `${moduleId}:${declaration.name.text}`),
    exportName: declaration.name.text,
    meta,
    paramNames,
    body,
    returnOutputs,
    source: sourceRange,
  }
}

export function parseSceneModule(
  source: string,
  options: { file: string; moduleId?: string; registry: ContractRegistry },
): ParseSceneModuleResult {
  const sourceFile = ts.createSourceFile(options.file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const moduleId = options.moduleId ?? source.match(MODULE_ANCHOR_PATTERN)?.[1] ?? options.file
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }
  ).parseDiagnostics ?? []
  const diagnostics: SceneDiagnostic[] = parseDiagnostics.map((item) => {
    const start = item.start ?? 0
    const point = sourceFile.getLineAndCharacterOfPosition(start)
    return createSceneDiagnostic({
      code: `TS${item.code}`,
      phase: 'parse',
      severity: 'error',
      message: ts.flattenDiagnosticMessageText(item.messageText, '\n'),
      expected: 'Valid TypeScript syntax in the restricted Scene Script subset.',
      actual: {
        syntaxKind: syntaxKindAtPosition(sourceFile, start),
        text: source.slice(start, start + Math.min(item.length ?? 1, 120)),
      },
      source: {
        file: options.file,
        start,
        end: start + (item.length ?? 0),
        line: point.line + 1,
        column: point.character + 1,
      },
    })
  })
  const imports: SceneImport[] = []
  const exports: SceneExport[] = []
  const definitions: SceneGroupDefinition[] = []
  const statements: SceneCallStatement[] = []
  const localDefinitionNames = new Set<string>()
  const importedNames = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const parsed = parseImport(options.file, sourceFile, statement)
      for (const specifier of parsed?.specifiers ?? []) importedNames.add(specifier.local)
      continue
    }
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        ts.isCallExpression(declaration.initializer) &&
        ts.isIdentifier(declaration.initializer.expression) &&
        declaration.initializer.expression.text === 'defineGroup'
      ) {
        localDefinitionNames.add(declaration.name.text)
      }
    }
  }
  const registry: ContractRegistry = {
    get(functionName) {
      return options.registry.get(functionName) ?? (localDefinitionNames.has(functionName)
        ? {
            functionName,
            kind: 'group',
            contractVersion: 'local',
            description: 'Module-local Scene Definition.',
            inputs: [],
            outputs: [],
          }
        : importedNames.has(functionName)
          ? {
              functionName,
              kind: 'group',
              contractVersion: 'import',
              description: 'Imported Scene symbol resolved at project link time.',
              inputs: [],
              outputs: [],
            }
        : undefined)
    },
    list: () => options.registry.list(),
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const parsed = parseImport(options.file, sourceFile, statement)
      if (parsed) imports.push(parsed)
      continue
    }
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause) || statement.moduleSpecifier) {
        diagnostics.push(diagnostic(
          'SCENE_PARSE_EXPORT',
          'Scene Script exports must be explicit local named exports.',
          rangeOf(options.file, sourceFile, statement),
        ))
        continue
      }
      for (const element of statement.exportClause.elements) {
        exports.push({
          local: element.propertyName?.text ?? element.name.text,
          exported: element.name.text,
          source: rangeOf(options.file, sourceFile, element),
        })
      }
      continue
    }
    if (ts.isVariableStatement(statement)) {
      const isExported = statement.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword) ?? false
      for (const declaration of statement.declarationList.declarations) {
        if (isExported && ts.isIdentifier(declaration.name)) {
          exports.push({
            local: declaration.name.text,
            exported: declaration.name.text,
            source: rangeOf(options.file, sourceFile, declaration),
          })
        }
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          ts.isCallExpression(declaration.initializer) &&
          ts.isIdentifier(declaration.initializer.expression) &&
          declaration.initializer.expression.text === 'defineGroup'
        ) {
          const parsed = parseGroupDefinition(statement, declaration, declaration.initializer, options.file, moduleId, source, sourceFile, registry, diagnostics)
          if (parsed) definitions.push(parsed)
          continue
        }
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) {
          diagnostics.push(
            diagnostic(
              'SCENE_PARSE_DECLARATION',
              'Scene Script declarations must bind one direct node-function call to an identifier.',
              rangeOf(options.file, sourceFile, declaration),
            ),
          )
          continue
        }
        const parsed = parseCallStatement(
          statement,
          declaration.initializer,
          declaration.name.text,
          options.file,
          moduleId,
          source,
          sourceFile,
          registry,
          diagnostics,
        )
        if (parsed) statements.push(parsed)
      }
      continue
    }
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      const parsed = parseCallStatement(
        statement,
        statement.expression,
        undefined,
        options.file,
        moduleId,
        source,
        sourceFile,
        registry,
        diagnostics,
      )
      if (parsed) statements.push(parsed)
      continue
    }
    if (statement.kind !== ts.SyntaxKind.EmptyStatement) {
      diagnostics.push(
        diagnostic(
          'SCENE_PARSE_STATEMENT',
          `Unsupported Scene Script statement: ${ts.SyntaxKind[statement.kind]}.`,
          rangeOf(options.file, sourceFile, statement),
        ),
      )
    }
  }

  return {
    module: { moduleId, file: options.file, imports, exports, definitions, statements },
    diagnostics,
  }
}
