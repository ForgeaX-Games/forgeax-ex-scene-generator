import { describe, expect, it } from 'vitest'
import { imageOutput } from '../../batteries/image/basic/image_output/index.js'

/**
 * Regression for the `image_output` naming bug: the battery declared `name` /
 * `tags` input ports and an `overwrite` param in its meta, but the
 * `_shared/asset2d.copyImage` glue dropped all three before calling the host
 * `copyImage` service — so a user-supplied name (e.g. 「圣诞树测试」) never reached
 * the asset record. These tests assert the values now flow through.
 */
describe('image_output naming pass-through', () => {
  function mockCtx() {
    const calls: Array<{ image: string; opts: Record<string, unknown> }> = []
    const ctx = {
      services: {
        asset2d: {
          copyImage: (image: string, opts: Record<string, unknown> = {}) => {
            calls.push({ image, opts })
            return { image: 'lib://saved.png', width: 0, height: 0, error: '' }
          },
        },
      },
    }
    return { ctx, calls }
  }

  it('forwards name / tags / overwrite from the node inputs to copyImage', async () => {
    const { ctx, calls } = mockCtx()
    const out = await imageOutput(
      { image: 'lib://src.png', name: '圣诞树测试', tags: ['xmas', 'tree'], overwrite: true },
      ctx,
    )
    expect(out.ok).toBe(true)
    expect(out.alias).toBe('lib://saved.png')
    expect(calls).toHaveLength(1)
    expect(calls[0].opts).toMatchObject({
      operation: 'image_output',
      name: '圣诞树测试',
      tags: ['xmas', 'tree'],
      overwrite: true,
    })
  })

  it('omits name when blank and drops non-string tags', async () => {
    const { ctx, calls } = mockCtx()
    await imageOutput({ image: 'lib://src.png', name: '   ', tags: ['ok', 42, ''] }, ctx)
    expect(calls[0].opts.name).toBeUndefined()
    expect(calls[0].opts.tags).toEqual(['ok'])
  })

  it('reports ok=false when there is no image input', async () => {
    const { ctx, calls } = mockCtx()
    const out = await imageOutput({ name: '圣诞树测试' }, ctx)
    expect(out.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
