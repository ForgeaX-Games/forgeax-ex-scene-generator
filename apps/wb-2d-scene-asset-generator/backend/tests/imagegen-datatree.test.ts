import { describe, expect, it, vi } from 'vitest'
import { executeNode, OpRegistry, DataTree, type ExecutionContext } from '@forgeax/node-runtime/layer1'
import { imageGen } from '../../batteries/ai/providers/ImageGen/index.js'

function ctx(generateImage: (input: { prompt?: string; images?: string[]; nodeId?: string; imageSize?: string }) => Promise<{ image: string; error?: string }>): ExecutionContext {
  return {
    pipelineId: 'p-imagegen',
    log: () => {},
    signal: new AbortController().signal,
    services: {
      asset2d: { generateImage },
    },
  }
}

function imageGenOp() {
  return {
    id: 'image_gen',
    inputs: [
      { name: 'prompt', type: 'string', access: 'item' as const },
      { name: 'image', type: 'image', access: 'tree' as const },
      { name: 'imageSize', type: 'string', access: 'item' as const },
    ],
    outputs: [
      { name: 'image', type: 'image', access: 'item' as const },
      { name: 'error', type: 'string', access: 'item' as const },
    ],
    params: [],
    principal: 'prompt',
    execute: (execCtx: ExecutionContext, args: Record<string, unknown>) => imageGen(args, execCtx),
  }
}

describe('image_gen DataTree execution', () => {
  it('generates one image per prompt item and preserves item paths', async () => {
    const registry = new OpRegistry()
    registry.register(imageGenOp())

    const generateImage = vi.fn(async ({ prompt }: { prompt?: string }) => ({ image: `ref:${prompt}` }))
    const result = await executeNode(
      registry,
      { id: 'img', opId: 'image_gen', position: { x: 0, y: 0 }, params: {} },
      {
        prompt: [
          { path: [0], items: ['cat', 'dog'] },
          { path: [1], items: ['tree house'] },
        ],
      },
      ctx(generateImage),
    )

    expect(result.error).toBeUndefined()
    expect(generateImage).toHaveBeenCalledTimes(3)
    expect(result.outputs.image).toEqual([
      { path: [0, 0], items: ['ref:cat'] },
      { path: [0, 1], items: ['ref:dog'] },
      { path: [1, 0], items: ['ref:tree house'] },
    ])
  })

  it('flattens a multi-branch reference-image tree into a SINGLE call with all images', async () => {
    const registry = new OpRegistry()
    registry.register(imageGenOp())

    const generateImage = vi.fn(async () => ({ image: 'ref:out' }))
    // Two reference images sitting on DIFFERENT parent paths (the Merge
    // "structure-pack" layout that used to split into multiple calls).
    const imageTree = DataTree.fromEntries([
      { path: [0], items: ['alias-building'] },
      { path: [1], items: ['alias-greyscale'] },
    ])

    const result = await executeNode(
      registry,
      { id: 'img', opId: 'image_gen', position: { x: 0, y: 0 }, params: {} },
      {
        prompt: [{ path: [0], items: ['move building to 2.5d'] }],
        image: imageTree,
      },
      ctx(generateImage),
    )

    expect(result.error).toBeUndefined()
    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(generateImage).toHaveBeenCalledWith({
      prompt: 'move building to 2.5d',
      imageSize: '2K',
      images: ['alias-building', 'alias-greyscale'],
    })
  })

  it('forwards a custom imageSize control input to generateImage', async () => {
    const registry = new OpRegistry()
    registry.register(imageGenOp())

    const generateImage = vi.fn(async () => ({ image: 'ref:out' }))
    const result = await executeNode(
      registry,
      { id: 'img', opId: 'image_gen', position: { x: 0, y: 0 }, params: { imageSize: '512' } },
      {
        prompt: [{ path: [0], items: ['pixel icon'] }],
      },
      ctx(generateImage),
    )

    expect(result.error).toBeUndefined()
    expect(generateImage).toHaveBeenCalledWith({ prompt: 'pixel icon', imageSize: '512' })
  })
})
