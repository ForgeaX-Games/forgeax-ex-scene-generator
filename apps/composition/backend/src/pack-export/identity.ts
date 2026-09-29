import { createHash } from 'node:crypto'

/**
 * Pack identity derived from the project, so re-exporting the same project
 * keeps the same GUIDs without storing any manifest state.
 *
 * `definePackageId` validates against the engine's plain UUID shape
 * (`packages/pack/src/guid.ts` `UUID_RE`) — no version or variant bits — so the
 * first 16 bytes of sha256(projectId), formatted, is an accepted package id.
 */
export function derivePackageUuid(projectId: string): string {
  const hex = createHash('sha256').update(`forgeax-scene-generator:${projectId}`).digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/** One `PACK_SOURCE_KEY_RE` segment, also used as the on-disk directory name. */
export function safeSlug(name: string, fallback: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9._-]+$/, '')
    .slice(0, 120)
  return cleaned || fallback
}

/**
 * The engine's `AssetGuid.derive`, reproduced so the UI can show the scene GUID
 * without depending on the engine: UUIDv5 over `packageIdBytes || utf8(sourceKey)`
 * — see `packages/pack/src/guid.ts` `derivedGuid`.
 */
export function deriveAssetGuid(packageUuid: string, sourceKey: string): string {
  const namespace = Buffer.from(packageUuid.replaceAll('-', ''), 'hex')
  const digest = createHash('sha1').update(Buffer.concat([namespace, Buffer.from(sourceKey, 'utf8')])).digest()
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-')
}
