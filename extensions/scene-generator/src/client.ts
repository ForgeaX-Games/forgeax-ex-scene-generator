export interface ExtensionContext {
  projectRoot: string
  stateDir: string
  packageVersion: string
}

export interface Configuration {
  baseUrl: string
}

export function configuration(value: unknown): Configuration {
  const baseUrl = (value as Configuration | null)?.baseUrl
  if (typeof baseUrl !== 'string') throw new Error('scene_config_invalid: the configured local API origin is missing')
  if (!URL.canParse(baseUrl)) throw new Error('scene_config_invalid: base URL must be a valid HTTP origin')
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('scene_config_invalid: base URL must be a loopback HTTP origin without credentials')
  }
  return { baseUrl: url.origin }
}

export async function request(config: Configuration, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forgeax-caller-kind': 'extension',
      'x-forgeax-caller-extension-id': 'scene-generator',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
    redirect: 'error',
  }).catch(() => {
    throw new Error('scene_service_unavailable: the configured Scene Generator API did not respond; check its independent service')
  })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel()
    throw new Error('scene_service_invalid: expected the Scene Generator JSON API')
  }
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body!) {
    size += chunk.length
    if (size > 32 * 1024 * 1024) throw new Error('scene_response_too_large: response exceeds 32 MiB')
    chunks.push(chunk)
  }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!response.ok) {
    throw new Error(`scene_http_${response.status}: ${JSON.stringify(result)}`)
  }
  if (result?.valid === false || result?.ok === false || result?.verification?.ok === false ||
      ['failed', 'rejected', 'error'].includes(result?.status)) {
    throw new Error(`scene_operation_failed: ${JSON.stringify(result)}`)
  }
  return result
}

export async function inspectService(config: Configuration): Promise<unknown> {
  const health = await request(config, '/health')
  if (health?.status !== 'ok') throw new Error('scene_service_invalid: health status must be ok')
  const projects = await request(config, '/api/v1/projects?all=1')
  if (!Array.isArray(projects)) throw new Error('scene_service_invalid: project API must return an array')
  return { baseUrl: config.baseUrl, uiUrl: health.uiUrl ?? null, health, projectCount: projects.length }
}
