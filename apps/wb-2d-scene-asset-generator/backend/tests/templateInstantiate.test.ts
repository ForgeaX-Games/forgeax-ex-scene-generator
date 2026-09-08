/**
 * Tests for the template-group instantiation primitive
 * (backend/src/lib/templateOps.ts) — the shared remap + ordering + op-build
 * logic behind POST /api/v1/group-templates/:id/instantiate, which the
 * `asset2d:groups.instantiateTemplate` tool forwards to.
 *
 * Pure-logic tests drive buildTemplateOps/splitTemplate directly (no batteries
 * needed). The integration test materialises a real shipped template into the
 * app runtime (getRuntime loads the app batteries so createNode validates).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyBatch, getPipeline, getGroup, listGroups } from '@forgeax/node-runtime'
import { getRuntime } from '../src/runtime.js'
import { buildTemplateOps, splitTemplate } from '../src/lib/templateOps.js'

const here = dirname(fileURLToPath(import.meta.url))
// backend/tests → backend → wb-2d-scene-asset-generator
const appRoot = resolve(here, '..', '..')
const CONCEPTUAL = resolve(
  appRoot,
  'batteries/templates/pipelines/(pixel)conceptual_scene_design/conceptual_scene_design.json',
)

const GROUP_OP_ID = '__group__'

function loadTemplate(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf-8'))
}

describe('buildTemplateOps / splitTemplate (conceptual_scene_design)', () => {
  it('splits the template into a root with stable in_N/out_N exposed ports', () => {
    const split = splitTemplate(loadTemplate(CONCEPTUAL))
    expect(split).not.toBeNull()
    expect(split!.root.id).toBeTruthy()
    expect((split!.root.exposedInputs ?? []).every((p) => /^in_\d+$/.test(p.portName))).toBe(true)
    expect((split!.root.exposedOutputs ?? []).every((p) => /^out_\d+$/.test(p.portName))).toBe(true)
  })

  it('builds an ordered batch with the root createGroup last and stable exposed ports', () => {
    const split = splitTemplate(loadTemplate(CONCEPTUAL))!
    const built = buildTemplateOps(split.root, split.deps, { x: 0, y: 0 }, undefined)
    const createGroups = built.ops.filter((o) => (o as { type: string }).type === 'createGroup')
    expect(createGroups.length).toBe(1 + split.deps.length)
    const rootIdx = built.ops.findIndex(
      (o) =>
        (o as { type: string; groupId?: string }).type === 'createGroup' &&
        (o as { groupId?: string }).groupId === built.rootGroupId,
    )
    expect(rootIdx).toBe(built.ops.length - 1)
    expect(built.exposedInputs.every((p) => /^in_\d+$/.test(p.portName))).toBe(true)
    expect(built.exposedOutputs.every((p) => /^out_\d+$/.test(p.portName))).toBe(true)
  })

  it('mints fresh ids so the SAME template builds twice with no overlapping node ids', () => {
    const split = splitTemplate(loadTemplate(CONCEPTUAL))!
    const a = buildTemplateOps(split.root, split.deps, { x: 0, y: 0 }, undefined)
    const b = buildTemplateOps(split.root, split.deps, { x: 600, y: 0 }, undefined)
    expect(a.rootGroupId).not.toBe(b.rootGroupId)
    const idsOf = (ops: typeof a.ops) =>
      ops
        .filter((o) => (o as { type: string }).type === 'createNode')
        .map((o) => (o as { nodeId: string }).nodeId)
    const overlap = idsOf(a.ops).filter((id) => idsOf(b.ops).includes(id))
    expect(overlap).toHaveLength(0)
  })
})

describe('instantiate into the app runtime', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'asset2d-tmpl-inst-'))
    process.env.FORGEAX_PROJECT_ROOT = root
  })
  afterEach(() => {
    delete process.env.FORGEAX_PROJECT_ROOT
    rmSync(root, { recursive: true, force: true })
  })

  it('materialises a __group__ shadow node with the exposed in_N/out_N contract, honouring an explicit groupId', async () => {
    const rt = await getRuntime()
    const split = splitTemplate(loadTemplate(CONCEPTUAL))!
    const built = buildTemplateOps(split.root, split.deps, { x: 100, y: 50 }, 'concept_handle')
    const result = await applyBatch(rt, built.ops as never, { actor: 'ai', label: 'test instantiate' })
    expect(result.status).toBe('ok')

    const snap = getPipeline(rt)
    expect(snap).not.toBeNull()
    const shadow = snap!.nodes['concept_handle']
    expect(shadow).toBeDefined()
    expect(shadow.opId).toBe(GROUP_OP_ID)

    const groups = listGroups(rt)
    expect(groups.length).toBe(1 + split.deps.length)
    const rootGroup = getGroup(rt, 'concept_handle')
    expect(rootGroup).not.toBeNull()
    expect(rootGroup!.exposedInputs.every((p) => /^in_\d+$/.test(p.portName))).toBe(true)
    expect(rootGroup!.exposedOutputs.every((p) => /^out_\d+$/.test(p.portName))).toBe(true)
  })
})
