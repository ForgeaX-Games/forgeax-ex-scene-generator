import { DEFAULT_ENGINE_ASSET_DIRECTORY } from './engine-import-contract'

export { DEFAULT_ENGINE_ASSET_DIRECTORY }

export function normalizeEngineAssetDirectory(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(trimmed)) throw new Error('目录必须是项目相对路径，不能使用绝对路径')
  const value = trimmed.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || DEFAULT_ENGINE_ASSET_DIRECTORY
  const segments = value.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error('目录必须是项目相对路径，不能包含 . 或 ..')
  }
  return segments.join('/')
}

export function normalizeEngineGlbFilename(raw: string): string {
  const value = raw.trim().split(/[\\/]/u).at(-1) ?? ''
  const stem = value.replace(/\.glb$/iu, '').replace(/[^a-zA-Z0-9._-]/gu, '_').replace(/_+/gu, '_').replace(/^[._]+|[._]+$/gu, '')
  if (!stem) throw new Error('请输入有效的 GLB 文件名')
  return `${stem}.glb`
}

export function createDirectImportRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // Fall through to the local, non-cryptographic correlation id.
  }
  return `lowpoly-import-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000_000).toString(36)}`
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return arrayBufferToBase64(await blob.arrayBuffer())
}

export interface DirectEngineImportRequest {
  requestId: string
  directory: string
  name: string
  base64: string
}

export function requestDirectEngineImport(input: DirectEngineImportRequest): Promise<unknown> {
  const parent = window.parent
  if (!parent || parent === window) {
    return Promise.reject(new Error('请在 Studio 工作台中打开 3D Lowpoly Generator 后再导入引擎'))
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('Editor 没有在规定时间内响应导入请求'))
    }, 120_000)

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== parent) return
      const data = event.data as {
        type?: unknown
        requestId?: unknown
        ok?: unknown
        result?: unknown
        error?: unknown
      } | null
      if (!data || data.type !== 'workbench:viewer-direct-import-result' || data.requestId !== input.requestId) return
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
      if (data.ok === true) resolve(data.result)
      else reject(new Error(typeof data.error === 'string' ? data.error : 'Editor asset import failed'))
    }

    window.addEventListener('message', onMessage)
    parent.postMessage({ type: 'workbench:viewer-direct-import', ...input }, '*')
  })
}
