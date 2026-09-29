import { parseScenePort, type ScenePortValue } from '../../../../vendor/shared/types/scene/port.js'
import { hydrateBlobRefs } from '@forgeax/node-runtime-react'
import { flattenWire } from './flattenWire.js'

/**
 * Scene ports on the wire are a DataTree (`[{ path, items: [ScenePortValue] }]`).
 * `parseScenePort` restores scene-document/1 and legacy graph records.
 */
export function parseScenePortFromWire(raw: unknown): ScenePortValue | null {
  if (raw && typeof raw === 'object' && 'blobs' in raw && 'value' in raw) {
    const hydrated = hydrateBlobRefs((raw as { value: unknown }).value, (raw as { blobs?: Record<string, unknown> }).blobs)
    return parseScenePortFromWire(hydrated)
  }
  const direct = parseScenePort(raw)
  if (direct) return direct
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw && !('focus' in raw)) {
    return parseScenePortFromWire((raw as { value: unknown }).value)
  }
  for (const item of flattenWire(raw)) {
    const parsed = parseScenePort(item)
    if (parsed) return parsed
  }
  return null
}
