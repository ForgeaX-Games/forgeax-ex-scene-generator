#!/usr/bin/env node
/**
 * Release gate for the generated standalone packages. It intentionally checks
 * the files that `npm pack` would publish, rather than the development workspace.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const packageArgument = process.argv.indexOf('--package')
const packages = packageArgument >= 0
  ? [resolve(process.argv[packageArgument + 1] ?? '')]
  : [join(ROOT, 'release', 'scene-generator')]
const forbiddenDependency = /^(?:file:|link:|workspace:|git\+)/u
const forbiddenPath = /(?:^|\/)(?:node_modules|\.env(?:\.|$))(?:\/|$)/iu
const forbiddenText = [
  /(?:^|[^A-Za-z0-9_])(?:api[_-]?key|access[_-]?token|secret(?:[_-]?key)?|password)\s*[:=]\s*["'][^"']+["']/iu,
  /(?:^|[\s"'`=])(?:\/(?:tmp|var|etc|usr|opt|Users|private|home|workspace|mnt|root|srv|app|build|Volumes|Library)(?:\/|$)|[A-Za-z]:[\\/])/u,
]

for (const packageRoot of packages) checkPackage(packageRoot)
console.log(`[release] release contract passed for ${packages.length} package(s)`)

function checkPackage(packageRoot) {
  assert(existsSync(packageRoot), `release package is missing: ${packageRoot}`)
  const pkg = readJson(packageRoot, 'package.json')
  const manifest = readJson(packageRoot, 'forgeax-extension.json')
  assert(pkg.private !== true, `${pkg.name} must be publishable`)
  assert(/^bun@\d/u.test(pkg.packageManager ?? ''), `${pkg.name} must declare a pinned Bun package manager`)
  assert(pkg.name === '@forgeax-extension/scene-generator', `${pkg.name} must be the canonical Scene Generator package`)
  assert(manifest.id === '@forgeax-extension/scene-generator', `${pkg.name} manifest id must match the package`)
  assert(pkg.version === manifest.version, `${pkg.name} package and manifest versions must match`)
  const toolIds = (manifest.contributes?.tools ?? []).map(({ id }) => id)
  assert(new Set(toolIds).size === toolIds.length, `${pkg.name} tool IDs must be unique`)
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, specifier] of Object.entries(pkg[section] ?? {})) {
      assert(typeof specifier === 'string' && !forbiddenDependency.test(specifier),
        `${pkg.name} ${section}.${name} must not use a local or Git dependency`)
    }
  }
  for (const [label, entry] of Object.entries({
    frontend: manifest.entry?.frontend,
    backend: manifest.entry?.backend,
    standalone: './serve.mjs',
    ...Object.fromEntries((manifest.contributes?.agents ?? []).map((agent) => [
      `agent ${agent.id} persona`, agent.personaFile,
    ])),
  })) {
    assert(typeof entry === 'string' && entry.startsWith('.'), `${pkg.name} ${label} entry is invalid`)
    const absolute = resolve(packageRoot, entry)
    assert(absolute === packageRoot || absolute.startsWith(`${packageRoot}${sep}`), `${pkg.name} ${label} escapes the package`)
    assert(existsSync(absolute), `${pkg.name} ${label} entry is missing: ${entry}`)
  }
  assert(typeof pkg.scripts?.serve === 'string', `${pkg.name} must expose scripts.serve`)
  assert(!pkg.scripts?.dev, `${pkg.name} must not expose scripts.dev`)
  assert(existsSync(join(packageRoot, 'bun.lock')), `${pkg.name} must include bun.lock`)
  assert(existsSync(join(packageRoot, 'modules/composition/batteries')), `${pkg.name} composition batteries are missing`)
  assert(existsSync(join(packageRoot, 'modules/3d-model/batteries')), `${pkg.name} 3d-model batteries are missing`)
  assert(existsSync(join(packageRoot, 'modules/2d-assets/batteries')), `${pkg.name} 2d-assets batteries are missing`)
  assert(existsSync(join(packageRoot, 'modules/composition/shared-batteries')), `${pkg.name} common batteries are missing`)
  for (const module of ['composition', '3d-model', '2d-assets']) {
    assert(existsSync(join(packageRoot, `modules/${module}/dist/frontend/index.html`)), `${pkg.name} ${module} frontend is missing`)
    assert(existsSync(join(packageRoot, `modules/${module}/dist/server/main.js`)), `${pkg.name} ${module} backend is missing`)
  }
  for (const subpath of ['composition', '3d-model', '2d-assets']) {
    const target = pkg.exports?.[`./${subpath}`]
    assert(typeof target === 'string' && existsSync(resolve(packageRoot, target)), `${pkg.name} export ./${subpath} is missing`)
  }

  const packed = packDryRun(packageRoot)
  const packedPaths = new Set(packed.map((file) => file.path.replaceAll('\\', '/')))
  for (const required of [
    'package.json',
    'bun.lock',
    'README.md',
    'forgeax-extension.json',
    String(manifest.entry.frontend).replace(/^\.\//u, ''),
    String(manifest.entry.backend).replace(/^\.\//u, ''),
    'serve.mjs',
    ...(manifest.contributes?.agents ?? []).map((agent) => String(agent.personaFile).replace(/^\.\//u, '')),
  ]) {
    assert(packedPaths.has(required), `${pkg.name} does not publish required file: ${required}`)
  }
  for (const file of packed) {
    const normalized = file.path.replaceAll('\\', '/')
    assert(!forbiddenPath.test(normalized), `${pkg.name} publishes forbidden path: ${normalized}`)
    assert(!normalized.endsWith('.generated.json'), `${pkg.name} publishes a source-only parity oracle: ${normalized}`)
    assert(!/\/batteries\/.+\/index\.ts$/u.test(normalized), `${pkg.name} publishes an uncompiled battery entry: ${normalized}`)
    const absolute = resolve(packageRoot, normalized)
    assert(absolute === packageRoot || absolute.startsWith(`${packageRoot}${sep}`), `${pkg.name} packed file escapes its package`)
    if (!isTextFile(normalized)) continue
    const text = readFileSync(absolute, 'utf8')
    for (const pattern of forbiddenText) {
      assert(!pattern.test(text), `${pkg.name} packed file contains a credential or absolute path: ${normalized}`)
    }
  }
}

function packDryRun(packageRoot) {
  const destination = mkdtempSync(join(tmpdir(), 'forgeax-release-pack-'))
  try {
    const npmArgs = ['pack', '--dry-run', '--json', '--pack-destination', destination]
    const invocation = npmInvocation(npmArgs)
    const output = execFileSync(invocation.command, invocation.args, {
      cwd: packageRoot,
      encoding: 'utf8',
    })
    const result = JSON.parse(output)
    assert(Array.isArray(result) && result.length === 1 && Array.isArray(result[0]?.files), 'npm pack returned no file list')
    return result[0].files
  } finally {
    rmSync(destination, { recursive: true, force: true })
  }
}

function npmInvocation(args) {
  if (process.platform !== 'win32') return { command: 'npm', args }
  const npmCommand = execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).split(/\r?\n/u).find(Boolean)
  assert(npmCommand, 'npm.cmd is not available on PATH')
  const npmCli = join(dirname(npmCommand), 'node_modules/npm/bin/npm-cli.js')
  assert(existsSync(npmCli), `npm CLI is missing beside npm.cmd: ${npmCli}`)
  return { command: process.execPath, args: [npmCli, ...args] }
}

function isTextFile(path) {
  return !/\.(?:png|jpe?g|webp|gif|ico|woff2?|ttf|otf|wasm|glb|zip|gz|mp3|mp4)$/iu.test(path)
}

function readJson(root, file) {
  return JSON.parse(readFileSync(join(root, file), 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
