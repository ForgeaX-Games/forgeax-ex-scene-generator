// Battery loader — integration test against a real filesystem tree under tmp.
//
// Spins up a minimal `materials/batteries/test/echo` directory with
// scene.contract.ts + index.ts, points the loader at it, scans, then verifies the
// op was registered and runs.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  OpRegistry,
  createBatteryLoader,
  executeNode,
  type ExecutionContext,
  type GraphNode,
  type OpInput,
  type OpOutput,
  type OpSpec,
} from '../layer1/index.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-loader-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

function makeCtx(): ExecutionContext {
  return {
    pipelineId: 'loader-test',
    log: () => undefined,
    signal: new AbortController().signal,
  }
}

function parseSpec(_dir: string, source: string): Omit<OpSpec, 'execute'> {
  const raw = source.replace(/^\s*export default defineAtomic\(/, '').replace(/\)\s*$/, '')
  const def = JSON.parse(raw) as {
    opId?: string
    functionName?: string
    label?: string
    inputs?: Array<{ name: string; type: string; access?: OpInput['access']; defaultValue?: unknown }>
    outputs?: Array<{ name: string; type: string; access?: OpOutput['access'] }>
  }
  if (!def.opId) throw new Error('missing opId')
  return {
    id: def.opId,
    name: def.label ?? def.functionName ?? def.opId,
    description: '',
    inputs: (def.inputs ?? []).map((port) => ({
      name: port.name,
      type: port.type,
      required: true,
      default: port.defaultValue as OpInput['default'],
      access: port.access,
      description: '',
    })),
    outputs: (def.outputs ?? []).map((port) => ({
      name: port.name,
      type: port.type,
      access: port.access,
      description: '',
    })),
    params: [],
    lacing: 'longest',
  }
}

function writeContract(
  dir: string,
  def: {
    opId: string
    functionName: string
    inputs?: Array<{ name: string; type: string; access?: string }>
    outputs?: Array<{ name: string; type: string; access?: string }>
  },
): void {
  writeFileSync(join(dir, 'scene.contract.ts'), `export default defineAtomic(${JSON.stringify(def, null, 2)})\n`)
}

function loaderConfig(scanDirs: string[]) {
  return { pluginId: 'plugin', scanDirs, parseSpec }
}

describe('battery loader', () => {
  it('discovers a battery folder and registers an op', async () => {
    const opDir = join(scratchDir, 'data', 'echo')
    mkdirSync(opDir, { recursive: true })
    writeContract(opDir, {
      opId: 'plugin.echo',
      functionName: 'echo',
      inputs: [{ name: 'value', type: 'string', access: 'item' }],
      outputs: [{ name: 'echo', type: 'string', access: 'item' }],
    })
    writeFileSync(
      join(opDir, 'index.ts'),
      `export function echo(input) { return { echo: input.value }; }\n`,
    )

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, loaderConfig([join(scratchDir, 'data')]))

    const result = await loader.scan()
    expect(result.errors).toEqual([])
    expect(result.added).toBe(1)
    expect(loader.list()).toContain('plugin.echo')
    expect(registry.has('plugin.echo')).toBe(true)

    const node: GraphNode = {
      id: 'n1',
      opId: 'plugin.echo',
      position: { x: 0, y: 0 },
      params: { value: 'hello' },
    }
    const exec = await executeNode(registry, node, {}, makeCtx())
    expect(exec.error).toBeUndefined()
    const out = exec.outputs.echo as Array<{ items: unknown[] }>
    expect(out[0]?.items).toEqual(['hello'])
  })

  it('reports per-folder errors but continues scanning other folders', async () => {
    const badDir = join(scratchDir, 'data', 'bad')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'scene.contract.ts'), '{ this is not a contract')

    const goodDir = join(scratchDir, 'data', 'good')
    mkdirSync(goodDir, { recursive: true })
    writeContract(goodDir, {
      opId: 'plugin.good',
      functionName: 'good',
      inputs: [],
      outputs: [{ name: 'tag', type: 'string', access: 'item' }],
    })
    writeFileSync(join(goodDir, 'index.ts'), `export function good() { return { tag: 'ok' }; }\n`)

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, loaderConfig([join(scratchDir, 'data')]))

    const result = await loader.scan()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].dir).toBe(badDir)
    expect(result.added).toBe(1)
    expect(registry.has('plugin.good')).toBe(true)
  })

  it('does not discover a folder that has no scene.contract.ts', async () => {
    const missing = join(scratchDir, 'data', 'missing')
    mkdirSync(missing, { recursive: true })
    writeFileSync(join(missing, 'index.ts'), `export function missing() { return { tag: 'no' }; }\n`)

    const goodDir = join(scratchDir, 'data', 'good')
    mkdirSync(goodDir, { recursive: true })
    writeContract(goodDir, {
      opId: 'plugin.good',
      functionName: 'good',
      inputs: [],
      outputs: [{ name: 'tag', type: 'string', access: 'item' }],
    })
    writeFileSync(join(goodDir, 'index.ts'), `export function good() { return { tag: 'ok' }; }\n`)

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, loaderConfig([join(scratchDir, 'data')]))
    const result = await loader.scan()
    expect(result.errors).toEqual([])
    expect(result.added).toBe(1)
    expect(registry.has('plugin.good')).toBe(true)
    expect(registry.has('plugin.missing')).toBe(false)
  })

  it('deduplicates a clashing op id deterministically: first sorted dir wins, later is skipped + reported', async () => {
    for (const [name, value] of [['zzz', 'from-zzz'], ['aaa', 'from-aaa']] as const) {
      const d = join(scratchDir, 'data', name)
      mkdirSync(d, { recursive: true })
      writeContract(d, {
        opId: 'plugin.dup',
        functionName: 'dup',
        inputs: [],
        outputs: [{ name: 'tag', type: 'string', access: 'item' }],
      })
      writeFileSync(join(d, 'index.ts'), `export function dup() { return { tag: '${value}' }; }\n`)
    }

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, loaderConfig([join(scratchDir, 'data')]))

    const result = await loader.scan()
    expect(result.added).toBe(1)
    expect(loader.list().filter((id) => id === 'plugin.dup')).toEqual(['plugin.dup'])
    const dupError = result.errors.find((e) => e.reason.includes('duplicate op id'))
    expect(dupError).toBeDefined()
    expect(dupError!.dir).toBe(join(scratchDir, 'data', 'zzz'))
    expect(dupError!.reason).toContain(join(scratchDir, 'data', 'aaa'))

    const node: GraphNode = { id: 'n', opId: 'plugin.dup', position: { x: 0, y: 0 }, params: {} }
    const exec = await executeNode(registry, node, {}, makeCtx())
    const out = exec.outputs.tag as Array<{ items: unknown[] }>
    expect(out[0]?.items).toEqual(['from-aaa'])
  })

  it('does NOT flag distinct ids that merely share a directory basename', async () => {
    for (const [parent, id] of [['legacy', 'building_carve'], ['alg', 'alg_building_carve']] as const) {
      const d = join(scratchDir, 'data', parent, 'building_carve')
      mkdirSync(d, { recursive: true })
      writeContract(d, {
        opId: id,
        functionName: 'run',
        inputs: [],
        outputs: [{ name: 'out', type: 'grid', access: 'item' }],
      })
      writeFileSync(join(d, 'index.ts'), `export function run() { return { out: '${id}' }; }\n`)
    }
    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, loaderConfig([join(scratchDir, 'data')]))
    const result = await loader.scan()
    expect(result.errors).toEqual([])
    expect(result.added).toBe(2)
    expect(registry.has('building_carve')).toBe(true)
    expect(registry.has('alg_building_carve')).toBe(true)
  })

  it('emits op-added events to subscribers', async () => {
    const opDir = join(scratchDir, 'plain')
    mkdirSync(opDir, { recursive: true })
    writeContract(opDir, {
      opId: 'plugin.plain',
      functionName: 'plain',
      inputs: [],
      outputs: [{ name: 'value', type: 'number', access: 'item' }],
    })
    writeFileSync(join(opDir, 'index.ts'), `export function plain() { return { value: 42 }; }\n`)

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, loaderConfig([scratchDir]))
    const events: string[] = []
    loader.subscribe((e) => events.push(`${e.kind}:${'opId' in e ? e.opId : ''}`))

    await loader.scan()
    expect(events).toContain('op-added:plugin.plain')
  })

  it('reloads index.ts execute changes without contract mtime change', async () => {
    const opDir = join(scratchDir, 'data', 'hot')
    mkdirSync(opDir, { recursive: true })
    writeContract(opDir, {
      opId: 'plugin.hot',
      functionName: 'hot',
      inputs: [],
      outputs: [{ name: 'tag', type: 'string', access: 'item' }],
    })
    writeFileSync(join(opDir, 'index.ts'), `export function hot() { return { tag: 'v1' }; }\n`)

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, loaderConfig([join(scratchDir, 'data')]))
    await loader.scan()

    const run = async () => {
      const node: GraphNode = { id: 'n', opId: 'plugin.hot', position: { x: 0, y: 0 }, params: {} }
      const exec = await executeNode(registry, node, {}, makeCtx())
      const out = exec.outputs.tag as Array<{ items: unknown[] }>
      return out[0]?.items?.[0]
    }
    expect(await run()).toBe('v1')

    writeFileSync(join(opDir, 'index.ts'), `export function hot() { return { tag: 'v2' }; }\n`)
    const past = Date.now() - 2000
    const { utimesSync } = await import('node:fs')
    utimesSync(join(opDir, 'index.ts'), past / 1000, Date.now() / 1000)

    const rescan = await loader.reload()
    expect(rescan.updated).toBeGreaterThanOrEqual(1)
    expect(await run()).toBe('v2')
  })

  it('emits op-updated when only icon.svg changes', async () => {
    const opDir = join(scratchDir, 'data', 'icon')
    mkdirSync(opDir, { recursive: true })
    writeContract(opDir, {
      opId: 'plugin.icon',
      functionName: 'icon',
      inputs: [],
      outputs: [{ name: 'ok', type: 'bool', access: 'item' }],
    })
    writeFileSync(join(opDir, 'index.ts'), `export function icon() { return { ok: true }; }\n`)
    writeFileSync(join(opDir, 'icon.svg'), '<svg viewBox="0 0 24 24"></svg>\n')

    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, loaderConfig([join(scratchDir, 'data')]))
    const events: string[] = []
    loader.subscribe((e) => events.push(e.kind))
    await loader.scan()
    events.length = 0

    writeFileSync(join(opDir, 'icon.svg'), '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>\n')
    const rescan = await loader.reload()
    expect(rescan.updated).toBeGreaterThanOrEqual(1)
    expect(events).toContain('op-updated')
  })
})
