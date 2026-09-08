import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'
import {
  createSceneDiagnostic,
  parseGeneratorContractSource,
  type AtomicNodeFunctionContract,
  type SceneDiagnostic,
} from '@forgeax/scene-authoring'

import { contentHash, stableJsonHash } from './hash.js'
import {
  collectRelativeImports,
  diagnoseGeneratorImport,
  hasDynamicImport,
  isRelativeSpecifier,
  projectSourceKind,
  resolveProjectImport,
  SDK_SPECIFIERS,
} from './imports.js'
import * as scenePortTokens from './sdk-globals.js'

const here = dirname(fileURLToPath(import.meta.url))

export interface GeneratorSourceFile {
  file: string
  source: string
}

export interface CompiledGeneratorArtifact {
  definitionId: string
  exportName: string
  opId: string
  contract: AtomicNodeFunctionContract
  sourceHash: string
  implementationRevision: string
  bundle: string
  sourceMap: string
  sources: Record<string, string>
  seed?: number
}

export interface CompileGeneratorResult {
  artifacts: CompiledGeneratorArtifact[]
  diagnostics: SceneDiagnostic[]
}

const GENERATOR_HOW_TO_FIX: Record<string, string[]> = {
  GENERATOR_IMPORT_CYCLE: ['Break the helper import cycle; *.generator-lib.ts may only import other helpers or the SDK.'],
  GENERATOR_SOURCE_MISSING: ['Create the missing .generator.ts / helper file, or fix the import path.'],
  GENERATOR_IMPORT_DYNAMIC: ['Replace import() with a static import of a *.generator-lib.ts or the Generator SDK.'],
  GENERATOR_IMPORT_NPM: ['Remove the npm import; Generators may only import the SDK or *.generator-lib.ts.'],
  GENERATOR_IMPORT_BUILTIN: ['Remove the Node builtin import; use ctx and the SDK instead.'],
  GENERATOR_IMPORT_DAG: ['.generator.ts may only import *.generator-lib.ts or the Generator SDK.'],
  GENERATOR_IMPORT_ESCAPE: ['Keep the import inside the project scene tree.'],
  GENERATOR_BUNDLE: ['Fix the TypeScript in this Generator; the sandbox bundle failed.'],
  GENERATOR_SOURCE_KIND: ['Put defineGenerator in a file named *.generator.ts.'],
  SCENE_GENERATOR_CONTRACT_STATIC: ['Keep id, version, inputs, and outputs as static literals. Do not compute them at runtime.'],
  SCENE_GENERATOR_CONTRACT_MISSING: ['Export a defineGenerator({ id, inputs, outputs, run }) declaration.'],
}

const GENERATOR_CAUSES: Record<string, string[]> = {
  GENERATOR_IMPORT_CYCLE: ['Two helpers import each other.', 'A helper re-imports the Generator that loaded it.'],
  GENERATOR_SOURCE_MISSING: ['The relative path is wrong.', 'The file was not written to disk.'],
  GENERATOR_IMPORT_DYNAMIC: ['The source used import() instead of a static import.'],
  GENERATOR_BUNDLE: ['The Generator TypeScript does not typecheck.', 'An SDK-internal import was resolved as project source.'],
  SCENE_GENERATOR_CONTRACT_STATIC: ['id or version was computed.', 'A port type was not a known identifier.'],
}

function diagnostic(code: string, message: string, file?: string): SceneDiagnostic {
  return createSceneDiagnostic({
    code,
    phase: 'compile',
    severity: 'error',
    message,
    operation: 'defineGenerator',
    ...(GENERATOR_HOW_TO_FIX[code] ? { howToFix: GENERATOR_HOW_TO_FIX[code] } : {}),
    ...(GENERATOR_CAUSES[code] ? { possibleCauses: GENERATOR_CAUSES[code] } : {}),
    ...(file ? { source: { file, start: 0, end: 0, line: 1, column: 1 } } : {}),
  })
}

export async function loadImportClosure(
  sceneRoot: string,
  entryFile: string,
  overrides: Record<string, string> = {},
): Promise<{ files: Record<string, string>; diagnostics: SceneDiagnostic[] }> {
  const files: Record<string, string> = {}
  const diagnostics: SceneDiagnostic[] = []
  const visiting = new Set<string>()
  const visit = async (file: string): Promise<void> => {
    if (visiting.has(file)) {
      diagnostics.push(diagnostic('GENERATOR_IMPORT_CYCLE', `Generator import cycle detected at '${file}'.`, file))
      return
    }
    if (files[file] !== undefined) return
    visiting.add(file)
    const source = overrides[file] ?? await readFile(resolve(sceneRoot, file), 'utf8').catch(() => '')
    if (!source && !overrides[file]) {
      diagnostics.push(diagnostic('GENERATOR_SOURCE_MISSING', `Generator source '${file}' was not found.`, file))
      visiting.delete(file)
      return
    }
    files[file] = source
    if (hasDynamicImport(source)) {
      diagnostics.push(diagnostic('GENERATOR_IMPORT_DYNAMIC', 'Dynamic import() is not allowed in Generator code.', file))
    }
    for (const specifier of collectRelativeImports(source)) {
      const issue = diagnoseGeneratorImport(file, specifier)
      if (issue) {
        diagnostics.push(diagnostic(issue.code, issue.message, file))
        continue
      }
      if (SDK_SPECIFIERS.has(specifier) || !isRelativeSpecifier(specifier)) continue
      await visit(resolveProjectImport(file, specifier))
    }
    visiting.delete(file)
  }
  await visit(entryFile)
  return { files, diagnostics }
}

function resolveBesideCompile(basename: string): string {
  const js = resolve(here, `${basename}.js`)
  if (existsSync(js)) return js
  const ts = resolve(here, `${basename}.ts`)
  if (existsSync(ts)) return ts
  return resolve(here, `../src/${basename}.ts`)
}

function sdkRuntimePath(): string {
  return resolveBesideCompile('sdk-runtime')
}

function geomRuntimePath(): string {
  return resolveBesideCompile('geom')
}

function sdkGlobalsPath(): string {
  return resolveBesideCompile('sdk-globals')
}

function typeTokenBanner(): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(scenePortTokens)) {
    if (typeof value === 'string') parts.push(`${key}=${JSON.stringify(value)}`)
  }
  return `var ${parts.join(',')};`
}

export async function bundleGenerator(
  sceneRoot: string,
  entryFile: string,
  sources: Record<string, string>,
): Promise<{ code: string; map: string; diagnostics: SceneDiagnostic[] }> {
  const diagnostics: SceneDiagnostic[] = []
  const virtualRoot = resolve(sceneRoot)
  try {
    const result = await esbuild.build({
      absWorkingDir: virtualRoot,
      entryPoints: [resolve(virtualRoot, entryFile)],
      outfile: 'generator.bundle.js',
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      sourcemap: true,
      inject: [sdkGlobalsPath()],
      banner: {
        js: typeTokenBanner(),
      },
      legalComments: 'none',
      logLevel: 'silent',
      plugins: [
        {
          name: 'project-generator-sandbox',
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (args.kind === 'entry-point') {
                return { path: resolve(virtualRoot, entryFile), namespace: 'generator-source' }
              }
              if (args.kind === 'dynamic-import') {
                diagnostics.push(diagnostic('GENERATOR_IMPORT_DYNAMIC', 'Dynamic import() is not allowed in Generator code.', entryFile))
                return { path: args.path, namespace: 'generator-banned' }
              }
              if (args.path === '@forgeax/project-generator/geom') {
                return { path: geomRuntimePath() }
              }
              if (SDK_SPECIFIERS.has(args.path)) {
                return { path: sdkRuntimePath() }
              }
              if (args.importer && !args.importer.startsWith(virtualRoot)) {
                return undefined
              }
              const issue = diagnoseGeneratorImport(
                args.importer ? args.importer.slice(virtualRoot.length + 1) || entryFile : entryFile,
                args.path,
              )
              if (issue) {
                diagnostics.push(diagnostic(issue.code, issue.message, issue.file))
                return { path: args.path, namespace: 'generator-banned' }
              }
              if (isRelativeSpecifier(args.path)) {
                const from = args.importer
                  ? args.importer.slice(virtualRoot.length + 1)
                  : entryFile
                const relative = resolveProjectImport(from || entryFile, args.path)
                return { path: resolve(virtualRoot, relative), namespace: 'generator-source' }
              }
              return undefined
            })
            build.onLoad({ filter: /.*/, namespace: 'generator-banned' }, () => ({
              contents: 'throw new Error("banned generator import")',
              loader: 'js',
            }))
            build.onLoad({ filter: /.*/, namespace: 'generator-source' }, (args) => {
              const relative = args.path.slice(virtualRoot.length + 1)
              const source = sources[relative]
              if (source === undefined) return { errors: [{ text: `missing source ${relative}` }] }
              return { contents: source, loader: 'ts', resolveDir: dirname(args.path) }
            })
          },
        },
      ],
    })
    const js = result.outputFiles.find((file) => file.path.endsWith('.js'))
    const map = result.outputFiles.find((file) => file.path.endsWith('.map'))
    if (!js) {
      diagnostics.push(diagnostic('GENERATOR_BUNDLE', 'esbuild produced no bundle.', entryFile))
      return { code: '', map: '', diagnostics }
    }
    return { code: js.text, map: map?.text ?? '', diagnostics }
  } catch (error) {
    diagnostics.push(diagnostic(
      'GENERATOR_BUNDLE',
      error instanceof Error ? error.message : String(error),
      entryFile,
    ))
    return { code: '', map: '', diagnostics }
  }
}

export async function compileGeneratorFile(
  sceneRoot: string,
  entryFile: string,
  overrides: Record<string, string> = {},
): Promise<CompileGeneratorResult> {
  const diagnostics: SceneDiagnostic[] = []
  if (projectSourceKind(entryFile) !== 'generator') {
    return {
      artifacts: [],
      diagnostics: [diagnostic('GENERATOR_SOURCE_KIND', `Expected a .generator.ts file, got '${entryFile}'.`, entryFile)],
    }
  }
  const loaded = await loadImportClosure(sceneRoot, entryFile, overrides)
  diagnostics.push(...loaded.diagnostics)
  const source = loaded.files[entryFile] ?? ''
  const parsed = parseGeneratorContractSource(source, entryFile)
  for (const item of parsed.diagnostics) {
    diagnostics.push(diagnostic(item.code, item.message, item.file))
  }
  if (diagnostics.some((item) => item.severity === 'error') || parsed.exports.length === 0) {
    return { artifacts: [], diagnostics }
  }
  const bundled = await bundleGenerator(sceneRoot, entryFile, loaded.files)
  diagnostics.push(...bundled.diagnostics)
  if (!bundled.code || diagnostics.some((item) => item.severity === 'error')) {
    return { artifacts: [], diagnostics }
  }
  const sourceHash = contentHash(
    Object.entries(loaded.files).sort(([left], [right]) => left.localeCompare(right))
      .map(([file, text]) => `${file}\0${text}`)
      .join('\n'),
  )
  const artifacts = parsed.exports.map((item) => ({
    definitionId: item.meta.id,
    exportName: item.exportName,
    opId: item.contract.opId,
    contract: item.contract,
    sourceHash,
    implementationRevision: contentHash(`${sourceHash}\0${item.meta.id}\0${stableJsonHash(item.contract)}\0${bundled.code}`),
    bundle: bundled.code,
    sourceMap: bundled.map,
    sources: loaded.files,
  }))
  return { artifacts, diagnostics }
}

export async function writeGeneratorArtifact(
  projectDir: string,
  artifact: CompiledGeneratorArtifact,
): Promise<string> {
  const root = join(projectDir, 'state', 'generators', artifact.definitionId)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'bundle.js'), artifact.bundle, 'utf8')
  if (artifact.sourceMap) await writeFile(join(root, 'bundle.js.map'), artifact.sourceMap, 'utf8')
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify({
    definitionId: artifact.definitionId,
    exportName: artifact.exportName,
    opId: artifact.opId,
    contract: artifact.contract,
    sourceHash: artifact.sourceHash,
    implementationRevision: artifact.implementationRevision,
    sources: Object.keys(artifact.sources),
  }, null, 2)}\n`, 'utf8')
  for (const [file, source] of Object.entries(artifact.sources)) {
    const target = join(root, 'sources', file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, source, 'utf8')
  }
  return root
}
