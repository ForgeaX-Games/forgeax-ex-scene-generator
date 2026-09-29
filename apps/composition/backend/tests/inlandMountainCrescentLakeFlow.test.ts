import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'
import { resetReadDedupeForTests } from '../src/scene-script/agent/readDedupe.js'
import { tools } from '../src/tool-handlers.js'

process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'scene-inland-flow-'))

const root = mkdtempSync(join(tmpdir(), 'scene-inland-ports-'))
const portsFile = join(root, 'plugin-dev-ports.json')

function ctx(toolId: string) {
  return {
    caller: {
      kind: 'ai' as const,
      agentId: 'sino',
      sessionId: 'sino-inland-session',
    },
    toolId,
    env: { FORGEAX_PLUGIN_DEV_PORTS_FILE: portsFile },
    cwd: process.cwd(),
  }
}

async function call(toolId: keyof typeof tools, args: Record<string, unknown>): Promise<unknown> {
  return await tools[toolId](args, ctx(toolId))
}

const FIELD_LIB = `
export interface Vec2 { x: number; z: number }

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 362437)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967295
}

export function valueNoise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const fx = x - x0
  const fz = z - z0
  const u = fx * fx * (3 - 2 * fx)
  const v = fz * fz * (3 - 2 * fz)
  const n00 = hash2(x0, z0, seed)
  const n10 = hash2(x0 + 1, z0, seed)
  const n01 = hash2(x0, z0 + 1, seed)
  const n11 = hash2(x0 + 1, z0 + 1, seed)
  const nx0 = n00 + (n10 - n00) * u
  const nx1 = n01 + (n11 - n01) * u
  return (nx0 + (nx1 - nx0) * v) * 2 - 1
}

export function fbm2(x: number, z: number, seed: number, octaves: number): number {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, z * freq, seed + i * 101)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return norm > 0 ? sum / norm : 0
}
`

const MOUNTAIN_GEN = `
import { defineGenerator } from '@forgeax/project-generator'
import { clamp, smoothstep, fbm2 } from './field.generator-lib.ts'

export const inlandMountainSkeleton = defineGenerator({
  id: 'inland-mountain-skeleton',
  version: '1.0.0',
  description: 'Inland mountain terrain with directional ridges',
  inputs: {
    cols: { type: 'number', defaultValue: 65 },
    rows: { type: 'number', defaultValue: 65 },
    cellSize: { type: 'number', defaultValue: 4 },
    seed: { type: 'number', defaultValue: 20260821 },
  },
  outputs: {
    heightGrid: 'grid',
  },
  run(ctx, args) {
    const cols = Number(args.cols ?? 65)
    const rows = Number(args.rows ?? 65)
    const cellSize = Number(args.cellSize ?? 4)
    const seed = Number(args.seed ?? 20260821)
    const grid: number[][] = []

    for (let r = 0; r < rows; r++) {
      const row: number[] = []
      const z = (r - (rows - 1) / 2) * cellSize
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * cellSize

        // Base undulating hills
        let elev = 45 + 18 * fbm2(x / 180, z / 180, seed, 3)

        // Main eastern spine (directional ridge)
        const spineDist = Math.abs(x - 60 - 20 * Math.sin(z / 80))
        const spineFactor = clamp(1 - spineDist / 70, 0, 1)
        elev += 50 * Math.pow(spineFactor, 2)

        row.push(elev)
      }
      grid.push(row)
    }
    return { heightGrid: grid }
  },
})
`

const LAKE_BASIN_GEN = `
import { defineGenerator } from '@forgeax/project-generator'
import { clamp, smoothstep, fbm2 } from './field.generator-lib.ts'

export const crescentLakeBasin = defineGenerator({
  id: 'crescent-lake-basin',
  version: '1.0.0',
  description: 'Carve NW crescent lake with center islet into terrain',
  inputs: {
    heightGrid: 'grid',
    cellSize: { type: 'number', defaultValue: 4 },
    waterLevel: { type: 'number', defaultValue: 25 },
  },
  outputs: {
    heightGrid: 'grid',
  },
  run(ctx, args) {
    const src = args.heightGrid as number[][]
    const rows = src.length
    const cols = rows > 0 ? src[0].length : 0
    const cell = Number(args.cellSize ?? 4)
    const waterLevel = Number(args.waterLevel ?? 25)

    const lakeX = -70
    const lakeZ = -70
    const outerR = 45
    const innerX = -55
    const innerZ = -55
    const innerR = 40
    const islandX = -75
    const islandZ = -75
    const islandR = 10

    const grid: number[][] = []
    for (let r = 0; r < rows; r++) {
      const row: number[] = []
      const z = (r - (rows - 1) / 2) * cell
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * cell
        let h = src[r][c]

        const dOuter = Math.hypot(x - lakeX, z - lakeZ)
        const dInner = Math.hypot(x - innerX, z - innerZ)

        // Crescent region: inside outer circle but outside inner circle
        const inOuter = dOuter < outerR
        const inInner = dInner < innerR

        if (inOuter && !inInner) {
          const depthFactor = smoothstep((outerR - dOuter) / 10) * smoothstep((dInner - innerR + 15) / 15)
          const targetBed = waterLevel - 8
          h = h * (1 - depthFactor) + targetBed * depthFactor
        }

        // Center islet
        const dIsland = Math.hypot(x - islandX, z - islandZ)
        if (dIsland < islandR) {
          const riseFactor = smoothstep((islandR - dIsland) / islandR)
          h = Math.max(h, waterLevel + 6 * riseFactor)
        }

        row.push(h)
      }
      grid.push(row)
    }
    return { heightGrid: grid }
  },
})
`

const MAIN_SCENE = `
import { addChild, basePlane, emptyScene, heightfield, sceneNode, sceneOutput } from '@forgeax/scene'
import { inlandMountainSkeleton } from './generators/mountainSkeleton.generator.ts'
import { crescentLakeBasin } from './generators/crescentLakeBasin.generator.ts'

export const world = basePlane({ width: 256, height: 256 })

export const skeleton = inlandMountainSkeleton({
  cols: 65,
  rows: 65,
  cellSize: 4,
  seed: 20260821,
})

export const terrain = crescentLakeBasin({
  heightGrid: skeleton.heightGrid,
  cellSize: 4,
  waterLevel: 25,
})

const field = heightfield({ geometry: world, height: terrain.heightGrid })
const ground = sceneNode({
  name: 'Inland_Mountains_With_NW_Lake',
  geometry: { kind: 'mesh', positions: [0, 0, 0, 4, 0, 0, 0, 4, 1], indices: [0, 1, 2] },
})
void field
sceneOutput({ scene: addChild({ scene: emptyScene(), nodes: [ground.scene] }).scene })
`

describe('Inland mountain and crescent lake flow test', () => {
  let app: any

  beforeAll(async () => {
    resetReadDedupeForTests()
    app = await buildApp({ logger: false })
    await app.ready()
    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const port = Number(address.split(':').pop())
    writeFileSync(portsFile, JSON.stringify({
      plugins: { '@forgeax/scene-generator-composition': { backendPort: port } },
    }))
  })

  afterAll(async () => {
    if (app) await app.close()
    rmSync(process.env.FORGEAX_PROJECT_ROOT!, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it('runs complete flow for inland mountain with crescent lake without errors and verifies meshLayers', async () => {
    const created = (await call('scene:projects.create', {
      name: 'Inland Mountain Test',
    })) as { id: string }
    const projectId = created.id
    expect(projectId).toBeDefined()

    const openRes = (await call('scene:projects.open', { id: projectId })) as {
      project: { id: string; name: string }
      projectRevision?: string
    }
    expect(openRes.project.id).toBe(projectId)

    const committed = (await call('scene:script.commitProject', {
      projectId,
      entryFile: 'main.scene.ts',
      expectedProjectRevision: openRes.projectRevision,
      files: [
        { file: 'generators/field.generator-lib.ts', source: FIELD_LIB },
        { file: 'generators/mountainSkeleton.generator.ts', source: MOUNTAIN_GEN },
        { file: 'generators/crescentLakeBasin.generator.ts', source: LAKE_BASIN_GEN },
        { file: 'main.scene.ts', source: MAIN_SCENE },
      ],
      label: 'Initial inland mountain with crescent lake commit',
    })) as { ok: boolean; executionStatus: string; diagnostics: unknown[] }

    expect(committed.ok).toBe(true)
    expect(committed.executionStatus).toBe('completed')
    expect((committed.diagnostics as Array<{ code?: string; severity?: string }>).every((item) => (
      item.severity !== 'error' && (item.code === undefined || item.code === 'SCENE_GRID_STRETCH')
    ))).toBe(true)

    // Execute pipeline to align execution evidence
    const executed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/execute/summary`,
      headers: {
        'x-forgeax-caller-kind': 'ai',
        'x-forgeax-caller-agent-id': 'sino',
        'x-forgeax-caller-session-id': 'sino-inland-session',
      },
      payload: { quietErrors: true },
    })
    expect(executed.statusCode, executed.body).toBe(200)

    // Report renderer status with 1 meshLayer
    await app.inject({
      method: 'POST',
      url: '/api/v1/renderer/status',
      payload: {
        viewingProjectId: projectId,
        openProjectId: projectId,
        projectRevision: (committed as any).projectRevision,
        executionStatus: 'completed',
        meshLayers: 1,
        voxelLayers: 1,
        frameDigest: 'inland-mountain-mesh',
      },
    })

    const verified = (await call('scene:script.verify', {
      projectId,
    })) as { ok: boolean; reasons: string[]; evidence?: { renderer?: { representation?: { meshLayers?: number } } } }

    expect(verified.ok, JSON.stringify(verified)).toBe(true)
    expect(verified.evidence?.renderer?.representation?.meshLayers).toBe(1)
  })
})
