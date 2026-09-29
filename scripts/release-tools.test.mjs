import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'apps/composition/forgeax-extension.json'), 'utf8'))

test('the current composition release declares each tool once and retains Sino', () => {
  const tools = manifest.contributes?.tools ?? []
  assert.equal(new Set(tools.map((tool) => tool.id)).size, tools.length)
  assert(manifest.contributes.agents.some((agent) => agent.id === 'sino'))
})

test('Sino can commit canonical Scene modules and verify completed scenes', () => {
  const sino = manifest.contributes.agents.find((agent) => agent.id === 'sino')
  for (const id of ['scene:script.commitProject', 'scene:script.verify']) {
    const tool = manifest.contributes.tools.find((entry) => entry.id === id)
    assert(tool?.exposedToAI, `${id} must be discoverable`)
    assert(sino.tools.includes(id), `${id} must be allowed for Sino`)
  }
})
