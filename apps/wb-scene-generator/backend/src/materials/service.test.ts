import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PBR_MATERIALS_DIR, getPbrMaterial, listPbrMaterials, resolvePbrMapPath } from './service.js'

const createdFixtureDirs: string[] = []
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function installMaterialFixture(
  name: string,
  manifest: Record<string, unknown>,
  mapFiles: string[] = [],
): void {
  const dir = join(PBR_MATERIALS_DIR, name)
  if (existsSync(dir)) return
  mkdirSync(dir, { recursive: true })
  createdFixtureDirs.push(dir)
  writeFileSync(join(dir, 'material.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const file of mapFiles) writeFileSync(join(dir, file), PNG_1X1)
}

beforeAll(() => {
  installMaterialFixture('Grass', {
    name: 'Grass',
    maps: { color: 'color.png', normal: 'normal.png', roughness: 'roughness.png' },
    normalSpace: 'GL',
    tiling: 0.25,
  }, ['color.png', 'normal.png', 'roughness.png'])
  installMaterialFixture('Rock', {
    name: 'Rock',
    maps: { color: 'color.png' },
    normalSpace: 'GL',
    tiling: 0.25,
  }, ['color.png'])
  installMaterialFixture('Sand', {
    name: 'Sand',
    maps: { color: 'color.png', normal: 'normal.png', roughness: 'roughness.png' },
    normalSpace: 'GL',
    tiling: 1,
  }, ['color.png', 'normal.png', 'roughness.png'])
  installMaterialFixture('Water', {
    name: 'Water',
    maps: { color: 'color.png', normal: 'normal.png' },
    normalSpace: 'DX',
    tiling: 0.25,
  }, ['color.png', 'normal.png'])
  installMaterialFixture('Water2', {
    name: 'Water2',
    maps: {},
    shading: 'physicalWater',
    water: { ior: 1.333 },
  })
  installMaterialFixture('Mount1', {
    name: 'Mount1',
    maps: {},
    shading: 'terrainBiome',
    biome: { layers: ['Grass', 'Moss', 'Rock'], slopeRockStart: 0.32 },
  })
})

afterAll(() => {
  for (const dir of createdFixtureDirs.reverse()) rmSync(dir, { recursive: true, force: true })
})

describe('pbr materials service', () => {
  it('lists seeded packs', () => {
    const items = listPbrMaterials()
    const names = items.map((i) => i.name)
    expect(names).toContain('Grass')
    expect(names).toContain('Rock')
    expect(names).toContain('Sand')
    expect(names).toContain('Water')
    expect(names).toContain('Water2')
    expect(names).toContain('Mount1')
  })

  it('Sand is textured with color/normal/roughness', () => {
    const s = getPbrMaterial('Sand')
    expect(s).not.toBeNull()
    expect(s!.shading).toBe('textured')
    expect(s!.maps).toEqual(expect.arrayContaining(['color', 'normal', 'roughness']))
    expect(s!.mapUrls.color).toBe('/api/v1/materials/Sand/maps/color')
  })

  it('Water2 is map-less physical water', () => {
    const w = getPbrMaterial('Water2')
    expect(w).not.toBeNull()
    expect(w!.shading).toBe('physicalWater')
    expect(w!.maps).toEqual([])
    expect(w!.water?.ior).toBeCloseTo(1.333)
  })

  it('Mount1 is map-less terrain biome', () => {
    const m = getPbrMaterial('Mount1')
    expect(m).not.toBeNull()
    expect(m!.shading).toBe('terrainBiome')
    expect(m!.maps).toEqual([])
    expect(m!.biome?.layers).toEqual(['Grass', 'Moss', 'Rock'])
    expect(m!.biome?.slopeRockStart).toBeCloseTo(0.32)
  })

  it('exact-name get returns map urls', () => {
    const g = getPbrMaterial('Grass')
    expect(g).not.toBeNull()
    expect(g!.maps).toContain('color')
    expect(g!.mapUrls.color).toBe('/api/v1/materials/Grass/maps/color')
  })

  it('unknown name returns null', () => {
    expect(getPbrMaterial('NoSuchMaterial')).toBeNull()
  })

  it('resolves color map path on disk', () => {
    const p = resolvePbrMapPath('Grass', 'color')
    expect(p).toBeTruthy()
    expect(p!.endsWith('.png')).toBe(true)
  })

  it('rejects path escape in name', () => {
    expect(resolvePbrMapPath('../etc', 'color')).toBeNull()
  })
})
