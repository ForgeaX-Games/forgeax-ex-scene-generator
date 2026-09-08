import { pluginFetch, pluginUrl } from '../api/pluginHttp'

export interface GeneratedAssetRecord {
  alias: string
  blobId: string
  relPath: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  name?: string
  prompt?: string
  nodeId?: string
  source?: string
  folder: string
  tags: string[]
  /** User-pinned favorite. A flag on the single record — favoriting never copies the asset. */
  favorite?: boolean
  /** Optional favorite sub-group; surfaced as a `__favorites__/<group>` rail sub-menu. */
  favoriteGroup?: string
  /** True for plugin-shipped preset assets (read-only, cannot be deleted/renamed). */
  readonly?: boolean
}

/** The card title: the editable display name, falling back to the alias. */
export function assetDisplayName(asset: GeneratedAssetRecord): string {
  return asset.name?.trim() || asset.alias
}

export async function listGeneratedAssets(folder?: string): Promise<GeneratedAssetRecord[]> {
  const qs = folder ? `?folder=${encodeURIComponent(folder)}` : ''
  const res = await pluginFetch(`/api/v1/generated-assets${qs}`)
  if (!res.ok) throw new Error(`list generated assets failed: ${res.status}`)
  const json = (await res.json()) as { items?: GeneratedAssetRecord[] }
  return json.items ?? []
}

export async function listGeneratedFolders(): Promise<Array<{ name: string; count: number }>> {
  const res = await pluginFetch('/api/v1/generated-assets/folders')
  if (!res.ok) throw new Error(`list generated folders failed: ${res.status}`)
  const json = (await res.json()) as { folders?: Array<{ name: string; count: number }> }
  return json.folders ?? []
}

/** Create an (empty) folder column: a new top-level menu or a one-level
 *  sub-menu (`parent/child`). Returns the normalized folder path. */
export async function createGeneratedFolder(path: string): Promise<string> {
  const res = await pluginFetch('/api/v1/generated-assets/folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!res.ok) throw new Error(`create folder failed: ${res.status}`)
  const json = (await res.json()) as { folder?: string }
  if (!json.folder) throw new Error('create folder failed: missing folder in response')
  return json.folder
}

/** Delete a folder column and every asset inside it (recursively). */
export async function deleteGeneratedFolder(path: string): Promise<string[]> {
  const res = await pluginFetch('/api/v1/generated-assets/folders/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!res.ok) throw new Error(`delete folder failed: ${res.status}`)
  const json = (await res.json()) as { deleted?: string[] }
  return json.deleted ?? []
}

export async function latestPreviewAsset(): Promise<GeneratedAssetRecord | null> {
  const res = await pluginFetch('/api/v1/preview/latest')
  if (!res.ok) throw new Error(`read latest preview failed: ${res.status}`)
  return (await res.json()) as GeneratedAssetRecord | null
}

export function generatedAssetUrl(alias: string): string {
  return pluginUrl(`/api/v1/generated-assets/blob/${encodeURIComponent(alias)}`)
}

export interface ImportUserAssetRequest {
  imageBase64: string
  mimeType?: string
  prompt?: string
  folder?: string
  source?: string
  tags?: string[]
}

export async function importUserAsset(req: ImportUserAssetRequest): Promise<GeneratedAssetRecord> {
  const res = await pluginFetch('/api/v1/generated-assets/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(`import asset failed: ${res.status}`)
  const json = (await res.json()) as { asset?: GeneratedAssetRecord }
  if (!json.asset) throw new Error('import asset failed: missing asset in response')
  return json.asset
}

export async function renameGeneratedAsset(alias: string, name: string): Promise<GeneratedAssetRecord> {
  const res = await pluginFetch(`/api/v1/generated-assets/${encodeURIComponent(alias)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`rename asset failed: ${res.status}`)
  const json = (await res.json()) as { asset?: GeneratedAssetRecord }
  if (!json.asset) throw new Error('rename asset failed: missing asset in response')
  return json.asset
}

export async function deleteGeneratedAsset(alias: string): Promise<void> {
  const res = await pluginFetch(`/api/v1/generated-assets/${encodeURIComponent(alias)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`delete asset failed: ${res.status}`)
}

export async function deleteGeneratedAssets(aliases: string[]): Promise<string[]> {
  if (aliases.length === 0) return []
  const res = await pluginFetch('/api/v1/generated-assets/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aliases }),
  })
  if (!res.ok) throw new Error(`delete assets failed: ${res.status}`)
  const json = (await res.json()) as { deleted?: string[] }
  return json.deleted ?? []
}

/** Move assets into another folder (physically relocates the backing files). */
export async function moveGeneratedAssets(aliases: string[], folder: string): Promise<string[]> {
  if (aliases.length === 0) return []
  const res = await pluginFetch('/api/v1/generated-assets/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aliases, folder }),
  })
  if (!res.ok) throw new Error(`move assets failed: ${res.status}`)
  const json = (await res.json()) as { moved?: string[] }
  return json.moved ?? []
}

/** Copy a single asset into a folder, creating an independent duplicate (paste). */
export async function copyAssetToFolder(alias: string, folder: string): Promise<GeneratedAssetRecord> {
  const res = await pluginFetch('/api/v1/generated-assets/copy-to-folder', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ alias, folder }),
  })
  if (!res.ok) throw new Error(`copy asset failed: ${res.status}`)
  const json = (await res.json()) as { asset?: GeneratedAssetRecord }
  if (!json.asset) throw new Error('copy asset failed: missing asset in response')
  return json.asset
}

/** Toggle/set an asset's favorite flag (never copies — flips a boolean on the record). */
export async function setAssetFavorite(alias: string, favorite: boolean): Promise<GeneratedAssetRecord> {
  const res = await pluginFetch(`/api/v1/generated-assets/${encodeURIComponent(alias)}/favorite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ favorite }),
  })
  if (!res.ok) throw new Error(`favorite asset failed: ${res.status}`)
  const json = (await res.json()) as { asset?: GeneratedAssetRecord }
  if (!json.asset) throw new Error('favorite asset failed: missing asset in response')
  return json.asset
}

/** Move assets into a favorite sub-group (group=null/'' ungroups; auto-favorites). */
export async function moveAssetsToFavoriteGroup(aliases: string[], group: string | null): Promise<string[]> {
  if (aliases.length === 0) return []
  const res = await pluginFetch('/api/v1/generated-assets/favorite-group', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aliases, group }),
  })
  if (!res.ok) throw new Error(`favorite-group move failed: ${res.status}`)
  const json = (await res.json()) as { updated?: string[] }
  return json.updated ?? []
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('failed to read file'))
    reader.readAsDataURL(file)
  })
}
