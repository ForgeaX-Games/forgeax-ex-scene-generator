import { createSceneDiagnostic } from '../diagnostics/diagnostics.js'
import type {
  CompiledSceneModule,
  ContractRegistry,
  SceneDiagnostic,
  SceneExpression,
  SceneModuleAst,
  SceneProjectAst,
} from '../model/types.js'
import { compileSceneModule } from './module-compiler.js'

export function compileSceneProject(
  project: SceneProjectAst,
  registry: ContractRegistry,
  resolveImport: (fromModuleId: string, specifier: string) => string = (_from, specifier) => specifier,
): CompiledSceneModule {
  const ordered: SceneModuleAst[] = []
  const diagnostics: SceneDiagnostic[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const reportedCycles = new Set<string>()

  const visit = (moduleId: string): void => {
    if (visited.has(moduleId)) return
    if (visiting.has(moduleId)) {
      if (reportedCycles.has(moduleId)) return
      reportedCycles.add(moduleId)
      diagnostics.push(createSceneDiagnostic({
        code: 'SCENE_RESOLVE_IMPORT_CYCLE',
        phase: 'resolve',
        severity: 'error',
        message: `Scene module cycle detected at '${moduleId}'.`,
        expected: 'An acyclic Scene Script import graph.',
        actual: moduleId,
        operation: 'import',
        possibleCauses: ['Two .scene.ts modules import each other.'],
        howToFix: ['Break the cycle; Scene modules must form a DAG.'],
      }))
      return
    }
    const module = project.modules[moduleId]
    if (!module) {
      diagnostics.push(createSceneDiagnostic({
        code: 'SCENE_RESOLVE_MODULE',
        phase: 'resolve',
        severity: 'error',
        message: `Scene module '${moduleId}' was not found.`,
        expected: 'A readable imported .scene.ts module.',
        actual: moduleId,
        operation: 'import',
        possibleCauses: ['The import path is wrong.', 'The module file is missing from the project.'],
        howToFix: ['Create the imported .scene.ts file or fix the specifier.'],
      }))
      return
    }
    visiting.add(moduleId)
    for (const item of module.imports) {
      if (item.from.endsWith('.generator.ts')) continue
      visit(resolveImport(moduleId, item.from))
    }
    visiting.delete(moduleId)
    visited.add(moduleId)
    ordered.push(module)
  }

  visit(project.entryModuleId)
  const entry = project.modules[project.entryModuleId] ?? {
    moduleId: project.entryModuleId,
    file: project.entryModuleId,
    imports: [],
    definitions: [],
    statements: [],
  }

  type LinkedSymbol =
    | { kind: 'value'; qualifiedBinding: string }
    | { kind: 'function'; registryName: string }

  const localSymbol = (module: SceneModuleAst, name: string): LinkedSymbol | undefined => {
    if (module.statements.some((statement) => statement.binding === name)) {
      return { kind: 'value', qualifiedBinding: `${module.moduleId}::${name}` }
    }
    if (module.definitions.some((definition) => definition.exportName === name)) {
      const qualified = `${module.moduleId}::${name}`
      return { kind: 'function', registryName: registry.get(qualified) ? qualified : name }
    }
    return undefined
  }

  const resolveExport = (
    moduleId: string,
    exportedName: string,
    resolving = new Set<string>(),
  ): LinkedSymbol | undefined => {
    const key = `${moduleId}::${exportedName}`
    if (resolving.has(key)) return undefined
    const module = project.modules[moduleId]
    if (!module) return undefined
    const exported = module.exports.find((item) => item.exported === exportedName)
    if (!exported) return undefined
    const local = localSymbol(module, exported.local)
    if (local) return local
    const imported = module.imports
      .flatMap((item) => (item.specifiers ?? item.names.map((name) => ({ imported: name, local: name })))
        .map((specifier) => ({ item, specifier })))
      .find(({ specifier }) => specifier.local === exported.local)
    if (!imported) return undefined
    return resolveExport(
      resolveImport(moduleId, imported.item.from),
      imported.specifier.imported,
      new Set(resolving).add(key),
    )
  }

  const importedSymbols = new Map<string, Map<string, LinkedSymbol>>()
  for (const module of ordered) {
    const symbols = new Map<string, LinkedSymbol>()
    for (const item of module.imports) {
      const targetId = resolveImport(module.moduleId, item.from)
      if (!project.modules[targetId]) continue
      for (const specifier of item.specifiers ?? item.names.map((name) => ({ imported: name, local: name }))) {
        const symbol = resolveExport(targetId, specifier.imported)
        if (!symbol) {
          diagnostics.push(createSceneDiagnostic({
            code: 'SCENE_RESOLVE_IMPORT_EXPORT',
            phase: 'resolve',
            severity: 'error',
            message: `Module '${targetId}' does not export '${specifier.imported}'.`,
            source: item.source,
            expected: 'An explicitly exported Scene symbol.',
            actual: specifier.imported,
            operation: 'import',
            possibleCauses: ['The export was renamed.', 'The symbol is local and not in the export list.'],
            howToFix: ['Export the symbol from the imported module, or import a name that module actually exports.'],
          }))
          continue
        }
        symbols.set(specifier.local, symbol)
      }
    }
    importedSymbols.set(module.moduleId, symbols)
  }

  const statementOrigins = new Map<string, { moduleId: string; file: string; statementId: string }>()
  const linkedStatements = ordered.flatMap((module) => module.statements.map((statement) => {
    const qualifiedStatementId = `${module.moduleId}::${statement.statementId}`
    statementOrigins.set(qualifiedStatementId, {
      moduleId: module.moduleId,
      file: module.file,
      statementId: statement.statementId,
    })
    const imports = importedSymbols.get(module.moduleId) ?? new Map<string, LinkedSymbol>()
    const rewriteExpression = (expression: SceneExpression): SceneExpression => {
      if (expression.kind === 'reference') {
        const isLocal = module.statements.some((candidate) => candidate.binding === expression.binding)
        const symbol = isLocal
          ? { kind: 'value' as const, qualifiedBinding: `${module.moduleId}::${expression.binding}` }
          : imports.get(expression.binding)
        return {
          ...expression,
          binding: symbol?.kind === 'value'
            ? symbol.qualifiedBinding
            : `${module.moduleId}::${expression.binding}`,
        }
      }
      if (expression.kind === 'callable') {
        const symbol = localSymbol(module, expression.functionName) ?? imports.get(expression.functionName)
        return {
          ...expression,
          functionName: symbol?.kind === 'function' ? symbol.registryName : expression.functionName,
        }
      }
      if (expression.kind === 'array') return { ...expression, items: expression.items.map(rewriteExpression) }
      if (expression.kind === 'object') {
        return {
          ...expression,
          properties: Object.fromEntries(
            Object.entries(expression.properties).map(([name, value]) => [name, rewriteExpression(value)]),
          ),
        }
      }
      return expression
    }
    const importedFunction = imports.get(statement.functionName)
    const localDefinition = localSymbol(module, statement.functionName)
    return {
      ...statement,
      statementId: qualifiedStatementId,
      ...(statement.binding ? { binding: `${module.moduleId}::${statement.binding}` } : {}),
      functionName: importedFunction?.kind === 'function'
        ? importedFunction.registryName
        : localDefinition?.kind === 'function'
          ? localDefinition.registryName
          : statement.functionName,
      args: Object.fromEntries(
        Object.entries(statement.args).map(([name, expression]) => [name, rewriteExpression(expression)]),
      ),
    }
  }))

  const combined: SceneModuleAst = {
    moduleId: project.entryModuleId,
    file: entry.file,
    imports: [],
    exports: [],
    definitions: [],
    statements: linkedStatements,
  }
  const compiled = compileSceneModule(combined, registry)
  const sourceMap = compiled.sourceMap.map((item) => {
    const origin = statementOrigins.get(item.statementId)
    return origin ? {
      ...item,
      moduleId: origin.moduleId,
      file: origin.file,
      statementId: origin.statementId,
    } : item
  })
  return { ...compiled, sourceMap, diagnostics: [...diagnostics, ...compiled.diagnostics] }
}
