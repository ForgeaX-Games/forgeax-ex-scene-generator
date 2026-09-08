// 💡 Plugin GLB object-model HTTP client — separate from Asset Store / PBR materials.

export interface ObjectModelSummary {
  name: string
  targetHeightCells: number
  category: string
  tags: string[]
  fileUrl: string
}

export interface ObjectModelDetail extends ObjectModelSummary {
  file: string
}

export async function listObjectModels(): Promise<ObjectModelSummary[]> {
  const r = await fetch('/api/v1/models')
  if (!r.ok) throw new Error(`/api/v1/models → ${r.status}`)
  const body = (await r.json()) as { items?: ObjectModelSummary[] }
  return Array.isArray(body.items) ? body.items : []
}

export async function fetchObjectModel(name: string): Promise<ObjectModelDetail | null> {
  if (!name) return null
  const r = await fetch(`/api/v1/models/${encodeURIComponent(name)}`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`/api/v1/models/${name} → ${r.status}`)
  return (await r.json()) as ObjectModelDetail
}

export function objectModelFileUrl(name: string): string {
  return `/api/v1/models/${encodeURIComponent(name)}/file`
}
