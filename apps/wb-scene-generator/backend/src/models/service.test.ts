import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OBJECT_MODELS_DIR, getObjectModel, listObjectModels, resolveObjectModelPath } from './service.js'

const createdFixtureDirs: string[] = []

function installModelFixture(
  name: string,
  targetHeightCells: number,
  category: string,
): void {
  const dir = join(OBJECT_MODELS_DIR, name)
  if (existsSync(dir)) return
  mkdirSync(dir, { recursive: true })
  createdFixtureDirs.push(dir)
  writeFileSync(join(dir, 'model.json'), `${JSON.stringify({
    name,
    file: 'model.glb',
    targetHeightCells,
    category,
    tags: ['mountain', category],
  }, null, 2)}\n`)
  const glbHeader = Buffer.alloc(12)
  glbHeader.write('glTF')
  glbHeader.writeUInt32LE(2, 4)
  glbHeader.writeUInt32LE(12, 8)
  writeFileSync(join(dir, 'model.glb'), glbHeader)
}

beforeAll(() => {
  installModelFixture('firtree1', 4, 'tree')
  installModelFixture('firtree2', 4, 'tree')
  installModelFixture('firtree6', 4, 'tree')
  installModelFixture('bushtree1', 2.5, 'midtree')
  installModelFixture('shrub_01_1', 1.2, 'shrub')
  installModelFixture('shrub_sorrel_01_1', 0.8, 'shrub')
  installModelFixture('rock1', 1, 'rock')
  installModelFixture('moss_rock1', 1, 'rock')
})

afterAll(() => {
  for (const dir of createdFixtureDirs.reverse()) rmSync(dir, { recursive: true, force: true })
})

describe('object models service', () => {
  it('lists imported mountain layer packs', () => {
    const names = listObjectModels().map((i) => i.name)
    expect(names).toContain('firtree1')
    expect(names).toContain('firtree6')
    expect(names).toContain('bushtree1')
    expect(names).toContain('shrub_01_1')
    expect(names).toContain('shrub_sorrel_01_1')
    expect(names).toContain('rock1')
    expect(names).toContain('moss_rock1')
  })

  it('exact-name get returns file url', () => {
    const m = getObjectModel('firtree1')
    expect(m).not.toBeNull()
    expect(m!.fileUrl).toBe('/api/v1/models/firtree1/file')
    expect(m!.targetHeightCells).toBe(4)
    expect(m!.tags).toContain('mountain')
  })

  it('resolves glb on disk', () => {
    const p = resolveObjectModelPath('firtree2')
    expect(p).toBeTruthy()
    expect(p!.endsWith('.glb')).toBe(true)
  })

  it('unknown / path escape → null', () => {
    expect(getObjectModel('NoSuchTree')).toBeNull()
    expect(resolveObjectModelPath('../etc')).toBeNull()
  })
})
