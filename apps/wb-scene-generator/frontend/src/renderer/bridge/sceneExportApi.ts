import { pluginFetch } from '../../api/pluginHttp'

const JSON_HEADERS = { 'content-type': 'application/json' }

export interface SceneExportCookResult {
  bundleId: string
  zipPath: string
  unpackedDir: string
  downloadUrl: string
  warnings: string[]
}

async function parseError(response: Response, fallbackUrl: string): Promise<Error> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return new Error(body.error)
  } catch {
    // Fall through to the status-based error below.
  }
  return new Error(`${fallbackUrl} -> ${response.status}`)
}

function readRequiredString(body: Record<string, unknown>, field: keyof SceneExportCookResult): string {
  const value = body[field]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`scene export response missing ${field}`)
  return value
}

function parseCookResult(body: unknown): SceneExportCookResult {
  if (!body || typeof body !== 'object') throw new Error('scene export response must be an object')
  const record = body as Record<string, unknown>
  return {
    bundleId: readRequiredString(record, 'bundleId'),
    zipPath: readRequiredString(record, 'zipPath'),
    unpackedDir: readRequiredString(record, 'unpackedDir'),
    downloadUrl: readRequiredString(record, 'downloadUrl'),
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((w): w is string => typeof w === 'string') : [],
  }
}

export const sceneExportApi = {
  async cook(): Promise<SceneExportCookResult> {
    const url = '/api/v1/scene-export/cook'
    const response = await pluginFetch(url, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    })
    if (!response.ok) throw await parseError(response, url)
    return parseCookResult(await response.json())
  },
}
