import { readdir, readFile, access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import * as esbuild from 'esbuild'
import ts from 'typescript'
import { createSceneDiagnostic, type SceneDiagnostic } from '@forgeax/scene-authoring'

import {
  collectImportSpecifiers,
  diagnoseSceneConventions,
  hasDynamicImport,
  isRelativeSpecifier,
  resolveProjectImport,
  SDK_SPECIFIERS,
  sceneSourceKind,
} from './convention.js'
import { bindMaterialHostGlobals } from './material.js'
import {
  HOST_FUNCTION_NAMES,
  bindSceneHostGlobals,
  createSceneRunHost,
  runWithSceneHost,
  type HostImpl,
  type SceneCallRecord,
  type SceneRunHost,
} from './host.js'
import { injectSceneCallIds } from './ids.js'
import { inspectSceneSource } from './inspect.js'
import {
  displayGraphToKernel,
  projectTraceToDisplayGraph,
  type DisplayGraph,
  type SourceMapProjection,
} from './projection.js'
import { diagnoseSceneSemantics } from './semantics.js'
import { diagnoseScenePlacement } from './spatial.js'

export interface RunSceneModuleInput {
  projectDir: string
  entryFile?: string
  sourceOverrides?: Record<string, string>
  implementations: Record<string, HostImpl>
  seed?: number
  memo?: Map<string, { argsKey: string; result: unknown }>
  /** A module build loads only reachable files and skips display layout. */
  purpose?: 'authoring' | 'build'
  /** Omit to use the normal script/default entry. Named exports may be values or functions. */
  exportName?: string
  args?: readonly unknown[]
}

export interface RunSceneModuleResult {
  ok: boolean
  trace: SceneCallRecord[]
  exports: Record<string, unknown>
  diagnostics: SceneDiagnostic[]
  graph: DisplayGraph
  kernelGraph: ReturnType<typeof displayGraphToKernel>
  sourceMap: SourceMapProjection[]
  files: Record<string, string>
  entryFile: string
  reused: boolean
  output?: unknown
}

function diagnostic(code: string, message: string, file?: string): SceneDiagnostic {
  return createSceneDiagnostic({
    code,
    phase: 'execute',
    severity: 'error',
    message,
    operation: 'runSceneModule',
    ...(file ? { source: { file, start: 0, end: 0, line: 1, column: 1 } } : {}),
  })
}

async function loadSceneClosure(
  projectDir: string,
  entryFile: string,
  overrides: Record<string, string>,
): Promise<{ files: Record<string, string>; diagnostics: SceneDiagnostic[] }> {
  const files: Record<string, string> = {}
  const diagnostics: SceneDiagnostic[] = []
  const visiting = new Set<string>()
  const visit = async (file: string): Promise<void> => {
    if (visiting.has(file) || files[file] !== undefined) return
    visiting.add(file)
    const source = overrides[file] ?? await readFile(resolve(projectDir, file), 'utf8').catch(() => '')
    if (!source && overrides[file] === undefined) {
      diagnostics.push(diagnostic('SCENE_SOURCE_MISSING', `Scene source '${file}' was not found.`, file))
      visiting.delete(file)
      return
    }
    files[file] = source
    if (hasDynamicImport(source)) {
      diagnostics.push(diagnostic('SCENE_IMPORT_DYNAMIC', 'Dynamic import target must be statically resolvable for an independent scene build.', file))
    }
    for (const specifier of collectImportSpecifiers(source)) {
      if (SDK_SPECIFIERS.has(specifier) || !isRelativeSpecifier(specifier)) continue
      const base = resolveProjectImport(file, specifier)
      let target = base
      for (const candidate of [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`]) {
        if (candidate in overrides || await access(resolve(projectDir, candidate)).then(() => true, () => false)) { target = candidate; break }
      }
      await visit(target)
    }
    visiting.delete(file)
  }
  await visit(entryFile)
  return { files, diagnostics }
}

async function listSceneFiles(projectDir: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (rel: string): Promise<void> => {
    const entries = await readdir(resolve(projectDir, rel || '.'), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const child = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(child)
      else if (entry.name.endsWith('.scene.ts')) files.push(child.replaceAll('\\', '/'))
    }
  }
  await walk('')
  return files
}

async function loadUnreachableSceneFiles(
  projectDir: string,
  files: Record<string, string>,
  overrides: Record<string, string>,
): Promise<void> {
  for (const file of await listSceneFiles(projectDir)) {
    if (files[file] !== undefined) continue
    const source = overrides[file] ?? await readFile(resolve(projectDir, file), 'utf8').catch(() => '')
    if (source) files[file] = source
  }
}

/** Virtual `@forgeax/scene` for the scene bundle. Derived from HOST_FUNCTION_NAMES. */
export function hostRuntimeSource(): string {
  const calls = HOST_FUNCTION_NAMES.map((name) => `export const ${name} = (args) => h.${name}(args)`).join('\n')
  return `
const h = globalThis.__forgeaxSceneHost
${calls}
export const sampleHeight = (args) => h.sampleHeight(args)
export const sampleSurface = (args) => h.sampleSurface(args)
export const defineMaterial = (definition) => h.defineMaterial(definition)
export const paintSurface = (args) => h.paintSurface(args)
export const invoke = (name, args) => h.invoke(name, args)
export function defineRecordedGenerator(definition) { return h.defineRecordedGenerator(definition) }
export function defineGenerator(definition) { return h.defineRecordedGenerator(definition) }
`
}

function bindHostGlobals(host: SceneRunHost): void {
  bindSceneHostGlobals(host)
  // Materials bind separately — see `material.ts` for why they are not batteries.
  bindMaterialHostGlobals(host)
}

export async function bundleSceneModule(
  projectDir: string,
  entryFile: string,
  sources: Record<string, string>,
): Promise<{ code: string; diagnostics: SceneDiagnostic[] }> {
  const diagnostics: SceneDiagnostic[] = []
  const virtualRoot = resolve(projectDir)
  try {
    const result = await esbuild.build({
      absWorkingDir: virtualRoot,
      entryPoints: [resolve(virtualRoot, entryFile)],
      outfile: 'scene.bundle.js',
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      sourcemap: false,
      legalComments: 'none',
      logLevel: 'silent',
      plugins: [
        {
          name: 'forgeax-scene-run',
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (args.kind === 'entry-point') {
                return { path: resolve(virtualRoot, entryFile), namespace: 'scene-source' }
              }
              if (
                args.path === '@forgeax/scene'
                || args.path === '@forgeax/scene/runtime'
                || args.path === '@forgeax/project-generator'
                || args.path === '@forgeax/project-generator/sdk'
                || args.path === '@forgeax/scene-authoring'
              ) {
                return { path: args.path, namespace: 'scene-host' }
              }
              if (args.path === '@forgeax/project-generator/geom') {
                return undefined
              }
              if (isRelativeSpecifier(args.path) && args.namespace === 'scene-source') {
                const from = args.importer.startsWith(virtualRoot)
                  ? args.importer.slice(virtualRoot.length + 1)
                  : entryFile
                const base = resolveProjectImport(from || entryFile, args.path)
                const target = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`].find(file => file in sources) ?? base
                return { path: resolve(virtualRoot, target), namespace: 'scene-source' }
              }
              return undefined
            })
            build.onLoad({ filter: /.*/, namespace: 'scene-host' }, () => ({
              contents: hostRuntimeSource(),
              loader: 'js',
            }))
            build.onLoad({ filter: /.*/, namespace: 'scene-source' }, (args) => {
              const relative = args.path.slice(virtualRoot.length + 1)
              const source = sources[relative]
              if (source === undefined) return { errors: [{ text: `missing source ${relative}` }] }
              return {
                contents: relative.endsWith('.json') ? source : injectSceneCallIds(source, relative),
                loader: relative.endsWith('.json') ? 'json' : 'ts',
                resolveDir: dirname(args.path),
              }
            })
          },
        },
      ],
    })
    const js = result.outputFiles.find((file) => file.path.endsWith('.js'))
    if (!js) {
      diagnostics.push(diagnostic('SCENE_BUNDLE', 'esbuild produced no scene bundle.', entryFile))
      return { code: '', diagnostics }
    }
    return { code: js.text, diagnostics }
  } catch (error) {
    diagnostics.push(diagnostic(
      'SCENE_BUNDLE',
      error instanceof Error ? error.message : String(error),
      entryFile,
    ))
    return { code: '', diagnostics }
  }
}

export async function evaluateSceneBundle(
  code: string,
  bundleUrl = 'forgeax-scene:bundle',
): Promise<Record<string, unknown>> {
  // Unique ESM URLs cannot be evicted from Node's module cache. Their SDK shims
  // capture the run host, retaining every old mesh trace after a scene rerun.
  // Evaluate the closed bundle in a fresh async module scope instead. TS's CJS
  // lowering preserves named/default exports; the async scope preserves TLA.
  const lowered = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    transformers: { before: [(context) => (source) => {
      // Keep one metadata object per evaluation. A generated identifier avoids
      // collisions with authored variables; AST rewriting leaves strings intact.
      const f = context.factory
      const meta = f.createUniqueName('__sceneImportMeta')
      let used = false
      const visit: ts.Visitor = (node) => {
        if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
          used = true
          return meta
        }
        return ts.visitEachChild(node, visit, context)
      }
      const rewritten = ts.visitEachChild(source, visit, context)
      if (!used) return rewritten
      const declaration = f.createVariableStatement(undefined, f.createVariableDeclarationList([
        f.createVariableDeclaration(meta, undefined, undefined, f.createObjectLiteralExpression([
          f.createPropertyAssignment('url', f.createStringLiteral(bundleUrl)),
        ])),
      ], ts.NodeFlags.Const))
      return f.updateSourceFile(rewritten, [declaration, ...rewritten.statements])
    }] },
  }).outputText
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const module = { exports: {} as Record<string, unknown> }
  const execute = new AsyncFunction('exports', 'require', 'module',
    `${lowered}\nreturn module.exports;\n//# sourceURL=forgeax-scene.bundle.js`)
  return execute(module.exports, createRequire(import.meta.url), module)
}

function projectLoadedSource(
  files: Record<string, string>,
  entryFile: string,
  trace: readonly SceneCallRecord[] = [],
) {
  const sites = Object.entries(files)
    .filter(([file]) => sceneSourceKind(file) === 'scene')
    .flatMap(([file, source]) => inspectSceneSource(source, file))
  return projectTraceToDisplayGraph({
    trace,
    sites,
    file: entryFile,
  })
}

export async function runSceneModule(input: RunSceneModuleInput): Promise<RunSceneModuleResult> {
  const entryFile = input.entryFile ?? 'main.scene.ts'
  const loaded = await loadSceneClosure(input.projectDir, entryFile, input.sourceOverrides ?? {})
  if (input.purpose !== 'build') await loadUnreachableSceneFiles(input.projectDir, loaded.files, input.sourceOverrides ?? {})
  const diagnostics = [
    ...loaded.diagnostics,
    ...diagnoseSceneConventions({ files: loaded.files, entryFile }),
  ]
  let output: unknown
  const finish = (
    ok: boolean,
    trace: readonly SceneCallRecord[] = [],
    exports: Record<string, unknown> = {},
    reused = false,
  ): RunSceneModuleResult => {
    const projected = projectLoadedSource(input.purpose === 'build' ? {} : loaded.files, entryFile, input.purpose === 'build' ? [] : trace)
    return {
      ok,
      trace: [...trace],
      exports,
      diagnostics,
      graph: projected.graph,
      kernelGraph: displayGraphToKernel(projected.graph),
      sourceMap: projected.sourceMap,
      files: loaded.files,
      entryFile,
      reused,
      output,
    }
  }
  if (diagnostics.some((item) => item.severity === 'error') || !loaded.files[entryFile]?.trim()) {
    if (!loaded.files[entryFile]?.trim() && diagnostics.length === 0) {
      return finish(true)
    }
    return finish(false)
  }

  const bundled = await bundleSceneModule(input.projectDir, entryFile, loaded.files)
  diagnostics.push(...bundled.diagnostics)
  if (diagnostics.some((item) => item.severity === 'error')) {
    return finish(false)
  }
  if (!bundled.code) {
    diagnostics.push(...diagnoseSceneSemantics({
      files: loaded.files,
      entryFile,
      trace: [],
    }))
    return finish(!diagnostics.some((item) => item.severity === 'error'))
  }

  const host = createSceneRunHost({
    implementations: input.implementations,
    seed: input.seed,
    memo: input.memo,
  })
  bindHostGlobals(host)
  let exports: Record<string, unknown> = {}
  try {
    exports = await runWithSceneHost(host, async () => evaluateSceneBundle(
      bundled.code, pathToFileURL(resolve(input.projectDir, 'scene.bundle.mjs')).href,
    ))
    const selected = input.exportName ?? 'default'
    if (input.exportName !== undefined && !(selected in exports)) throw new Error(`Export '${selected}' does not exist in '${entryFile}'`)
    const entry = exports[selected]
    output = typeof entry === 'function'
      ? await runWithSceneHost(host, () => entry(...(input.args ?? [])))
      : entry
  } catch (error) {
    diagnostics.push(diagnostic(
      'SCENE_RUN',
      error instanceof Error ? error.message : String(error),
      entryFile,
    ))
  }
  diagnostics.push(...host.diagnostics)
  if (input.purpose !== 'build') diagnostics.push(...diagnoseSceneSemantics({
    files: loaded.files,
    entryFile,
    trace: host.trace,
  }))
  if (input.purpose !== 'build') diagnostics.push(...diagnoseScenePlacement(host.trace))
  return finish(
    !diagnostics.some((item) => item.severity === 'error'),
    host.trace,
    exports,
    host.trace.some((item) => item.reused),
  )
}

export type { SceneRunHost }
