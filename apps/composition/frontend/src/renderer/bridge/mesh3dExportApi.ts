const JSON_HEADERS = { 'content-type': 'application/json' }

export interface Mesh3dExportCookResult {
  sceneId: string
  gameSlug: string
  sceneDir: string
  metaPath: string
  relativeDir: string
  projectRelativeDir: string
  projectId: string
  sceneName: string
  warnings: string[]
}

async function parseError(response: Response, fallbackUrl: string): Promise<Error> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return new Error(body.error)
  } catch {
    // Fall through.
  }
  return new Error(`${fallbackUrl} -> ${response.status}`)
}

function readRequiredString(body: Record<string, unknown>, field: keyof Mesh3dExportCookResult): string {
  const value = body[field]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`mesh3d export response missing ${field}`)
  return value
}

function parseCookResult(body: unknown): Mesh3dExportCookResult {
  if (!body || typeof body !== 'object') throw new Error('mesh3d export response must be an object')
  const record = body as Record<string, unknown>
  return {
    sceneId: readRequiredString(record, 'sceneId'),
    gameSlug: readRequiredString(record, 'gameSlug'),
    sceneDir: readRequiredString(record, 'sceneDir'),
    metaPath: readRequiredString(record, 'metaPath'),
    relativeDir: readRequiredString(record, 'relativeDir'),
    projectRelativeDir: readRequiredString(record, 'projectRelativeDir'),
    projectId: readRequiredString(record, 'projectId'),
    sceneName: readRequiredString(record, 'sceneName'),
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((w): w is string => typeof w === 'string') : [],
  }
}

export const mesh3dExportApi = {
  async cook(body: { gameSlug?: string; sceneName?: string; sceneId?: string } = {}): Promise<Mesh3dExportCookResult> {
    const url = '/api/v1/mesh3d-export/cook'
    const response = await fetch(url, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    })
    if (!response.ok) throw await parseError(response, url)
    return parseCookResult(await response.json())
  },
}
