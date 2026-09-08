import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUIStore } from '../../stores/index.js'
import { getEditorTransport } from '../../transport/index.js'
import { MarkdownBody } from './MarkdownBody.js'
import { parseReadmeSections } from './parseReadmeSections.js'
import './TemplateDetailModal.css'

interface TemplateDetailModalProps {
  batteryId: string
  batteryName: string
  onClose: () => void
}

const MODAL_WIDTH = 720
const MODAL_MAX_HEIGHT = 640

const ZOOM_MIN = 1
const ZOOM_MAX = 8
const ZOOM_STEP = 0.15

interface DocsState {
  iconPng?: string
  usagePng?: string
  readme?: string
}

/** 窗口内滚轮缩放 + 拖拽平移；双击复位。 */
function ZoomableImage({
  src,
  alt,
  pixelated,
}: {
  src: string
  alt: string
  pixelated?: boolean
}): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const panRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  // 用 ref 读最新 transform，避免 wheel/pan 闭包读到旧值。
  const transformRef = useRef({ scale: 1, x: 0, y: 0 })
  transformRef.current = { scale, x: offset.x, y: offset.y }

  const reset = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  // 滚轮缩放：以视口中心为锚（足够好用，且实现简单）
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const prev = transformRef.current
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.scale + delta * prev.scale))
      if (next <= ZOOM_MIN + 1e-6) {
        setScale(1)
        setOffset({ x: 0, y: 0 })
        return
      }
      // 缩放时按视口中心保持点位：offset' = offset * (next/prev)
      const ratio = next / prev.scale
      setScale(next)
      setOffset({ x: prev.x * ratio, y: prev.y * ratio })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    if (transformRef.current.scale <= 1) return
    e.preventDefault()
    e.stopPropagation()
    const el = viewportRef.current
    el?.setPointerCapture(e.pointerId)
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
    }
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const pan = panRef.current
    if (!pan) return
    setOffset({
      x: pan.originX + (e.clientX - pan.startX),
      y: pan.originY + (e.clientY - pan.startY),
    })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!panRef.current) return
    panRef.current = null
    viewportRef.current?.releasePointerCapture(e.pointerId)
  }, [])

  const zoomed = scale > 1.01

  return (
    <div
      ref={viewportRef}
      className={[
        'tpl-detail-zoom-viewport',
        zoomed ? 'tpl-detail-zoom-viewport--zoomed' : '',
      ].filter(Boolean).join(' ')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
      title="滚轮缩放 · 拖拽平移 · 双击复位"
    >
      <img
        className={[
          'tpl-detail-zoom-img',
          pixelated ? 'tpl-detail-zoom-img--pixelated' : '',
        ].filter(Boolean).join(' ')}
        src={src}
        alt={alt}
        draggable={false}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        }}
      />
      {zoomed && (
        <span className="tpl-detail-zoom-badge">{Math.round(scale * 100)}%</span>
      )}
    </div>
  )
}

export default function TemplateDetailModal({
  batteryId,
  batteryName,
  onClose,
}: TemplateDetailModalProps) {
  const langMode = useUIStore((s) => s.langMode)
  const [docs, setDocs] = useState<DocsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [pos, setPos] = useState(() => ({
    x: Math.max(0, (window.innerWidth - MODAL_WIDTH) / 2),
    y: Math.max(0, (window.innerHeight - MODAL_MAX_HEIGHT) / 2),
  }))
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void getEditorTransport().api.loadGroupTemplateDocs(batteryId)
      .then((res) => {
        if (cancelled) return
        if (!res) {
          setError(langMode === 'en' ? 'Template docs not found.' : '未找到模板详细信息。')
          setDocs(null)
        } else {
          setDocs(res)
        }
      })
      .catch(() => {
        if (cancelled) return
        setError(langMode === 'en' ? 'Failed to load template docs.' : '加载模板详细信息失败。')
        setDocs(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [batteryId, langMode])

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    }
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      setPos({
        x: Math.max(0, d.originX + ev.clientX - d.startX),
        y: Math.max(0, d.originY + ev.clientY - d.startY),
      })
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [pos.x, pos.y])

  const sections = docs?.readme ? parseReadmeSections(docs.readme) : []

  return createPortal(
    <div
      ref={modalRef}
      className="tpl-detail-modal"
      style={{ left: pos.x, top: pos.y, width: MODAL_WIDTH, maxHeight: MODAL_MAX_HEIGHT }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="tpl-detail-modal-header" onMouseDown={onHeaderMouseDown}>
        <span className="tpl-detail-modal-title">
          {langMode === 'en' ? 'Template details' : '详细信息'} — {batteryName}
        </span>
        <button
          type="button"
          className="tpl-detail-modal-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="tpl-detail-modal-body">
        {loading && (
          <div className="tpl-detail-status">
            {langMode === 'en' ? 'Loading…' : '加载中…'}
          </div>
        )}
        {!loading && error && (
          <div className="tpl-detail-status tpl-detail-status--error">{error}</div>
        )}
        {!loading && !error && docs && (
          <>
            <div className="tpl-detail-media">
              <div className="tpl-detail-media-icon">
                {docs.iconPng ? (
                  <ZoomableImage src={docs.iconPng} alt="icon" pixelated />
                ) : (
                  <div className="tpl-detail-media-empty">
                    {langMode === 'en' ? 'No icon.png' : '无 icon.png'}
                  </div>
                )}
              </div>
              <div className="tpl-detail-media-usage">
                {docs.usagePng ? (
                  <ZoomableImage src={docs.usagePng} alt="usage" />
                ) : (
                  <div className="tpl-detail-media-empty">
                    {langMode === 'en' ? 'No usage.png' : '无 usage.png'}
                  </div>
                )}
              </div>
            </div>

            <div className="tpl-detail-readme">
              {sections.length === 0 ? (
                <div className="tpl-detail-status">
                  {langMode === 'en' ? 'No README.md' : '无 README.md'}
                </div>
              ) : (
                sections.map((sec, idx) => (
                  <section key={`${sec.level}-${sec.title}-${idx}`} className="tpl-detail-section">
                    {sec.title ? (
                      <h3
                        className={`tpl-detail-section-title tpl-detail-section-title--l${Math.min(sec.level, 3) || 1}`}
                      >
                        {sec.title}
                      </h3>
                    ) : null}
                    {sec.content.trim() ? (
                      <div className="tpl-detail-section-body">
                        <MarkdownBody content={sec.content} />
                      </div>
                    ) : null}
                  </section>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
