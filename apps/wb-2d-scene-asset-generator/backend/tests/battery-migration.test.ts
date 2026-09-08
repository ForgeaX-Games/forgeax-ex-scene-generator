import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'

describe('asset2d battery migration', () => {
  it('loads migrated AI and image batteries in the asset app', async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/ops' })
      expect(res.statusCode).toBe(200)
      const ops = res.json() as Array<{
        id: string
        type?: string
        inputs?: Array<{ name: string; access?: string }>
        outputs?: Array<{ name: string; access?: string }>
      }>
      const ids = new Set(ops.map((op) => op.id))
      expect(ids.has('image_gen')).toBe(true)
      expect(ids.has('text_gen')).toBe(true)
      expect(ids.has('image_resize')).toBe(true)
      expect(ids.has('image_remove_bg')).toBe(true)
      expect(ids.has('make_seamless_moisan')).toBe(true)
      expect(ids.has('worldmap_render_layers')).toBe(false)
      expect(new Set(ops.map((op) => op.type))).not.toContain('basic')
      expect(new Set(ops.map((op) => op.type))).not.toContain('components')
      expect(new Set(ops.map((op) => op.type))).not.toContain('special')

      const imageGen = ops.find((op) => op.id === 'image_gen')
      expect(imageGen?.inputs?.find((port) => port.name === 'prompt')?.access).toBe('item')
      expect(imageGen?.inputs?.find((port) => port.name === 'image')?.access).toBe('item')
      expect(imageGen?.outputs?.find((port) => port.name === 'image')?.access).toBe('item')
      expect(imageGen?.outputs?.find((port) => port.name === 'error')?.access).toBe('item')
    } finally {
      await app.close()
    }
  })

  it('removes generic AI batteries from wb-scene-generator', () => {
    const sceneAiDir = resolve(process.cwd(), 'apps/wb-scene-generator/batteries/ai')
    expect(existsSync(sceneAiDir)).toBe(false)
  })
})
