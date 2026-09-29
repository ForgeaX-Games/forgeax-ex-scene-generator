import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'

const repo = resolve(import.meta.dirname, '..')
const backendRequire = createRequire(resolve(repo, 'apps/composition/backend/package.json'))
const frontendRequire = createRequire(resolve(repo, 'apps/composition/frontend/package.json'))
const { createServer } = await import(resolve(dirname(frontendRequire.resolve('vite/package.json')), 'dist/node/index.js'))

test('project files follow real source mutations without reloading the page', { timeout: 90_000 }, async (t) => {
  const scratch = resolve(repo, '.scratch-repro/project-file-tree')
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(resolve(scratch, 'run-'))
  const server = fork(resolve(repo, 'extensions/scene-generator/test/server.mts'), [], {
    execArgv: ['--conditions=source', '--import', backendRequire.resolve('tsx')],
    cwd: repo,
    env: { ...process.env, FORGEAX_PROJECT_ROOT: resolve(root, 'service'), FORGEAX_GAMES_ROOT: resolve(root, 'games'), TMPDIR: root },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let output = ''
  let vite
  let browser
  server.stdout.on('data', data => { output += data })
  server.stderr.on('data', data => { output += data })
  t.after(async () => {
    await browser?.close()
    await vite?.close()
    if (server.connected) {
      const exited = once(server, 'exit')
      server.send('close')
      await exited
    }
  })
  const [{ address }] = await Promise.race([
    once(server, 'message'),
    once(server, 'exit').then(([code]) => { throw new Error(`Service exited ${code}: ${output}`) }),
  ])
  process.env.VITE_API_TARGET = address
  vite = await createServer({
    root: resolve(repo, 'apps/composition/frontend'),
    configFile: resolve(repo, 'apps/composition/frontend/vite.config.ts'),
    cacheDir: resolve(root, 'vite-cache'),
    server: { port: 0, host: '127.0.0.1' },
    logLevel: 'error',
  })
  await vite.listen()
  browser = await chromium.launch({ headless: true, env: { ...process.env, TMPDIR: root } })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  const headers = {
    'x-forgeax-caller-kind': 'extension',
    'x-forgeax-caller-extension-id': 'scene-generator',
  }
  async function request(path, method = 'GET', body) {
    const response = await fetch(`${address}/api/v1${path}`, {
      method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    assert(response.ok, `${method} ${path}: ${response.status} ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  const project = await request('/projects', 'POST', { name: 'File tree acceptance' })
  const prefix = `/projects/${project.id}/scene-script`
  await request(`/projects/${project.id}/view`, 'POST', {})
  await page.goto(`${origin}/?pane=left&projectId=${project.id}`, { waitUntil: 'networkidle' })
  const tree = page.locator('.scene-project-info__tree')
  await tree.getByText('main.scene.ts', { exact: true }).waitFor()
  let navigations = 0
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
  const main = `import { box, sceneNode, sceneOutput } from '@forgeax/scene'
sceneOutput({ scene: sceneNode({ name: 'Market foundation', geometry: box({ width: 4, depth: 3, height: 1 }) }).scene })`
  async function commit(files, deleteFiles = []) {
    const info = await request(`${prefix}/project-info`)
    const result = await request(`${prefix}/commit`, 'POST', {
      files, deleteFiles, entryFile: 'main.scene.ts', expectedProjectRevision: info.projectRevision,
    })
    assert.equal(result.ok, true)
  }
  async function visible(file, present = true) {
    await tree.locator(`[title="${file}"]`).waitFor({ state: present ? 'visible' : 'detached', timeout: 8000 })
  }
  await commit([
    { file: 'main.scene.ts', source: main },
    { file: 'market-hall.scene.ts', source: 'export const hallWidth = 12' },
  ])
  await visible('market-hall.scene.ts')
  const stateFolder = tree.locator('button[title="state"]')
  await stateFolder.click()
  // These helpers do not affect the executed graph, so graph events cannot refresh them.
  await commit([{ file: 'palette.ts', source: 'export const roof = "#904632"' }])
  await visible('palette.ts')
  assert.equal(await stateFolder.locator('..').getAttribute('aria-expanded'), 'false')
  await stateFolder.click()
  await commit([{ file: 'materials.ts', source: 'export const roof = "#904632"' }], ['palette.ts'])
  await visible('materials.ts')
  await visible('palette.ts', false)
  await commit([{ file: 'main.scene.ts', source: main }], ['materials.ts'])
  await visible('materials.ts', false)
  await request(`${prefix}/files`, 'POST', { file: 'courtyard.scene.ts', source: 'export const width = 8' })
  await visible('courtyard.scene.ts')
  await request(`${prefix}/files`, 'PATCH', { from: 'courtyard.scene.ts', to: 'plaza.scene.ts' })
  await visible('plaza.scene.ts')
  await visible('courtyard.scene.ts', false)
  await request(`${prefix}/files?file=plaza.scene.ts`, 'DELETE')
  await visible('plaza.scene.ts', false)
  for (const [action, present] of [['undo', true], ['redo', false]]) {
    const info = await request(`${prefix}/project-info`)
    await request(`${prefix}/${action}`, 'POST', { expectedProjectRevision: info.projectRevision })
    await visible('plaza.scene.ts', present)
  }
  const info = await request(`${prefix}/project-info`)
  const displayed = await tree.locator('.scene-project-info__tree-row--file').evaluateAll(rows => rows.map(row => row.title))
  assert.deepEqual(displayed.sort(), info.files.map(file => file.path.replace(/^\.\.\//, '')).sort())
  assert.equal(navigations, 0)
  assert.deepEqual(errors, [])
})
