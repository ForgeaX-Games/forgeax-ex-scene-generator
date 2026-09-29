import { pluginFetch } from '../../api/pluginHttp'

const JSON_HEADERS = { 'content-type': 'application/json' }

/** One `SCENE_*` diagnostic from the run the pack was built from. */
export interface PackExportDiagnostic {
  severity: string
  code: string
  message: string
}

export interface PackExportResult {
  projectName: string
  gameSlug: string
  /** Absolute directory the pack was written to. */
  path: string
  /** Same directory, relative to the game root. */
  relPath: string
  packFile: string
  /** Paste into the game's `forge.json` `defaultScene`. */
  sceneGuid: string
  entityCount: number
  meshCount: number
  vertexCount: number
  triangleCount: number
  fileCount: number
  bytes: number
  /** Re-running the emitted closure standalone — what the pack costs at module init. */
  verifyMs: number
  diagnostics: PackExportDiagnostic[]
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

export const enginePackApi = {
  async cook(options: { gameSlug?: string } = {}): Promise<PackExportResult> {
    const url = '/api/v1/pack-export/cook'
    const response = await pluginFetch(url, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(options),
    })
    if (!response.ok) throw await parseError(response, url)
    return await response.json() as PackExportResult
  },
}
