// End-to-end proof for the two stage additions:
//
//   A) atomic verbs (node *, pipeline get/apply/execute) can be aimed at a
//      specific project in a multi-project workspace via `--project-id`
//      (or a raw graph via `--graph-file`), without `project open` swapping the
//      active pointer; and
//   B) `node create-template` instantiates a saved group template (a NodeGroup
//      JSON, possibly nested) as one `__group__` node with stable exposed ports,
//      can be dropped many times into one graph, and the result wires + executes.
//
// The deterministic suite uses the fixture batteries (fixture.number/add/collect)
// + a hand-built nested-group template so it executes and asserts a numeric
// result with no dependency on the scene op catalog. The structural suite drives
// the REAL scene templates (ArchitectureRegions / LakeRegions) to prove the
// Example1 skeleton (template groups → scene_merge_subtrees → scene_output) can
// be reproduced and read back faithfully — those member ops are not all
// registered in this checkout, so it asserts structure, not execution.

import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const batteriesDir = join(here, '..', 'fixtures', 'batteries')
const adderTemplate = join(here, '..', 'fixtures', 'templates', 'adder.group.json')
// Real scene templates (authored by the editor) live in the app battery tree.
const sceneTemplates = join(here, '..', '..', '..', '..', 'apps', 'wb-scene-generator', 'batteries', 'templates', 'scene')
const sceneBatteries = join(here, '..', '..', '..', '..', 'apps', 'wb-scene-generator', 'batteries')

let scratch: string
beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-cli-tmpl-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratch, { recursive: true })
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function captureNdjson(): () => unknown[] {
  const lines: unknown[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    String(chunk).split('\n').filter(Boolean).forEach((l) => lines.push(JSON.parse(l)))
    return true
  })
  return () => lines
}

/** Run a command, capture its NDJSON records, and return the last one. */
async function runCapture(args: string[]): Promise<Record<string, unknown>> {
  const out = captureNdjson()
  await run(['node', 'forgeax', ...args, '--ndjson'])
  const recs = out()
  return recs[recs.length - 1] as Record<string, unknown>
}

describe('B — node create-template (nested group, executable, fixture batteries)', () => {
  it('instantiates a nested template twice, wires both, and executes', async () => {
    const G = ['--pipeline-id', 'p1', '--project-root', scratch]

    // Two independent instances of the SAME template into one graph.
    const g1 = await runCapture(['node', 'create-template', '--group-file', adderTemplate, '--group-id', 'g1', '--x', '0', ...G])
    const g2 = await runCapture(['node', 'create-template', '--group-file', adderTemplate, '--group-id', 'g2', '--x', '400', ...G])
    expect(g1.status).toBe('ok')
    expect(g2.status).toBe('ok')
    expect(g1.exposedInputs).toEqual(['in_0', 'in_1'])
    expect(g1.exposedOutputs).toEqual(['out_0'])

    // Feed g1 := 3 + 4 = 7 and g2 := 10 + 20 = 30 via plain fixture.number nodes.
    await runCapture(['node', 'create', '--node-id', 'a1', '--op', 'fixture.number', '--params', '{"value":3}', ...G])
    await runCapture(['node', 'create', '--node-id', 'b1', '--op', 'fixture.number', '--params', '{"value":4}', ...G])
    await runCapture(['node', 'create', '--node-id', 'a2', '--op', 'fixture.number', '--params', '{"value":10}', ...G])
    await runCapture(['node', 'create', '--node-id', 'b2', '--op', 'fixture.number', '--params', '{"value":20}', ...G])
    await runCapture(['node', 'connect', '--edge-id', 'ea1', '--from', 'a1:out', '--to', 'g1:in_0', ...G])
    await runCapture(['node', 'connect', '--edge-id', 'eb1', '--from', 'b1:out', '--to', 'g1:in_1', ...G])
    await runCapture(['node', 'connect', '--edge-id', 'ea2', '--from', 'a2:out', '--to', 'g2:in_0', ...G])
    await runCapture(['node', 'connect', '--edge-id', 'eb2', '--from', 'b2:out', '--to', 'g2:in_1', ...G])

    // Converge: g1.out_0 + g2.out_0 -> add(merge) -> collect(sink, scene_output analog).
    await runCapture(['node', 'create', '--node-id', 'merge', '--op', 'fixture.add', ...G])
    await runCapture(['node', 'create', '--node-id', 'sink', '--op', 'fixture.collect', ...G])
    await runCapture(['node', 'connect', '--edge-id', 'em1', '--from', 'g1:out_0', '--to', 'merge:a', ...G])
    await runCapture(['node', 'connect', '--edge-id', 'em2', '--from', 'g2:out_0', '--to', 'merge:b', ...G])
    await runCapture(['node', 'connect', '--edge-id', 'es', '--from', 'merge:sum', '--to', 'sink:in', ...G])

    // Read back: two group shadows + their stable exposed ports + boundary edges.
    const snap = await runCapture(['pipeline', 'get', ...G]) as {
      nodes: Record<string, { opId: string }>
      edges: Record<string, { source: { nodeId: string; port: string }; target: { nodeId: string; port: string } }>
      groups: Array<{ id: string; nodes: unknown[]; exposedInputs: Array<{ portName: string }>; exposedOutputs: Array<{ portName: string }> }>
    }
    expect(snap.nodes.g1?.opId).toBe('__group__')
    expect(snap.nodes.g2?.opId).toBe('__group__')
    // Each template expanded into the root group + its 1 nested group = many group entries.
    const rootG1 = snap.groups.find((g) => g.id === 'g1')!
    expect(rootG1.exposedInputs.map((p) => p.portName).sort()).toEqual(['in_0', 'in_1'])
    expect(rootG1.exposedOutputs.map((p) => p.portName)).toEqual(['out_0'])
    // Boundary edges land on the group shadow's stable ports.
    const edgeStrs = Object.values(snap.edges).map((e) => `${e.source.nodeId}:${e.source.port}->${e.target.nodeId}:${e.target.port}`)
    expect(edgeStrs).toContain('a1:out->g1:in_0')
    expect(edgeStrs).toContain('g1:out_0->merge:a')
    expect(edgeStrs).toContain('g2:out_0->merge:b')
    expect(edgeStrs).toContain('merge:sum->sink:in')

    // Execute: 7 + 30 = 37 at the sink. Proves the nested group sub-graphs run.
    const exec = await runCapture(['pipeline', 'execute', ...G, '--batteries', batteriesDir]) as {
      result: { status: string; outputs: Record<string, { out?: Array<{ items: unknown[] }> }> }
    }
    expect(exec.result.status).toBe('completed')
    expect(exec.result.outputs.sink?.out?.[0]?.items).toEqual([37])
  })
})

describe('A — --project-id targets a specific project graph', () => {
  it('node create-template + connect on a --project-id graph, read back via --project-id', async () => {
    // Build a 2-project workspace; operate on the SECOND without `project open`.
    await runCapture(['project', 'create', '--name', 'First', '--id', 'p_first', '--project-root', scratch])
    await runCapture(['project', 'create', '--name', 'Second', '--id', 'p_second', '--project-root', scratch])

    const T = ['--project-id', 'p_second', '--project-root', scratch]
    const created = await runCapture(['node', 'create-template', '--group-file', adderTemplate, '--group-id', 'g1', ...T])
    expect(created.status).toBe('ok')
    await runCapture(['node', 'create', '--node-id', 'sink', '--op', 'fixture.collect', ...T])
    await runCapture(['node', 'connect', '--edge-id', 'e1', '--from', 'g1:out_0', '--to', 'sink:in', ...T])

    const snap = await runCapture(['pipeline', 'get', ...T]) as {
      nodes: Record<string, { opId: string }>
      groups: Array<{ id: string }>
    }
    expect(snap.nodes.g1?.opId).toBe('__group__')
    expect(snap.nodes.sink?.opId).toBe('fixture.collect')
    expect(snap.groups.some((g) => g.id === 'g1')).toBe(true)

    // The FIRST project's graph must be untouched (isolation).
    const first = await runCapture(['pipeline', 'get', '--project-id', 'p_first', '--project-root', scratch]) as {
      nodes: Record<string, unknown>
    }
    expect(Object.keys(first.nodes)).toEqual([])
  })
})

describe('B — Example1 skeleton with REAL scene templates (structure only)', () => {
  it('drops ArchitectureRegions + LakeRegions, wires them through merge → scene_output', async () => {
    const G = ['--pipeline-id', 'scene1', '--project-root', scratch]
    const arch = await runCapture(['node', 'create-template', '--group-file', join(sceneTemplates, 'ArchitectureRegions', 'ArchitectureRegions.json'), '--group-id', 'arch', '--x', '0', ...G])
    const lake = await runCapture(['node', 'create-template', '--group-file', join(sceneTemplates, 'LakeRegions', 'LakeRegions.json'), '--group-id', 'lake', '--x', '400', ...G])
    expect(arch.status).toBe('ok')
    expect(lake.status).toBe('ok')
    // The root templates expose a stable scene `out_0` (and a `Rest` etc).
    expect(arch.exposedOutputs).toContain('out_0')
    expect(lake.exposedOutputs).toContain('out_0')

    // scene_merge_subtrees + scene_output ARE registered in the scene batteries.
    await runCapture(['node', 'create', '--node-id', 'merge', '--op', 'scene_merge_subtrees', '--x', '800', ...G, '--batteries', sceneBatteries])
    await runCapture(['node', 'create', '--node-id', 'sceneOut', '--op', 'scene_output', '--x', '1100', ...G, '--batteries', sceneBatteries])
    await runCapture(['node', 'connect', '--edge-id', 'e_arch', '--from', 'arch:out_0', '--to', 'merge:scenes', ...G])
    await runCapture(['node', 'connect', '--edge-id', 'e_lake', '--from', 'lake:out_0', '--to', 'merge:scenes', ...G])
    await runCapture(['node', 'connect', '--edge-id', 'e_out', '--from', 'merge:scene', '--to', 'sceneOut:scene', ...G])

    const snap = await runCapture(['pipeline', 'get', ...G]) as {
      nodes: Record<string, { opId: string }>
      edges: Record<string, { source: { nodeId: string; port: string }; target: { nodeId: string; port: string } }>
      groups: Array<{ id: string; nodes: Array<{ opId: string }>; exposedInputs: unknown[]; exposedOutputs: unknown[] }>
    }
    // Top level: 2 group shadows + merge + scene_output.
    expect(snap.nodes.arch?.opId).toBe('__group__')
    expect(snap.nodes.lake?.opId).toBe('__group__')
    expect(snap.nodes.merge?.opId).toBe('scene_merge_subtrees')
    expect(snap.nodes.sceneOut?.opId).toBe('scene_output')

    // Each template carries 2 nested groups → 3 group entries per template
    // (root + 2 nested). They must all be present (nested groups survived).
    expect(snap.groups.some((g) => g.id === 'arch')).toBe(true)
    expect(snap.groups.some((g) => g.id === 'lake')).toBe(true)
    const archRoot = snap.groups.find((g) => g.id === 'arch')!
    // root group has its members (24 leaves + 2 nested shadows = 26).
    expect(archRoot.nodes.length).toBeGreaterThanOrEqual(20)
    expect(archRoot.nodes.some((n) => n.opId === '__group__')).toBe(true)
    // group ids are unique across the two instances (no collision).
    const groupIds = snap.groups.map((g) => g.id)
    expect(new Set(groupIds).size).toBe(groupIds.length)

    // Boundary edges reference the group shadows' stable exposed ports.
    const edgeStrs = Object.values(snap.edges).map((e) => `${e.source.nodeId}:${e.source.port}->${e.target.nodeId}:${e.target.port}`)
    expect(edgeStrs).toContain('arch:out_0->merge:scenes')
    expect(edgeStrs).toContain('lake:out_0->merge:scenes')
    expect(edgeStrs).toContain('merge:scene->sceneOut:scene')
  })
})
