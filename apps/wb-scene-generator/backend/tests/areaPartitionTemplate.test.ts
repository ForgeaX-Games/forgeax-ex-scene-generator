import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

import { splitTemplate, buildTemplateOps } from '../src/lib/legacy/templateOps.js'

const here = dirname(fileURLToPath(import.meta.url))
const AREA_PARTITION = resolve(
  here,
  '../../batteries/templates/structures/districts/AreaPartition/AreaPartition.generated.json',
)

describe('AreaPartition template instantiate ops', () => {
  it('wires ap_slice.slice into multi_seed.shape (required for per-branch seeds)', () => {
    const tpl = JSON.parse(readFileSync(AREA_PARTITION, 'utf-8')) as {
      edges: Array<{ source: { nodeId: string; port: string }; target: { nodeId: string; port: string } }>
    }
    const hasShapeWire = tpl.edges.some(
      (e) => e.source.nodeId === 'ap_slice' && e.source.port === 'slice'
        && e.target.nodeId === 'ap_seed' && e.target.port === 'shape',
    )
    expect(hasShapeWire).toBe(true)
  })

  it('splits root + 2 nested groups and builds createGroup batch', () => {
    const split = splitTemplate(JSON.parse(readFileSync(AREA_PARTITION, 'utf-8')))
    expect(split).not.toBeNull()
    expect(split!.root.id).toBe('group_area_partition_district')
    expect(split!.deps.length).toBe(1)
    const built = buildTemplateOps(split!.root, split!.deps, { x: 0, y: 0 }, 'ap_test')
    expect(built.exposedInputs.some((p) => p.portName === 'in_1')).toBe(true)
    expect(built.exposedOutputs.some((p) => p.portName === 'out_1' && p.portType === 'scene')).toBe(true)
    expect(built.exposedOutputs.some((p) => p.portName === 'out_2' && p.portType === 'string')).toBe(true)
    expect(built.exposedOutputs.some((p) => p.portName === 'out_3' || p.portName === 'out_4')).toBe(false)
    expect(built.ops.filter((o) => (o as { type: string }).type === 'createGroup').length).toBe(2)
  })
})
