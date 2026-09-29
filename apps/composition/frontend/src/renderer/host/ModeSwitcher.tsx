import { useRenderStore } from '../store'
import { VIEW_MODE_ORDER, type DrawMode } from '../types'

const DRAWS: DrawMode[] = ['wire', 'color', 'asset']

export function ModeSwitcher(): JSX.Element {
  // Selected individually — `useRenderStore()` with no selector subscribes to
  // the whole store and re-renders on every unrelated update (see RendererSurface.tsx).
  const viewMode = useRenderStore((s) => s.viewMode)
  const drawMode = useRenderStore((s) => s.drawMode)
  const setViewMode = useRenderStore((s) => s.setViewMode)
  const setDrawMode = useRenderStore((s) => s.setDrawMode)
  return (
    <div style={{ display: 'flex', gap: 8, padding: 6 }}>
      {VIEW_MODE_ORDER.map((m) => (
        <button key={m} aria-pressed={viewMode === m} onClick={() => setViewMode(m)}>
          {m === 'default' ? 'Default' : m}
        </button>
      ))}
      <span style={{ width: 12 }} />
      {DRAWS.map((d) => (
        <button key={d} aria-pressed={drawMode === d} onClick={() => setDrawMode(d)}>
          {d}
        </button>
      ))}
    </div>
  )
}
