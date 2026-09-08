#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(scriptRoot, 'backend', 'package.json'))
const Database = require('better-sqlite3')

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function readPngSize(buf, label) {
  const signature = '89504e470d0a1a0a'
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== signature || buf.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`Legacy overlay blob is not a PNG: ${label}`)
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function jsonValue(value) {
  return value == null ? null : JSON.stringify(value)
}

const NON_TILE_KINDS = new Set(['', 'asset', 'object', '抠图'])

/**
 * Old 13-field export alias → new 12-field renderer alias:
 * drops 大区域(idx2)/小区域(idx3), inserts a blank 材质 after 物体名, and folds
 * the rule (asset_kind) into the type field (idx 7). Non-bracketed filenames
 * pass through. Keep in sync with backend composeRendererAlias / deriveAliasMeta.
 */
export function toRendererAlias(fileName, assetKind) {
  const f = [...String(fileName).matchAll(/\[([^\]]*)\]/g)].map((m) => m[1].trim())
  if (f.length < 13) return fileName
  const ak = (assetKind ?? '').trim()
  const type7 = NON_TILE_KINDS.has(ak) ? 'asset' : ak
  const nf = [f[0], f[1], f[4], '', f[5], f[6], f[7], type7, f[9], f[10], f[11], f[12]]
  return nf.map((x) => `[${x}]`).join('_') + '.png'
}

function parseArgs(argv) {
  const opts = { root: process.cwd(), overlayPath: join(scriptRoot, 'materials', 'legacy-asset-overlays.json') }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root') {
      opts.root = argv[++i]
    } else if (arg === '--overlay') {
      opts.overlayPath = argv[++i]
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/legacy-asset-overlays.mjs [--root <plugin-root>] [--overlay <json>]')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return opts
}

function assertAsset(asset, index) {
  for (const key of ['id', 'alias', 'zone', 'blobSha256', 'mimeType', 'blobBase64']) {
    if (typeof asset[key] !== 'string' || asset[key].length === 0) {
      throw new Error(`Legacy overlay asset ${index} is missing ${key}`)
    }
  }
  if (!Number.isInteger(asset.sizeBytes) || asset.sizeBytes <= 0) {
    throw new Error(`Legacy overlay asset ${asset.alias} has invalid sizeBytes`)
  }
}

export function applyLegacyAssetOverlays({
  root,
  storeDir = join(root, 'materials', 'asset-store'),
  overlayPath = join(scriptRoot, 'materials', 'legacy-asset-overlays.json'),
} = {}) {
  const resolvedRoot = resolve(root ?? process.cwd())
  const resolvedStoreDir = resolve(storeDir)
  const resolvedOverlayPath = resolve(overlayPath)
  if (!existsSync(resolvedOverlayPath)) return { applied: 0, storeDir: resolvedStoreDir, overlayPath: resolvedOverlayPath }

  const dbPath = join(resolvedStoreDir, 'library.db')
  if (!existsSync(dbPath)) throw new Error(`Missing asset-store library.db at ${dbPath}`)

  const manifest = JSON.parse(readFileSync(resolvedOverlayPath, 'utf-8'))
  if (!Array.isArray(manifest.assets)) throw new Error(`Legacy overlay manifest has no assets array: ${resolvedOverlayPath}`)

  const db = new Database(dbPath)
  const insertBlob = db.prepare(`
    INSERT INTO blobs (sha256, mime_type, size_bytes, width_px, height_px)
    VALUES (@sha256, @mime_type, @size_bytes, @width_px, @height_px)
    ON CONFLICT(sha256) DO UPDATE SET
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      width_px = excluded.width_px,
      height_px = excluded.height_px
  `)
  const insertAsset = db.prepare(`
    INSERT INTO assets (
      id, alias, zone, blob_sha256, mime_type, size_bytes, width_px, height_px, anchor_x, anchor_y,
      geometry_json
    ) VALUES (
      @id, @alias, @zone, @blob_sha256, @mime_type, @size_bytes, @width_px, @height_px, @anchor_x, @anchor_y,
      @geometry_json
    )
    ON CONFLICT(id) DO UPDATE SET
      alias = excluded.alias,
      zone = excluded.zone,
      blob_sha256 = excluded.blob_sha256,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      width_px = excluded.width_px,
      height_px = excluded.height_px,
      anchor_x = excluded.anchor_x,
      anchor_y = excluded.anchor_y,
      geometry_json = excluded.geometry_json
  `)

  let applied = 0
  const writeRows = db.transaction(() => {
    for (let i = 0; i < manifest.assets.length; i++) {
      const asset = manifest.assets[i]
      assertAsset(asset, i)

      const bytes = Buffer.from(asset.blobBase64, 'base64')
      const digest = sha256(bytes)
      if (digest !== asset.blobSha256) {
        throw new Error(`Legacy overlay ${asset.alias} sha mismatch: expected ${asset.blobSha256}, got ${digest}`)
      }
      if (bytes.length !== asset.sizeBytes) {
        throw new Error(`Legacy overlay ${asset.alias} size mismatch: expected ${asset.sizeBytes}, got ${bytes.length}`)
      }
      const { width, height } = readPngSize(bytes, asset.alias)
      if (asset.widthPx != null && width !== asset.widthPx) throw new Error(`Legacy overlay ${asset.alias} width mismatch`)
      if (asset.heightPx != null && height !== asset.heightPx) throw new Error(`Legacy overlay ${asset.alias} height mismatch`)

      const blobPath = join(resolvedStoreDir, 'blobs', digest.slice(0, 2), digest.slice(2, 4), digest)
      mkdirSync(dirname(blobPath), { recursive: true })
      writeFileSync(blobPath, bytes)

      insertBlob.run({
        sha256: digest,
        mime_type: asset.mimeType,
        size_bytes: bytes.length,
        width_px: width,
        height_px: height,
      })
      insertAsset.run({
        id: asset.id,
        alias: toRendererAlias(asset.alias, asset.assetKind),
        zone: asset.zone,
        blob_sha256: digest,
        mime_type: asset.mimeType,
        size_bytes: bytes.length,
        width_px: width,
        height_px: height,
        anchor_x: asset.anchorX ?? null,
        anchor_y: asset.anchorY ?? null,
        geometry_json: jsonValue(asset.geometry),
      })
      applied++
    }
  })

  try {
    writeRows()
    db.pragma('optimize')
  } finally {
    db.close()
  }

  return {
    applied,
    storeDir: resolvedStoreDir,
    overlayPath: resolvedOverlayPath,
    dbBytes: statSync(dbPath).size,
    root: resolvedRoot,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2))
    const result = applyLegacyAssetOverlays({ root: resolve(opts.root), overlayPath: opts.overlayPath })
    console.log(`[legacy-asset-overlays] applied ${result.applied} assets`)
    console.log(`[legacy-asset-overlays] wrote ${result.storeDir}`)
  } catch (err) {
    console.error(`[legacy-asset-overlays] failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
