import { inspectModuleImports, rewriteModuleImports } from '@forgeax/scene-authoring'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, posix, relative, resolve } from 'node:path'

import { primaryOutputPort } from '@forgeax/scene'

import { resolveFirstBatchLibraryEntries } from '../scene-script/firstBatchBatteries.js'
import { appRoot, isPackaged } from '../resources.js'

/**
 * Vendors the first-batch library into a self-contained `platform/` tree so the
 * emitted pack runs with no `@forgeax/scene` and no `globalThis.__forgeaxSceneHost`.
 *
 * Local sources retain their repo-relative paths under `platform/lib/`.
 * Canonical contracts come from the importer's installed package, under
 * `lib/canonical/scene-authoring/`. All edges are rebased between emitted paths,
 * including TypeScript's `.js` -> `.ts` source extension substitution.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..')
const CANONICAL_PACKAGE = '@forgeax/scene-authoring'
export const PORTABLE_SDK_SPECIFIERS = new Set(['@forgeax/scene','@forgeax/scene/runtime','@forgeax/project-generator','@forgeax/project-generator/sdk'])

/** Names `@forgeax/scene` provides that are not first-batch battery exports. */
const NON_BATTERY_EXPORTS: Readonly<Record<string, string>> = {
  sampleHeight: './hostExtras.ts',
  sampleSurface: './hostExtras.ts',
  defineGenerator: './generator.ts',
  defineRecordedGenerator: './generator.ts',
  defineMaterial: './material.ts',
  paintSurface: './material.ts',
}

/** Collected by `platform/outputs.ts` instead of the battery, so `build()` can read it. */
const COLLECTED_EXPORTS: Readonly<Record<string, string>> = { sceneOutput: './outputs.ts' }

export function portableLibraryNames(): string[] {
  return [...new Set([
    ...resolveFirstBatchLibraryEntries().map(entry => entry.exportName),
    ...Object.keys(NON_BATTERY_EXPORTS),
    ...Object.keys(COLLECTED_EXPORTS),
  ])].sort()
}

export interface ClosureResult {
  /** platform-relative path -> file text. */
  readonly files: ReadonlyMap<string, string>
  readonly barrel: string
  /** Every `@forgeax/scene` name the project imports, sorted. */
  readonly imported: readonly string[]
  readonly sourceFileCount: number
}

const mapSpecifiers = rewriteModuleImports

function resolveRelative(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier)
  return [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`].find(existsSync)
}

const within = (root: string, file: string): boolean => {
  const path = relative(root, file)
  return !isAbsolute(path) && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\')
}
const relativeSpecifier = (from: string, to: string): string => {
  const path = posix.relative(posix.dirname(from), to)
  return path.startsWith('.') ? path : `./${path}`
}

/** One build owns resolution and output identity; no cached installation survives a cook. */
class SourceClosure {
  private readonly root: string
  private packageRoot?: string
  private exports?: Record<string, { source?: string; import?: string }>

  constructor(root: string) { this.root = realpathSync(root) }

  resolveImport(fromFile: string, specifier: string): string {
    if (specifier.startsWith('.')) {
      const target = resolveRelative(fromFile, specifier)
      if (!target) throw new Error(`unresolved relative import ${specifier} in ${fromFile}`)
      return realpathSync(target)
    }
    if (specifier !== CANONICAL_PACKAGE && !specifier.startsWith(`${CANONICAL_PACKAGE}/`)) {
      throw new Error(`battery closure reached ${specifier.startsWith('node:') ? 'node builtin' : 'bare import'} '${specifier}' in ${fromFile}`)
    }
    // Self-references use this package's exports; other importers use Node's
    // installed-package search paths, including workspace/package-store links.
    const installed = this.packageRoot && within(this.packageRoot, fromFile) ? this.packageRoot
      : createRequire(fromFile).resolve.paths(CANONICAL_PACKAGE)?.map(path => resolve(path, CANONICAL_PACKAGE))
        .find(path => existsSync(resolve(path, 'package.json')))
    if (!installed) throw new Error(`cannot resolve installed ${CANONICAL_PACKAGE} from ${fromFile}`)
    const packageRoot = realpathSync(installed)
    if (this.packageRoot && this.packageRoot !== packageRoot) {
      throw new Error(`battery closure reached multiple installations of ${CANONICAL_PACKAGE}: ${this.packageRoot} and ${packageRoot}`)
    }
    if (!this.packageRoot) {
      this.packageRoot = packageRoot
      this.exports = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).exports
    }
    const subpath = specifier === CANONICAL_PACKAGE ? '.' : `.${specifier.slice(CANONICAL_PACKAGE.length)}`
    const entry = this.exports?.[subpath]
    // Older canonical subpaths (mesh-asset) publish src beside dist without a
    // source condition. Resolve that same installed source layout, never a
    // similarly named file in the exporter's workspace or a generated .d.ts.
    const source = entry?.source ?? (entry?.import?.startsWith('./dist/')
      ? entry.import.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts') : undefined)
    if (!source) throw new Error(`installed ${CANONICAL_PACKAGE} has no source export for '${specifier}' in ${fromFile}`)
    const target = resolve(packageRoot, source)
    if (!existsSync(target)) throw new Error(`installed canonical source missing for '${specifier}' in ${fromFile}: ${target}`)
    return realpathSync(target)
  }

  path(file: string): string {
    if (this.packageRoot && within(this.packageRoot, file)) {
      return `lib/canonical/scene-authoring/${relative(this.packageRoot, file).replaceAll('\\', '/')}`
    }
    if (!within(this.root, file)) throw new Error(`battery closure source is outside its source root: ${file}`)
    return `lib/${relative(this.root, file).replaceAll('\\', '/')}`
  }

  collect(seeds: readonly string[]): Map<string, string> {
    const sources = new Map<string, { text: string; targets: Map<string, string> }>()
    const queue = seeds.map(file => realpathSync(file))
    while (queue.length > 0) {
      const file = queue.pop()!
      if (sources.has(file)) continue
      const text = readFileSync(file, 'utf8'), targets = new Map<string, string>()
      sources.set(file, { text, targets })
      for (const { specifier } of inspectModuleImports(text).imports) {
        const target = this.resolveImport(file, specifier)
        targets.set(specifier, target); queue.push(target)
      }
    }
    // Resolve the whole closure first, so a relative and a package import of
    // the same canonical source receive the same path regardless of walk order.
    return new Map([...sources].map(([file, { text, targets }]) => [this.path(file),
      mapSpecifiers(text, specifier => relativeSpecifier(this.path(file), this.path(targets.get(specifier)!))),
    ]))
  }
}

/** Source-only closure entry point, also used for isolated installed-package regression tests. */
export function collectSourceClosure(seeds: readonly string[], sourceRoot = REPO_ROOT): Map<string, string> {
  return new SourceClosure(sourceRoot).collect(seeds)
}

/**
 * Sources that ship at the platform root. `engineBridge.ts` sits beside this
 * file because the exporter imports it too — one projection, both sides.
 * `templates/` is copy-only: those modules compile in the pack's module graph,
 * not the backend's, so the backend tsconfig excludes them.
 */
const PLATFORM_SOURCES: readonly string[] = [
  resolve(import.meta.dirname, 'engineBridge.ts'),
  ...['outputs.ts', 'generator.ts', 'hostExtras.ts', 'material.ts', 'primary.ts'].map((name) =>
    resolve(import.meta.dirname, 'templates', name),
  ),
]

const PLATFORM_SET = new Set(PLATFORM_SOURCES)

/**
 * Copy one platform source to `platform/<basename>`. In this repo it imports
 * the real battery sources so it type-checks; in the emitted tree those same
 * targets live under `lib/`, and the platform sources stay siblings.
 */
function copyPlatformSource(file: string, seeds: Set<string>, closure: SourceClosure): () => string {
  const source = readFileSync(file, 'utf8'), targets = new Map<string, string>()
  for (const { specifier } of inspectModuleImports(source).imports) {
    // Backend compilation consumes generated declarations outside rootDir;
    // portable packs vendor their canonical TS source, never a build directory.
    const sourceSpecifier = specifier.replace('/vendor/dist/shared/', '/vendor/shared/')
    const target = closure.resolveImport(file, sourceSpecifier)
    targets.set(specifier, target)
    if (!PLATFORM_SET.has(target)) seeds.add(target)
  }
  // Defer path assignment until the entire closure has identified canonical sources.
  return () => mapSpecifiers(source, (specifier) => {
    const target = targets.get(specifier)!
    if (PLATFORM_SET.has(target)) return `./${basename(target)}`
    return `./${closure.path(target)}`
  })
}

/**
 * Build `platform/` for exactly the `@forgeax/scene` names the project imports.
 * The battery table stays the single source of truth — this derives from
 * `resolveFirstBatchLibraryEntries()` and never restates it.
 */
export function buildPlatformClosure(imported: readonly string[]): ClosureResult {
  const byExport = new Map(resolveFirstBatchLibraryEntries().map((entry) => [entry.exportName, entry.file]))
  const wanted = [...new Set(imported)].sort()
  const unsupported = wanted.filter(
    (name) => !byExport.has(name) && !(name in NON_BATTERY_EXPORTS) && !(name in COLLECTED_EXPORTS),
  )
  if (unsupported.length > 0) {
    throw new Error(
      `scene imports ${unsupported.join(', ')} from @forgeax/scene, which the pack exporter cannot vendor`,
    )
  }

  if (isPackaged) {
    const stored = JSON.parse(readFileSync(resolve(appRoot, 'pack-resources/platform.json'), 'utf8')) as {
      files: Array<[string, string]>
      barrel: string
      imported: string[]
    }
    for (const name of wanted) {
      if (!stored.imported.includes(name)) throw new Error(`Pack resources do not include ${name}`)
    }
    const files = new Map(stored.files)
    return { files, barrel: stored.barrel, imported: wanted, sourceFileCount: files.size }
  }

  const seeds = new Set<string>()
  const closure = new SourceClosure(REPO_ROOT)
  for (const name of wanted) {
    const file = byExport.get(name)
    if (file) seeds.add(file)
  }
  const typeSources=['@forgeax/scene-authoring/scene-tree','@forgeax/scene-authoring/values'].map(specifier=>closure.resolveImport(import.meta.filename,specifier))
  for(const file of typeSources) seeds.add(file)
  const platform = new Map(PLATFORM_SOURCES.map((file) => [basename(file), copyPlatformSource(file, seeds, closure)]))

  const files = closure.collect([...seeds])
  for (const [name, copy] of platform) files.set(name, copy())
  // Batteries return `{ <port>: value, _warnings? }`. In the app the host
  // unwraps the primary port before the scene sees it (`unwrapPrimaryResult`), so
  // the barrel has to do the same or the two runs disagree the moment scene code
  // touches a result instead of passing it straight into another battery —
  // exactly what a material rule does (`gridSlope(...)` is a Grid in the app but
  // `{ grid }` here). Batteries tolerate both shapes on input, which is why this
  // stayed invisible until materials.
  const lines: string[] = typeSources.map(file=>`export type * from './${closure.path(file)}'`)
  let needsUnwrap = false
  for (const name of wanted) {
    const collected = COLLECTED_EXPORTS[name]
    if (collected) {
      lines.push(`export { ${name} } from '${collected}'`)
      continue
    }
    const extra = NON_BATTERY_EXPORTS[name]
    if (extra) {
      lines.push(`export { ${name} } from '${extra}'`)
      continue
    }
    const specifier = `./${closure.path(realpathSync(byExport.get(name)!))}`
    const port = primaryOutputPort(name)
    if (!port) {
      lines.push(`export { ${name} } from '${specifier}'`)
      continue
    }
    needsUnwrap = true
    lines.push(`import { ${name} as ${name}$body } from '${specifier}'`)
    lines.push(`export const ${name} = (args: Parameters<typeof ${name}$body>[0]) => primary(${name}$body(args), ${JSON.stringify(port)})`)
  }
  const barrel = `${[
    '// Generated by scene-generator pack export. Replaces the virtual `@forgeax/scene`',
    '// module with the real first-batch battery bodies — no host injection.',
    ...(needsUnwrap ? ["import { primary } from './primary.ts'"] : []),
    ...lines,
  ].join('\n')}\n`
  return { files, barrel, imported: wanted, sourceFileCount: files.size }
}

/** Named `@forgeax/scene` imports across the project's scene sources. */
export function collectSceneImports(sources: ReadonlyMap<string, string>): string[] {
  const names = new Set<string>()
  for (const source of sources.values()) for (const item of inspectModuleImports(source).imports) {
    if (!PORTABLE_SDK_SPECIFIERS.has(item.specifier) || item.typeOnly) continue
    if (item.names.includes('*')) {
      for (const name of portableLibraryNames()) names.add(name)
    } else for (const name of item.names) names.add(name)
  }
  return [...names].sort()
}
