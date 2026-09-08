import type { Battery } from '../../types.js'

// Safari/WebKit may discard custom DataTransfer MIME types while still
// preserving text/plain. Keep this payload small for catalog batteries; the
// canvas can resolve the exact row from the catalog key without serializing a
// potentially large icon payload.
export const BATTERY_TEXT_DRAG_PREFIX = 'forgeax-battery:'

interface BatteryTextDragData {
  id?: string
  key?: string
  battery?: Battery
  presetText?: string
}

export interface BatteryDragPayloadOptions {
  battery: Battery
  catalogKey?: string
  presetText?: string
}

/**
 * Write the legacy application/* payloads and a WebKit-safe text/plain
 * fallback. The fallback is written first so a browser that rejects a custom
 * MIME type still leaves a usable drag payload behind.
 */
export function writeBatteryDragPayload(
  dataTransfer: DataTransfer,
  { battery, catalogKey, presetText }: BatteryDragPayloadOptions,
): void {
  const fallback: BatteryTextDragData = catalogKey
    ? { id: battery.id, key: catalogKey }
    : { battery }
  if (presetText !== undefined) fallback.presetText = presetText

  try {
    dataTransfer.setData('text/plain', `${BATTERY_TEXT_DRAG_PREFIX}${JSON.stringify(fallback)}`)
  } catch {
    // The native drag operation can still continue with the legacy payload.
  }

  try {
    if (catalogKey) {
      dataTransfer.setData('application/battery-id', battery.id)
      dataTransfer.setData('application/battery-key', catalogKey)
    } else {
      dataTransfer.setData('application/battery', JSON.stringify(battery))
    }
    if (presetText !== undefined) {
      dataTransfer.setData('application/preset-text', presetText)
    }
  } catch {
    // Some WebKit versions reject application/* types. text/plain above is the
    // intentional fallback, so do not cancel the drag when that happens.
  }
}

export function readBatteryTextDragPayload(value: string): BatteryTextDragData | null {
  if (!value.startsWith(BATTERY_TEXT_DRAG_PREFIX)) return null

  try {
    const parsed: unknown = JSON.parse(value.slice(BATTERY_TEXT_DRAG_PREFIX.length))
    if (!parsed || typeof parsed !== 'object') return null

    const data = parsed as Record<string, unknown>
    return {
      id: typeof data.id === 'string' ? data.id : undefined,
      key: typeof data.key === 'string' ? data.key : undefined,
      battery: data.battery && typeof data.battery === 'object'
        ? data.battery as Battery
        : undefined,
      presetText: typeof data.presetText === 'string' ? data.presetText : undefined,
    }
  } catch {
    return null
  }
}
