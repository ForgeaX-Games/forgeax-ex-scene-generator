import type { Battery } from '../../types.js'

export const BATTERY_POINTER_DROP_EVENT = 'forgeax:battery-pointer-drop'

interface ActivePointerDrag {
  battery: Battery
  presetText?: string
  pointerId: number
  source: HTMLElement
  startX: number
  startY: number
  moved: boolean
}

let activeDrag: ActivePointerDrag | null = null
let removeListeners: (() => void) | null = null

export interface BatteryPointerDropDetail {
  battery: Battery
  presetText?: string
  clientX: number
  clientY: number
}

/** Mac trackpads use the deterministic pointer path; other platforms keep native HTML5 DnD. */
export function shouldUseBatteryPointerDrag(): boolean {
  if (typeof navigator === 'undefined') return false
  const extendedNavigator = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = extendedNavigator.userAgentData?.platform || navigator.platform || ''
  return /Mac|iPhone|iPad|iPod/i.test(`${platform} ${navigator.userAgent}`)
}

/**
 * Track a press-and-move gesture for Apple/WebKit environments where native
 * HTML5 drag-and-drop races with text selection and may lose the final drop.
 * Pointer capture makes one gesture use one path from press through release.
 */
export function startBatteryPointerDrag(
  event: React.PointerEvent,
  battery: Battery,
  presetText?: string,
): void {
  if (!shouldUseBatteryPointerDrag()) return
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
  if ((event.target as Element | null)?.closest('button, input, textarea, select, a')) return

  cancelBatteryPointerDrag()
  event.preventDefault()
  event.stopPropagation()

  const source = event.currentTarget as HTMLElement
  try {
    source.setPointerCapture(event.pointerId)
  } catch {
    // Pointer capture is an enhancement; window-level listeners still work.
  }
  document.documentElement.classList.add('battery-pointer-dragging')

  activeDrag = {
    battery,
    presetText,
    pointerId: event.pointerId,
    source,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  }

  const onPointerMove = (moveEvent: PointerEvent) => {
    if (!activeDrag || moveEvent.pointerId !== activeDrag.pointerId) return
    const dx = moveEvent.clientX - activeDrag.startX
    const dy = moveEvent.clientY - activeDrag.startY
    if (Math.hypot(dx, dy) >= 6) {
      activeDrag.moved = true
      // The native drag gesture did not win, so WebKit would otherwise select
      // the battery name while the pointer travels toward the canvas.
      moveEvent.preventDefault()
      window.getSelection()?.removeAllRanges()
    }
  }

  const onPointerUp = (upEvent: PointerEvent) => {
    if (!activeDrag || upEvent.pointerId !== activeDrag.pointerId) return
    const drag = activeDrag
    const dropTarget = document.elementFromPoint(upEvent.clientX, upEvent.clientY)
    const droppedOnCanvas = dropTarget?.closest('.canvas, .react-flow__pane')

    cancelBatteryPointerDrag()

    if (!drag.moved || !droppedOnCanvas) return

    upEvent.preventDefault()
    window.dispatchEvent(new CustomEvent<BatteryPointerDropDetail>(BATTERY_POINTER_DROP_EVENT, {
      detail: {
        battery: drag.battery,
        ...(drag.presetText !== undefined ? { presetText: drag.presetText } : {}),
        clientX: upEvent.clientX,
        clientY: upEvent.clientY,
      },
    }))
  }

  const onPointerCancel = (cancelEvent: PointerEvent) => {
    if (!activeDrag || cancelEvent.pointerId !== activeDrag.pointerId) return
    cancelBatteryPointerDrag()
  }

  window.addEventListener('pointermove', onPointerMove, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('pointercancel', onPointerCancel, true)
  removeListeners = () => {
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('pointercancel', onPointerCancel, true)
  }
}

/** Cancel an unfinished pointer gesture and restore the normal cursor. */
export function cancelBatteryPointerDrag(): void {
  if (activeDrag) {
    try {
      if (activeDrag.source.hasPointerCapture(activeDrag.pointerId)) {
        activeDrag.source.releasePointerCapture(activeDrag.pointerId)
      }
    } catch {
      // The browser may already have released capture during pointercancel.
    }
  }
  removeListeners?.()
  removeListeners = null
  activeDrag = null
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('battery-pointer-dragging')
  }
}
