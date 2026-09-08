import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const surface = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../Viewer3DSurface.tsx'),
  'utf8',
)

describe('Viewer3DSurface headless ready marker', () => {
  it('exposes a dedicated renderer identity for the headless daemon', () => {
    expect(surface).toContain('data-forgeax-headless-renderer="wb-3d-lowpoly"')
    expect(surface).toContain('data-pane="viewer3d"')
  })
})
