import { createSceneDiagnostic, inspectModuleImports, type SceneDiagnostic } from '@forgeax/scene-authoring'

const SDK_SPECIFIERS = new Set([
  '@forgeax/scene',
  '@forgeax/scene/runtime',
  '@forgeax/project-generator',
  '@forgeax/project-generator/sdk',
  '@forgeax/project-generator/geom',
  '@forgeax/scene-authoring',
])

export type SceneSourceKind = 'scene' | 'generator' | 'material' | 'helper' | 'unknown'

export function sceneSourceKind(file: string): SceneSourceKind {
  if (file.endsWith('.scene.ts')) return 'scene'
  if (file.endsWith('.generator.ts')) return 'generator'
  // Before '.generator-lib.ts' would be wrong either way — the suffixes are
  // disjoint — but keep material next to generator: both are leaf modules a
  // scene imports, neither may import back up into a .scene.ts.
  if (file.endsWith('.material.ts')) return 'material'
  if (file.endsWith('.generator-lib.ts')) return 'helper'
  return 'unknown'
}

export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

export function resolveProjectImport(fromFile: string, specifier: string): string {
  const parts = [...fromFile.replace(/\\/g, '/').split('/').slice(0, -1), ...specifier.split('/')]
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..' && resolved.length && resolved.at(-1) !== '..') resolved.pop()
    else resolved.push(part)
  }
  return resolved.join('/')
}

export function collectImportSpecifiers(source: string): string[] {
  return inspectModuleImports(source).imports.filter(item => !item.typeOnly).map(item => item.specifier)
}

/** Only unresolved dynamic expressions need a portability diagnostic. */
export function hasDynamicImport(source: string): boolean {
  return inspectModuleImports(source).dynamicExpressions.length > 0
}

function diagnostic(code: string, message: string, file?: string): SceneDiagnostic {
  return createSceneDiagnostic({
    code,
    phase: 'resolve',
    severity: 'error',
    message,
    operation: 'scene-module',
    ...(file ? { source: { file, start: 0, end: 0, line: 1, column: 1 } } : {}),
  })
}

export function diagnoseSceneConventions(input: {
  files: Record<string, string>
  entryFile: string
}): SceneDiagnostic[] {
  const diagnostics: SceneDiagnostic[] = []
  if (sceneSourceKind(input.entryFile) !== 'scene') {
    diagnostics.push(diagnostic(
      'SCENE_ENTRY_KIND',
      `Scene entry must be a .scene.ts file, got '${input.entryFile}'.`,
      input.entryFile,
    ))
  }
  const graph = new Map<string, string[]>()
  for (const [file, source] of Object.entries(input.files)) {
    const kind = sceneSourceKind(file)
    const deps: string[] = []
    if (hasDynamicImport(source) && kind !== 'unknown') {
      diagnostics.push(diagnostic('SCENE_IMPORT_DYNAMIC', 'Dynamic import target must be statically resolvable for an independent scene build.', file))
    }
    for (const specifier of collectImportSpecifiers(source)) {
      if (SDK_SPECIFIERS.has(specifier)) continue
      if (!isRelativeSpecifier(specifier)) continue
      const base = resolveProjectImport(file, specifier)
      const target = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`].find(path => path in input.files) ?? base
      if (target.split('/').includes('..')) {
        diagnostics.push(diagnostic('SCENE_IMPORT_ESCAPE', `Import '${specifier}' escapes the project scene tree.`, file))
        continue
      }
      const targetKind = sceneSourceKind(target)
      if (kind === 'generator' && targetKind === 'scene') {
        diagnostics.push(diagnostic(
          'SCENE_IMPORT_DAG',
          `.generator.ts may not import a .scene.ts module ('${specifier}').`,
          file,
        ))
      }
      if (kind === 'helper' && targetKind === 'scene') {
        diagnostics.push(diagnostic(
          'SCENE_IMPORT_DAG',
          `*.generator-lib.ts may not import a .scene.ts module ('${specifier}').`,
          file,
        ))
      }
      if (kind === 'material' && targetKind === 'scene') {
        diagnostics.push(diagnostic(
          'SCENE_IMPORT_DAG',
          `.material.ts may not import a .scene.ts module ('${specifier}'). A material is consumed by scenes, not the other way round.`,
          file,
        ))
      }
      deps.push(target)
    }
    graph.set(file, deps)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const walk = (file: string): boolean => {
    if (visited.has(file)) return false
    if (visiting.has(file)) {
      diagnostics.push(diagnostic('SCENE_IMPORT_CYCLE', `Scene import cycle detected at '${file}'.`, file))
      return true
    }
    visiting.add(file)
    for (const dep of graph.get(file) ?? []) {
      if (walk(dep)) return true
    }
    visiting.delete(file)
    visited.add(file)
    return false
  }
  walk(input.entryFile)
  for (const file of Object.keys(input.files)) {
    if (sceneSourceKind(file) !== 'scene' || file === input.entryFile || visited.has(file)) continue
    diagnostics.push(createSceneDiagnostic({
      code: 'SCENE_ORPHAN_MODULE',
      phase: 'resolve',
      severity: 'warning',
      message: `.scene.ts '${file}' is not imported from the entry module tree. Large scenes should call smaller ones.`,
      operation: 'scene-module',
      source: { file, start: 0, end: 0, line: 1, column: 1 },
    }))
  }
  return diagnostics
}

export { SDK_SPECIFIERS }
