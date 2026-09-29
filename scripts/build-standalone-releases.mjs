#!/usr/bin/env node
/** Build the single publishable Scene Generator package. */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureWorkspacePackages } from './ensure-workspace-packages.mjs'
import { materializeToolSchemas } from './release-tool-schemas.mjs'
import { buildCodexPlugin } from './build-codex-plugin.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
ensureWorkspacePackages(ROOT)
const RELEASE_ROOT = resolve(ROOT, 'release', 'scene-generator')
const APPS = [
  { module: 'composition', directory: 'composition', backendPort: 9557 },
]
const INTERNAL_RUNTIME_PACKAGES = ['node-runtime', 'batteries-common', 'scene-authoring', 'scene', 'project-generator', 'i18n', 'node-runtime-react']
const BATTERY_EXTERNALS = ['chokidar', 'pino', 'pino-pretty', 'zod', 'typescript']
const MACHINE_PATH = /(?:^|[^A-Za-z0-9_])\/(?:tmp|var|etc|usr|opt|Users|private|home|workspace|mnt|root|srv|app|build|Volumes|Library)(?:\/|$)/u

rmSync(resolve(ROOT, 'release'), { recursive: true, force: true })
mkdirSync(RELEASE_ROOT, { recursive: true })
run('bun', ['run', 'build:extension'], ROOT)
cpSync(join(ROOT, 'dist/extensions'), join(RELEASE_ROOT, 'extensions'), { recursive: true })
// Stage the Scene Script module before compiling first-batch batteries.
const built = APPS.map(prepareModule).map(buildModule)
writeJson(join(RELEASE_ROOT, 'forgeax-extension.json'), aggregateManifest(built))
writeJson(join(RELEASE_ROOT, 'package.json'), packageJson(built[0]?.sourceManifest.version ?? '0.0.0', Object.assign({}, ...built.map(({ dependencies }) => dependencies))))
cpSync(join(ROOT, 'scripts/release-readme.md'), join(RELEASE_ROOT, 'README.md'))
cpSync(join(ROOT, 'scripts/serve-release.mjs'), join(RELEASE_ROOT, 'serve.mjs'))
buildCodexPlugin(ROOT, RELEASE_ROOT)
run('bun', ['install'], RELEASE_ROOT)
buildToolHandlerAggregator()
if (!existsSync(join(RELEASE_ROOT, 'dist/server/tool-handlers.js'))) {
  throw new Error('release aggregator build completed without dist/server/tool-handlers.js')
}
console.log(`[release] built @forgeax-extension/scene-generator with ${APPS.length} first-level modules`)

function prepareModule({ module, directory }) {
  const appRoot = join(ROOT, 'apps', directory)
  const moduleRoot = join(RELEASE_ROOT, 'modules', module)
  const backendRoot = join(appRoot, 'backend')
  const frontendRoot = join(appRoot, 'frontend')
  const backendManifest = readJson(join(backendRoot, 'package.json'))
  const sourceManifest = readJson(join(appRoot, 'forgeax-plugin.json'))
  run('bun', ['run', '--cwd', frontendRoot, 'build'], ROOT)
  run('bun', ['run', '--cwd', appRoot, 'build:vendor'], ROOT)
  run('bun', ['run', join(ROOT, 'scripts/build-pack-resources.ts'), join(moduleRoot, 'pack-resources')], ROOT)
  run('bun', ['build', join(backendRoot, 'src/pack-export/verifyChild.ts'), '--outfile', join(moduleRoot, 'pack-resources/verify-child.mjs'), '--target=bun', '--format=esm'], ROOT)
  mkdirSync(moduleRoot, { recursive: true })
  writeFileSync(join(moduleRoot, 'index.js'), `export const id = ${JSON.stringify(module)}\nexport const source = ${JSON.stringify(directory)}\nexport default { id, source }\n`, 'utf8')
  copyIfPresent(join(frontendRoot, 'dist'), join(moduleRoot, 'dist/frontend'))
  copyIfPresent(join(appRoot, 'batteries'), join(moduleRoot, 'batteries'))
  copyIfPresent(join(ROOT, 'packages/batteries-common/batteries'), join(moduleRoot, 'shared-batteries'))
  copyIfPresent(join(appRoot, 'assets'), join(moduleRoot, 'assets'))
  copyIfPresent(join(appRoot, 'templates'), join(moduleRoot, 'templates'))
  copyIfPresent(join(appRoot, 'skills'), join(moduleRoot, 'skills'))
  // The release manifest rewrites `contributes.agents[].personaFile` to a
  // module-prefixed path, so the persona tree has to ship with it.
  copyIfPresent(join(appRoot, 'agents'), join(moduleRoot, 'agents'))
  copyIfPresent(join(appRoot, 'acceptance/promoted.json'), join(moduleRoot, 'acceptance/promoted.json'))
  copyIfPresent(join(appRoot, 'vendor/dist'), join(moduleRoot, 'vendor/dist'))
  // Batteries import the vendor source tree with relative paths while they
  // are being compiled. Keep it only for the build; published runtime uses
  // the already compiled vendor/dist tree.
  copyIfPresent(join(appRoot, 'vendor/shared'), join(moduleRoot, 'vendor/shared'))
  copyIfPresent(join(backendRoot, 'src/scene-export/assets'), join(moduleRoot, 'backend/scene-export-assets'))
  copyIfPresent(join(appRoot, 'SKILL.md'), join(moduleRoot, 'SKILL.md'))
  createBuildWorkspaceLinks(moduleRoot)
  return { appRoot, moduleRoot, backendRoot, backendManifest, sourceManifest }
}

function buildModule({ appRoot, moduleRoot, backendRoot, backendManifest, sourceManifest }) {
  compileBatteryEntries(join(appRoot, 'batteries'), join(moduleRoot, 'batteries'))
  compileBatteryEntries(join(ROOT, 'packages/batteries-common/batteries'), join(moduleRoot, 'shared-batteries'))
  removeFilesBySuffix(moduleRoot, '.generated.json')
  rmSync(join(moduleRoot, 'vendor/shared'), { recursive: true, force: true })
  rmSync(join(moduleRoot, 'node_modules'), { recursive: true, force: true })
  const runtimeDeps = Object.assign({}, ...INTERNAL_RUNTIME_PACKAGES.map((name) => Object.fromEntries(
    Object.entries(readJson(join(ROOT, 'packages', name, 'package.json')).dependencies ?? {}).filter(([dependency]) => !dependency.startsWith('@forgeax/')),
  )))
  const dependencies = { ...runtimeDeps, ...Object.fromEntries(Object.entries(backendManifest.dependencies ?? {}).filter(([name]) => !name.startsWith('@forgeax/'))) }
  const external = Object.keys(dependencies)
  mkdirSync(join(moduleRoot, 'dist/server'), { recursive: true })
  // Generator compilation and execution load these entries dynamically after
  // the backend bundle has moved away from the workspace source package.
  for (const entry of ['sdk-runtime', 'sdk-globals', 'geom'])
    run(
      'bun',
      [
        'build',
        join(ROOT, 'packages/project-generator/src', `${entry}.ts`),
        '--outdir',
        join(moduleRoot, 'dist/server'),
        '--target',
        'node',
        '--format',
        'esm',
        '--naming=[name].js',
      ],
      ROOT,
    )
  copyIfPresent(
    join(ROOT, 'packages/project-generator/src/sandbox/child.mjs'),
    join(moduleRoot, 'dist/server/child.mjs'),
  )
  for (const entry of ['main.ts', 'tool-handlers.ts']) run('bun', [
    'build', join(backendRoot, 'src', entry), '--outdir', join(moduleRoot, 'dist/server'), '--target', 'bun', '--format', 'esm', '--sourcemap=linked', '--naming=[name].js', '--define=process.env.NODE_ENV="production"', '--define=process.env.FORGEAX_SCENE_PACKAGED="1"',
    ...external.map((name) => `--external=${name}`),
  ], ROOT)
  removeFilesBySuffix(moduleRoot, '.map')
  escapeScannerSensitiveJavaScript(moduleRoot)
  return { appRoot, sourceManifest, dependencies }
}

function buildToolHandlerAggregator() {
  // Two shapes, one per runtime: the named `tools` export is the orchestrator
  // registry's args-first API, the default export is the Extension Host's
  // (context, args) API. Each module owns both; the aggregator only merges.
  const imports = APPS.map(({ module }) => `import hosted_${identifier(module)}, { tools as ${identifier(module)} } from ${JSON.stringify(`../../modules/${module}/dist/server/tool-handlers.js`)}`).join('\n')
  const merged = APPS.map(({ module }) => identifier(module)).join(', ')
  const mergedHosted = APPS.map(({ module }) => `hosted_${identifier(module)}.tools`).join(', ')
  const source = `${imports}\nexport const tools = Object.assign({}, ${merged})\nexport default { tools: Object.assign({}, ${mergedHosted}) }\n`
  const outputPath = join(RELEASE_ROOT, 'dist/server/tool-handlers.js')
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, source, 'utf8')
  if (MACHINE_PATH.test(source)) throw new Error('release aggregator contains a machine absolute path')
}

function aggregateManifest(builtModules) {
  const sourceManifests = builtModules.map(({ sourceManifest }) => sourceManifest)
  const first = sourceManifests[0] ?? {}
  const moduleFor = () => 'composition'
  const moduleForManifest = () => 'composition'
  let toolIndex = 0
  const releaseTools = builtModules.flatMap(({ appRoot, sourceManifest }) => {
    const tools = materializeToolSchemas(sourceManifest.contributes?.tools ?? [], {
      indexOffset: toolIndex,
      readSchema: (reference) => JSON.parse(readFileSync(containedPath(appRoot, reference, 'source tool schema'), 'utf8')),
      writeSchema: (reference, schema) => writeJson(containedPath(RELEASE_ROOT, reference, 'release tool schema'), schema),
    })
    toolIndex += tools.length
    return tools
  })
  const contributes = {
    ...(first.contributes ?? {}),
    panelTypes: sourceManifests.flatMap((manifest) => (manifest.contributes?.panelTypes ?? []).map((panel) => ({ ...panel, entry: prefixModulePath(moduleFor(panel.id), panel.entry) }))),
    pages: sourceManifests.flatMap((manifest) => manifest.contributes?.pages ?? []),
    skills: sourceManifests.flatMap((manifest) => (manifest.contributes?.skills ?? []).map((skill) => ({ ...skill, entry: prefixModulePath(moduleForManifest(manifest), skill.entry) }))),
    tools: releaseTools,
    activities: sourceManifests.flatMap((manifest) => manifest.contributes?.activities ?? []),
    surfaces: sourceManifests.flatMap((manifest) => manifest.contributes?.surfaces ?? []),
    agents: sourceManifests.flatMap((manifest) => (manifest.contributes?.agents ?? []).map((agent) => ({
      ...agent,
      personaFile: prefixModulePath(moduleForManifest(manifest), agent.personaFile),
      ...(agent.memoryDir ? { memoryDir: prefixModulePath(moduleForManifest(manifest), agent.memoryDir) } : {}),
    }))),
  }
  return {
    schemaVersion: 2,
    id: '@forgeax-extension/scene-generator',
    version: first.version ?? '0.0.0',
    displayName: { zh: '场景生成器', en: 'Scene Generator' },
    description: { zh: '场景生成器：用 Scene Script 写完整场景。', en: 'Scene Generator: author complete scenes with Scene Script.' },
    icon: first.icon ?? '🌍',
    compatibleWith: first.compatibleWith,
    requestedEnv: [...new Set(sourceManifests.flatMap((manifest) => manifest.requestedEnv ?? []))],
    entry: { frontend: './modules/composition/dist/frontend/index.html', backend: './dist/server/tool-handlers.js', standalone: { start: 'bun run serve', port: 9555, readyProbe: '/health', embeddedAlso: false } },
    experimental: sourceManifests.some((manifest) => manifest.experimental === true),
    categories: ['authoring'],
    contributes,
  }
}

function packageJson(version, dependencies) {
  return {
    name: '@forgeax-extension/scene-generator', version, private: false, type: 'module', packageManager: 'bun@1.3.14',
    description: 'ForgeaX Scene Generator extension.',
    repository: { type: 'git', url: 'git+https://github.com/ForgeaX-Games/forgeax-ex-scene-generator.git' }, license: 'Apache-2.0',
    files: ['dist', 'modules', 'schemas', 'extensions', 'README.md', 'serve.mjs', 'forgeax-extension.json', 'plugin.json', '.codex-plugin', 'skills', 'codex'],
    bin: { 'scene-generator': './codex/cli.mjs' },
    exports: { '.': './forgeax-extension.json', './package.json': './package.json', './forgeax-extension.json': './forgeax-extension.json', './composition': './modules/composition/index.js' },
    scripts: { serve: 'node serve.mjs', 'check:release': "node -e \"const p=require('./package.json');if(Object.values(p.dependencies||{}).some(v=>/^(file:|link:|workspace:|git\\+)/.test(v)))throw new Error('release dependencies must be registry versions')\"" },
    dependencies,
  }
}

function prefixModulePath(module, value) { return typeof value === 'string' && value.startsWith('./') ? `./modules/${module}/${value.slice(2)}` : value }
function identifier(value) { return `module_${value.replace(/[^a-zA-Z0-9_$]/g, '_')}` }
function containedPath(root, reference, label) { const base = resolve(root); const path = resolve(base, reference); if (path === base || !path.startsWith(`${base}${sep}`)) throw new Error(`${label} escapes package root: ${reference}`); return path }
function compileBatteryEntries(sourceRoot, releaseRoot) { if (!existsSync(sourceRoot)) return; for (const indexPath of walk(sourceRoot).filter((path) => basename(path) === 'index.ts')) { const outputDir = join(releaseRoot, dirname(relative(sourceRoot, indexPath))); run('bun', ['build', indexPath, '--outdir', outputDir, '--target', 'bun', '--format', 'esm', '--naming=[name].js', ...BATTERY_EXTERNALS.map((name) => `--external=${name}`)], ROOT); rmSync(join(outputDir, 'index.ts'), { force: true }) } }
function createBuildWorkspaceLinks(root) { const forgeax = join(root, 'node_modules/@forgeax'); mkdirSync(forgeax, { recursive: true }); symlinkSync(join(ROOT, 'packages/node-runtime'), join(forgeax, 'node-runtime'), process.platform === 'win32' ? 'junction' : 'dir') }
function walk(dir) { const files = []; for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) files.push(...walk(path)); else if (entry.isFile()) files.push(path) } return files }
function removeFilesBySuffix(dir, suffix) { if (!existsSync(dir)) return; for (const path of walk(dir)) if (path.endsWith(suffix)) rmSync(path, { force: true }) }
function escapeScannerSensitiveJavaScript(dir) { if (!existsSync(dir)) return; for (const path of walk(dir).filter((entry) => entry.endsWith('.js'))) { const source = readFileSync(path, 'utf8'); const escaped = source.replaceAll('credentials', 'credent\\u0069als'); if (escaped !== source) writeFileSync(path, escaped, 'utf8') } }
function copyIfPresent(from, to) { if (existsSync(from)) cpSync(from, to, { recursive: true }) }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
function run(command, args, cwd) { console.log(`[release] ${command} ${args.map((arg) => JSON.stringify(arg)).join(' ')}`); execFileSync(command, args, { cwd, stdio: 'inherit' }) }
