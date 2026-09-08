// Tracks active pan/zoom on the ReactFlow canvas. Probe labels and other heavy
// per-edge overlays subscribe so they can unmount during viewport movement —
// ReactFlow re-renders every edge every zoom frame (screen-space coords change)
// even when wire values are unchanged; skipping overlays avoids re-walking large
// DataTree / scene payloads 60×/s while the user scrolls.
//
// Also drives viewportRefreshDefer so loadPipeline / output fan-out defer until
// pan/zoom stops (prevents multi-MB GET storms mid-gesture).
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import { setViewportMoving } from '../../utils/viewportRefreshDefer.js'
import { flushDeferredRefreshAfterViewport } from '../../stores/pipelineStore.js'

interface ViewportMovingContextValue {
  moving: boolean
  onMoveStart: () => void
  onMoveEnd: () => void
}

const ViewportMovingContext = createContext<ViewportMovingContextValue>({
  moving: false,
  onMoveStart: () => {},
  onMoveEnd: () => {},
})

export function useViewportMoving(): boolean {
  return useContext(ViewportMovingContext).moving
}

export function useViewportMoveHandlers(): Pick<ViewportMovingContextValue, 'onMoveStart' | 'onMoveEnd'> {
  const { onMoveStart, onMoveEnd } = useContext(ViewportMovingContext)
  return { onMoveStart, onMoveEnd }
}

export function ViewportMovingProvider({ children }: { children: ReactNode }) {
  const [moving, setMoving] = useState(false)
  const onMoveStart = useCallback(() => {
    setMoving(true)
    setViewportMoving(true)
  }, [])
  const onMoveEnd = useCallback(() => {
    setMoving(false)
    flushDeferredRefreshAfterViewport()
  }, [])
  const value = useMemo(
    () => ({ moving, onMoveStart, onMoveEnd }),
    [moving, onMoveStart, onMoveEnd],
  )
  return <ViewportMovingContext.Provider value={value}>{children}</ViewportMovingContext.Provider>
}
