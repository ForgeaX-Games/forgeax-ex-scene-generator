#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyLegacyAssetOverlays, toRendererAlias } from './legacy-asset-overlays.mjs'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(scriptRoot, 'backend', 'package.json'))
const Database = require('better-sqlite3')

function parseArgs(argv) {
  const opts = { root: process.cwd(), exportName: 'export_2026-06-04' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root') {
      opts.root = argv[++i]
    } else if (arg === '--export') {
      opts.exportName = argv[++i]
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/import-exported-assets.mjs [--root <plugin-root>] [--export <export-dir-or-name>]')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return opts
}

function resolveExportRoot(root, exportName) {
  if (isAbsolute(exportName)) return exportName
  if (exportName.includes('/') || exportName.includes('\\')) return resolve(root, exportName)
  return join(root, 'materials', exportName)
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function jsonValue(value) {
  return value == null ? null : JSON.stringify(value)
}

function readPngSize(buf, file) {
  const signature = '89504e470d0a1a0a'
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== signature || buf.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`Not a PNG file: ${file}`)
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function readAnchor(geometry) {
  const pivot = geometry && typeof geometry === 'object' ? geometry.pivot : null
  if (!Array.isArray(pivot) || pivot.length < 2) return { x: null, y: null }
  const [x, y] = pivot
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: null, y: null }
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA foreign_keys = ON;

    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      zone TEXT NOT NULL,
      blob_sha256 TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      width_px INTEGER,
      height_px INTEGER,
      anchor_x REAL,
      anchor_y REAL,
      geometry_json TEXT
    );

    CREATE INDEX idx_assets_zone_alias ON assets(zone, alias);
    CREATE INDEX idx_assets_blob_sha256 ON assets(blob_sha256);

    CREATE TABLE blobs (
      sha256 TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      width_px INTEGER,
      height_px INTEGER
    );
  `)
}

function assertAsset(asset, index) {
  if (!asset || typeof asset !== 'object') throw new Error(`Invalid asset at index ${index}`)
  if (typeof asset.fileName !== 'string' || asset.fileName.length === 0) throw new Error(`Asset ${index} is missing fileName`)
  if (typeof asset.exportPath !== 'string' || asset.exportPath.length === 0) throw new Error(`Asset ${asset.fileName} is missing exportPath`)
}

function buildStore({ root, exportRoot, storeDir, tempDir }) {
  const metaPath = join(exportRoot, 'meta.json')
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
  if (!Array.isArray(meta.assets)) throw new Error(`meta.json has no assets array: ${metaPath}`)

  rmSync(tempDir, { recursive: true, force: true })
  mkdirSync(join(tempDir, 'blobs'), { recursive: true })
  writeFileSync(join(tempDir, '.gitignore'), '# SQLite WAL 临时文件（运行时产物，不追踪）\nlibrary.db-shm\nlibrary.db-wal\n')

  const dbPath = join(tempDir, 'library.db')
  const db = new Database(dbPath)
  createSchema(db)

  const insertAsset = db.prepare(`
    INSERT INTO assets (
      id, alias, zone, blob_sha256, mime_type, size_bytes, width_px, height_px, anchor_x, anchor_y,
      geometry_json
    ) VALUES (
      @id, @alias, @zone, @blob_sha256, @mime_type, @size_bytes, @width_px, @height_px, @anchor_x, @anchor_y,
      @geometry_json
    )
  `)
  const insertBlob = db.prepare(`
    INSERT OR IGNORE INTO blobs (sha256, mime_type, size_bytes, width_px, height_px)
    VALUES (@sha256, @mime_type, @size_bytes, @width_px, @height_px)
  `)

  let imported = 0
  const assets = meta.assets
    .map((asset, originalIndex) => ({ asset, originalIndex }))
    .sort((a, b) => String(a.asset.fileName).localeCompare(String(b.asset.fileName)) || String(a.asset.exportPath).localeCompare(String(b.asset.exportPath)) || a.originalIndex - b.originalIndex)
  const writeRows = db.transaction(() => {
    for (let i = 0; i < assets.length; i++) {
      const { asset, originalIndex } = assets[i]
      assertAsset(asset, i)
      const imagePath = isAbsolute(asset.exportPath) ? asset.exportPath : join(exportRoot, asset.exportPath)
      const bytes = readFileSync(imagePath)
      const digest = sha256(bytes)
      const { width, height } = readPngSize(bytes, imagePath)
      const anchor = readAnchor(asset.geometry)
      const blobPath = join(tempDir, 'blobs', digest.slice(0, 2), digest.slice(2, 4), digest)
      mkdirSync(dirname(blobPath), { recursive: true })
      writeFileSync(blobPath, bytes)

      insertBlob.run({
        sha256: digest,
        mime_type: 'image/png',
        size_bytes: bytes.length,
        width_px: width,
        height_px: height,
      })
      insertAsset.run({
        id: sha256(Buffer.from(`${asset.fileName}\0${asset.exportPath}\0${originalIndex}`)),
        alias: toRendererAlias(asset.fileName, asset.assetKind),
        zone: 'raw',
        blob_sha256: digest,
        mime_type: 'image/png',
        size_bytes: bytes.length,
        width_px: width,
        height_px: height,
        anchor_x: anchor.x,
        anchor_y: anchor.y,
        geometry_json: jsonValue(asset.geometry),
      })
      imported++
    }
  })

  try {
    writeRows()
    db.pragma('user_version = 20260604')
    db.pragma('optimize')
  } finally {
    db.close()
  }

  const expected = typeof meta.totalAssets === 'number' ? meta.totalAssets : assets.length
  if (imported !== expected) {
    throw new Error(`Imported ${imported} assets, expected ${expected}`)
  }

  rmSync(storeDir, { recursive: true, force: true })
  mkdirSync(dirname(storeDir), { recursive: true })
  renameSync(tempDir, storeDir)
  const legacyOverlay = applyLegacyAssetOverlays({
    root,
    storeDir,
    overlayPath: join(scriptRoot, 'materials', 'legacy-asset-overlays.json'),
  })

  return {
    imported,
    legacyImported: legacyOverlay.applied,
    dbBytes: statSync(join(storeDir, 'library.db')).size,
    storeDir,
    exportRoot,
  }
}

const opts = parseArgs(process.argv.slice(2))
const root = resolve(opts.root)
const exportRoot = resolveExportRoot(root, opts.exportName)
const storeDir = join(root, 'materials', 'asset-store')
const tempDir = join(root, 'materials', `.asset-store.tmp-${process.pid}`)

if (!existsSync(join(exportRoot, 'meta.json'))) {
  throw new Error(`Missing export meta.json at ${join(exportRoot, 'meta.json')}`)
}

try {
  const result = buildStore({ root, exportRoot, storeDir, tempDir })
  console.log(`[import-exported-assets] imported ${result.imported} assets`)
  if (result.legacyImported) console.log(`[import-exported-assets] applied ${result.legacyImported} legacy assets`)
  console.log(`[import-exported-assets] wrote ${result.storeDir}`)
  console.log(`[import-exported-assets] library.db ${result.dbBytes} bytes`)
} catch (err) {
  rmSync(tempDir, { recursive: true, force: true })
  console.error(`[import-exported-assets] failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
