import { useCallback, useRef, useState, type CSSProperties, type RefObject } from 'react'

// Resize the section directly above a drag handle; spill compresses sections further
// up (in stack order). Pair with usePanelDragMinHeight so upper titles stay put
// while the handle follows the pointer.

export function applySectionDragDelta<K extends string>(
  heights: Record<K, number>,
  order: readonly K[],
  targetKey: K,
  dy: number,
  minFor: (key: K) => number,
): Record<K, number> {
  const start = order.indexOf(targetKey)
  if (start < 0 || dy === 0) return heights

  let remaining = dy
  const next = { ...heights }

  for (let i = start; i >= 0 && remaining !== 0; i--) {
    const key = order[i]!
    const min = minFor(key)
    const cur = next[key]
    const proposed = cur + remaining
    if (proposed >= min) {
      next[key] = proposed
      remaining = 0
    } else {
      next[key] = min
      remaining = proposed - min
    }
  }

  return next
}

/** Lock panel min-height at drag start so the stack never shrinks during a drag. */
export function usePanelDragMinHeight(panelRef: RefObject<HTMLElement | null>): {
  panelStyle: CSSProperties
  onDragStart: () => void
} {
  const dragMinHRef = useRef<number | null>(null)
  const [dragMinH, setDragMinH] = useState<number | null>(null)

  const onDragStart = useCallback(() => {
    const el = panelRef.current
    const h = el ? el.scrollHeight : 0
    dragMinHRef.current = h
    setDragMinH(h)
  }, [panelRef])

  const activeMinH = dragMinHRef.current ?? dragMinH
  const panelStyle: CSSProperties = activeMinH != null ? { minHeight: activeMinH } : {}

  return { panelStyle, onDragStart }
}
