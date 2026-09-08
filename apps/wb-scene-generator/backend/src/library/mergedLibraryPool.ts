/**
 * Renderer matching pool + asset bytes: base library ∪ project-private ∪ game sandbox.
 * Shared by GET /aliases-meta, scene-export/cook, and headless preview — all paths
 * must see prefab-imported tiles, not just the read-only base library.db rows.
 */
import { existsSync, readFileSync } from 'node:fs'
import { getActiveProjectDir, getProjectDir } from '../runtime.js'
import {
  gameSandboxAliasMetasForProjectDir,
  resolveGameSandboxBlobByAliasForProjectDir,
} from './gameSandboxStore.js'
import {
  filterPrivateAllZonesForProjectDir,
  filterPrivateForProjectDir,
  getPrivateByAliasForProjectDir,
  resolvePrivateBlobPath,
  type PrivateAssetRecord,
} from './privateStore.js'
import { deriveAliasMeta, getLibraryService, type AliasMeta } from './service.js'

export function privateToAliasMeta(r: PrivateAssetRecord): AliasMeta {
  return deriveAliasMeta({
    alias: r.alias,
    anchor_x: r.anchorX,
    anchor_y: r.anchorY,
    width_px: r.widthPx ?? null,
    height_px: r.heightPx ?? null,
    geometry_json: r.geometryJson ?? null,
  })
}

/** User sources (sandbox, then private) override base aliases on clash. */
export function mergeAliasMetas(base: AliasMeta[], userMetas: AliasMeta[]): AliasMeta[] {
  if (userMetas.length === 0) return base
  const overridden = new Set(userMetas.map((m) => m.alias))
  return [...userMetas, ...base.filter((m) => !overridden.has(m.alias))]
}

/** Full renderer matching pool for a zone (same as GET /library/aliases-meta). */
export async function listMergedAliasMetas(zone: string): Promise<AliasMeta[]> {
  return listMergedAliasMetasForProjectDir(await getActiveProjectDir(), zone)
}

/** Project-scoped matching pool — safe for parallel headless cooks. */
export async function listMergedAliasMetasForProject(projectId: string, zone: string): Promise<AliasMeta[]> {
  const projDir = await getProjectDir(projectId)
  if (!projDir) throw new Error(`project not found: ${projectId}`)
  return listMergedAliasMetasForProjectDir(projDir, zone)
}

export async function listMergedAliasMetasForProjectDir(projDir: string, zone: string): Promise<AliasMeta[]> {
  const svc = getLibraryService()
  const base = svc.listAliasesWithMeta(zone)
  const privMetas = filterPrivateForProjectDir(projDir, { zone }).map(privateToAliasMeta)
  const sandboxMetas = gameSandboxAliasMetasForProjectDir(projDir, zone)
  return mergeAliasMetas(base, [...sandboxMetas, ...privMetas])
}

/** Zone-agnostic renderer matching pool: base ∪ private (all zones except trash)
 *  ∪ game sandbox. A painted alias can live in any zone (e.g. after the base
 *  library was migrated raw→staging); matching must not be pinned to one zone. */
export async function listMergedAliasMetasAllZones(): Promise<AliasMeta[]> {
  return listMergedAliasMetasAllZonesForProjectDir(await getActiveProjectDir())
}

export function listMergedAliasMetasAllZonesForProjectDir(projDir: string): AliasMeta[] {
  const svc = getLibraryService()
  const base = svc.listAllAliasesWithMeta()
  const privSeen = new Set<string>()
  const privMetas: AliasMeta[] = []
  for (const r of filterPrivateAllZonesForProjectDir(projDir)) {
    if (privSeen.has(r.alias)) continue // an alias in >1 private zone → keep first
    privSeen.add(r.alias)
    privMetas.push(privateToAliasMeta(r))
  }
  const sandboxMetas = gameSandboxAliasMetasForProjectDir(projDir, 'raw')
  return mergeAliasMetas(base, [...sandboxMetas, ...privMetas])
}

export interface ResolvedAssetContent {
  bytes: Buffer
  mimeType: string
  widthPx?: number
  heightPx?: number
}

function resolvePrivateAssetContent(
  projDir: string,
  priv: PrivateAssetRecord,
): ResolvedAssetContent | null {
  const path = resolvePrivateBlobPath(projDir, priv.blobSha256)
  if (!existsSync(path)) return null
  return {
    bytes: readFileSync(path),
    mimeType: priv.mimeType,
    ...(priv.widthPx !== undefined ? { widthPx: priv.widthPx } : {}),
    ...(priv.heightPx !== undefined ? { heightPx: priv.heightPx } : {}),
  }
}

/** Resolve PNG bytes: base library → project-private → game sandbox. */
export async function resolveMergedAssetContent(alias: string): Promise<ResolvedAssetContent | null> {
  return resolveMergedAssetContentForProjectDir(await getActiveProjectDir(), alias)
}

/** Project-scoped asset bytes — safe for parallel headless cooks. */
export async function resolveMergedAssetContentForProject(
  projectId: string,
  alias: string,
): Promise<ResolvedAssetContent | null> {
  const projDir = await getProjectDir(projectId)
  if (!projDir) throw new Error(`project not found: ${projectId}`)
  return resolveMergedAssetContentForProjectDir(projDir, alias)
}

export async function resolveMergedAssetContentForProjectDir(
  projDir: string,
  alias: string,
): Promise<ResolvedAssetContent | null> {
  const svc = getLibraryService()
  const base = svc.resolveAssetContent(alias)
  if (base) return base

  const priv = getPrivateByAliasForProjectDir(projDir, alias)
  if (priv) {
    const content = resolvePrivateAssetContent(projDir, priv)
    if (content) return content
  }

  const sandbox = resolveGameSandboxBlobByAliasForProjectDir(projDir, alias)
  if (sandbox && existsSync(sandbox.path)) {
    return { bytes: readFileSync(sandbox.path), mimeType: sandbox.mimeType }
  }

  return null
}
