import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { stableEntityId } from '@forgeax/scene-authoring'

import { applySceneSourceEdits, orderReferencedBindings } from './writeback.js'
import { runSceneModule } from './runner.js'

const impls = {
  basePlane: (args: Record<string, unknown>) => ({
    geometry: { kind: 'plane', width: args.width ?? 10, height: args.height ?? 4 },
  }),
  heightfieldExplode: (args: Record<string, unknown>) => ({
    geometry: args.heightfield,
    columns: 2,
    rows: 2,
  }),
  sceneOutput: (args: Record<string, unknown>) => ({ scene: args.scene }),
}

async function writeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'scene-run-'))
  for (const [file, source] of Object.entries(files)) {
    await writeFile(join(dir, file), source, 'utf8')
  }
  return dir
}

describe('runSceneModule', () => {
  it('runs ordinary TypeScript with if / helper and records host calls', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { basePlane, heightfieldExplode } from '@forgeax/scene'

function pickWidth(wide: boolean): number {
  if (wide) return 24
  return 8
}

// @scene-id world
const world = basePlane({ width: pickWidth(true), height: 6 })
const parts = world.kind === 'plane'
  ? heightfieldExplode({ heightfield: world })
  : world
export const out = parts
`,
    })
    const result = await runSceneModule({
      projectDir,
      entryFile: 'main.scene.ts',
      implementations: impls,
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.trace.map((item) => item.functionName)).toEqual(['basePlane', 'heightfieldExplode'])
    expect(result.diagnostics.some((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toBe(true)
    expect(result.trace[0]?.id).toBe('world')
    expect(result.trace[0]?.args.width).toBe(24)
    expect(result.graph.nodes.world?.opId).toBe('base_plane')
    expect(result.graph.nodes.world?.valueShape).toBe('item')
    expect(result.graph.nodes.world?.moduleFile).toBe('main.scene.ts')
    expect(Object.keys(result.graph.edges).length).toBeGreaterThan(0)
  })

  it('imports geometryMask from the scene-host shim as a Grid', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { geometryMask } from '@forgeax/scene'
export const lotMask = geometryMask({ columns: 4, rows: 3 })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: {
        geometryMask: () => ({ grid: [[1, 0], [0, 1]] }),
      },
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.trace.map((item) => item.functionName)).toEqual(['geometryMask'])
    expect(result.trace[0]?.result).toEqual([[1, 0], [0, 1]])
  })

  it('imports gridStats from the scene-host shim as a multi-output record', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { gridStats } from '@forgeax/scene'
export const stats = gridStats({ grid: [[1, 2]] })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: {
        gridStats: () => ({ min: 1, max: 2, mean: 1.5, sum: 3, count: 2, coverage: 1 }),
      },
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.trace.map((item) => item.functionName)).toEqual(['gridStats'])
    expect(result.trace[0]?.result).toEqual({ min: 1, max: 2, mean: 1.5, sum: 3, count: 2, coverage: 1 })
  })

  it('imports heightfieldSetMask from the scene-host shim as a Heightfield', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { heightfieldSetMask } from '@forgeax/scene'
export const marked = heightfieldSetMask({ heightfield: { type: 'heightfield' } })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: {
        heightfieldSetMask: () => ({ heightfield: { type: 'heightfield', mask: [[1, 0]] } }),
      },
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.trace.map((item) => item.functionName)).toEqual(['heightfieldSetMask'])
    expect(result.trace[0]?.result).toEqual({ type: 'heightfield', mask: [[1, 0]] })
  })

  it('imports heightfieldMesh from the scene-host shim as Geometry', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { heightfieldMesh } from '@forgeax/scene'
export const woven = heightfieldMesh({ heightfield: { type: 'heightfield' } })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: {
        heightfieldMesh: () => ({ geometry: { kind: 'mesh', positions: [0, 0, 1], indices: [0, 1, 2] } }),
      },
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.trace.map((item) => item.functionName)).toEqual(['heightfieldMesh'])
    expect(result.trace[0]?.result).toEqual({ kind: 'mesh', positions: [0, 0, 1], indices: [0, 1, 2] })
  })

  it('reuses a previous result when id and args match', async () => {
    let hits = 0
    const projectDir = await writeProject({
      'main.scene.ts': `
import { basePlane } from '@forgeax/scene'
export const a = basePlane({ __sceneId: 'world', width: 10, height: 4 })
export const b = basePlane({ __sceneId: 'world', width: 10, height: 4 })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: {
        basePlane: (args: Record<string, unknown>) => {
          hits += 1
          return { geometry: { kind: 'plane', width: args.width } }
        },
      },
    })
    expect(result.ok).toBe(true)
    expect(hits).toBe(1)
    expect(result.trace[1]?.reused).toBe(true)
  })

  it('warns when a nested scene module is not imported from the entry tree', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { basePlane } from '@forgeax/scene'
export const world = basePlane({ width: 10, height: 4 })
`,
      'house.scene.ts': `
import { basePlane } from '@forgeax/scene'
export const house = basePlane({ width: 4, height: 4 })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: impls,
    })
    expect(result.diagnostics.some((item) => item.code === 'SCENE_ORPHAN_MODULE')).toBe(true)
  })

  it('warns when heightfield runs before operating geometry is selected', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { createGrid, heightfield } from '@forgeax/scene'
const grid = createGrid({ columns: 4, rows: 4, fill: 1 })
export const field = heightfield({ grid })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: {
        ...impls,
        createGrid: () => ({ grid: [[1, 1], [1, 1]] }),
        heightfield: () => ({ type: 'heightfield', height: [[1, 1]] }),
      },
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'SCENE_OPERATING_GEOMETRY')).toBe(true)
  })

  it('projects nested scene modules onto their own graph row', async () => {
    const projectDir = await writeProject({
      'house.scene.ts': `
import { basePlane } from '@forgeax/scene'
// @scene-id site
export const site = basePlane({ width: 4, height: 4 })
`,
      'main.scene.ts': `
import { heightfieldExplode } from '@forgeax/scene'
import { site } from './house.scene.ts'
// @scene-id parts
export const parts = heightfieldExplode({ heightfield: site })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: impls,
    })
    expect(result.ok).toBe(true)
    expect(result.graph.nodes.site?.moduleFile).toBe('house.scene.ts')
    expect(result.graph.nodes.parts?.moduleFile).toBe('main.scene.ts')
    expect(result.graph.nodes.parts?.position.y).not.toBe(result.graph.nodes.site?.position.y)
    expect(result.diagnostics.some((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toBe(true)
    expect(result.diagnostics.filter((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toHaveLength(1)
  })

  it('warns SCENE_OUTPUT_INCOMPLETE after a successful run with no entry sceneOutput', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { basePlane } from '@forgeax/scene'
export const world = basePlane({ width: 10, height: 4 })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: impls,
    })
    expect(result.ok).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toBe(true)
    expect(result.diagnostics.find((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')?.severity).toBe('warning')
  })

  it('does not warn when the entry assembles a SceneTree and calls sceneOutput', async () => {
    const hung = {
      graph: {
        n: {
          id: 'n',
          name: 'terrain',
          parent: null,
          children: {},
          schema: 'mesh',
          content: { schema: 'mesh', mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] } },
        },
      },
      focus: 'n',
    }
    const projectDir = await writeProject({
      'main.scene.ts': `
import { addChild, emptyScene, sceneNode, sceneOutput } from '@forgeax/scene'
const node = sceneNode({ name: 'terrain', geometry: { kind: 'mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] } })
const root = addChild({ scene: emptyScene(), nodes: [node.scene] })
sceneOutput({ scene: root.scene })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: {
        ...impls,
        emptyScene: () => ({ scene: { graph: { root: { id: 'root', name: '', parent: null, children: {} } }, focus: 'root' } }),
        sceneNode: () => ({ scene: hung, schema: 'mesh' }),
        addChild: (args: Record<string, unknown>) => {
          const nodes = args.nodes
          const first = Array.isArray(nodes) ? nodes[0] : nodes
          return { scene: first ?? args.scene }
        },
      },
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toBe(false)
    expect(result.trace.map((item) => item.functionName)).toEqual(['sceneNode', 'emptyScene', 'addChild', 'sceneOutput'])
    expect(result.trace.find((item) => item.functionName === 'addChild')?.argRefs).toEqual(
      expect.arrayContaining([{ from: expect.any(String), port: 'scene', arg: 'nodes' }]),
    )
    expect(Object.values(result.graph.edges).some((edge) => edge.target.port === 'nodes')).toBe(true)
  })

  it('warns SCENE_OUTPUT_INCOMPLETE when sceneOutput receives an empty SceneTree', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { emptyScene, sceneOutput } from '@forgeax/scene'
sceneOutput({ scene: emptyScene() })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: {
        ...impls,
        emptyScene: () => ({ scene: { graph: { root: { id: 'root', name: '', parent: null, children: {} } }, focus: 'root' } }),
      },
    })
    expect(result.ok).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toBe(true)
  })

  it('warns SCENE_HEIGHTFIELD_NOT_IN_SCENE when a Heightfield packet is never hung', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { basePlane, emptyScene, heightfield, sceneOutput } from '@forgeax/scene'
const world = basePlane({ width: 10, height: 8 })
heightfield({ geometry: world, height: [[0, 1], [1, 2]] })
sceneOutput({ scene: emptyScene() })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: {
        ...impls,
        heightfield: () => ({
          heightfield: {
            type: 'heightfield',
            geometry: { kind: 'plane', width: 10, height: 8 },
            columns: 2,
            rows: 2,
            height: [[0, 1], [1, 2]],
            mask: [[1, 1], [1, 1]],
            attributes: {},
          },
        }),
        emptyScene: () => ({ scene: { graph: { root: { id: 'root', name: '', parent: null, children: {} } }, focus: 'root' } }),
      },
    })
    expect(result.ok).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'SCENE_OUTPUT_INCOMPLETE')).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'SCENE_HEIGHTFIELD_NOT_IN_SCENE')).toBe(true)
  })

  it('wires a named number const onto every referencing input', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { basePlane } from '@forgeax/scene'
const worldWidth = 120
export const world = basePlane({ width: worldWidth, height: 80 })
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: impls,
    })
    expect(result.ok).toBe(true)
    const widthNode = Object.values(result.graph.nodes).find((node) => node.opId === 'number_const' && node.params.value === 120)
    expect(widthNode).toBeDefined()
    expect(Object.values(result.graph.edges).some((edge) => (
      edge.source.nodeId === widthNode?.id
      && edge.source.port === 'value'
      && edge.target.port === 'width'
    ))).toBe(true)
    const plane = Object.values(result.graph.nodes).find((node) => node.functionName === 'basePlane')
    expect(plane?.params.width).toBeUndefined()
  })

  it('projects an unused named number when the source has no host calls', async () => {
    const projectDir = await writeProject({
      'main.scene.ts': `
import { createGrid } from '@forgeax/scene'

// @scene-id n
const n = 16
`,
    })
    const result = await runSceneModule({
      projectDir,
      implementations: {
        createGrid: () => ({ columns: 16, rows: 16 }),
      },
    })
    expect(result.ok).toBe(true)
    expect(result.trace).toHaveLength(0)
    expect(result.graph.nodes.n?.opId).toBe('number_const')
    expect(result.graph.nodes.n?.params.value).toBe(16)
  })
})

describe('applySceneSourceEdits', () => {
  it('updates a numeric literal in place without reprinting the module', async () => {
    const source = `import { basePlane } from '@forgeax/scene'

function helper() { return 1 }

// @scene-id world
const world = basePlane({ width: 10, height: 4 })
`
    const result = applySceneSourceEdits(source, [
      { type: 'updateLiteral', id: 'world', path: ['width'], value: 32 },
    ])
    expect(result.applied).toBe(1)
    expect(result.source).toContain('function helper() { return 1 }')
    expect(result.source).toContain('width: 32')
    expect(result.source).not.toContain('width: 10')
  })

  it('rewrites a dict-list argument from a JSON panel commit', () => {
    const source = `import { network2d } from '@forgeax/scene'

// @scene-id paths
const paths = network2d({
  nodes: [[0, 0], [8, 0]],
  edges: [{ from: 0, to: 1 }],
})
`
    const result = applySceneSourceEdits(source, [
      {
        type: 'updateLiteral',
        id: 'paths',
        path: ['edges'],
        value: [{ from: 0, to: 1 }, { from: 1, to: 0 }],
      },
    ])
    expect(result.applied).toBe(1)
    expect(result.source).toContain('{ from: 1, to: 0 }')
    expect(result.source).toContain('from: 0, to: 1')
  })

  it('moves the producer above the consumer so a canvas wire does not TDZ', () => {
    const source = `import { basePlane, heightfield } from '@forgeax/scene'

// @scene-id field
const field = heightfield({})

// @scene-id world
const world = basePlane({ width: 10, height: 4 })
`
    const result = applySceneSourceEdits(source, [{
      type: 'connectBinding',
      id: 'field',
      arg: 'geometry',
      binding: 'world',
      output: 'geometry',
    }])
    expect(result.applied).toBe(1)
    expect(result.source.indexOf('const world = basePlane')).toBeLessThan(result.source.indexOf('const field = heightfield'))
    expect(result.source).toContain('geometry: world')
    expect(result.source).not.toContain('world.geometry')
    expect(result.source).toMatch(/@scene-id world[\s\S]*@scene-id field/)
  })

  it('appends each site onto a list points port instead of replacing the array', () => {
    const source = `import { point2d, polyline2d } from '@forgeax/scene'

// @scene-id origin
const origin = point2d({ x: 0, y: 0 })

// @scene-id plaza
const plaza = point2d({ x: 40, y: 30 })

// @scene-id road
const road = polyline2d({ points: [origin] })
`
    const first = applySceneSourceEdits(source, [{
      type: 'connectBinding',
      id: 'road',
      arg: 'points',
      binding: 'plaza',
      output: 'geometry',
      list: true,
    }])
    expect(first.source).toContain('points: [origin, plaza]')
    const second = applySceneSourceEdits(first.source, [{
      type: 'disconnectArg',
      id: 'road',
      arg: 'points',
      binding: 'origin',
      output: 'geometry',
      unset: true,
    }])
    expect(second.source).toContain('points: [plaza]')
    expect(second.source).not.toMatch(/points:\s*\[[^\]]*origin/)
  })

  it('keeps a later Heightfield below BasePlane when the order is already safe', () => {
    const source = `import { basePlane, heightfield } from '@forgeax/scene'

// @scene-id world
const world = basePlane({ width: 10, height: 4 })

// @scene-id field
const field = heightfield({})
`
    const result = applySceneSourceEdits(source, [{
      type: 'connectBinding',
      id: 'field',
      arg: 'geometry',
      binding: 'world',
      output: 'geometry',
    }])
    expect(result.source.indexOf('const world = basePlane')).toBeLessThan(result.source.indexOf('const field = heightfield'))
    expect(result.source).toContain('geometry: world')
    expect(result.source).not.toContain('world.geometry')
  })

  it('wires a number literal as the binding, not n.value', () => {
    const source = `import { createGrid } from '@forgeax/scene'

// @scene-id n
const n = 8

// @scene-id grid
const grid = createGrid({})
`
    const result = applySceneSourceEdits(source, [{
      type: 'connectBinding',
      id: 'grid',
      arg: 'columns',
      binding: 'n',
      output: 'value',
    }])
    expect(result.applied).toBe(1)
    expect(result.source).toContain('createGrid({ columns: n })')
    expect(result.source).not.toContain('n.value')
  })

  it('rewrites leftover n.value on a number literal so createGrid sees the number', () => {
    const source = `import { createGrid } from '@forgeax/scene'

// @scene-id n
const n = 8

// @scene-id grid
const grid = createGrid({ columns: n.value, rows: n.value })
`
    const next = orderReferencedBindings(source, 'main.scene.ts')
    expect(next).toContain('createGrid({ columns: n, rows: n })')
    expect(next).not.toContain('n.value')
  })

  it('inlines a deleted JSON record into consumers', () => {
    const source = `import { network2d } from '@forgeax/scene'

// @scene-id edges
const edges = [{ from: 0, to: 1 }]

// @scene-id paths
const paths = network2d({ nodes: [[0, 0], [8, 0]], edges })
`
    const result = applySceneSourceEdits(source, [{ type: 'removeCall', id: 'edges' }])
    expect(result.diagnostics).toEqual([])
    expect(result.source).not.toContain('const edges =')
    expect(result.source).toContain('edges: [{ from: 0, to: 1 }]')
  })

  it('inlines a deleted number literal into consumers', () => {
    const source = `import { createGrid } from '@forgeax/scene'

// @scene-id n
const n = 12

// @scene-id grid
const grid = createGrid({ columns: n, rows: 8 })
`
    const result = applySceneSourceEdits(source, [{ type: 'removeCall', id: 'n' }])
    expect(result.diagnostics).toEqual([])
    expect(result.source).not.toContain('const n =')
    expect(result.source).toContain('createGrid({ columns: 12, rows: 8 })')
    expect(result.source).not.toMatch(/columns:\s*n\b/)
  })

  it('inlines a deleted number even when the consumer still reads n.value', () => {
    const source = `import { createGrid } from '@forgeax/scene'

// @scene-id n
const n = 12

// @scene-id grid
const grid = createGrid({ columns: n.value, rows: 8 })
`
    const result = applySceneSourceEdits(source, [{ type: 'removeCall', id: 'n' }])
    expect(result.diagnostics).toEqual([])
    expect(result.source).toContain('createGrid({ columns: 12, rows: 8 })')
    expect(result.source).not.toContain('n.value')
  })

  it('wires a Grid into heightfield.height even when the batch also disconnects that port', () => {
    const source = `import { heightfield, gridMul, basePlane } from '@forgeax/scene'

// @scene-id world
const world = basePlane({})

// @scene-id product
const product = gridMul({ a: [[1, 2], [3, 4]], value: 3 })

// @scene-id field
const field = heightfield({ geometry: world.geometry })
`
    const result = applySceneSourceEdits(source, [
      {
        type: 'connectBinding',
        id: 'field',
        arg: 'height',
        binding: 'product',
        output: 'grid',
      },
      { type: 'disconnectArg', id: 'field', arg: 'height' },
    ])
    expect(result.diagnostics).toEqual([])
    expect(result.source).toContain('height: product')
    expect(result.source).not.toContain('product.grid')
    expect(result.source).not.toMatch(/height:\s*0/)
    expect(result.source).not.toMatch(/const n\s*=\s*0/)
  })

  it('unsets a disconnected Grid port instead of writing 0', () => {
    const source = `import { heightfield, gridMul, basePlane } from '@forgeax/scene'

// @scene-id world
const world = basePlane({})

// @scene-id product
const product = gridMul({ a: [[1, 2], [3, 4]], value: 3 })

// @scene-id field
const field = heightfield({ geometry: world.geometry, height: product.grid })
`
    const result = applySceneSourceEdits(source, [{ type: 'disconnectArg', id: 'field', arg: 'height' }])
    expect(result.diagnostics).toEqual([])
    expect(result.source).toContain('heightfield({ geometry: world.geometry })')
    expect(result.source).not.toMatch(/height:\s*0/)
    expect(result.source).not.toContain('product.grid')
  })

  it('unsets a deleted call binding on consumers', () => {
    const source = `import { basePlane, heightfield } from '@forgeax/scene'

// @scene-id world
const world = basePlane({ width: 10, height: 4 })

// @scene-id field
const field = heightfield({ geometry: world.geometry })
`
    const result = applySceneSourceEdits(source, [{ type: 'removeCall', id: 'world' }])
    expect(result.diagnostics).toEqual([])
    expect(result.source).not.toContain('const world =')
    expect(result.source).toContain('heightfield({  })')
    expect(result.source).not.toContain('world.geometry')
  })

  it('unsets a parent argument when an inline helper node is deleted', () => {
    const source = `import { gridGradient } from '@forgeax/scene'

// @scene-id ramp
const ramp = gridGradient({ columns: 16, kind: 'radial' })
`
    const helperId = stableEntityId('stmt', 'ramp:kind:literal')
    const result = applySceneSourceEdits(source, [{ type: 'removeCall', id: helperId }])
    expect(result.diagnostics).toEqual([])
    expect(result.source).toContain('const ramp = gridGradient')
    expect(result.source).not.toMatch(/kind:\s*'radial'/)
    expect(result.source).toContain('columns: 16')
  })

  it('treats delete of a missing @scene-id as already gone', () => {
    const source = `import { basePlane } from '@forgeax/scene'\nconst world = basePlane({})\n`
    const result = applySceneSourceEdits(source, [{ type: 'removeCall', id: 'node-not-in-source' }])
    expect(result.applied).toBe(1)
    expect(result.diagnostics).toEqual([])
    expect(result.source).toBe(source)
  })

  it('deletes a battery and its wired number in one batch without 422', () => {
    const source = `import { createGrid } from '@forgeax/scene'

// @scene-id n
const n = 16

// @scene-id grid
const grid = createGrid({ columns: n, rows: n })
`
    const result = applySceneSourceEdits(source, [
      { type: 'removeCall', id: 'grid' },
      { type: 'removeCall', id: 'n' },
    ])
    expect(result.diagnostics).toEqual([])
    expect(result.source).not.toContain('const n =')
    expect(result.source).not.toMatch(/const grid = createGrid/)
  })

  it('leaves an unused number when only the consumer battery is deleted', () => {
    const source = `import { createGrid } from '@forgeax/scene'

// @scene-id n
const n = 16

// @scene-id grid
const grid = createGrid({ columns: n, rows: n })
`
    const result = applySceneSourceEdits(source, [{ type: 'removeCall', id: 'grid' }])
    expect(result.diagnostics).toEqual([])
    expect(result.source).toContain('const n = 16')
    expect(result.source).not.toMatch(/const grid = createGrid/)
  })

  it('treats disconnect onto a statement already removed in the same batch as already gone', () => {
    const source = `import { createGrid } from '@forgeax/scene'

// @scene-id n
const n = 16

// @scene-id grid
const grid = createGrid({ columns: n })
`
    const result = applySceneSourceEdits(source, [
      { type: 'removeCall', id: 'grid' },
      { type: 'disconnectArg', id: 'grid', arg: 'columns', fallback: 16 },
    ])
    expect(result.diagnostics).toEqual([])
    expect(result.source).toContain('const n = 16')
    expect(result.source).not.toMatch(/const grid = createGrid/)
  })

  it('repairs leftover inverted const order without a new edit', () => {
    const source = `import { heightfield, createGrid, basePlane } from '@forgeax/scene'
const field = heightfield({ geometry: world.geometry })
const grid = createGrid({})
const world = basePlane({})
`
    const next = orderReferencedBindings(source, 'main.scene.ts')
    expect(next.indexOf('const world = basePlane')).toBeLessThan(next.indexOf('const field = heightfield'))
    expect(next).toContain('geometry: world')
    expect(next).not.toContain('world.geometry')
    expect(next).toContain('const grid = createGrid')
  })
})
