import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeypointModel, KNode } from './parse.js'
import type { Positions } from './forceLayout.js'

interface Transform {
  k: number
  x: number
  y: number
}

const MIN_SCALE = 0.2
const MAX_SCALE = 4

/** Default (force-mode) radius heuristic, in layout units. */
function defaultRadius(node: KNode): number {
  return Math.max(8, Math.min(30, 8 + Math.sqrt(Math.max(0, node.area)) * 1.6))
}

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function contentBounds(
  model: KeypointModel,
  positions: Positions,
  radiusOf: (node: KNode) => number,
  labelMargin: number,
): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of model.nodes) {
    const p = positions[node.id]
    if (!p) continue
    const r = radiusOf(node) + labelMargin
    minX = Math.min(minX, p.x - r)
    minY = Math.min(minY, p.y - r)
    maxX = Math.max(maxX, p.x + r)
    maxY = Math.max(maxY, p.y + r)
  }
  if (!Number.isFinite(minX)) return { minX: -50, minY: -50, maxX: 50, maxY: 50 }
  return { minX, minY, maxX, maxY }
}

function fitTransform(bounds: Bounds, width: number, height: number): Transform {
  const contentW = Math.max(1, bounds.maxX - bounds.minX)
  const contentH = Math.max(1, bounds.maxY - bounds.minY)
  const k = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(width / contentW, height / contentH) * 0.9))
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return { k, x: width / 2 - cx * k, y: height / 2 - cy * k }
}

// Convert a screen (client) coordinate into the <svg> element's own user space.
// This uses the live screen CTM, so it stays correct even when the editor canvas
// itself is zoomed/panned (otherwise the zoom focal point drifts).
function clientToSvg(svg: SVGSVGElement | null, clientX: number, clientY: number): { x: number; y: number } {
  const ctm = svg?.getScreenCTM()
  if (!svg || !ctm) return { x: clientX, y: clientY }
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const p = pt.matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

interface EdgeGeometry {
  x1: number
  y1: number
  x2: number
  y2: number
}

// Endpoints trimmed to the node circles: start at the source circle edge, end a
// `gapTo` past the target circle edge so an arrow marker stays visible.
function trimmedEdge(
  a: { x: number; y: number },
  b: { x: number; y: number },
  rA: number,
  rB: number,
  gapTo: number,
): EdgeGeometry {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const startPad = Math.min(rA, len - 1)
  const endPad = Math.min(rB + gapTo, Math.max(0, len - startPad - 1))
  return {
    x1: a.x + ux * startPad,
    y1: a.y + uy * startPad,
    x2: b.x - ux * endPad,
    y2: b.y - uy * endPad,
  }
}

const ARROW_GAP = 7

export function KeypointGraphCanvas({
  model,
  positions,
  structureKey,
  selectedId,
  onSelect,
  radiusOf = defaultRadius,
  metric = false,
}: {
  model: KeypointModel
  positions: Positions
  /** changes only when the graph structure changes → triggers a re-fit */
  structureKey: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** node radius in layout units; defaults to the force-mode heuristic */
  radiusOf?: (node: KNode) => number
  /** metric mode (positions are meters); drops the world-space label margin */
  metric?: boolean
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [size, setSize] = useState({ width: 320, height: 200 })
  const [transform, setTransform] = useState<Transform>({ k: 1, x: 160, y: 100 })
  const lastFitKey = useRef<string>('')
  const drag = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null)
  const dragMoved = useRef(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = (): void => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const bounds = useMemo(
    () => contentBounds(model, positions, radiusOf, metric ? 0 : 18),
    [model, positions, radiusOf, metric],
  )

  // Re-fit when the structure changes or the container is first measured.
  useEffect(() => {
    const fitKey = `${structureKey}@${size.width}x${size.height}`
    if (lastFitKey.current === fitKey) return
    if (size.width <= 0 || size.height <= 0) return
    lastFitKey.current = fitKey
    setTransform(fitTransform(bounds, size.width, size.height))
  }, [structureKey, size.width, size.height, bounds])

  const nodeById = useMemo(() => {
    const m = new Map<string, (typeof model.nodes)[number]>()
    for (const n of model.nodes) m.set(n.id, n)
    return m
  }, [model.nodes])

  // Native non-passive wheel listener so preventDefault() actually blocks page
  // scroll (React's synthetic onWheel is passive).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const handler = (e: WheelEvent): void => {
      e.preventDefault()
      const { x: sx, y: sy } = clientToSvg(svgRef.current, e.clientX, e.clientY)
      setTransform((t) => {
        const factor = Math.exp(-e.deltaY * 0.0015)
        const k = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.k * factor))
        const worldX = (sx - t.x) / t.k
        const worldY = (sy - t.y) / t.k
        return { k, x: sx - worldX * k, y: sy - worldY * k }
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const onPointerDownBg = useCallback(
    (e: React.PointerEvent) => {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      const p = clientToSvg(svgRef.current, e.clientX, e.clientY)
      drag.current = { sx: p.x, sy: p.y, tx: transform.x, ty: transform.y }
      dragMoved.current = false
    },
    [transform.x, transform.y],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    const p = clientToSvg(svgRef.current, e.clientX, e.clientY)
    const dx = p.x - drag.current.sx
    const dy = p.y - drag.current.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved.current = true
    setTransform((t) => ({ ...t, x: drag.current!.tx + dx, y: drag.current!.ty + dy }))
  }, [])

  const endDrag = useCallback(() => {
    drag.current = null
  }, [])

  const edgeGeometry = useCallback(
    (from: string, to: string, gapTo: number): EdgeGeometry | null => {
      const a = positions[from]
      const b = positions[to]
      if (!a || !b) return null
      const na = nodeById.get(from)
      const nb = nodeById.get(to)
      const rA = na ? radiusOf(na) : 0
      const rB = nb ? radiusOf(nb) : 0
      return trimmedEdge(a, b, rA, rB, gapTo)
    },
    [positions, nodeById, radiusOf],
  )

  const incident = (id: string): boolean => id === selectedId

  return (
    <div
      ref={wrapRef}
      className="kpg-canvas nodrag nowheel"
      onPointerDown={onPointerDownBg}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <svg ref={svgRef} width={size.width} height={size.height} className="kpg-canvas__svg" role="img" aria-label="Keypoint relation graph">
        <defs>
          <marker id="kpg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="kpg-arrow-head" />
          </marker>
          <marker id="kpg-arrow-parent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="kpg-arrow-head kpg-arrow-head--parent" />
          </marker>
        </defs>
        {/* Background hit area: click clears selection. */}
        <rect
          x={0}
          y={0}
          width={size.width}
          height={size.height}
          fill="transparent"
          onClick={() => {
            if (dragMoved.current) {
              dragMoved.current = false
              return
            }
            onSelect(null)
          }}
        />
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
          {/* parent-child edges */}
          {model.parentEdges.map((e) => {
            const p = edgeGeometry(e.from, e.to, ARROW_GAP)
            if (!p) return null
            return (
              <line
                key={`pe-${e.from}-${e.to}`}
                className={`kpg-edge kpg-edge--parent${incident(e.from) || incident(e.to) ? ' is-active' : ''}`}
                x1={p.x1}
                y1={p.y1}
                x2={p.x2}
                y2={p.y2}
                markerEnd="url(#kpg-arrow-parent)"
              />
            )
          })}
          {/* relation edges */}
          {model.relationEdges.map((e) => {
            const p = edgeGeometry(e.from, e.to, e.kind === 'orientation' ? ARROW_GAP : 0)
            if (!p) return null
            const mx = (p.x1 + p.x2) / 2
            const my = (p.y1 + p.y2) / 2
            const active = incident(e.from) || incident(e.to)
            const label = e.kind === 'clearance' ? `${e.distance} m` : e.direction
            return (
              <g key={`re-${e.id}`}>
                <line
                  className={`kpg-edge kpg-edge--${e.kind}${active ? ' is-active' : ''}`}
                  x1={p.x1}
                  y1={p.y1}
                  x2={p.x2}
                  y2={p.y2}
                  markerEnd={e.kind === 'orientation' ? 'url(#kpg-arrow)' : undefined}
                />
                <text className={`kpg-edge__label kpg-edge__label--${e.kind}`} x={mx} y={my} textAnchor="middle" dominantBaseline="central">
                  {label}
                </text>
              </g>
            )
          })}
          {/* nodes */}
          {model.nodes.map((node) => {
            const p = positions[node.id]
            if (!p) return null
            const r = radiusOf(node)
            const labelDy = metric ? r + Math.max(r * 0.45, 0.5) : r + 11
            const isSel = node.id === selectedId
            return (
              <g
                key={node.id}
                className={`kpg-node${isSel ? ' is-selected' : ''}`}
                transform={`translate(${p.x} ${p.y})`}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onSelect(node.id)
                }}
                onPointerDown={(ev) => ev.stopPropagation()}
              >
                <circle className="kpg-node__circle" r={r} />
                <text className="kpg-node__label" y={labelDy} textAnchor="middle">
                  {node.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
