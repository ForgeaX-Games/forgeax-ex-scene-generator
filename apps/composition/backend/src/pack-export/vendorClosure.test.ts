import { afterEach, describe, expect, it } from 'vitest'
import { inspectModuleImports, rewriteModuleImports } from '@forgeax/scene-authoring'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildPlatformClosure, collectSourceClosure } from './vendorClosure.js'

const roots: string[] = []
const temporary = () => { const root = mkdtempSync(join(tmpdir(), 'scene-closure-')); roots.push(root); return root }
const write = (file: string, text: string) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function stage(files: ReadonlyMap<string, string>): string {
  const root = temporary()
  write(join(root, 'package.json'), '{"type":"module"}')
  for (const [file, text] of files) {
    expect(file.startsWith('lib/../')).toBe(false)
    for (const { specifier } of inspectModuleImports(text).imports) {
      expect(specifier.startsWith('.'), `${file} -> ${specifier}`).toBe(true)
      expect(files.has(posix.normalize(posix.join(posix.dirname(file), specifier))), `${file} -> ${specifier}`).toBe(true)
    }
    const javascript = ts.transpileModule(rewriteModuleImports(text, specifier => specifier.replace(/\.ts$/, '.js')), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText
    write(join(root, file.replace(/\.ts$/, '.js')), javascript)
  }
  return root
}

function evaluate(root: string, file: string, expression: string): unknown {
  const url = pathToFileURL(join(root, file.replace(/\.ts$/, '.js'))).href
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `import * as entry from ${JSON.stringify(url)}; console.log(JSON.stringify(${expression}));`,
  ], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } }))
}

describe('installed canonical source closure', () => {
  it.each(['directory', 'symlink'])('vendors the installed %s package and runs after the installation is removed', (layout) => {
    const root = temporary(), install = join(root, 'plugin'), link = join(install, 'node_modules/@forgeax/scene-authoring')
    const pkg = layout === 'symlink' ? join(root, 'package-store/scene-authoring') : link
    write(join(pkg, 'package.json'), JSON.stringify({ name: '@forgeax/scene-authoring', exports: {
      './scene-tree': { source: './src/contracts/tree.ts', import: './dist/incorrect.js' },
      './scene-wire': { source: './src/codec/wire.ts', import: './dist/wire.js' },
    } }))
    if (layout === 'symlink') { mkdirSync(dirname(link), { recursive: true }); symlinkSync(pkg, link, 'dir') }
    write(join(pkg, 'src/contracts/tree.ts'), "import { numeric } from './buffers.js'; export { origin } from '@forgeax/scene-authoring/scene-wire'; export const isNumericBuffer = numeric; export type Shape = { count: number };\n")
    write(join(pkg, 'src/contracts/buffers.ts'), 'export const numeric = (x: unknown) => Array.isArray(x) || x instanceof Uint16Array;\n')
    write(join(pkg, 'src/codec/wire.ts'), "import type { Shape } from '../contracts/tree.js'; export const origin: Shape = { count: 73 };\n")
    write(join(pkg, 'dist/incorrect.js'), "throw new Error('must use published source condition');\n")
    const entry = join(install, 'vendor/surfacePaint.ts')
    write(entry, "export { isNumericBuffer, origin } from '@forgeax/scene-authoring/scene-tree';\n")
    const files = collectSourceClosure([entry], install)
    const detached = stage(files)
    expect(files.size).toBe(4) // the type-only cycle is visited once; dist is not copied
    rmSync(root, { recursive: true })
    expect(evaluate(detached, 'lib/vendor/surfacePaint.ts', '[entry.isNumericBuffer(new Uint16Array([1])), entry.origin.count]')).toEqual([true, 73])
  })

  it('keeps the real surfacePaint runtime dependency and all platform imports executable', () => {
    const closure = buildPlatformClosure(['paintSurface', 'defineMaterial', 'sceneOutput'])
    const root = stage(new Map([...closure.files, ['index.ts', closure.barrel]]))
    const paint = closure.files.get('lib/apps/composition/vendor/shared/types/scene/surfacePaint.ts')!
    expect(paint).toMatch(/import \{ isNumericBuffer \} from '\./)
    const output = evaluate(root, 'index.ts', `entry.paintSurface({ geometry: { kind: 'mesh', positions: new Float32Array([0,0,0,1,0,0,0,1,0]), indices: new Uint16Array([0,1,2]) }, material: entry.defineMaterial({ name: 'canonical', surface: () => ({ baseColor: [1,0,0,1] }) }) })`)
    expect(output).toMatchObject({ geometry: { indices: [0, 1, 2], material: { id: 'canonical' } } })
  })

  it('reports a missing installed source instead of borrowing the workspace copy', () => {
    const root = temporary(), entry = join(root, 'surfacePaint.ts')
    write(join(root, 'node_modules/@forgeax/scene-authoring/package.json'), JSON.stringify({
      name: '@forgeax/scene-authoring', exports: { './scene-tree': { source: './src/missing.ts' } },
    }))
    write(entry, "export { isNumericBuffer } from '@forgeax/scene-authoring/scene-tree';\n")
    expect(() => collectSourceClosure([entry], root)).toThrow(/installed canonical source missing.*scene-tree.*surfacePaint\.ts/)
  })

  it.each(['other-runtime', 'node:fs'])('still rejects the unavailable dependency %s', (specifier) => {
    const root = temporary(), entry = join(root, 'entry.ts')
    write(entry, `import ${JSON.stringify(specifier)};\n`)
    expect(() => collectSourceClosure([entry], root)).toThrow(`'${specifier}' in `)
  })
})
