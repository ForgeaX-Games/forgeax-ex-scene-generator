import { posix, resolve } from 'node:path'
import * as esbuild from 'esbuild'
import ts from 'typescript'

/** Manifest inputs must round-trip without silently dropping functions or typed data.
 * Procedural logic and typed buffers belong in the ordinary TS module closure.
 */
export function assertPortableInputs(
  args: unknown,
): asserts args is readonly unknown[] {
  if (!Array.isArray(args))
    throw new Error('Pack args must be an array of JSON data')
  const active = new Set<object>()
  const visit = (value: unknown, path: string): void => {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      !Object.is(value, -0)
    )
      return
    if (
      typeof value !== 'object' ||
      active.has(value) ||
      (!Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    )
      throw new Error(
        `Pack input ${path} must be portable JSON data; keep executable or typed values in the TS source`,
      )
    active.add(value)
    if (Array.isArray(value))
      for (let i = 0; i < value.length; i++) visit(value[i], `${path}[${i}]`)
    else
      for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key))
          throw new Error(`Unsupported pack input key: ${path}.${key}`)
        visit(item, `${path}.${key}`)
      }
    active.delete(value)
  }
  visit(args, 'args')
}

/** A fresh lexical instance of the complete program per build, including its dependencies.
 * No eval, module-cache eviction, process globals or Engine implementation is needed.
 */
export async function compilePortableScene(
  files: ReadonlyMap<string, string>,
  entryFile: string,
  options: {
    exportName?: string
    args?: readonly unknown[]
    projectDir: string
  },
): Promise<string> {
  assertPortableInputs(options.args ?? [])
  const wrapper = `export * as entry from './scene/${entryFile}'; export { collectedScene } from './platform/outputs.ts';`
  const result = await esbuild.build({
    stdin: {
      contents: wrapper,
      sourcefile: 'entry.ts',
      resolveDir: options.projectDir,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    metafile: true,
    logLevel: 'silent',
    legalComments: 'none',
    plugins: [
      {
        name: 'portable-scene-source',
        setup(build) {
          build.onResolve({ filter: /^\./ }, (args) => {
            if (
              args.namespace &&
              args.namespace !== 'file' &&
              args.namespace !== 'portable'
            )
              return
            const importer =
              args.namespace === 'portable' ? args.importer : 'entry.ts'
            const base = posix.normalize(
              posix.join(posix.dirname(importer), args.path),
            )
            const path = [
              base,
              base.replace(/\.js$/, '.ts'),
              `${base}.ts`,
              `${base}/index.ts`,
            ].find((p) => files.has(p))
            return path ? { path, namespace: 'portable' } : undefined
          })
          build.onLoad({ filter: /.*/, namespace: 'portable' }, (args) => ({
            contents: files.get(args.path)!,
            loader: args.path.endsWith('.json') ? 'json' : 'ts',
            resolveDir: resolve(
              options.projectDir,
              posix.dirname(args.path.replace(/^scene\//, '')),
            ),
          }))
        },
      },
    ],
  })
  const external = Object.values(result.metafile.outputs).flatMap((output) =>
    output.imports.filter((item) => item.external).map((item) => item.path),
  )
  if (external.length)
    throw new Error(
      `Pack entry '${entryFile}' has runtime-only dependencies: ${[...new Set(external)].join(', ')}. Bind portable data or provide a build-time implementation.`,
    )
  const code = ts.transpileModule(result.outputFiles[0]!.text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText
  const selected = JSON.stringify(options.exportName ?? 'default')
  return `// Generated executable closure. Rebuild the pack from its accompanying editable scene sources.
export async function generateScene(args = ${JSON.stringify(options.args ?? [])}) {
  const exports = {};
  const module = { exports };
${code}
  const entry = module.exports.entry;
  const selected = ${selected};
  ${options.exportName === undefined ? '' : "if (!(selected in entry)) throw new Error('Selected scene export is missing: ' + selected);"}
  const value = typeof entry[selected] === 'function' ? await entry[selected](...args) : await entry[selected];
  return value === undefined ? module.exports.collectedScene() : value;
}
`
}
