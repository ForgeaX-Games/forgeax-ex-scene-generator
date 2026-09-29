const RAW_BASE =
  (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'

/**
 * Entry launcher embeds authoringes at `/__fx/<projectId>/`. When Vite `base` is
 * `./` (dev default), absolute `/api` and `/ws` calls must include this prefix
 * so the launcher routes them to the correct Vite proxy — not to a stale
 * `launcher_fx` cookie or a missing Referer (both yield 404 and silent persist loss).
 */
export function launcherFxPrefixFromPathname(pathname: string): string {
  const m = pathname.match(/^(\/__fx\/[^/]+)/)
  return m?.[1] ?? ''
}

export function isHostExtensionPathname(pathname: string): boolean {
  return pathname.startsWith('/extensions/')
}

function basePrefix(): string {
  // Explicit Vite base (Studio proxy path or dist subpath) wins.
  if (RAW_BASE && RAW_BASE !== './' && RAW_BASE !== '/') {
    return RAW_BASE.replace(/\/$/, '')
  }
  // Dev default (`base: ./`) or root: infer Entry launcher embed prefix at runtime.
  if (typeof location === 'undefined') return ''
  return launcherFxPrefixFromPathname(location.pathname)
}

export function pluginBasePath(): string {
  return basePrefix()
}

function hostBridgedPath(path: string): string {
  if (typeof location === 'undefined' || !isHostExtensionPathname(location.pathname)) return path
  // Keep /api/v1 on the Studio origin (host already proxies it to :9557).
  // /ws is the Studio session socket; the host bridges /ws/editor to :9557.
  if (path === '/ws' || path.startsWith('/ws?')) return '/ws/editor'
  return path
}

export function pluginUrl(path: string): string {
  if (/^(?:https?:|blob:|data:)/.test(path)) return path
  if (!path.startsWith('/')) return path
  const bridged = hostBridgedPath(path)
  if (typeof location !== 'undefined' && isHostExtensionPathname(location.pathname)) return bridged
  const prefix = basePrefix()
  if (!prefix || bridged === prefix || bridged.startsWith(`${prefix}/`)) return bridged
  return `${prefix}${bridged}`
}

export function pluginFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(pluginUrl(input), init)
}

export function pluginWsUrl(path = '/ws', baseUrl?: string): string {
  const url = baseUrl ? pluginUrl(`${baseUrl.replace(/\/$/, '')}${path}`) : pluginUrl(path)
  const absolute = url.startsWith('http') ? url : `${location.origin}${url.startsWith('/') ? '' : '/'}${url}`
  return absolute.replace(/^http/, 'ws')
}
