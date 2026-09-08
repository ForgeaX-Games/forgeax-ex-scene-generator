import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Battery } from '../types.js'
import {
  BATTERY_POINTER_DROP_EVENT,
  cancelBatteryPointerDrag,
  shouldUseBatteryPointerDrag,
  startBatteryPointerDrag,
  type BatteryPointerDropDetail,
} from '../components/sidebar/batteryPointerDrag.js'

const battery: Battery = {
  id: 'number_value',
  name: 'Number',
  type: 'ts',
  category: 'common',
  description: '',
  version: '1.0.0',
  inputs: [],
  outputs: [],
  params: [],
}

function pointerEvent(type: string, values: Record<string, number>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  return event
}

afterEach(() => {
  cancelBatteryPointerDrag()
  vi.restoreAllMocks()
  delete (document as unknown as { elementFromPoint?: Document['elementFromPoint'] }).elementFromPoint
})

describe('Mac battery pointer drag', () => {
  it('is selected only on Apple platforms', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')
    expect(shouldUseBatteryPointerDrag()).toBe(true)

    vi.restoreAllMocks()
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Win32')
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Windows')
    expect(shouldUseBatteryPointerDrag()).toBe(false)
  })

  it('captures one gesture and emits one canvas drop', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')

    const source = document.createElement('div')
    source.setPointerCapture = vi.fn()
    source.hasPointerCapture = vi.fn(() => true)
    source.releasePointerCapture = vi.fn()
    const canvas = document.createElement('div')
    canvas.className = 'canvas'
    document.body.append(source, canvas)
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => canvas),
    })

    let detail: BatteryPointerDropDetail | undefined
    window.addEventListener(BATTERY_POINTER_DROP_EVENT, ((event: CustomEvent<BatteryPointerDropDetail>) => {
      detail = event.detail
    }) as EventListener, { once: true })

    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    startBatteryPointerDrag({
      isPrimary: true,
      pointerType: 'mouse',
      button: 0,
      pointerId: 7,
      clientX: 10,
      clientY: 20,
      target: source,
      currentTarget: source,
      preventDefault,
      stopPropagation,
    } as unknown as React.PointerEvent, battery)

    window.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 30, clientY: 40 }))
    window.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: 80, clientY: 90 }))

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(source.setPointerCapture).toHaveBeenCalledWith(7)
    expect(detail).toEqual({ battery, clientX: 80, clientY: 90 })
    expect(document.documentElement).not.toHaveClass('battery-pointer-dragging')
    source.remove()
    canvas.remove()
  })
})
