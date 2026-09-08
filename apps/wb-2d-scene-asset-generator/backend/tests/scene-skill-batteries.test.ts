import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { fourwayRouteClassifier } from '../../batteries/image/fourway/fourway_route_classifier/index.js'
import { fourwayPromptBuilder } from '../../batteries/image/fourway/fourway_prompt_builder/index.js'
import { fourwayMetadataPack } from '../../batteries/image/fourway/fourway_metadata_pack/index.js'
import { seamlessEdgeCheck } from '../../batteries/image/fourway/seamless_edge_check/index.js'
import { sidescrollerPromptBuilder } from '../../batteries/image/sidescroller/sidescroller_prompt_builder/index.js'
import { sidescrollerResizeTile } from '../../batteries/image/sidescroller/sidescroller_resize_tile/index.js'
import { sidescrollerStitchTiles } from '../../batteries/image/sidescroller/sidescroller_stitch_tiles/index.js'
import { sidescrollerMetadataPack } from '../../batteries/image/sidescroller/sidescroller_metadata_pack/index.js'

function makeImage(w: number, h: number): Buffer {
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      data[i] = x * 20
      data[i + 1] = y * 20
      data[i + 2] = 64
      data[i + 3] = 255
    }
  }
  return data
}

function mockCtx(w = 4, h = 3) {
  const input = { width: w, height: h, data: makeImage(w, h) }
  return {
    services: {
      asset2d: {
        processImage: (
          _image: string,
          _opts: unknown,
          transform: (img: { width: number; height: number; data: Buffer }) => { width: number; height: number; data: Buffer },
        ) => {
          const out = transform(input)
          return { image: 'processed://asset', width: out.width, height: out.height, error: '' }
        },
      },
    },
  }
}

describe('four-way skill batteries', () => {
  it('routes semantic road markings to decal sprites', () => {
    const out = fourwayRouteClassifier({ usage: 'crosswalk lane marking for top-down road' })
    expect(out.route).toBe('decal_sprite')
    expect(out.blocking).toBe(false)
  })

  it('builds material prompts with seamless constraints', () => {
    const out = fourwayPromptBuilder({ route: 'material_seamless', subject: 'mossy grass', view: 'top_down' })
    expect(String(out.prompt)).toContain('material_seamless')
    expect(String(out.prompt)).toContain('four-way seamless texture')
  })

  it('packs edge-check evidence into metadata', () => {
    const out = fourwayMetadataPack({
      route: 'material_seamless',
      edgeReport: JSON.stringify({ passed: true, left_right_max_delta: 3 }),
    })
    const metadata = JSON.parse(String(out.metadata)) as { seamlessAxes: string[]; seamless_check: { passed: boolean } }
    expect(metadata.seamlessAxes).toEqual(['x', 'y'])
    expect(metadata.seamless_check.passed).toBe(true)
    expect(out.ready).toBe(true)
  })

  it('passes a decoded image through seamless edge check', () => {
    const out = seamlessEdgeCheck({ image: 'asset://in', threshold: 255 }, mockCtx())
    expect(out.image).toBe('processed://asset')
    expect(out.passed).toBe(true)
  })
})

describe('side-scroller skill batteries', () => {
  it('builds background prompts that forbid standable platforms', () => {
    const out = sidescrollerPromptBuilder({ layer: 'bg_middle', scene: 'forest ruins' })
    expect(out.aspectRatio).toBe('16:9')
    expect(String(out.prompt)).toContain('NO ground platforms')
  })

  it('resizes background tiles to the requested logical dimensions', () => {
    const out = sidescrollerResizeTile({ image: 'asset://in', width: 8, height: 6 }, mockCtx())
    expect(out.width).toBe(8)
    expect(out.height).toBe(6)
  })

  it('stitches three 4px tiles into a 12px background by default', () => {
    const out = sidescrollerStitchTiles({ image: 'asset://in' }, mockCtx(4, 3))
    expect(out.width).toBe(12)
    expect(out.height).toBe(3)
  })

  it('packs runtime metadata and respects quality action', () => {
    const out = sidescrollerMetadataPack({
      layer_role: 'bg_top',
      texture_width: 1920,
      texture_height: 360,
      qualityReport: JSON.stringify({ action: 'regenerate' }),
    })
    const metadata = JSON.parse(String(out.metadata)) as { scene_type: string; layer_role: string }
    expect(metadata.scene_type).toBe('side_scroller')
    expect(metadata.layer_role).toBe('bg_top')
    expect(out.ready).toBe(false)
  })
})
