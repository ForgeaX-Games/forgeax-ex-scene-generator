#!/usr/bin/env node
/** Build the single publishable Scene Generator package. */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureWorkspacePackages } from './ensure-workspace-packages.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
ensureWorkspacePackages(ROOT)
const RELEASE_ROOT = resolve(ROOT, 'release', 'scene-generator')
const APPS = [
  { module: 'composition', slug: 'wb-scene-generator', backendPort: 9557 },
  { module: '3d-model', slug: 'wb-3d-lowpoly', backendPort: 9567 },
  { module: '2d-assets', slug: 'wb-2d-scene-asset-generator', backendPort: 9577 },
]
const INTERNAL_RUNTIME_PACKAGES = ['node-runtime', 'editor-host', 'batteries-common', 'scene-authoring', 'project-generator', 'i18n', 'node-runtime-react']
const BATTERY_EXTERNALS = ['chokidar', 'pino', 'pino-pretty', 'zod', 'typescript']
const MACHINE_PATH = /(?:^|[^A-Za-z0-9_])\/(?:tmp|var|etc|usr|opt|Users|private|home|workspace|mnt|root|srv|app|build|Volumes|Library)(?:\/|$)/u

rmSync(resolve(ROOT, 'release'), { recursive: true, force: true })
mkdirSync(RELEASE_ROOT, { recursive: true })
const built = APPS.map(buildModule)
const manifests = built.map(({ sourceManifest }) => sourceManifest)
writeJson(join(RELEASE_ROOT, 'forgeax-extension.json'), aggregateManifest(manifests))
writeJson(join(RELEASE_ROOT, 'package.json'), packageJson(manifests[0]?.version ?? '0.0.0', Object.assign({}, ...built.map(({ dependencies }) => dependencies))))
writeFileSync(join(RELEASE_ROOT, 'README.md'), releaseReadme(), 'utf8')
writeFileSync(join(RELEASE_ROOT, 'serve.mjs'), serverScript(), 'utf8')
run('bun', ['install'], RELEASE_ROOT)
buildToolHandlerAggregator()
if (!existsSync(join(RELEASE_ROOT, 'dist/server/tool-handlers.js'))) {
  throw new Error('release aggregator build completed without dist/server/tool-handlers.js')
}
console.log(`[release] built @forgeax-extension/scene-generator with ${APPS.length} first-level modules`)

function buildModule({ module, slug }) {
  const appRoot = join(ROOT, 'apps', slug)
  const moduleRoot = join(RELEASE_ROOT, 'modules', module)
  const backendRoot = join(appRoot, 'backend')
  const frontendRoot = join(appRoot, 'frontend')
  const backendManifest = readJson(join(backendRoot, 'package.json'))
  // Read the canonical file directly. On Windows clones without symlink support,
  // forgeax-extension.json is checked out as the literal symlink target text.
  const sourceManifest = readJson(join(appRoot, 'forgeax-plugin.json'))
  run('bun', ['run', '--cwd', frontendRoot, 'build'], ROOT)
  run('bun', ['run', '--cwd', appRoot, 'build:vendor'], ROOT)
  mkdirSync(moduleRoot, { recursive: true })
  writeFileSync(join(moduleRoot, 'index.js'), `export const id = ${JSON.stringify(module)}\nexport const source = ${JSON.stringify(slug)}\nexport default { id, source }\n`, 'utf8')
  copyIfPresent(join(frontendRoot, 'dist'), join(moduleRoot, 'dist/frontend'))
  copyIfPresent(join(appRoot, 'batteries'), join(moduleRoot, 'batteries'))
  copyIfPresent(join(ROOT, 'packages/batteries-common/batteries'), join(moduleRoot, 'shared-batteries'))
  copyIfPresent(join(appRoot, 'assets'), join(moduleRoot, 'assets'))
  copyIfPresent(join(appRoot, 'templates'), join(moduleRoot, 'templates'))
  copyIfPresent(join(appRoot, 'skills'), join(moduleRoot, 'skills'))
  copyIfPresent(join(appRoot, 'agents'), join(moduleRoot, 'agents'))
  copyIfPresent(join(appRoot, 'acceptance/promoted.json'), join(moduleRoot, 'acceptance/promoted.json'))
  copyIfPresent(join(appRoot, 'examples/scene-script/coastal-small-city'), join(moduleRoot, 'examples/scene-script/coastal-small-city'))
  copyIfPresent(join(appRoot, 'vendor/dist'), join(moduleRoot, 'vendor/dist'))
  // Batteries import the vendor source tree with relative paths while they
  // are being compiled. Keep it only for the build; published runtime uses
  // the already compiled vendor/dist tree.
  copyIfPresent(join(appRoot, 'vendor/shared'), join(moduleRoot, 'vendor/shared'))
  copyIfPresent(join(backendRoot, 'src/scene-export/assets'), join(moduleRoot, 'backend/scene-export-assets'))
  copyIfPresent(join(appRoot, 'SKILL.md'), join(moduleRoot, 'SKILL.md'))
  createBuildWorkspaceLinks(moduleRoot)
  compileBatteryEntries(join(moduleRoot, 'batteries'))
  compileBatteryEntries(join(moduleRoot, 'shared-batteries'))
  // Native Scene Script parity oracles belong to source verification, not the
  // runtime package. Keeping both the oracle and canonical JSON also deepens
  // Windows installer paths without adding runtime behavior.
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
  for (const entry of ['sdk-runtime', 'sdk-globals', 'geom']) run('bun', [
    'build', join(ROOT, 'packages/project-generator/src', `${entry}.ts`),
    '--outdir', join(moduleRoot, 'dist/server'), '--target', 'node', '--format', 'esm', '--naming=[name].js',
  ], ROOT)
  copyIfPresent(join(ROOT, 'packages/project-generator/src/sandbox/child.mjs'), join(moduleRoot, 'dist/server/child.mjs'))
  for (const entry of ['main.ts', 'tool-handlers.ts']) run('bun', [
    'build', join(backendRoot, 'src', entry), '--outdir', join(moduleRoot, 'dist/server'), '--target', 'bun', '--format', 'esm', '--sourcemap=linked', '--naming=[name].js',
    '--define=process.env.NODE_ENV="production"',
    ...external.map((name) => `--external=${name}`),
  ], ROOT)
  removeFilesBySuffix(moduleRoot, '.map')
  return { sourceManifest, dependencies }
}

function buildToolHandlerAggregator() {
  const imports = APPS.map(({ module }) => `import ${identifier(module)} from ${JSON.stringify(`../../modules/${module}/dist/server/tool-handlers.js`)}`).join('\n')
  const source = `${imports}\nexport default Object.assign({}, ${APPS.map(({ module }) => identifier(module)).join(', ')})\n`
  const outputPath = join(RELEASE_ROOT, 'dist/server/tool-handlers.js')
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, source, 'utf8')
  if (MACHINE_PATH.test(source)) throw new Error('release aggregator contains a machine absolute path')
}

function aggregateManifest(sourceManifests) {
  const first = sourceManifests[0] ?? {}
  const moduleFor = (id) => String(id ?? '').includes('wb-3d-lowpoly') ? '3d-model' : String(id ?? '').includes('wb-2d-scene-asset-generator') ? '2d-assets' : 'composition'
  const moduleForManifest = (manifest) => moduleFor(manifest.id)
  const contributes = {
    ...(first.contributes ?? {}),
    panelTypes: sourceManifests.flatMap((manifest) => (manifest.contributes?.panelTypes ?? []).map((panel) => ({ ...panel, entry: prefixModulePath(moduleFor(panel.id), panel.entry) }))),
    pages: sourceManifests.flatMap((manifest) => manifest.contributes?.pages ?? []),
    skills: sourceManifests.flatMap((manifest) => (manifest.contributes?.skills ?? []).map((skill) => ({ ...skill, entry: prefixModulePath(moduleForManifest(manifest), skill.entry) }))),
    tools: sourceManifests.flatMap((manifest) => manifest.contributes?.tools ?? []),
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
    description: { zh: '场景生成器产品包，包含完整场景编排、3D 模型生成和 2D 场景资产生成三个一级模块。', en: 'Scene Generator product package with composition, 3D model, and 2D asset generation as first-level modules.' },
    icon: first.icon ?? '🌍',
    compatibleWith: first.compatibleWith,
    requestedEnv: [...new Set(sourceManifests.flatMap((manifest) => manifest.requestedEnv ?? []))],
    entry: { frontend: './modules/composition/dist/frontend/index.html', backend: './dist/server/tool-handlers.js', standalone: { start: 'bun run serve', port: 9555, readyProbe: '/health', embeddedAlso: false } },
    experimental: sourceManifests.some((manifest) => manifest.experimental === true),
    categories: ['workbench'],
    contributes,
  }
}

function packageJson(version, dependencies) {
  return {
    name: '@forgeax-extension/scene-generator', version, private: false, type: 'module', packageManager: 'bun@1.3.14',
    description: 'ForgeaX Scene Generator extension: composition, 3D model, and 2D asset modules.',
    repository: { type: 'git', url: 'git+https://github.com/ForgeaX-Games/forgeax-ex-scene-generator.git' }, license: 'Apache-2.0',
    files: ['dist', 'modules', 'README.md', 'serve.mjs', 'forgeax-extension.json', 'bun.lock'],
    exports: { '.': './forgeax-extension.json', './package.json': './package.json', './forgeax-extension.json': './forgeax-extension.json', './composition': './modules/composition/index.js', './3d-model': './modules/3d-model/index.js', './2d-assets': './modules/2d-assets/index.js' },
    scripts: { serve: 'bun serve.mjs', 'check:release': "node -e \"const p=require('./package.json');if(Object.values(p.dependencies||{}).some(v=>/^(file:|link:|workspace:|git\\+)/.test(v)))throw new Error('release dependencies must be registry versions')\"" },
    dependencies,
  }
}

function serverScript() {
  const children = JSON.stringify(APPS.map(({ module, backendPort }) => ({ module, backendPort })))
  return `import { createServer } from 'node:http'\nimport { createReadStream, existsSync, statSync } from 'node:fs'\nimport { extname, join, normalize, resolve } from 'node:path'\nconst root = resolve(import.meta.dirname)\nconst children = ${children}.map(({ module, backendPort }) => ({ module, backendPort, process: Bun.spawn(['bun', 'modules/' + module + '/dist/server/main.js'], { cwd: root, env: { ...process.env, PORT: String(backendPort) }, stdout: 'inherit', stderr: 'inherit' }) }))\nconst port = Number(process.env.VITE_DEV_PORT ?? 9555)\nconst mime = new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.webp','image/webp']])\nconst server = createServer((req, res) => { if (req.url === '/health') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({ status: 'ok', package: '@forgeax-extension/scene-generator', modules: children.map(({ module }) => module) })); return } const requested = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)).replace(/^(\\.\\.[/\\\\])+/, ''); let file = resolve(root, '.' + requested); if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'modules/composition/dist/frontend/index.html'); res.writeHead(200, {'content-type': mime.get(extname(file)) ?? 'application/octet-stream'}); createReadStream(file).pipe(res) })\nserver.listen(port, '0.0.0.0', () => console.log('[scene-generator] listening on :' + port))\nfor (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const child of children) child.process.kill(); server.close(() => process.exit(0)) })\n`
}

function releaseReadme() { return `# Scene Generator\n\nOne installable extension package with three first-level modules:\n\n- composition — complete scene composition and authoring\n- 3d-model — procedural 3D model generation\n- 2d-assets — 2D scene asset generation\n\n## Install\n\nbun add @forgeax-extension/scene-generator\n\nThe package owns one manifest, version, lockfile, lifecycle, and publish operation.\n` }
function prefixModulePath(module, value) { return typeof value === 'string' && value.startsWith('./') ? `./modules/${module}/${value.slice(2)}` : value }
function identifier(value) { return `module_${value.replace(/[^a-zA-Z0-9_$]/g, '_')}` }
function compileBatteryEntries(root) { if (!existsSync(root)) return; for (const indexPath of walk(root).filter((path) => basename(path) === 'index.ts')) { const outputDir = dirname(indexPath); run('bun', ['build', indexPath, '--outdir', outputDir, '--target', 'bun', '--format', 'esm', '--naming=[name].js', ...BATTERY_EXTERNALS.map((name) => `--external=${name}`)], ROOT); rmSync(indexPath, { force: true }) } }
function createBuildWorkspaceLinks(root) { const forgeax = join(root, 'node_modules/@forgeax'); mkdirSync(forgeax, { recursive: true }); symlinkSync(join(ROOT, 'packages/node-runtime'), join(forgeax, 'node-runtime'), process.platform === 'win32' ? 'junction' : 'dir') }
function walk(dir) { const files = []; for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) files.push(...walk(path)); else if (entry.isFile()) files.push(path) } return files }
function removeFilesBySuffix(dir, suffix) { if (!existsSync(dir)) return; for (const path of walk(dir)) if (path.endsWith(suffix)) rmSync(path, { force: true }) }
function copyIfPresent(from, to) { if (existsSync(from)) cpSync(from, to, { recursive: true }) }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
function run(command, args, cwd) { console.log(`[release] ${command} ${args.map((arg) => JSON.stringify(arg)).join(' ')}`); execFileSync(command, args, { cwd, stdio: 'inherit' }) }
