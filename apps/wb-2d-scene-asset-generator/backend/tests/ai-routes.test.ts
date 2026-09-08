import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyBatch, writeNodeOutput } from '@forgeax/node-runtime'
import { buildApp } from '../src/main.js'
import { getRuntime } from '../src/runtime.js'
import { importGeneratedImage, parseImageRef } from '../src/assets/generatedAssets.js'

let root: string
let originalFetch: typeof fetch

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asset2d-ai-'))
  process.env.FORGEAX_PROJECT_ROOT = root
  process.env.FORGEAX_STUDIO_API_BASE_URL = 'http://studio.test'
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.FORGEAX_PROJECT_ROOT
  delete process.env.FORGEAX_STUDIO_API_BASE_URL
  rmSync(root, { recursive: true, force: true })
})

describe('AI gateway routes', () => {
  it('proxies image generation through Studio and persists the generated asset', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      imageBase64: png.toString('base64'),
      mimeType: 'image/png',
      vendor: 'mock-vendor',
      modelId: 'mock-image-model',
      triedVendors: ['mock-vendor'],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const app = await buildApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/image',
        payload: { prompt: 'tiny cat', nodeId: 'node-a' },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json() as { data: { image: string; asset: { alias: string; source: string } } }
      const imageRef = parseImageRef(body.data.image)
      expect(imageRef).toEqual({
        alias: body.data.asset.alias,
        blobId: expect.any(String),
      })
      if (!imageRef || 'dataUrl' in imageRef) throw new Error('expected generated library ImageRef')

      const blob = await app.inject({
        method: 'GET',
        url: `/api/v1/library/blob/${imageRef.blobId}`,
      })
      expect(blob.statusCode).toBe(200)
      expect(blob.headers['content-type']).toContain('image/png')
      expect(Buffer.from(blob.rawPayload)).toEqual(png)
      expect(body.data.asset.source).toBe('studio-gateway:mock-vendor')
      expect(fetchMock).toHaveBeenCalledWith(
        'http://studio.test/__ce-api__/generate-image',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"imageSize":"2K"'),
        }),
      )

      // The Run-button result is persisted into the backend output cache (port
      // `image`) so the manual-trigger op's downstream consumers hydrate from it
      // without the walker re-firing image_gen.
      const rt = await getRuntime()
      const cached = rt.outputs.read('node-a', 'image')
      expect(cached).not.toBeNull()
      expect(cached!.valid).toBe(true)
      // No real graph node `node-a` in this test, so the op/port type can't be
      // resolved and the type defaults to 'any'. The wire shape is what matters.
      expect(cached!.type).toBe('any')
      // Wire form: a single item-access branch holding the generated alias.
      const entries = cached!.data as Array<{ path: number[]; items: unknown[] }>
      expect(entries[0]!.items).toEqual([body.data.image])
    } finally {
      await app.close()
    }
  })

  it('backfills the wired reference image even when the caller supplies its own prompt', async () => {
    // Regression: an agent run names the node AND passes an explicit prompt, but
    // relies on the wired `image` edge for the reference image. The route used to
    // resolve canvas inputs only when BOTH prompt and images were empty, so any
    // caller that passed a prompt got ZERO reference images — the model ignored
    // the wired template. prompt and images must be backfilled independently.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const refBytes = Buffer.from('grayscale-template')
    let sentPayload: { prompt?: string; inputImages?: Array<{ base64: string }> } | null = null
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      sentPayload = init?.body ? JSON.parse(init.body) : null
      return new Response(JSON.stringify({
        success: true,
        imageBase64: png.toString('base64'),
        mimeType: 'image/png',
        vendor: 'mock-vendor',
        modelId: 'mock-image-model',
        triedVendors: ['mock-vendor'],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const rt = await getRuntime()
    // A real library asset → its alias is what the wired `image` port carries.
    const ref = importGeneratedImage(rt, { prompt: 'tpl', nodeId: 'src', imageBase64: refBytes.toString('base64') })

    await applyBatch(rt, [
      { type: 'createNode', nodeId: 'src', opId: 'image_source', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'gen', opId: 'image_gen', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'src', port: 'image' }, target: { nodeId: 'gen', port: 'image' } },
    ])
    // Seed the upstream output cache (manual run resolves from getNodeOutput).
    writeNodeOutput(rt, 'src', 'image', ref.image)

    const app = await buildApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/image',
        // Caller passes BOTH nodeId and an explicit prompt — no images.
        payload: { prompt: 'a temple, pixel art', nodeId: 'gen' },
      })

      expect(res.statusCode).toBe(200)
      expect(sentPayload).not.toBeNull()
      expect(sentPayload!.prompt).toBe('a temple, pixel art')
      // The wired reference image must have been backfilled and forwarded.
      expect(sentPayload!.inputImages).toBeDefined()
      expect(sentPayload!.inputImages!.length).toBe(1)
      expect(sentPayload!.inputImages![0]!.base64).toBe(refBytes.toString('base64'))
    } finally {
      await app.close()
    }
  })

  it('resolves the wired reference image even when the upstream was never executed', async () => {
    // Regression: an AI/agent run names image_gen, but the upstream image_source
    // (created via a create-batch with params.image set) was never executed in
    // this backend, so its output cache file does not exist. A human Run works
    // because the FRONTEND store holds the computed nodeOutputs; the agent has no
    // such store. The route must walk image_gen's closure first so image_source
    // executes and its `image` output is cached, then resolve the wired ref.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const refBytes = Buffer.from('grayscale-template')
    let sentPayload: { prompt?: string; inputImages?: Array<{ base64: string }> } | null = null
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      sentPayload = init?.body ? JSON.parse(init.body) : null
      return new Response(JSON.stringify({
        success: true,
        imageBase64: png.toString('base64'),
        mimeType: 'image/png',
        vendor: 'mock-vendor',
        modelId: 'mock-image-model',
        triedVendors: ['mock-vendor'],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const rt = await getRuntime()
    const ref = importGeneratedImage(rt, { prompt: 'tpl', nodeId: 'src', imageBase64: refBytes.toString('base64') })

    // image_source holds its ref in params.image (set on the create-batch). No
    // writeNodeOutput seed → the upstream output cache is intentionally absent.
    await applyBatch(rt, [
      { type: 'createNode', nodeId: 'src', opId: 'image_source', position: { x: 0, y: 0 }, params: { image: ref.image } },
      { type: 'createNode', nodeId: 'gen', opId: 'image_gen', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'src', port: 'image' }, target: { nodeId: 'gen', port: 'image' } },
    ])

    const app = await buildApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/image',
        payload: { prompt: 'a temple, pixel art', nodeId: 'gen' },
      })

      expect(res.statusCode).toBe(200)
      expect(sentPayload).not.toBeNull()
      // The wired reference image was resolved by executing the upstream and
      // forwarded — even though nothing seeded the output cache up front.
      expect(sentPayload!.inputImages).toBeDefined()
      expect(sentPayload!.inputImages!.length).toBe(1)
      expect(sentPayload!.inputImages![0]!.base64).toBe(refBytes.toString('base64'))
    } finally {
      await app.close()
    }
  })

  it('forwards imageSize from the request body to the Studio gateway', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    let sentPayload: { imageSize?: string } | null = null
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      sentPayload = init?.body ? JSON.parse(init.body) : null
      return new Response(JSON.stringify({
        success: true,
        imageBase64: png.toString('base64'),
        mimeType: 'image/png',
        vendor: 'mock-vendor',
        modelId: 'mock-image-model',
        triedVendors: ['mock-vendor'],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const app = await buildApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/image',
        payload: { prompt: 'tiny icon', imageSize: '512' },
      })

      expect(res.statusCode).toBe(200)
      expect(sentPayload?.imageSize).toBe('512')
    } finally {
      await app.close()
    }
  })

  it('backfills imageSize from the node params when only nodeId is given', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    let sentPayload: { imageSize?: string } | null = null
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      sentPayload = init?.body ? JSON.parse(init.body) : null
      return new Response(JSON.stringify({
        success: true,
        imageBase64: png.toString('base64'),
        mimeType: 'image/png',
        vendor: 'mock-vendor',
        modelId: 'mock-image-model',
        triedVendors: ['mock-vendor'],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const rt = await getRuntime()
    await applyBatch(rt, [
      { type: 'createNode', nodeId: 'gen', opId: 'image_gen', position: { x: 0, y: 0 }, params: { imageSize: '4K' } },
    ])

    const app = await buildApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/image',
        payload: { prompt: 'large scene', nodeId: 'gen' },
      })

      expect(res.statusCode).toBe(200)
      expect(sentPayload?.imageSize).toBe('4K')
    } finally {
      await app.close()
    }
  })
})
