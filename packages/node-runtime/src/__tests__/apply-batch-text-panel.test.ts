// Agents confuse text_panel with number_const and write params.value.
// applyBatch must copy value → text so WallAsset / AssetName are not empty.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyBatch,
  createRuntime,
  getPipeline,
  normalizeTextPanelParams,
} from '../layer2/index.js'
import type { OpSpec } from '../layer1/index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-text-panel-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratch, { recursive: true })
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const textPanelOp: OpSpec = {
  id: 'text_panel',
  inputs: [],
  outputs: [{ name: 'output', type: 'string', access: 'item' }],
  params: [{ name: 'text', type: 'string' }],
  execute: (_ctx, args) => ({ output: args.text ?? '' }),
}

function fresh() {
  const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
  runtime.registry.register(textPanelOp)
  return runtime
}

describe('normalizeTextPanelParams', () => {
  it('copies value → text when text is missing', () => {
    expect(normalizeTextPanelParams('text_panel', { value: '墙体' })).toEqual({
      value: '墙体',
      text: '墙体',
    })
  })

  it('keeps existing text', () => {
    expect(normalizeTextPanelParams('text_panel', { text: '草地', value: 'ignored' })).toEqual({
      text: '草地',
      value: 'ignored',
    })
  })

  it('ignores non-text_panel ops', () => {
    expect(normalizeTextPanelParams('number_const', { value: 3 })).toEqual({ value: 3 })
  })
})

describe('applyBatch text_panel value→text heal', () => {
  it('createNode with params.value gets params.text', async () => {
    const runtime = fresh()
    const res = await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'wall', opId: 'text_panel', params: { value: '墙体' } },
    ])
    expect(res.status).toBe('ok')
    const node = getPipeline(runtime)!.nodes.wall
    expect(node.params).toMatchObject({ text: '墙体', value: '墙体' })
  })

  it('updateNode with params.value heals empty text', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'wall', opId: 'text_panel', params: {} },
    ])
    const res = await applyBatch(runtime, [
      { type: 'updateNode', nodeId: 'wall', params: { value: '墙体' } },
    ])
    expect(res.status).toBe('ok')
    expect(getPipeline(runtime)!.nodes.wall.params).toMatchObject({ text: '墙体' })
  })
})
