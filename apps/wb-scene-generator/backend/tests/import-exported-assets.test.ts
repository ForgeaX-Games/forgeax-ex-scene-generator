import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const importer = join(pluginRoot, 'scripts', 'import-exported-assets.mjs')

function writeFixtureExport(root: string): void {
  const exportRoot = join(root, 'materials', 'export_2026-06-04')
  mkdirSync(join(exportRoot, 'tiles'), { recursive: true })
  mkdirSync(join(root, 'materials', 'asset-store', 'blobs', 'stale'), { recursive: true })

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2jLw9AAAAFElEQVR4nGP8z8DAwMDAxAADKgAEBV+Y2AAAAABJRU5ErkJggg==',
    'base64',
  )
  const imagePath = join(exportRoot, 'tiles', 'common.png')
  mkdirSync(dirname(imagePath), { recursive: true })
  writeFileSync(imagePath, png)
  writeFileSync(join(root, 'materials', 'asset-store', 'blobs', 'stale', 'old'), 'old')

  writeFileSync(
    join(exportRoot, 'meta.json'),
    JSON.stringify(
      {
        exportVersion: 1,
        totalAssets: 3,
        assets: [
          {
            fileName: '[外]_[室外]__[地形]_[草地]_[草]_[无]_[自然]_[正常]_[瓦片组]_[16]__[静态]_[]_[0].png',
            libraryPath: 'Asset_Library/common.png',
            organizeFolderPath: 'tiles',
            exportPath: 'tiles/common.png',
            tags: { cropType: '瓦片组', size: '16' },
            tagLayers: [{ index: 9, key: 'cropType', label: '是否抠图（原始）', value: '瓦片组' }],
            assetKind: 'common_16',
            cropTypeOriginal: '瓦片组',
            geometry: { pivot: [0.25, 0.75] },
          },
          {
            fileName: '[外]_[室外]__[地形]_[草地]_[草]_[无]_[自然]_[正常]_[瓦片组]_[16]__[静态]_[]_[0].png',
            libraryPath: 'Asset_Library/common.png',
            organizeFolderPath: 'tiles',
            exportPath: 'tiles/common.png',
            tags: { cropType: '瓦片组', size: '16' },
            tagLayers: [{ index: 9, key: 'cropType', label: '是否抠图（原始）', value: '瓦片组' }],
            assetKind: 'common_16',
            cropTypeOriginal: '瓦片组',
            geometry: { pivot: [0.25, 0.75] },
          },
          {
            fileName: '[室内]_[室内]__[家具]_[卧室]_[床]_[无]_[现代]_[正常]_[抠图]_[32]__[静态]_[]_[0].png',
            libraryPath: 'Asset_Library/common.png',
            organizeFolderPath: 'objects',
            exportPath: 'tiles/common.png',
            tags: { cropType: '抠图', size: '32' },
            tagLayers: [{ index: 9, key: 'cropType', label: '是否抠图（原始）', value: '抠图' }],
            assetKind: 'object',
            cropTypeOriginal: '抠图',
            geometry: {
              object_height: 33,
              collision_mask: { type: 'rectangle', x: 4, y: 16, width: 32, height: 30 },
              pivot: [0.5, 0],
            },
          },
        ],
      },
      null,
      2,
    ),
  )
}

describe('import-exported-assets script', () => {
  it('builds a fresh compatible asset-store with new metadata columns', () => {
    const root = mkdtempSync(join(tmpdir(), 'wb-import-assets-'))
    try {
      writeFixtureExport(root)

      execFileSync(process.execPath, [importer, '--root', root], { cwd: pluginRoot, stdio: 'pipe' })

      const db = new Database(join(root, 'materials', 'asset-store', 'library.db'), { readonly: true })
      try {
        const stale = existsSync(join(root, 'materials', 'asset-store', 'blobs', 'stale', 'old'))
        expect(stale).toBe(false)

        expect((db.prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c).toBe(4)
        expect((db.prepare('SELECT COUNT(DISTINCT id) AS c FROM assets').get() as { c: number }).c).toBe(4)

        // asset_kind column was folded into the alias type field (idx 7) and dropped;
        // rows are now addressed by their 12-field renderer alias.
        const row = db.prepare("SELECT * FROM assets WHERE alias LIKE '%_[common_16]_%' LIMIT 1").get() as Record<string, unknown>
        expect(row.alias).toBe('[外]_[室外]_[草]_[]_[无]_[自然]_[正常]_[common_16]_[16]_[静态]_[]_[0].png')
        expect(row.zone).toBe('raw')
        expect(row.mime_type).toBe('image/png')
        expect(row.width_px).toBe(2)
        expect(row.height_px).toBe(3)
        expect(row.anchor_x).toBe(0.25)
        expect(row.anchor_y).toBe(0.75)
        expect(JSON.parse(String(row.geometry_json))).toEqual({ pivot: [0.25, 0.75] })

        const blob = db.prepare('SELECT * FROM blobs WHERE sha256 = ?').get(row.blob_sha256) as Record<string, unknown>
        expect(blob.sha256).toBe(row.blob_sha256)
        expect(readFileSync(join(root, 'materials', 'asset-store', 'blobs', String(blob.sha256).slice(0, 2), String(blob.sha256).slice(2, 4), String(blob.sha256))).length).toBe(row.size_bytes)

        const floor = db.prepare("SELECT * FROM assets WHERE alias LIKE '%_[floor_1]_%'").get() as Record<string, unknown>
        expect(floor.alias).toContain('_[floor_1]_[16]_')
        expect(floor.width_px).toBe(16)
        expect(floor.height_px).toBe(16)
        expect(existsSync(join(root, 'materials', 'asset-store', 'blobs', String(floor.blob_sha256).slice(0, 2), String(floor.blob_sha256).slice(2, 4), String(floor.blob_sha256)))).toBe(true)

        const object = db.prepare("SELECT * FROM assets WHERE alias LIKE '%_[床]_%'").get() as Record<string, unknown>
        expect(object.geometry_json).toBeTruthy()
        expect(object.width_px).toBeGreaterThan(0)
        expect(object.height_px).toBeGreaterThan(0)
        expect(JSON.parse(String(object.geometry_json))).toMatchObject({
          object_height: 33,
          collision_mask: { type: 'rectangle' },
        })
      } finally {
        db.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
