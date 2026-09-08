import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyBatch } from '@forgeax/node-runtime'
import { getRuntime } from '../src/runtime.js'
import { importGeneratedImage } from '../src/assets/generatedAssets.js'
import { readUpstreamImageRefs, resolveNodeImageInputs } from '../src/ai/imageGeneration.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asset2d-imagegen-upstream-'))
  process.env.FORGEAX_PROJECT_ROOT = root
})

afterEach(() => {
  delete process.env.FORGEAX_PROJECT_ROOT
  rmSync(root, { recursive: true, force: true })
})

describe('image_gen upstream reference resolution', () => {
  it('falls back to upstream _gen_image when the output cache is missing (image_gen → image_gen)', async () => {
    const rt = await getRuntime()
    const refBytes = Buffer.from('upstream-generated')
    const upstream = importGeneratedImage(rt, {
      prompt: 'first pass',
      nodeId: 'gen1',
      imageBase64: refBytes.toString('base64'),
    })

    await applyBatch(rt, [
      {
        type: 'createNode',
        nodeId: 'gen1',
        opId: 'image_gen',
        position: { x: 0, y: 0 },
        params: { _gen_image: upstream.image },
      },
      { type: 'createNode', nodeId: 'gen2', opId: 'image_gen', position: { x: 200, y: 0 }, params: {} },
      {
        type: 'connect',
        edgeId: 'e1',
        source: { nodeId: 'gen1', port: 'image' },
        target: { nodeId: 'gen2', port: 'image' },
      },
    ])

    expect(readUpstreamImageRefs(rt, 'gen1', 'image')).toEqual([upstream.image])

    const resolved = resolveNodeImageInputs(rt, 'gen2')
    expect(resolved.images).toEqual([upstream.image])
  })

  it('resolves imageSize from a wired text_panel output (genMask size512 path)', async () => {
    const rt = await getRuntime()
    await applyBatch(rt, [
      { type: 'createNode', nodeId: 'size512', opId: 'text_panel', position: { x: 0, y: 0 }, params: { text: '512' } },
      { type: 'createNode', nodeId: 'genMask', opId: 'image_gen', position: { x: 200, y: 0 }, params: {} },
      {
        type: 'connect',
        edgeId: 'e-size',
        source: { nodeId: 'size512', port: 'output' },
        target: { nodeId: 'genMask', port: 'imageSize' },
      },
    ])

    const resolved = resolveNodeImageInputs(rt, 'genMask')
    expect(resolved.imageSize).toBe('512')
  })

  it('defaults imageSize to 2K when genMask has no wire and no param', async () => {
    const rt = await getRuntime()
    await applyBatch(rt, [
      { type: 'createNode', nodeId: 'genBare', opId: 'image_gen', position: { x: 0, y: 100 }, params: {} },
    ])
    expect(resolveNodeImageInputs(rt, 'genBare').imageSize).toBe('2K')
  })
})
