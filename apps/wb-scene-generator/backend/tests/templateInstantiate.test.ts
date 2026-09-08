/**
 * Pure-logic tests for the template-group instantiation primitive
 * (backend/src/lib/legacy/templateOps.ts) — the shared remap + ordering + op-build
 * logic behind POST /api/v1/group-templates/:id/instantiate.
 *
 * These deliberately do NOT boot a Fastify server (the repo's Fastify-5 / Node-18
 * combo is flaky and the editor-host submodule may be absent). Instead they drive
 * the SAME runtime + applyBatch path the route uses, against a throwaway on-disk
 * runtime, so they exercise the real materialisation end-to-end with zero HTTP.
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyBatch, createRuntime, getPipeline, getGroup, listGroups } from '@forgeax/node-runtime'

import { buildTemplateOps, splitTemplate } from '../src/lib/legacy/templateOps.js'

const here = dirname(fileURLToPath(import.meta.url))
// backend/tests → backend → wb-scene-generator
const appRoot = resolve(here, '..', '..')
const LAKE_REGIONS = resolve(appRoot, 'batteries/groups/scene/LakeRegions/LakeRegions.generated.json')

const GROUP_OP_ID = '__group__'

function loadTemplate(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf-8'))
}

/** Materialise the LakeRegions template into a fresh runtime, returning the
 *  applyBatch result + the build metadata + the loaded pipeline snapshot. */
async function instantiateLakeRegions(opts: { groupId?: string } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'tmpl-inst-'))
  const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'wb-scene-test' })
  const split = splitTemplate(loadTemplate(LAKE_REGIONS))
  expect(split).not.toBeNull()
  const built = buildTemplateOps(split!.root, split!.deps, { x: 100, y: 50 }, opts.groupId)
  const result = await applyBatch(runtime, built.ops as never, { actor: 'ai:sino', label: 'test instantiate' })
  return { scratch, runtime, split: split!, built, result }
}

describe('buildTemplateOps / splitTemplate (LakeRegions)', () => {
  it('splits the template into a root + nested deps', () => {
    const split = splitTemplate(loadTemplate(LAKE_REGIONS))
    expect(split).not.toBeNull()
    expect(split!.root.id).toBeTruthy()
    // LakeRegions carries nested groups in _nestedGroups
    expect(split!.deps.length).toBeGreaterThan(0)
    // exposed ports use the stable in_N/out_N contract
    expect((split!.root.exposedInputs ?? []).every((p) => /^in_\d+$/.test(p.portName))).toBe(true)
    expect((split!.root.exposedOutputs ?? []).every((p) => /^out_\d+$/.test(p.portName))).toBe(true)
  })

  it('builds an ordered batch with createGroup ops for root + every nested dep', () => {
    const split = splitTemplate(loadTemplate(LAKE_REGIONS))!
    const built = buildTemplateOps(split.root, split.deps, { x: 0, y: 0 }, undefined)
    const createGroups = built.ops.filter((o) => (o as { type: string }).type === 'createGroup')
    // root + each nested group → one createGroup each
    expect(createGroups.length).toBe(1 + split.deps.length)
    // a child createGroup must appear before the root createGroup that references it
    const rootIdx = built.ops.findIndex(
      (o) => (o as { type: string; groupId?: string }).type === 'createGroup' &&
        (o as { groupId?: string }).groupId === built.rootGroupId,
    )
    expect(rootIdx).toBe(built.ops.length - 1) // root group is created last
    // exposed ports surfaced for wiring, stable names
    expect(built.exposedInputs.every((p) => /^in_\d+$/.test(p.portName))).toBe(true)
    expect(built.exposedOutputs.every((p) => /^out_\d+$/.test(p.portName))).toBe(true)
    // ports authored with a customLabelEn surface it as `label` (agent-facing semantic name)
    expect(built.exposedInputs.find((p) => p.portName === 'in_1')?.label).toBe('Scene')
    expect(built.exposedOutputs.find((p) => p.portName === 'out_4')?.label).toBe('Lake')
    // ports without a customLabelEn/customLabel simply omit `label`
    expect(built.exposedInputs.find((p) => p.portName === 'in_3')?.label).toBeUndefined()
  })

  it('instantiates into an empty graph: adds a __group__ shadow node + group defs (incl. nested)', async () => {
    const { scratch, runtime, built, result } = await instantiateLakeRegions()
    try {
      expect(result.status).toBe('ok')

      const snap = getPipeline(runtime)
      expect(snap).not.toBeNull()
      // The top-level group materialises as ONE __group__ shadow node keyed by the group id.
      const shadow = snap!.nodes[built.rootGroupId]
      expect(shadow).toBeDefined()
      expect(shadow.opId).toBe(GROUP_OP_ID)

      // The flat group registry contains the root group + all nested sub-groups.
      const groups = listGroups(runtime)
      expect(groups.length).toBe(built.ops.filter((o) => (o as { type: string }).type === 'createGroup').length)
      const rootGroup = getGroup(runtime, built.rootGroupId)
      expect(rootGroup).not.toBeNull()
      // Exposed ports keep the in_N/out_N contract on the materialised group.
      expect(rootGroup!.exposedInputs.every((p) => /^in_\d+$/.test(p.portName))).toBe(true)
      expect(rootGroup!.exposedOutputs.every((p) => /^out_\d+$/.test(p.portName))).toBe(true)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('honours an explicit groupId for a stable handle', async () => {
    const { scratch, runtime, result } = await instantiateLakeRegions({ groupId: 'lake_handle' })
    try {
      expect(result.status).toBe('ok')
      const snap = getPipeline(runtime)
      expect(snap!.nodes['lake_handle']).toBeDefined()
      expect(snap!.nodes['lake_handle'].opId).toBe(GROUP_OP_ID)
      expect(getGroup(runtime, 'lake_handle')).not.toBeNull()
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('can instantiate the SAME template twice into one graph without id collision', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'tmpl-inst-twice-'))
    try {
      const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'wb-scene-test' })
      const split = splitTemplate(loadTemplate(LAKE_REGIONS))!

      const a = buildTemplateOps(split.root, split.deps, { x: 0, y: 0 }, undefined)
      const ra = await applyBatch(runtime, a.ops as never, { actor: 'ai:sino', label: 'first' })
      expect(ra.status).toBe('ok')

      const b = buildTemplateOps(split.root, split.deps, { x: 600, y: 0 }, undefined)
      const rb = await applyBatch(runtime, b.ops as never, { actor: 'ai:sino', label: 'second' })
      expect(rb.status).toBe('ok')

      // Distinct root group ids → two independent top-level groups, no collision.
      expect(a.rootGroupId).not.toBe(b.rootGroupId)
      const snap = getPipeline(runtime)
      expect(snap!.nodes[a.rootGroupId]).toBeDefined()
      expect(snap!.nodes[b.rootGroupId]).toBeDefined()

      // Exactly two TOP-LEVEL group shadow nodes (nested-group shadows live inside
      // each parent group's `nodes`, not in the flat top-level node map).
      const topShadows = Object.values(snap!.nodes).filter((n) => n.opId === GROUP_OP_ID)
      expect(topShadows.length).toBe(2)

      // The flat group registry holds both instances' groups with disjoint ids —
      // proof the remap minted fresh ids and the second instance did not collide.
      const groupIds = listGroups(runtime).map((g) => g.id)
      expect(new Set(groupIds).size).toBe(groupIds.length) // all unique
      expect(groupIds.length).toBe(2 * (1 + split.deps.length))
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('stamps __groupIsTemplate on the shadow (instantiate route provenance pass)', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'tmpl-prov-'))
    try {
      const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'wb-scene-test' })
      const split = splitTemplate(loadTemplate(LAKE_REGIONS))!
      const built = buildTemplateOps(split.root, split.deps, { x: 100, y: 50 }, undefined)
      const ops = [
        ...built.ops,
        {
          type: 'updateNode',
          nodeId: built.rootGroupId,
          params: {
            groupId: built.rootGroupId,
            __groupIsTemplate: true,
            __groupSourceGroupId: split.root.id,
            __groupSourceCategory: 'scene',
            __groupSourceBatteryName: split.root.name ?? 'LakeRegions',
          },
        },
      ]
      const result = await applyBatch(runtime, ops as never, { actor: 'ai:sino', label: 'template provenance' })
      expect(result.status).toBe('ok')
      const snap = getPipeline(runtime)
      expect(snap!.nodes[built.rootGroupId]?.params?.__groupIsTemplate).toBe(true)
      expect(snap!.nodes[built.rootGroupId]?.params?.__groupSourceGroupId).toBe(split.root.id)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
