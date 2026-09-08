import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const apps = ['wb-scene-generator', 'wb-3d-lowpoly', 'wb-2d-scene-asset-generator']

test('the aggregated release declares each tool ID once and retains the Sino persona', () => {
  const manifests = apps.map((app) => JSON.parse(readFileSync(resolve(root, 'apps', app, 'forgeax-plugin.json'), 'utf8')))
  const tools = manifests.flatMap((manifest) => manifest.contributes?.tools ?? [])
  const seen = new Set()
  for (const tool of tools) {
    assert(!seen.has(tool.id), `duplicate release tool ID: ${tool.id}`)
    seen.add(tool.id)
  }
  assert(seen.has('asset2d:templates.list'))
  assert(seen.has('asset2d:templates.get'))
  assert(manifests.flatMap((manifest) => manifest.contributes?.agents ?? []).some((agent) => agent.id === 'sino'))
})

test('Sino can request the closed starter and verify completed scenes', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'apps/wb-scene-generator/forgeax-extension.json'), 'utf8'))
  const sino = manifest.contributes.agents.find((agent) => agent.id === 'sino')
  for (const id of ['scene:script.scaffold', 'scene:script.verify']) {
    const tool = manifest.contributes.tools.find((entry) => entry.id === id)
    assert(tool?.exposedToAI, `${id} must be discoverable`)
    assert(sino.tools.includes(id), `${id} must be allowed for Sino`)
  }
})
