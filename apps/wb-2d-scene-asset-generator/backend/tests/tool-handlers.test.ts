import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { publishProjectRoot, tools } from '../src/tool-handlers.js'

let root: string
let portsFile: string

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wb-asset2d-tools-'))
  portsFile = join(root, 'plugin-dev-ports.json')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function ctx(toolId: string, agentId?: string) {
  return {
    caller: { kind: 'ai' as const, ...(agentId ? { agentId } : {}) },
    toolId,
    env: { FORGEAX_PLUGIN_DEV_PORTS_FILE: portsFile },
    cwd: process.cwd(),
  }
}

describe('ToolRegistry asset2d handlers', () => {
  it('publishes cross-workbench assets under the Studio project root', () => {
    expect(publishProjectRoot({}, {
      cwd: '/marketplace/extensions/wb-2d-scene-asset-generator',
      projectRoot: '/studio/project',
    })).toBe('/studio/project')
    expect(publishProjectRoot({ projectRoot: '/untrusted/project' }, {
      cwd: '/extension',
      projectRoot: '/studio/project',
    })).toBe('/studio/project')
    expect(publishProjectRoot({ projectRoot: '/legacy/project' }, {
      cwd: '/extension',
    })).toBe('/legacy/project')
  })

  it('uses the Studio plugin dev backendPort override when proxying tool calls', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-2d-scene-asset-generator': { frontendPort: 5001, backendPort: port } } }),
    )

    try {
      const result = await tools['asset2d:projects.list']({}, ctx('asset2d:projects.list'))

      expect(result).toEqual([
        expect.objectContaining({ id: 'main', type: 'asset2d', name: 'Default Asset Workspace' }),
      ])
    } finally {
      await app.close()
    }
  })

  it('resolves a single battery via the registry handlers', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-2d-scene-asset-generator': { backendPort: port } } }),
    )

    try {
      const all = await tools['asset2d:batteries.list']({}, ctx('asset2d:batteries.list')) as Array<{ id: string }>
      expect(all.length).toBeGreaterThan(0)

      const one = await tools['asset2d:batteries.get']({ id: all[0].id }, ctx('asset2d:batteries.get'))
      expect(one).toEqual(expect.objectContaining({ id: all[0].id }))
    } finally {
      await app.close()
    }
  })

  it('lists, reads, and instantiates curated group templates', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-2d-scene-asset-generator': { backendPort: port } } }),
    )

    try {
      const agentId = 'test-agent'
      const templates = await tools['asset2d:templates.list']({}, ctx('asset2d:templates.list')) as Array<{ id: string; name: string }>
      expect(templates.some((tpl) => tpl.id === 'tpl_sidescroller_background_layer')).toBe(true)

      const template = await tools['asset2d:templates.get'](
        { id: 'SideScrollerBackgroundLayer' },
        ctx('asset2d:templates.get'),
      ) as { id: string }
      expect(template).toEqual(expect.objectContaining({ id: 'tpl_sidescroller_background_layer' }))

      await tools['asset2d:projects.open']({ id: 'main' }, ctx('asset2d:projects.open', agentId))
      const result = await tools['asset2d:pipeline.instantiateTemplate'](
        { templateId: 'SideScrollerBackgroundLayer', position: { x: 10, y: 20 } },
        ctx('asset2d:pipeline.instantiateTemplate', agentId),
      ) as { status: string; groupId: string; opCount: number }
      expect(result.status).toBe('ok')
      expect(result.groupId).toMatch(/^group_/)
      expect(result.opCount).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  it('exposes composite batteries (groups) with a Run button per inner manual-trigger node', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-2d-scene-asset-generator': { backendPort: port } } }),
    )

    try {
      // Mutations require the project to be open by the calling agent.
      const agentId = 'test-agent'
      await tools['asset2d:projects.open']({ id: 'main' }, ctx('asset2d:projects.open', agentId))
      // Build a tiny composite battery: text_panel → image_gen, wrapped into a
      // group. The inner image_gen is the only manualTrigger node, so the group
      // must surface exactly one image Run button addressing its inner node id.
      await tools['asset2d:pipeline.applyBatch'](
        {
          projectId: 'main',
          ops: [
            { type: 'createNode', nodeId: 'prompt', opId: 'text_panel', position: { x: 0, y: 0 }, params: {} },
            { type: 'createNode', nodeId: 'gen', opId: 'image_gen', position: { x: 200, y: 0 }, params: {} },
            { type: 'connect', edgeId: 'e1', source: { nodeId: 'prompt', port: 'output' }, target: { nodeId: 'gen', port: 'prompt' } },
            { type: 'createGroup', groupId: 'g1', name: 'mygroup', memberNodeIds: ['prompt', 'gen'], position: { x: 0, y: 0 } },
          ],
          opts: { actor: 'test', label: 'create group' },
        },
        ctx('asset2d:pipeline.applyBatch', agentId),
      )

      const list = (await tools['asset2d:groups.list']({ projectId: 'main' }, ctx('asset2d:groups.list'))) as Array<{
        id: string
        runButtons: Array<{ nodeId: string; opId: string; kind: string }>
      }>
      expect(list.length).toBeGreaterThan(0)
      const g = list.find((x) => x.id === 'g1') ?? list[0]
      const imgRun = g.runButtons.find((r) => r.opId === 'image_gen')
      expect(imgRun).toBeTruthy()
      expect(imgRun!.kind).toBe('image')
      expect(typeof imgRun!.nodeId).toBe('string')
      expect(imgRun!.nodeId.length).toBeGreaterThan(0)

      const got = (await tools['asset2d:groups.get'](
        { projectId: 'main', id: g.id },
        ctx('asset2d:groups.get'),
      )) as {
        id: string
        runButtons: Array<{ opId: string }>
        exposedInputs: unknown
        exposedOutputs: unknown
      }
      expect(got.id).toBe(g.id)
      expect(Array.isArray(got.exposedInputs)).toBe(true)
      expect(Array.isArray(got.exposedOutputs)).toBe(true)
      expect(got.runButtons.some((r) => r.opId === 'image_gen')).toBe(true)
    } finally {
      await app.close()
    }
  })
})
