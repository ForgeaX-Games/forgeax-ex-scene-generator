#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..', '..')
const visualDir = resolve(appRoot, 'acceptance', 'visual')
const projectsPath = resolve(visualDir, 'projects.json')
const evidencePath = resolve(visualDir, 'evidence.json')
const studioUrl = process.env.FORGEAX_STUDIO_URL ?? 'http://localhost:80'
const pluginUrl = new URL(
  process.env.WB_SCENE_GENERATOR_URL ?? '/__fx-plugin/wb-scene-generator/',
  studioUrl,
).toString()
const headed = process.argv.includes('--headed')

const representativeOps = {
  common: 'basic_math_op',
  basic: 'pt2_construct',
  Grid: 'grid_size',
  scene: 'empty_scene',
  scenealg: 'alg_field_noise',
  special: 'pass_through',
  'alg-store': 'perlin_noise',
  components: 'random_rect_zone_gen',
  scene30: 'aw_perlin_noise',
  group: '__group__',
  template: '__group__',
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const screenshot = async (page, name) => {
  const path = resolve(visualDir, name)
  await page.screenshot({ path, animations: 'disabled', timeout: 15_000 })
  return name
}
const assertion = (name, pass, actual, expected) => ({ name, pass, actual, expected })

async function fetchJsonWithRetry(url, init, attempts = 5) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init)
      const text = await response.text()
      if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${response.status}: ${text}`)
      return text ? JSON.parse(text) : null
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 250))
    }
  }
  throw lastError
}

async function bodySnapshot(page) {
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    text: (await page.locator('body').innerText().catch(() => '')).slice(0, 2000),
  }
}

async function main() {
  await mkdir(visualDir, { recursive: true })
  const projects = JSON.parse(await readFile(projectsPath, 'utf8'))
  const browser = await chromium.launch({ headless: !headed })
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 })
  const studio = await context.newPage()
  const left = await context.newPage()
  const center = await context.newPage()
  for (const page of [studio, left, center]) page.setDefaultTimeout(20_000)
  const consoleErrors = []
  for (const page of [studio, left, center]) {
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push({ page: page.url(), text: message.text() })
    })
    page.on('pageerror', (error) => consoleErrors.push({ page: page.url(), text: error.message }))
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    studioUrl,
    pluginUrl,
    sourceProjects: projectsPath,
    studioEntry: {},
    batches: [],
    cells: {},
    status: 'pending',
  }

  try {
    await studio.goto(studioUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await studio.waitForTimeout(1500)
    const studioShot = await screenshot(studio, 'studio-entry.png')
    const studioState = await bodySnapshot(studio)
    manifest.studioEntry = {
      status: studioState.text.includes('Welcome to Forgeax Studio') ? 'blocked-onboarding' : 'opened',
      screenshot: studioShot,
      snapshot: studioState,
      fallback: pluginUrl,
    }
    console.log(`[visual] Studio entry: ${manifest.studioEntry.status}`)

    await Promise.all([
      left.goto(`${pluginUrl}?pane=left&locale=en`, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
      center.goto(`${pluginUrl}?locale=en`, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
    ])
    await Promise.all([
      left.locator('.scene-left-pane').waitFor({ timeout: 30_000 }),
      center.locator('.scene-workbench').waitFor({ timeout: 30_000 }),
    ])

    for (const project of projects.projects) {
      console.log(`[visual] checking ${project.batch} (${project.id})`)
      const batchErrors = []
      const assertions = []
      const screenshots = []
      const projectButton = left.locator('.proj-card__open').filter({ hasText: project.name }).first()
      const listed = await projectButton.isVisible().catch(() => false)
      assertions.push(assertion('project-listed', listed, listed, true))
      await fetchJsonWithRetry(`${pluginUrl}api/v1/projects/${project.id}/view`, { method: 'POST' })
      await Promise.all([left.reload({ waitUntil: 'domcontentloaded' }), center.reload({ waitUntil: 'domcontentloaded' })])
      await Promise.all([
        left.locator('.scene-left-pane').waitFor(),
        center.locator('.scene-workbench').waitFor(),
      ])
      let executionBody = {}
      let executionError
      try {
        executionBody = await fetchJsonWithRetry(`${pluginUrl}api/v1/projects/${project.id}/execute`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forgeax-caller-kind': 'user',
          },
          body: '{}',
        })
      } catch (error) {
        executionError = error instanceof Error ? error.message : String(error)
      }
      assertions.push(assertion(
        'runtime-execute',
        !executionError && executionBody?.status === 'completed',
        executionError ?? executionBody,
        'completed',
      ))
      await left.waitForTimeout(1000)
      screenshots.push(await screenshot(left, `${project.batch}-project-list.png`))

      const projectTab = left.getByRole('tab', { name: 'Project', exact: true })
      let projectInfoError
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await projectTab.click()
          await left.locator('.scene-project-info').filter({ hasText: project.id }).waitFor({ timeout: 8_000 })
          projectInfoError = undefined
          break
        } catch (error) {
          projectInfoError = error
          if (attempt < 3) {
            await left.reload({ waitUntil: 'domcontentloaded' })
            await left.locator('.scene-left-pane').waitFor()
          }
        }
      }
      if (projectInfoError) batchErrors.push(projectInfoError.message)
      const projectText = await left.locator('.scene-project-info').innerText().catch(() => '')
      assertions.push(assertion('project-tab-id', projectText.includes(project.id), projectText, project.id))
      assertions.push(assertion('project-file-tree', projectText.includes('main.scene.ts') && projectText.includes('authoring.json'), projectText, 'main.scene.ts + authoring.json'))
      screenshots.push(await screenshot(left, `${project.batch}-project-tab.png`))

      await center.waitForTimeout(1800)
      const pipeline = await fetchJsonWithRetry(`${pluginUrl}api/v1/projects/${project.id}/pipeline`)
      const nodes = Object.values(pipeline.nodes ?? {})
      const representative = nodes.find((node) => node.opId === representativeOps[project.batch])
      assertions.push(assertion('representative-contract-node', Boolean(representative), representative?.opId ?? null, representativeOps[project.batch]))

      const nodeLocator = center.locator('.react-flow__node')
      let nodeLoadError
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await nodeLocator.first().waitFor({ timeout: 10_000 })
          nodeLoadError = undefined
          break
        } catch (error) {
          nodeLoadError = error
          if (attempt < 3) {
            await fetchJsonWithRetry(`${pluginUrl}api/v1/projects/${project.id}/view`, { method: 'POST' })
            await center.reload({ waitUntil: 'domcontentloaded' })
            await center.locator('.scene-workbench').waitFor()
          }
        }
      }
      if (nodeLoadError) batchErrors.push(nodeLoadError.message)
      const editorPane = center.locator('.scene-workbench__editor')
      await editorPane.evaluate((element) => {
        element.classList.remove('is-collapsed')
        element.style.visibility = 'visible'
        element.style.opacity = '1'
        element.style.pointerEvents = 'auto'
      })
      await center.waitForTimeout(500)
      const nodeCount = await nodeLocator.count()
      const edgeCount = await center.locator('.react-flow__edge-path').count()
      assertions.push(assertion('canvas-nodes-visible', nodeCount >= 5, nodeCount, '>=5'))
      assertions.push(assertion('connections-visible', edgeCount >= 4, edgeCount, '>=4'))
      const boxes = await nodeLocator.evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect()
        return { id: element.getAttribute('data-id'), x: box.x, y: box.y, width: box.width, height: box.height }
      }))
      const overlaps = []
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]
          const b = boxes[j]
          const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
          const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
          if (width > 4 && height > 4) overlaps.push([a.id, b.id, Math.round(width), Math.round(height)])
        }
      }
      assertions.push(assertion('nodes-do-not-overlap', overlaps.length === 0, overlaps, []))
      const rendererPane = center.locator('.scene-workbench__panes')
      await rendererPane.evaluate((element) => { element.style.visibility = 'hidden' })
      screenshots.push(await screenshot(center, `${project.batch}-canvas.png`))
      await rendererPane.evaluate((element) => { element.style.visibility = '' })
      screenshots.push(await screenshot(center, `${project.batch}-renderer.png`))

      if (representative) {
        const target = center.locator(`.react-flow__node[data-id="${representative.id}"]`)
        await target.dispatchEvent('click').catch((error) => batchErrors.push(error.message))
        await left.getByRole('tab', { name: /Node Info/i }).click()
        await left.locator('.scene-node-info__details').waitFor({ timeout: 15_000 }).catch((error) => batchErrors.push(error.message))
      }
      const nodeInfoText = await left.locator('.scene-node-info__details').innerText().catch(() => '')
      assertions.push(assertion('ts-status-badge', /Scene Script|Equivalent/.test(nodeInfoText), nodeInfoText, 'Scene Script or Equivalent'))
      const expectedContractSource = project.batch === 'group' || project.batch === 'template'
        ? '.scene.ts'
        : 'scene.contract.ts'
      assertions.push(assertion(
        'contract-provenance',
        nodeInfoText.includes(expectedContractSource),
        nodeInfoText,
        expectedContractSource,
      ))
      screenshots.push(await screenshot(left, `${project.batch}-node-info.png`))

      const rendererFrame = center.frames().find((frame) => new URL(frame.url()).searchParams.get('pane') === 'renderer')
      const samples = []
      if (rendererFrame) {
        for (let sample = 0; sample < 4; sample += 1) {
          await rendererFrame.waitForTimeout(500)
          samples.push(await rendererFrame.locator('canvas').first().evaluate((canvas) => {
            const colors = new Set()
            const context = canvas.getContext('2d')
            const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data
            const stride = pixels ? Math.max(4, Math.floor(pixels.length / 2048 / 4) * 4) : 4
            for (let index = 0; pixels && index < pixels.length; index += stride) {
              colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`)
            }
            return {
              connected: canvas.isConnected,
              width: canvas.clientWidth,
              height: canvas.clientHeight,
              distinctColors: colors.size,
              encodedBytes: Math.floor(canvas.toDataURL('image/png').length * 0.75),
            }
          }).catch(() => ({ connected: false, width: 0, height: 0, distinctColors: 0, encodedBytes: 0 })))
        }
      }
      const rendererStable = samples.length === 4 && samples.every((sample) =>
        sample.connected &&
        sample.width > 0 &&
        sample.height > 0 &&
        sample.distinctColors > 1 &&
        sample.encodedBytes > 1_000)
      assertions.push(assertion('renderer-no-disappear-or-flicker', rendererStable, samples, '4 stable non-uniform canvas samples'))

      const pass = batchErrors.length === 0 && assertions.every((item) => item.pass)
      const evidenceId = `visual-${project.batch}-${sha256(JSON.stringify({ assertions, screenshots })).slice(0, 12)}`
      const batchEvidence = {
        evidenceId,
        batch: project.batch,
        projectId: project.id,
        projectName: project.name,
        status: pass ? 'pass' : 'failed',
        assertions,
        screenshots,
        errors: batchErrors,
        cellCount: project.cells.length,
      }
      manifest.batches.push(batchEvidence)
      for (const cellId of project.cells) {
        manifest.cells[cellId] = {
          status: batchEvidence.status,
          batch: project.batch,
          projectId: project.id,
          evidenceId,
          screenshots,
          assertionNames: assertions.map((item) => item.name),
        }
      }
    }
  } catch (error) {
    manifest.fatalError = error instanceof Error ? error.stack : String(error)
    for (const project of projects.projects) {
      const path = resolve(visualDir, `${project.batch}-fatal.png`)
      await center.screenshot({ path, animations: 'disabled', timeout: 15_000 }).catch(() => {})
      const evidenceId = `visual-${project.batch}-fatal`
      manifest.batches.push({
        evidenceId,
        batch: project.batch,
        projectId: project.id,
        projectName: project.name,
        status: 'failed',
        assertions: [],
        screenshots: [path],
        errors: [manifest.fatalError],
        cellCount: project.cells.length,
      })
      for (const cellId of project.cells) {
        manifest.cells[cellId] = {
          status: 'failed',
          batch: project.batch,
          projectId: project.id,
          evidenceId,
          screenshots: [path],
          assertionNames: [],
        }
      }
    }
  } finally {
    manifest.consoleErrors = consoleErrors
    manifest.mappedCellCount = Object.keys(manifest.cells).length
    manifest.status = manifest.batches.length === projects.projects.length &&
      manifest.mappedCellCount === projects.cellCount &&
      manifest.batches.every((batch) => batch.status === 'pass')
      ? 'pass'
      : 'failed'
    await writeFile(evidencePath, `${JSON.stringify(manifest, null, 2)}\n`)
    await browser.close()
  }

  console.log(`visual acceptance: ${manifest.status}`)
  console.log(`mapped cells: ${manifest.mappedCellCount}/${projects.cellCount}`)
  console.log(`evidence: ${evidencePath}`)
  for (const batch of manifest.batches) {
    console.log(`${batch.batch}: ${batch.status} project=${batch.projectId}`)
  }
  if (manifest.status !== 'pass') process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
