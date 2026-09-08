const RAW_BASE =
  (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'

/**
 * Entry launcher embeds workbenches at `/__fx/<projectId>/`. When Vite `base` is
 * `./` (dev default), absolute `/api` and `/ws` calls must include this prefix
 * so the launcher routes them to the correct Vite proxy — not to a stale
 * `launcher_fx` cookie or a missing Referer (both yield 404 and silent persist loss).
 */
export function launcherFxPrefixFromPathname(pathname: string): string {
  const m = pathname.match(/^(\/__fx\/[^/]+)/)
  return m?.[1] ?? ''
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

export function pluginUrl(path: string): string {
  if (/^(?:https?:|blob:|data:)/.test(path)) return path
  if (!path.startsWith('/')) return path
  const prefix = basePrefix()
  if (!prefix || path === prefix || path.startsWith(`${prefix}/`)) return path
  return `${prefix}${path}`
}

export function pluginFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(pluginUrl(input), init)
}

export function pluginWsUrl(path = '/ws'): string {
  const url = pluginUrl(path)
  const absolute = url.startsWith('http') ? url : `${location.origin}${url.startsWith('/') ? '' : '/'}${url}`
  return absolute.replace(/^http/, 'ws')
}
