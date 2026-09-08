import { describe, expect, it } from 'vitest'
import type { Battery } from '../types.js'
import {
  BATTERY_TEXT_DRAG_PREFIX,
  readBatteryTextDragPayload,
  writeBatteryDragPayload,
} from '../components/sidebar/batteryDragPayload.js'

const battery: Battery = {
  id: 'text_panel',
  name: 'Text Panel',
  type: 'special',
  category: 'scene',
  description: '',
  version: '1.0.0',
  inputs: [],
  outputs: [],
  params: [],
}

function mockDataTransfer(rejectApplicationTypes = false) {
  const values: Record<string, string> = {}
  const dataTransfer = {
    setData(type: string, value: string) {
      if (rejectApplicationTypes && type.startsWith('application/')) throw new Error('WebKit custom MIME rejected')
      values[type] = value
    },
    getData(type: string) {
      return values[type] ?? ''
    },
  }
  return { values, dataTransfer: dataTransfer as unknown as DataTransfer }
}

describe('battery drag payload', () => {
  it('keeps the exact catalog key in the text fallback', () => {
    const { values, dataTransfer } = mockDataTransfer()
    writeBatteryDragPayload(dataTransfer, { battery, catalogKey: 'batteries/templates/scene/text.json' })

    expect(values['text/plain']).toBe(
      `${BATTERY_TEXT_DRAG_PREFIX}${JSON.stringify({ id: battery.id, key: 'batteries/templates/scene/text.json' })}`,
    )
    expect(readBatteryTextDragPayload(values['text/plain'])).toEqual({
      id: battery.id,
      key: 'batteries/templates/scene/text.json',
      battery: undefined,
      presetText: undefined,
    })
  })

  it('still writes a usable fallback when WebKit rejects application/* types', () => {
    const { values, dataTransfer } = mockDataTransfer(true)
    writeBatteryDragPayload(dataTransfer, { battery, presetText: 'hello\nworld' })

    expect(readBatteryTextDragPayload(values['text/plain'])).toEqual({
      id: undefined,
      key: undefined,
      battery,
      presetText: 'hello\nworld',
    })
  })

  it('does not interpret ordinary text as a battery payload', () => {
    expect(readBatteryTextDragPayload('hello')).toBeNull()
  })
})
