import { workbenchTargetOrigin } from '../../workbench/protocol.js'

export const DEFAULT_STUDIO_ASSET_DIRECTORY = 'assets/3d'

export function normalizeStudioAssetDirectory(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(trimmed)) {
    throw new Error('Destination directory must be project-relative.')
  }
  const value = trimmed.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '') || DEFAULT_STUDIO_ASSET_DIRECTORY
  const segments = value.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error('Destination directory must not contain . or .. segments.')
  }
  return segments.join('/')
}

export function normalizeStudioGlbFilename(raw: string): string {
  const stem = (raw.trim().split(/[\\/]/u).at(-1) ?? '')
    .replace(/\.glb$/iu, '')
    .replace(/[^a-zA-Z0-9._-]/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^[._]+|[._]+$/gu, '')
  if (!stem) throw new Error('Enter a valid GLB filename.')
  return `${stem}.glb`
}

export function createStudioImportRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `scene-glb-import-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000_000).toString(36)}`
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function requestDirectStudioImport(input: {
  requestId: string
  directory: string
  name: string
  base64: string
}): Promise<unknown> {
  const parent = window.parent
  if (!parent || parent === window) {
    return Promise.reject(new Error('Open Scene Generator in Studio before importing a GLB.'))
  }
  const origin = workbenchTargetOrigin()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('Studio did not respond to the GLB import request.'))
    }, 120_000)
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== origin || event.source !== parent) return
      const data = event.data as {
        type?: unknown
        requestId?: unknown
        ok?: unknown
        result?: unknown
        error?: unknown
      } | null
      if (!data || data.type !== 'workbench:renderer-direct-import-result' || data.requestId !== input.requestId) return
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
      if (data.ok === true) resolve(data.result)
      else reject(new Error(typeof data.error === 'string' ? data.error : 'Studio asset import failed.'))
    }
    window.addEventListener('message', onMessage)
    parent.postMessage({ type: 'workbench:renderer-direct-import', ...input }, origin)
  })
}
