import { useState, useRef, useLayoutEffect, memo, useCallback } from 'react'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import type { Battery } from '../../types.js'
import { useNodeTooltip, TooltipPortal } from '../canvas/nodeTooltip.js'
import type { BatteryTooltipState } from '../canvas/nodeTooltip.js'
import { FavoriteStarIcon, PresetXIcon } from './batteryBarIcons.js'
import {
  cancelBatteryPointerDrag,
  shouldUseBatteryPointerDrag,
  startBatteryPointerDrag,
} from './batteryPointerDrag.js'

// ── 电池条目（单行列表）：图标 + 名称 + 星标/记录角标 ────────────────────────
export interface BatteryRowProps {
  battery: Battery
  langMode: string
  stars: number
  devNoteCount: number
  showDevNoteCount: boolean
  /** 该电池/模板是否已被收藏（展示黄色五角星标记）。 */
  isFavorite: boolean
  /** 右键菜单当前指向本行：保持模板预览图的悬浮放大态（不缩回）。 */
  isContextActive?: boolean
  /** Templates mode renders a large golden-ratio preview image + wrapping name. */
  templateMode?: boolean
  /** 列表层算出的「全局最宽文字行」单行宽度（base 字号）：所有模板行共用以保持缩放一致。 */
  templateMaxLineW?: number
  onDragStart: (e: React.DragEvent, battery: Battery) => void
  onContextMenu: (e: React.MouseEvent, battery: Battery) => void
  /** When set, renders an inline (hover) delete button that calls this with the row's battery. */
  onDelete?: (battery: Battery) => void
}

/** Format a template's creation timestamp (ms epoch) as a compact `YYYY-MM-DD HH:mm`. */
export function formatTemplateDate(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 模板行文字整体缩放：用 canvas 测量名称单行自然宽度（与当前 DOM 换行状态无关），
// 据此决定「先保证全部文字显示、再等比放大」的逻辑。基准字号见 CSS。
let _tplMeasureCanvas: HTMLCanvasElement | null = null
export function measureTextWidth(text: string, font: string): number {
  if (typeof document === 'undefined') return 0
  if (!_tplMeasureCanvas) _tplMeasureCanvas = document.createElement('canvas')
  const ctx = _tplMeasureCanvas.getContext('2d')
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(text).width
}
const TPL_NAME_BASE_PX = 12      // 与 .battery-row-template-name 基准字号一致
const TPL_VER_BASE_PX = 9.5      // 与 .battery-row-template-ver / -author 一致
const TPL_DATE_BASE_PX = 9       // 与 .battery-row-template-date 一致
const TPL_BASE_BLOCK_H = 44      // 缩放系数 1 时文字块约高（名称单行 + 信息 + 日期）
const TPL_MAX_SCALE = 3

// 单个模板行「最宽文字行」的单行自然宽度（名称 / 版本+作者 / 日期，取最宽）。
// 用于在列表层求全局最大值，使所有行共用同一缩放系数、大小一致。
export function templateRowMaxLineWidth(args: {
  displayName: string
  version?: string
  author?: string
  createdAt?: number
  langMode: string
  fam: string
}): number {
  const { displayName, version, author, createdAt, langMode, fam } = args
  const measure = (text: string, px: number, weight = '400') =>
    text ? measureTextWidth(text, `${weight} ${px}px ${fam}`) : 0
  const byLabel = langMode === 'en' ? 'by ' : '作者 '
  const verW = version ? measure(`v${version}`, TPL_VER_BASE_PX, '600') : 0
  const authorW = author ? measure(`${byLabel}${author}`, TPL_VER_BASE_PX) : 0
  const infoW = verW + authorW + (verW > 0 && authorW > 0 ? 6 : 0)
  const dateW = createdAt !== undefined ? measure(formatTemplateDate(createdAt), TPL_DATE_BASE_PX) : 0
  const nameW = measure(displayName, TPL_NAME_BASE_PX)
  return Math.max(nameW, infoW, dateW)
}

export const BatteryRow = memo(function BatteryRow({
  battery,
  langMode,
  stars,
  devNoteCount,
  showDevNoteCount,
  isFavorite,
  isContextActive = false,
  templateMode = false,
  templateMaxLineW = 0,
  onDragStart,
  onContextMenu,
  onDelete,
}: BatteryRowProps) {
  const { tooltip, showDelayed, hide, trackMouse } = useNodeTooltip(800)
  const usePointerDrag = shouldUseBatteryPointerDrag()

  const displayName = langMode === 'zh' ? battery.name : (battery.nameEn || formatIdAsLabel(battery.id))
  const displayDesc = langMode === 'zh'
    ? (battery.description || battery.name)
    : (battery.descriptionEn || battery.description || displayName)

  const handleMouseEnter = useCallback(() => {
    showDelayed({
      title: displayName,
      icon: battery.iconSvg,
      subtitle: battery.version ? `v${battery.version}` : undefined,
      tagLine: getBatteryTagLine(battery.type, battery.category),
      tagLineColor: getBatteryTypeColor(battery.type),
      description: displayDesc,
    } satisfies BatteryTooltipState)
  }, [battery, displayName, displayDesc, showDelayed])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, battery)
  }, [battery, onContextMenu])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    startBatteryPointerDrag(e, battery)
  }, [battery])

  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (usePointerDrag) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    cancelBatteryPointerDrag()
    onDragStart(e, battery)
  }, [battery, onDragStart, usePointerDrag])

  // 名称右侧 meta（星 + 角标）：只有星 > 0 或开启角标才渲染，避免空列占位
  const showStars = stars > 0
  const showCount = showDevNoteCount && devNoteCount > 0
  const hasMeta = showStars || showCount
  const cappedStars = Math.min(stars, 9)   // 行内宽度有限，最多显示 9 颗
  const sceneScriptLabel =
    battery.sceneScriptStatus === 'equivalence-verified'
      ? 'Equivalent'
      : battery.sceneScriptStatus === 'script-callable'
        ? 'Script'
        : null
  const sceneScriptTitle = sceneScriptLabel
    ? `${sceneScriptLabel}${battery.sceneScriptFunctionName ? ` · ${battery.sceneScriptFunctionName}()` : ''}${battery.sceneScriptMissingGates?.length ? ` · pending: ${battery.sceneScriptMissingGates.join(', ')}` : ''}`
    : undefined

  // 模板行：拉宽电池栏时，先确保名称单行完整显示（否则保持换行不截断），
  // 一旦能单行容纳，再把名称 + 信息 + 日期整体等比放大（共用 --tpl-scale，保持相对大小一致），
  // 直到文字块高度接近缩略图高度封顶。缩略图尺寸固定，多余宽度只作用于文字。
  const tplThumbRef = useRef<HTMLSpanElement>(null)
  const tplBodyRef = useRef<HTMLSpanElement>(null)
  const tplNameRef = useRef<HTMLSpanElement>(null)
  const [tplScale, setTplScale] = useState(1)
  const [tplOneLine, setTplOneLine] = useState(false)

  useLayoutEffect(() => {
    if (!templateMode) return
    const body = tplBodyRef.current
    const name = tplNameRef.current
    if (!body || !name) return
    const recompute = () => {
      const availW = body.clientWidth
      if (availW <= 0) return
      const thumb = tplThumbRef.current
      const imageH = thumb ? thumb.getBoundingClientRect().height : 0
      // 约束宽度优先用列表层算出的「全局最宽文字行」，使全列所有行共用同一系数、大小一致；
      // 缺省（未传入）时回退本行自身的最宽行。
      const constraintW = templateMaxLineW > 0
        ? templateMaxLineW
        : templateRowMaxLineWidth({
            displayName: name.textContent || '',
            version: battery.version,
            author: battery.author,
            createdAt: battery.createdAt,
            langMode,
            fam: getComputedStyle(name).fontFamily,
          })
      const fits = constraintW > 0 && constraintW <= availW
      let next = 1
      if (fits) {
        const wScale = availW / constraintW
        const hScale = imageH > 0 ? imageH / TPL_BASE_BLOCK_H : TPL_MAX_SCALE
        next = Math.max(1, Math.min(wScale, hScale, TPL_MAX_SCALE))
      }
      setTplScale(prev => (Math.abs(prev - next) > 0.01 ? next : prev))
      setTplOneLine(prev => (prev !== fits ? fits : prev))
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(body)
    return () => ro.disconnect()
  }, [templateMode, templateMaxLineW, displayName, battery.version, battery.author, battery.createdAt, langMode])

  if (templateMode) {
    return (
      <div
        className={`battery-row battery-row--template${isContextActive ? ' battery-row--context-active' : ''}`}
        draggable={!usePointerDrag}
        onPointerDown={handlePointerDown}
        onDragStart={handleDragStart}
        onMouseEnter={handleMouseEnter}
        onMouseMove={trackMouse}
        onMouseLeave={hide}
        onContextMenu={handleContextMenu}
      >
        <span className="battery-row-thumb" ref={tplThumbRef}>
          {battery.iconPng
            ? <img className="battery-row-thumb-img" src={battery.iconPng} alt={displayName} draggable={false} />
            : <span className="battery-row-thumb-empty">
                <span className="battery-row-thumb-empty-glyph" aria-hidden>🖼</span>
                <span className="battery-row-thumb-empty-text">{langMode === 'en' ? 'No preview' : '无预览图'}</span>
              </span>
          }
          {isFavorite && (
            <span className="battery-row-fav-star battery-row-fav-star--thumb" title={langMode === 'en' ? 'Favorited' : '已收藏'}>
              <FavoriteStarIcon size={16} />
            </span>
          )}
        </span>
        <span
          className="battery-row-template-body"
          ref={tplBodyRef}
          style={{ '--tpl-scale': tplScale } as React.CSSProperties}
        >
          <span
            className={`battery-row-template-name${tplOneLine ? ' is-oneline' : ''}`}
            ref={tplNameRef}
          >{displayName}</span>
          {sceneScriptLabel && (
            <span className={`battery-row-scene-status battery-row-scene-status--${battery.sceneScriptStatus}`} title={sceneScriptTitle}>
              {sceneScriptLabel}
            </span>
          )}
          <span className="battery-row-template-info">
            <span className="battery-row-template-info-line">
              {battery.version && (
                <span className="battery-row-template-ver">v{battery.version}</span>
              )}
              {battery.author && (
                <span className="battery-row-template-author" title={battery.author}>
                  {langMode === 'en' ? 'by ' : '作者 '}{battery.author}
                </span>
              )}
            </span>
            {battery.createdAt !== undefined && (
              <span className="battery-row-template-date">{formatTemplateDate(battery.createdAt)}</span>
            )}
          </span>
          {hasMeta && (
            <span className="battery-row-meta">
              {showStars && <span className="battery-row-stars">{'★'.repeat(cappedStars)}</span>}
              {showCount && <span className="battery-row-note-count">{devNoteCount}</span>}
            </span>
          )}
        </span>
        {tooltip && <TooltipPortal tooltip={tooltip} />}
      </div>
    )
  }

  return (
    <div
      className="battery-row"
      draggable={!usePointerDrag}
      onPointerDown={handlePointerDown}
      onDragStart={handleDragStart}
      onMouseEnter={handleMouseEnter}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
      onContextMenu={handleContextMenu}
    >
      <span className="battery-row-icon">
        {battery.iconSvg
          ? <span className="battery-row-icon-svg" dangerouslySetInnerHTML={{ __html: battery.iconSvg }} />
          : <span className="battery-row-icon-fallback">⚡</span>
        }
      </span>
      <span className="battery-row-name">{displayName}</span>
      {sceneScriptLabel && (
        <span className={`battery-row-scene-status battery-row-scene-status--${battery.sceneScriptStatus}`} title={sceneScriptTitle}>
          {sceneScriptLabel}
        </span>
      )}
      {isFavorite && (
        <span className="battery-row-fav-star" title={langMode === 'en' ? 'Favorited' : '已收藏'}>
          <FavoriteStarIcon size={12} />
        </span>
      )}
      {hasMeta && (
        <span className="battery-row-meta">
          {showStars && <span className="battery-row-stars">{'★'.repeat(cappedStars)}</span>}
          {showCount && <span className="battery-row-note-count">{devNoteCount}</span>}
        </span>
      )}
      {onDelete && (
        <button
          type="button"
          className="battery-row-delete"
          title={langMode === 'en' ? 'Delete this group battery' : '删除此 group 电池'}
          aria-label={langMode === 'en' ? 'Delete this group battery' : '删除此 group 电池'}
          draggable={false}
          onMouseDown={e => e.stopPropagation()}
          onDragStart={e => { e.preventDefault(); e.stopPropagation() }}
          onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(battery) }}
        >
          <PresetXIcon size={12} />
        </button>
      )}
      {tooltip && <TooltipPortal tooltip={tooltip} />}
    </div>
  )
})
