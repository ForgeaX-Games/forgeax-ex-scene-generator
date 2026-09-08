import { parseScenePort, type ScenePortValue } from '../../../../vendor/shared/types/scene/port.js'
import { flattenWire } from './flattenWire.js'

/**
 * Scene ports on the wire are a DataTree (`[{ path, items: [ScenePortValue] }]`).
 * `parseScenePort` only accepts `{ graph, focus }`. Peel one DataTree level.
 */
export function parseScenePortFromWire(raw: unknown): ScenePortValue | null {
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
