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
const legacyAuthoringPrefix = /wb-/u
const scannerCredentialField = /\bcredentials\b/u
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
  assert(pkg.publishConfig?.tag === 'latest', `${pkg.name} must explicitly publish to latest`)
  assert(/^bun@\d/u.test(pkg.packageManager ?? ''), `${pkg.name} must declare a pinned Bun package manager`)
  assert(pkg.name === '@forgeax-extension/scene-generator', `${pkg.name} must be the canonical Scene Generator package`)
  assert(manifest.id === '@forgeax-extension/scene-generator', `${pkg.name} manifest id must match the package`)
  assert(!legacyAuthoringPrefix.test(JSON.stringify(manifest)), `${pkg.name} manifest contains a legacy authoring identity`)
  assert(!JSON.stringify(manifest).includes('@forgeax-plugin/'), `${pkg.name} manifest contains a retired package scope`)
  const toolIds = (manifest.contributes?.tools ?? []).map(({ id }) => id)
  assert(new Set(toolIds).size === toolIds.length, `${pkg.name} tool ids must be unique`)
  const toolSchemaReferences = []
  for (const tool of manifest.contributes?.tools ?? []) {
    assert(typeof tool.args === 'string' && tool.args.startsWith('./schemas/tools/'), `${pkg.name} ${tool.id} args must reference a generated package-local schema`)
    for (const field of ['args', 'returns']) {
      const reference = tool[field]
      if (reference === undefined) continue
      assert(typeof reference === 'string' && reference.startsWith('./schemas/tools/'), `${pkg.name} ${tool.id} ${field} must reference a generated package-local schema`)
      const absolute = resolve(packageRoot, reference)
      assert(absolute.startsWith(`${packageRoot}${sep}`), `${pkg.name} ${tool.id} ${field} escapes the package`)
      assert(existsSync(absolute), `${pkg.name} ${tool.id} ${field} schema is missing: ${reference}`)
      const schema = JSON.parse(readFileSync(absolute, 'utf8'))
      assert(schema !== null && typeof schema === 'object' && !Array.isArray(schema), `${pkg.name} ${tool.id} ${field} schema must be a JSON object`)
      toolSchemaReferences.push(reference.replace(/^\.\//u, ''))
    }
  }
  const contributionIds = Object.values(manifest.contributes ?? {})
    .flatMap((entries) => Array.isArray(entries) ? entries : [])
    .map(({ id }) => id)
    .filter((id) => typeof id === 'string')
  for (const id of contributionIds) {
    assert(/^[a-z]/u.test(id), `${pkg.name} contribution id must start with a lowercase letter: ${id}`)
  }
  assert(JSON.stringify(manifest.contributes?.activities?.map(({ id }) => id)) === JSON.stringify([
    'scene-generator.launcher',
  ]), `${pkg.name} must publish the Scene Generator activity`)
  assert(pkg.version === manifest.version, `${pkg.name} package and manifest versions must match`)
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
  })) {
    assert(typeof entry === 'string' && entry.startsWith('.'), `${pkg.name} ${label} entry is invalid`)
    const absolute = resolve(packageRoot, entry)
    assert(absolute === packageRoot || absolute.startsWith(`${packageRoot}${sep}`), `${pkg.name} ${label} escapes the package`)
    assert(existsSync(absolute), `${pkg.name} ${label} entry is missing: ${entry}`)
  }
  const personaFiles = (manifest.contributes?.agents ?? []).map(({ personaFile }) => personaFile)
  for (const persona of personaFiles) {
    assert(typeof persona === 'string' && persona.startsWith('.'), `${pkg.name} agent personaFile is invalid: ${persona}`)
    const absolute = resolve(packageRoot, persona)
    assert(absolute.startsWith(`${packageRoot}${sep}`), `${pkg.name} agent personaFile escapes the package`)
    assert(existsSync(absolute), `${pkg.name} agent personaFile is missing: ${persona}`)
  }
  assert(typeof pkg.scripts?.serve === 'string', `${pkg.name} must expose scripts.serve`)
  assert(!pkg.scripts?.dev, `${pkg.name} must not expose scripts.dev`)
  assert(existsSync(join(packageRoot, 'bun.lock')), `${pkg.name} must include bun.lock`)
  assert(existsSync(join(packageRoot, 'modules/composition/batteries')), `${pkg.name} composition batteries are missing`)
  assert(existsSync(join(packageRoot, 'modules/composition/shared-batteries')), `${pkg.name} common batteries are missing`)
  assert(existsSync(join(packageRoot, 'modules/composition/dist/frontend/index.html')), `${pkg.name} composition frontend is missing`)
  assert(existsSync(join(packageRoot, 'modules/composition/dist/server/main.js')), `${pkg.name} composition backend is missing`)
  const target = pkg.exports?.['./composition']
  assert(typeof target === 'string' && existsSync(resolve(packageRoot, target)), `${pkg.name} export ./composition is missing`)

  const packed = packDryRun(packageRoot)
  const standard = readJson(packageRoot, 'extensions/scene-generator/extension.json')
  const codex = readJson(packageRoot, '.codex-plugin/plugin.json')
  const portable = readJson(packageRoot, 'plugin.json')
  assert(codex.name === 'scene-generator' && codex.version.startsWith(`${pkg.version}+codex.`), 'Codex plugin identity is invalid')
  assert(portable.name === codex.name && portable.version === codex.version, 'Portable plugin identity must match Codex')
  assert(pkg.bin?.['scene-generator'] === './codex/cli.mjs', 'Codex installer command is missing')
  assert(standard.schemaVersion === 1 && standard.id === 'scene-generator', 'standard extension identity is invalid')
  assert(standard.version === pkg.version && standard.cli === 'cli.mjs', 'standard extension version or CLI is invalid')
  const packedPaths = new Set(packed.map((file) => file.path.replaceAll('\\', '/')))
  for (const required of [
    'package.json',
    'README.md',
    'forgeax-extension.json',
    String(manifest.entry.frontend).replace(/^\.\//u, ''),
    String(manifest.entry.backend).replace(/^\.\//u, ''),
    'serve.mjs',
    'extensions/scene-generator/extension.json',
    'extensions/scene-generator/cli.mjs',
    'extensions/scene-generator/skills/scene-generator-authoring/SKILL.md',
    'extensions/scene-generator/skills/scene-generator-authoring/references/authoring.md',
    'plugin.json',
    '.codex-plugin/plugin.json',
    'codex/cli.mjs',
    'skills/scene-build/SKILL.md',
    'skills/scene-build/references/authoring.md',
    'skills/scene-build/agents/openai.yaml',
    'modules/composition/pack-resources/platform.json',
    'modules/composition/pack-resources/verify-child.mjs',
    ...toolSchemaReferences,
    ...personaFiles.map((persona) => persona.replace(/^\.\//u, '')),
  ]) {
    assert(packedPaths.has(required), `${pkg.name} does not publish required file: ${required}`)
  }
  assert(!packedPaths.has('bun.lock'), `${pkg.name} must not publish its build-only bun.lock`)
  for (const file of packed) {
    const normalized = file.path.replaceAll('\\', '/')
    assert(!forbiddenPath.test(normalized), `${pkg.name} publishes forbidden path: ${normalized}`)
    assert(!normalized.endsWith('.generated.json'), `${pkg.name} publishes a source-only parity oracle: ${normalized}`)
    assert(!/\/batteries\/.+\/index\.ts$/u.test(normalized), `${pkg.name} publishes an uncompiled battery entry: ${normalized}`)
    assert(!legacyAuthoringPrefix.test(normalized), `${pkg.name} publishes a legacy authoring path: ${normalized}`)
    const absolute = resolve(packageRoot, normalized)
    assert(absolute === packageRoot || absolute.startsWith(`${packageRoot}${sep}`), `${pkg.name} packed file escapes its package`)
    if (!isTextFile(normalized)) continue
    const text = readFileSync(absolute, 'utf8')
    if (normalized.endsWith('.js')) {
      assert(!scannerCredentialField.test(text), `${pkg.name} publishes a plaintext credential field in JavaScript: ${normalized}`)
    }
    assert(!legacyAuthoringPrefix.test(text), `${pkg.name} packed file contains a legacy authoring identity: ${normalized}`)
    for (const pattern of forbiddenText) {
      assert(!pattern.test(text), `${pkg.name} packed file contains a credential or absolute path: ${normalized}`)
    }
  }
}

function packDryRun(packageRoot) {
  const destination = mkdtempSync(join(tmpdir(), 'forgeax-release-pack-'))
  try {
    const invocation = npmInvocation(['pack', '--dry-run', '--json', '--pack-destination', destination])
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
  const npmCommand = execFileSync('where.exe', ['npm.cmd'], {
    encoding: 'utf8',
  })
    .split(/\r?\n/u)
    .find(Boolean)
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
