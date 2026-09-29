// 💡 电池选择栏（竖向版）：
//   ─ 大标签（左侧 rail，点击跳转到右侧对应分组）
//   ─ 小标签（手风琴二级，多个可同时展开 / 收起；点 + 号可展开覆盖层平铺全部电池）
//   ─ 电池条目（叶子）：图标 + 名称单行列表
// 整列纵向滚动；右侧 4px 把手可拖拽调整电池栏宽度（localStorage 持久化）
// 横向滚动相关旧逻辑（attachBatteryBarHScrollWheel / hScroll smooth refs / cards-scroll-map / tabs-scroll-left）已整体移除。
//
// Develop 用手风琴（大标签 → 小标签 → 电池行）；Templates 大标签=父分类，其下直接平铺模板卡片。
// 右键菜单 / 星标 / 开发记录角标 / Tooltip / 拖拽到画布 等核心交互全部保留。
//
// 忠实移植说明（faithful port）：模板分类目录列表原由 app 级 apiService.getTemplateCategories()
// 拉取，属多项目 chrome，已在通用编辑器中剥离；templateCategories 保留为空数组，
// templates 渲染分支因此仅由通用电池数据驱动（batteryFilterMode 默认恒为 'develop'）。
import { useState, useMemo, useRef, useLayoutEffect, useEffect, useCallback } from 'react'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'
import type { Battery } from '../../types.js'
import DevNoteModal from './DevNoteModal.js'
import TemplateDetailModal from './TemplateDetailModal.js'
import { getEditorTransport, peekEditorTransport } from '../../transport/index.js'
import './BatteryBar.css'
import {
  BATTERY_BAR_WIDTH_MIN,
  BATTERY_BAR_WIDTH_MAX,
  readActiveBigLabels,
  writeActiveBigLabels,
  readCollapsedSmallMap,
  writeCollapsedSmallMap,
  readVScrollMap,
  writeVScrollSlot,
  vScrollKey,
  smallGroupKey,
  parseSmallGroupKey,
  readBigLabelOrder,
  writeBigLabelOrder,
  readBatteryBarWidth,
  writeBatteryBarWidth,
} from './batteryBarStorage.js'
import {
  isTemplateBattery,
  catalogBatteryKey,
  getBigLabel,
  getTemplateSubfolder,
  getTemplateSmallLabel,
  getSmallLabel,
  formatBigLabel,
  formatBigLabelRailText,
  formatBigLabelRailRest,
  compareBigLabel,
  formatSmallLabel,
  applyOrder,
  sortSmallLabels,
  sortBatteriesInGroup,
  matchesProjectType,
  fuzzyMatchBattery,
} from './batteryGrouping.js'
import { getDragGhostCanvas } from './batteryBarDragGhost.js'
import { writeBatteryDragPayload } from './batteryDragPayload.js'
import {
  FavoritesRailIcon,
  PresetsRailIcon,
  ModeToggleRailIcon,
  CollapseRailIcon,
  PinRailIcon,
} from './batteryBarIcons.js'
import {
  FAVORITES_BIG,
  FAVORITES_SMALL,
  PRESETS_BIG,
  getDeletableKind,
  parseFavoriteBatteryJson,
} from './batteryBarDelete.js'
import { PresetsRailPanel } from './PresetsRailPanel.js'
import { BatteryRow, templateRowMaxLineWidth } from './BatteryRow.js'

interface ContextMenuState {
  x: number
  y: number
  battery: Battery
}

interface DevNoteTarget {
  id: string
  name: string
}

interface TemplateDetailTarget {
  id: string
  name: string
}

function BatteryBar({ paletteAllowOpIds }: { paletteAllowOpIds?: readonly string[] } = {}) {
  // Selected field-by-field — `usePipelineStore()` with no selector would
  // re-render this (potentially long) battery palette list on every unrelated
  // pipeline update (e.g. every streamed nodeOutputs tick while running).
  const batteries = usePipelineStore((s) => s.batteries)
  const allowedOpIds = paletteAllowOpIds ? new Set(paletteAllowOpIds) : null
  const inPalette = useCallback(
    (b: Battery) => !allowedOpIds || allowedOpIds.has(b.id),
    [allowedOpIds],
  )
  const categories = usePipelineStore((s) => s.categories)
  const batteryOrder = usePipelineStore((s) => s.batteryOrder)
  const saveBatteryOrder = usePipelineStore((s) => s.saveBatteryOrder)
  const langMode = useUIStore((s) => s.langMode)
  const batteryStars = useUIStore((s) => s.batteryStars)
  const batteryDevNotes = useUIStore((s) => s.batteryDevNotes)
  const showDevNoteCount = useUIStore((s) => s.showDevNoteCount)
  const favoriteBatteries = useUIStore((s) => s.favoriteBatteries)
  const addFavoriteBattery = useUIStore((s) => s.addFavoriteBattery)
  const removeFavoriteBattery = useUIStore((s) => s.removeFavoriteBattery)
  const removePrompt = useUIStore((s) => s.removePrompt)
  const removeUserTemplate = useUIStore((s) => s.removeUserTemplate)
  const removeGroupBattery = useUIStore((s) => s.removeGroupBattery)
  // 多项目：当前激活项目类型（用于按 projectTypes 过滤）
  const activeProjectType = useUIStore((s) => s.activeProjectType)
  // Develop / Templates 切换：Toolbar 与 rail 底部切换按钮共用同一 store 动作。
  const batteryFilterMode = useUIStore((s) => s.batteryFilterMode)
  const setBatteryFilterMode = useUIStore((s) => s.setBatteryFilterMode)
  // searchQuery 当前由画布双击搜索浮层（CanvasSearchPopover）驱动，BatteryBar 内部不再有写入入口；
  // 这里仍订阅状态用于显示搜索结果计数 / 切换扁平搜索视图。setter 暂未使用但保留预留接口。
  const [searchQuery, setSearchQuery] = useState('')
  void setSearchQuery
  const [focusedBigLabel, setFocusedBigLabel] = useState<string | null>(() => readActiveBigLabels()[0] ?? null)
  // 收藏 / 预设属「收藏视图」，其余大标签属「电池视图」。视图由当前 focused 大标签决定。
  const isCollectionLabel = useCallback(
    (label: string) => label === FAVORITES_BIG || label === PRESETS_BIG,
    [],
  )
  const railView: 'batteries' | 'collection' =
    focusedBigLabel && isCollectionLabel(focusedBigLabel) ? 'collection' : 'batteries'
  // 小标签折叠集合：按大标签维度独立存储已收起的小标签（默认全部展开）
  const [collapsedSmallLabels, setCollapsedSmallLabels] = useState<Record<string, string[]>>(readCollapsedSmallMap)
  // Templates 大标签的空占位目录：扫 batteries/templates/ 子目录（即便尚无模板电池），
  // 让空分类也显示。注意用 listTemplateOnlyCategories（templates/），而非
  // listTemplateCategories（那是 groups/ 保存分类，会混入 111/222）。
  const [templateCategories, setTemplateCategories] = useState<string[]>([])

  useEffect(() => {
    if (batteryFilterMode !== 'templates') return
    void getEditorTransport().api.listTemplateOnlyCategories()
      .then((cats) => setTemplateCategories([...cats]))
      .catch(() => setTemplateCategories([]))
  }, [batteryFilterMode])

  // ── 右键菜单状态 ────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // ── 开发记录弹窗状态（多实例：同一电池只保留一个）
  const [devNoteTargets, setDevNoteTargets] = useState<DevNoteTarget[]>([])
  // ── 模板详细信息弹窗（单实例）
  const [templateDetailTarget, setTemplateDetailTarget] = useState<TemplateDetailTarget | null>(null)

  // ── 大标签拖拽排序状态 ──────────────────────────────────────────────────
  const [dragBigLabel, setDragBigLabel] = useState<string | null>(null)
  const [dragOverBigLabel, setDragOverBigLabel] = useState<string | null>(null)
  // 大标签顺序持久化到浏览器（localStorage），develop / templates 各存各的桶。
  const [bigLabelOrder, setBigLabelOrder] = useState<string[]>(() => readBigLabelOrder(batteryFilterMode))
  useEffect(() => {
    setBigLabelOrder(readBigLabelOrder(batteryFilterMode))
  }, [batteryFilterMode])
  const [isRailExpanded, setIsRailExpanded] = useState(false)
  const [isRailExpansionSuppressed, setIsRailExpansionSuppressed] = useState(false)
  // 图钉：点击后大标签 rail 常驻展开（不再需要悬浮才展开），再次点击取消。会话态，不持久化。
  const [isRailPinned, setIsRailPinned] = useState(false)
  const isRailShown = isRailExpanded || isRailPinned
  const railGroupRef = useRef<HTMLDivElement>(null)
  const [railThumb, setRailThumb] = useState({ visible: false, top: 0, height: 20 })
  // 电池栏整体收起 / 展开（会话态，不持久化，与宽度一致刷新即恢复默认展开）。
  const [isCollapsed, setIsCollapsed] = useState(false)

  // 本栏「浮在画布之上」，画布占满整行不随本栏开闭回流；把本栏实测宽度发布到
  // `--bb-current-width`（挂在根上），供组内视图导航栏右移到本栏右侧、避免被遮挡。
  const asideRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const el = asideRef.current
    if (!el) return
    const publish = () => {
      document.documentElement.style.setProperty('--bb-current-width', `${el.offsetWidth}px`)
    }
    publish()
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        document.documentElement.style.removeProperty('--bb-current-width')
      }
    }
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--bb-current-width')
    }
  }, [])

  // ── 小标签拖拽排序状态 ──────────────────────────────────────────────────
  const [dragSmallLabel, setDragSmallLabel] = useState<string | null>(null)
  const [dragOverSmallLabel, setDragOverSmallLabel] = useState<string | null>(null)

  // ── 小标签展开覆盖层（+ 号点开后，绝对定位的多列网格平铺该小标签全部电池） ─
  const [expandedSmallLabel, setExpandedSmallLabel] = useState<string | null>(null)
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties | null>(null)

  // ── DOM refs ────────────────────────────────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement>(null)         // 整体纵向滚动容器
  const smallHeaderRefs = useRef<Record<string, HTMLDivElement | null>>({})  // 每个小标签头部 DOM（用于覆盖层定位）
  const bigSectionRefs = useRef<Record<string, HTMLDivElement | null>>({})    // 每个大标签内容分组 DOM（用于 rail 跳转）
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedBigLabelRef = useRef<string | null>(focusedBigLabel)
  const bigLabelsRef = useRef<string[]>([])
  // 电池视图（batteries）与收藏/预设视图（collection）各自独立滚动、各自保存滚动位置，
  // 互不打通——只能通过点击 rail 按钮（星标 / 书签 / 大标签）切换，不支持滚动越界联动。

  useEffect(() => {
    focusedBigLabelRef.current = focusedBigLabel
  }, [focusedBigLabel])

  // ── 宽度拖拽 ─────────────────────────────────────────────────────────────
  // 拖拽把手调整的宽度持久化到 localStorage，刷新后保留上次的位置。
  const [width, setWidth] = useState<number>(readBatteryBarWidth)
  const widthRef = useRef<number>(width)
  useEffect(() => { widthRef.current = width }, [width])

  const onResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthRef.current
    document.body.classList.add('bb-resizing')
    const onMove = (m: MouseEvent) => {
      const next = Math.max(BATTERY_BAR_WIDTH_MIN, Math.min(BATTERY_BAR_WIDTH_MAX, startW + (m.clientX - startX)))
      setWidth(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('bb-resizing')
      writeBatteryBarWidth(widthRef.current)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  // ── 纵向滚动持久化 ──────────────────────────────────────────────────────
  // 两个视图各自独立的滚动位置（互不干扰），故把视图维度拼进 key。
  const scrollKey = useMemo(
    () => `${vScrollKey(searchQuery)}::${railView}`,
    [searchQuery, railView]
  )

  // 切换大标签 / 搜索语境时恢复滚动位置（双 rAF 确保 DOM 已渲染）。
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const map = readVScrollMap()
    const saved = map[scrollKey] ?? 0
    const apply = () => {
      const s = scrollerRef.current
      if (!s) return
      const max = Math.max(0, s.scrollHeight - s.clientHeight)
      s.scrollTop = Math.min(Math.max(0, saved), max)
    }
    requestAnimationFrame(() => requestAnimationFrame(apply))
  }, [scrollKey])

  const syncFocusedBigLabelFromScroll = useCallback(() => {
    const labels = bigLabelsRef.current
    if (searchQuery || labels.length === 0) return
    const scroller = scrollerRef.current
    if (!scroller) return

    // 右侧列表按大标签 section 顺序渲染；滚动顶部进入哪个 section，左侧 rail 就高亮哪个大标签。
    const markerTop = scroller.scrollTop + 4
    let nextFocused = labels[0] ?? null
    for (const label of labels) {
      const section = bigSectionRefs.current[label]
      if (!section) continue
      if (section.offsetTop <= markerTop) nextFocused = label
      else break
    }

    if (nextFocused && focusedBigLabelRef.current !== nextFocused) {
      focusedBigLabelRef.current = nextFocused
      setFocusedBigLabel(nextFocused)
      writeActiveBigLabels([nextFocused])
    }
  }, [searchQuery])

  const persistScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    syncFocusedBigLabelFromScroll()
    if (scrollSaveTimerRef.current != null) clearTimeout(scrollSaveTimerRef.current)
    scrollSaveTimerRef.current = setTimeout(() => {
      scrollSaveTimerRef.current = null
      const s = scrollerRef.current
      if (s) writeVScrollSlot(scrollKey, s.scrollTop)
    }, 120)
  }, [scrollKey, syncFocusedBigLabelFromScroll])

  useEffect(() => () => {
    if (scrollSaveTimerRef.current != null) clearTimeout(scrollSaveTimerRef.current)
  }, [])

  // ── 小标签展开覆盖层定位（点 + 号后从该小标签头下方展开到容器底部） ────
  useLayoutEffect(() => {
    if (!expandedSmallLabel || !scrollerRef.current) {
      setOverlayStyle(null)
      return
    }
    const scroller = scrollerRef.current
    const headerEl = smallHeaderRefs.current[expandedSmallLabel]
    if (!headerEl) {
      setOverlayStyle(null)
      return
    }
    // 用 getBoundingClientRect 差值取 header 底部位置（避坑 2026-03-17：不要 offsetTop+gap 累加）
    const calc = () => {
      const sRect = scroller.getBoundingClientRect()
      const hRect = headerEl.getBoundingClientRect()
      const top = hRect.bottom - sRect.top + scroller.scrollTop
      setOverlayStyle({
        position: 'absolute',
        left: 0,
        right: 0,
        top,
        bottom: 0,
      })
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [expandedSmallLabel])

  const resolveSmallLabel = useCallback((b: Battery) => {
    return batteryFilterMode === 'templates' ? getTemplateSubfolder(b) : getSmallLabel(b)
  }, [batteryFilterMode])

  // ── 派生：大标签列表（原始） ─────────────────────────────────────────────
  const rawBigLabels = useMemo(() => {
    if (batteryFilterMode === 'templates') {
      // 大标签来自：(1) batteries/templates/ 下的所有目录（含空占位目录，
      // 经 listTemplateOnlyCategories 取得）；(2) 真正的模板电池自身的分类。
      // 绝不混入 listTemplateCategories()——那是 groups/ 保存分类（111/222）。
      const templateBatteries = batteries.filter(b => isTemplateBattery(b))
      const tags = new Set<string>([
        ...templateCategories,
        ...templateBatteries.map(b => b.category || getBigLabel(b)),
      ])
      // Templates 模式同样钉「收藏」与「预设」两个入口，位于 rail 底部，
      // 与 Develop 模式底部按钮数量保持一致（预设面板内容与模式无关，见 PresetsRailPanel）。
      return [FAVORITES_BIG, PRESETS_BIG, ...[...tags].sort()]
    }

    const tsTags: string[] = []
    const otherTags: string[] = []
    const seenTs = new Set<string>()
    const seenOther = new Set<string>()

    const matchesType = (b: Battery): boolean => matchesProjectType(b, activeProjectType) && inPalette(b)

    if (categories.length > 0) {
      const visibleBigTags = new Set(
        batteries.filter(b => b.type === 'ts' && matchesType(b) && !b.paletteHidden)
          .map(b => getBigLabel(b))
      )
      categories.forEach(c => {
        if (c.type !== 'ts') return
        if (!visibleBigTags.has(c.bigTag)) return
        if (seenTs.has(c.bigTag)) return
        seenTs.add(c.bigTag)
        tsTags.push(c.bigTag)
      })
    } else {
      batteries.filter(b => b.type === 'ts' && matchesType(b) && !b.paletteHidden).forEach(b => {
        const label = getBigLabel(b)
        if (seenTs.has(label)) return
        seenTs.add(label)
        tsTags.push(label)
      })
    }

    batteries.forEach(b => {
      if (b.type === 'ts') return
      if (isTemplateBattery(b)) return
      if (b.paletteHidden) return
      if (!matchesType(b)) return
      const label = getBigLabel(b)
      if (seenOther.has(label)) return
      seenOther.add(label)
      otherTags.push(label)
    })

    return [FAVORITES_BIG, PRESETS_BIG, ...tsTags.sort(compareBigLabel), ...otherTags.sort(compareBigLabel)]
  }, [batteries, categories, activeProjectType, batteryFilterMode, templateCategories, inPalette])

  // 应用持久化排序后的大标签列表（用于渲染），收藏 + 预设始终钉顶
  const bigLabels = useMemo(() => {
    const ordered = applyOrder(bigLabelOrder, rawBigLabels)
    const pinned = [FAVORITES_BIG, PRESETS_BIG].filter(label => ordered.includes(label))
    let result = pinned.length === 0
      ? [...ordered]
      : [...pinned, ...ordered.filter(label => !pinned.includes(label))]
    // Prompts 大标签固定钉在 GROUPS 之下（与 GROUPS 同为底部品牌标签）。
    if (result.includes('prompt') && result.includes('groups')) {
      result = result.filter(label => label !== 'prompt')
      result.splice(result.indexOf('groups') + 1, 0, 'prompt')
    }
    return result
  }, [rawBigLabels, bigLabelOrder])

  // ── 双视图拆分：收藏 / 预设 归「收藏视图」，其余电池大标签归「电池视图」。
  //    两个视图各自一个独立滚动容器（互不滚过），rail 底部钉住收藏/预设按钮。
  const collectionLabels = useMemo(
    () => bigLabels.filter(isCollectionLabel),
    [bigLabels, isCollectionLabel],
  )
  const batteryLabels = useMemo(
    () => bigLabels.filter(label => !isCollectionLabel(label)),
    [bigLabels, isCollectionLabel],
  )
  useLayoutEffect(() => {
    const element = railGroupRef.current
    if (!element) return
    const update = () => {
      const { clientHeight, scrollHeight, scrollTop } = element
      const visible = scrollHeight > clientHeight + 1
      const height = visible ? Math.max(20, clientHeight * clientHeight / scrollHeight) : clientHeight
      const maxTop = Math.max(0, clientHeight - height)
      const top = scrollHeight > clientHeight
        ? (scrollTop / (scrollHeight - clientHeight)) * maxTop
        : 0
      setRailThumb({ visible, top, height })
    }
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)
    return () => {
      element.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [batteryLabels.length])
  // 仅当前视图内的大标签参与滚动联动（rail 高亮 / 恢复滚动位置）。
  const activeViewLabels = railView === 'collection' ? collectionLabels : batteryLabels

  useEffect(() => {
    bigLabelsRef.current = activeViewLabels
  }, [activeViewLabels])

  const visibleBatteries = useMemo(() => {
    let result = batteries.filter(b => !b.paletteHidden && inPalette(b))
    if (batteryFilterMode === 'templates') {
      result = result.filter(b => isTemplateBattery(b))
    } else {
      result = result.filter(b => !isTemplateBattery(b))
    }
    return result.filter(b => matchesProjectType(b, activeProjectType))
  }, [activeProjectType, batteries, batteryFilterMode, inPalette])

  const searchBatteries = useMemo(
    () => visibleBatteries.filter(b => fuzzyMatchBattery(b, searchQuery)),
    [visibleBatteries, searchQuery]
  )

  const searchResultCount = useMemo(() => {
    if (!searchQuery) return 0
    return searchBatteries.length
  }, [searchBatteries, searchQuery])

  // Templates 模式：算出全列模板行「最宽文字行」的单行宽度（base 字号），
  // 下发给每个 BatteryRow 作为统一缩放约束，保证所有行大小一致、同步放大/换行。
  const [templateMaxLineW, setTemplateMaxLineW] = useState(0)
  useLayoutEffect(() => {
    if (batteryFilterMode !== 'templates') {
      setTemplateMaxLineW(prev => (prev !== 0 ? 0 : prev))
      return
    }
    const root = asideRef.current
    if (!root) return
    const fam = getComputedStyle(root).fontFamily
    let max = 0
    for (const b of visibleBatteries) {
      const dn = langMode === 'zh' ? b.name : (b.nameEn || formatIdAsLabel(b.id))
      const w = templateRowMaxLineWidth({
        displayName: dn,
        version: b.version,
        author: b.author,
        createdAt: b.createdAt,
        langMode,
        fam,
      })
      if (w > max) max = w
    }
    setTemplateMaxLineW(prev => (Math.abs(prev - max) > 0.5 ? max : prev))
  }, [batteryFilterMode, visibleBatteries, langMode])

  const getRawSmallLabelsForBig = useCallback((bigLabel: string): string[] => {
    if (bigLabel === FAVORITES_BIG) return [FAVORITES_SMALL]
    if (bigLabel === PRESETS_BIG) return [] // presets render via a dedicated panel, not battery sub-groups
    if (batteryFilterMode === 'templates') {
      const seen = new Set<string>()
      const result: string[] = []
      visibleBatteries
        .filter(b => isTemplateBattery(b) && b.category === bigLabel)
        .forEach(b => {
          const small = getTemplateSubfolder(b)
          if (seen.has(small)) return
          seen.add(small)
          result.push(small)
        })
      return result.sort()
    }

    const catEntry = categories.find(c => c.bigTag === bigLabel)
    if (catEntry) return [...catEntry.smallTags].sort()
    const seen = new Set<string>()
    const result: string[] = []
    visibleBatteries
      .filter(b => getBigLabel(b) === bigLabel)
      .forEach(b => {
        const small = getSmallLabel(b)
        if (seen.has(small)) return
        seen.add(small)
        result.push(small)
      })
    return result.sort()
  }, [batteryFilterMode, categories, visibleBatteries])

  const groupBatteriesBySmall = useCallback((items: Battery[], bigLabel: string | null): Record<string, Battery[]> => {
    const groups: Record<string, Battery[]> = {}
    items.forEach(b => {
      const small = bigLabel === FAVORITES_BIG ? FAVORITES_SMALL : resolveSmallLabel(b)
      if (!groups[small]) groups[small] = []
      groups[small].push(b)
    })
    for (const [small, groupItems] of Object.entries(groups)) {
      groups[small] = sortBatteriesInGroup(groupItems, bigLabel, small)
    }
    return groups
  }, [resolveSmallLabel])

  const getBatteriesForBig = useCallback((bigLabel: string): Battery[] => {
    if (bigLabel === PRESETS_BIG) return [] // presets are not batteries; rendered separately
    if (bigLabel === FAVORITES_BIG) {
      const byId = new Map(visibleBatteries.map(b => [b.id, b]))
      return [...favoriteBatteries]
        .sort((a, b) => a.addedAt - b.addedAt)
        .map(f => byId.get(f.batteryId) ?? parseFavoriteBatteryJson(f.batteryJson))
        .filter((b): b is Battery => Boolean(b))
        // 收藏按当前模式分流：模板收藏只在 Templates 模式显示（格式同模板），
        // 普通电池收藏只在 Develop 模式显示，互不串栏。
        .filter(b => (batteryFilterMode === 'templates') === isTemplateBattery(b))
        .filter(b => matchesProjectType(b, activeProjectType))
    }
    return visibleBatteries.filter(b => {
      const big = batteryFilterMode === 'templates'
        ? (b.category || getBigLabel(b))
        : getBigLabel(b)
      return big === bigLabel
    })
  }, [activeProjectType, batteryFilterMode, favoriteBatteries, visibleBatteries])

  const getSmallLabelsToRender = useCallback((bigLabel: string, groupedBySmall: Record<string, Battery[]>): string[] => {
    const rawSmallLabels = getRawSmallLabelsForBig(bigLabel)
    const allSmall = new Set([...rawSmallLabels, ...Object.keys(groupedBySmall)])
    const sorted = sortSmallLabels([...allSmall], bigLabel)
    return applyOrder(batteryOrder.smallLabels[bigLabel] ?? [], sorted)
  }, [batteryOrder.smallLabels, getRawSmallLabelsForBig])

  const searchGroupedBySmall = useMemo(
    () => groupBatteriesBySmall(searchBatteries, null),
    [groupBatteriesBySmall, searchBatteries]
  )

  const searchSmallLabelsToRender = useMemo(
    () => sortSmallLabels(Object.keys(searchGroupedBySmall), null),
    [searchGroupedBySmall]
  )

  const expandedOverlayItems = useMemo(() => {
    if (!expandedSmallLabel) return []
    const parsed = parseSmallGroupKey(expandedSmallLabel)
    if (!parsed) return []
    if (parsed.bigLabel === '__search__') return searchGroupedBySmall[parsed.smallLabel] ?? []
    const grouped = groupBatteriesBySmall(getBatteriesForBig(parsed.bigLabel), parsed.bigLabel)
    return grouped[parsed.smallLabel] ?? []
  }, [expandedSmallLabel, getBatteriesForBig, groupBatteriesBySmall, searchGroupedBySmall])

  // 覆盖层是否正在展示「收藏」小组（收藏视图内不重复显示五角星）。
  const expandedOverlayIsFavorites = useMemo(() => {
    if (!expandedSmallLabel) return false
    return parseSmallGroupKey(expandedSmallLabel)?.bigLabel === FAVORITES_BIG
  }, [expandedSmallLabel])

  // 小标签默认展开；集合记录被用户显式收起的项（入集合=收起，出集合=展开）
  const isSmallOpen = useCallback(
    (openKey: string, smallLabel: string) => !(collapsedSmallLabels[openKey] ?? []).includes(smallLabel),
    [collapsedSmallLabels],
  )

  const toggleSmallOpen = useCallback((openKey: string, smallLabel: string) => {
    setCollapsedSmallLabels(prev => {
      const cur = new Set(prev[openKey] ?? [])
      if (cur.has(smallLabel)) cur.delete(smallLabel)
      else cur.add(smallLabel)
      const next = { ...prev, [openKey]: [...cur] }
      writeCollapsedSmallMap(next)
      return next
    })
    // 切换某个小标签的开合时，若它正处于覆盖层展开态，则一并收起覆盖层
    setExpandedSmallLabel(prev => (prev === smallGroupKey(openKey, smallLabel) ? null : prev))
  }, [])

  // ── 大标签 rail 点击：始终跳转到该组最前端 ───────────────────────────────
  const handleRailBigLabelClick = (label: string) => {
    setIsCollapsed(false)
    setIsRailExpanded(false)
    setIsRailExpansionSuppressed(true)
    setFocusedBigLabel(label)
    writeActiveBigLabels([label])
    setExpandedSmallLabel(null)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const s = scrollerRef.current
      const section = bigSectionRefs.current[label]
      if (!s || !section) return
      const max = Math.max(0, s.scrollHeight - s.clientHeight)
      s.scrollTop = Math.min(Math.max(0, section.offsetTop), max)
    }))
  }

  const handleRailMouseEnter = () => {
    // 收起态下不整列展开 rail（避免悬浮覆盖压住标签文字），仅各标签自身 hover 高亮。
    if (isCollapsed) return
    if (!isRailExpansionSuppressed) setIsRailExpanded(true)
  }

  const handleRailMouseLeave = () => {
    setIsRailExpanded(false)
    setIsRailExpansionSuppressed(false)
  }

  const handleScrollerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 点击空白处收起覆盖层
    if (e.target === e.currentTarget) setExpandedSmallLabel(null)
  }

  // ── 拖拽排序：大标签 ─────────────────────────────────────────────────────
  const handleTabDragStart = (e: React.DragEvent, label: string) => {
    e.stopPropagation()
    setDragBigLabel(label)
    e.dataTransfer.setData('application/tab-reorder', label)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleTabDragEnd = () => {
    setDragBigLabel(null)
    setDragOverBigLabel(null)
  }

  const handleTabDragOver = (e: React.DragEvent, label: string) => {
    if (!e.dataTransfer.types.includes('application/tab-reorder')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverBigLabel !== label) setDragOverBigLabel(label)
  }

  const handleTabDragLeave = () => setDragOverBigLabel(null)

  const handleTabDrop = (e: React.DragEvent, targetLabel: string) => {
    if (!e.dataTransfer.types.includes('application/tab-reorder')) return
    e.preventDefault()
    const sourceLabel = dragBigLabel
    if (!sourceLabel || sourceLabel === targetLabel) return
    const newOrder = [...bigLabels]
    const fromIdx = newOrder.indexOf(sourceLabel)
    const toIdx = newOrder.indexOf(targetLabel)
    if (fromIdx === -1 || toIdx === -1) return
    newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, sourceLabel)
    // 持久化到浏览器（按模式分桶），并同步内存 store（小标签排序仍走 store）。
    writeBigLabelOrder(batteryFilterMode, newOrder)
    setBigLabelOrder(newOrder)
    saveBatteryOrder({ bigLabels: newOrder, smallLabels: batteryOrder.smallLabels })
    setDragBigLabel(null)
    setDragOverBigLabel(null)
  }

  // ── 拖拽排序：小标签 ─────────────────────────────────────────────────────
  const handleGroupDragStart = (e: React.DragEvent, small: string) => {
    e.stopPropagation()
    setDragSmallLabel(small)
    e.dataTransfer.setData('application/group-reorder', small)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleGroupDragEnd = () => {
    setDragSmallLabel(null)
    setDragOverSmallLabel(null)
  }

  const handleGroupDragOver = (e: React.DragEvent, small: string) => {
    if (!e.dataTransfer.types.includes('application/group-reorder')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverSmallLabel !== small) setDragOverSmallLabel(small)
  }

  const handleGroupDragLeave = () => setDragOverSmallLabel(null)

  const handleGroupDrop = (e: React.DragEvent, bigLabel: string, smallLabelsInSection: string[], targetSmall: string) => {
    if (!e.dataTransfer.types.includes('application/group-reorder')) return
    e.preventDefault()
    const sourceSmall = dragSmallLabel
    if (!sourceSmall || sourceSmall === targetSmall) return
    const newOrder = [...smallLabelsInSection]
    const fromIdx = newOrder.indexOf(sourceSmall)
    const toIdx = newOrder.indexOf(targetSmall)
    if (fromIdx === -1 || toIdx === -1) return
    newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, sourceSmall)
    saveBatteryOrder({
      bigLabels: batteryOrder.bigLabels,
      smallLabels: { ...batteryOrder.smallLabels, [bigLabel]: newOrder },
    })
    setDragSmallLabel(null)
    setDragOverSmallLabel(null)
  }

  // ── 电池行：拖入画布 ─────────────────────────────────────────────────────
  // stopPropagation 防止冒泡到父级 .bb-small-section 的 onDragStart（小标签拖排），
  // 否则 handleGroupDragStart 会把 effectAllowed 覆盖为 'move'，画布 onDrop 不触发
  const handleDragStart = (e: React.DragEvent, battery: Battery) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'copy'
    // Slim id-only payload when the op is in the live catalog — avoids
    // JSON.stringify of multi-MB template iconPng through dataTransfer (main-thread
    // freeze on drop). Off-catalog favorites still ship the legacy full JSON.
    //
    // `batteries/groups/` and `batteries/templates/` are physically separate
    // copies that may share a group id, so the id alone cannot address a catalog
    // row. Ship catalogBatteryKey (the sourcePath) alongside it so the drop
    // resolves the exact row the user dragged.
    const key = catalogBatteryKey(battery)
    writeBatteryDragPayload(e.dataTransfer, {
      battery,
      catalogKey: batteries.some((b) => catalogBatteryKey(b) === key) ? key : undefined,
    })
    const ghost = getDragGhostCanvas()
    if (ghost) e.dataTransfer.setDragImage(ghost, 14, 14)
  }

  // ── 右键菜单 ────────────────────────────────────────────────────────────
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const handleRowContextMenu = useCallback((e: React.MouseEvent, battery: Battery) => {
    setContextMenu({ x: e.clientX, y: e.clientY, battery })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // 视口边界钳制：菜单贴近右/下边缘时上翻、左移，避免被视口或状态栏裁掉。
  useLayoutEffect(() => {
    if (!contextMenu) return
    const el = contextMenuRef.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    const margin = 8
    let left = contextMenu.x
    let top = contextMenu.y
    if (left + w > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - w - margin)
    if (top + h > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - h - margin)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const handler = () => closeContextMenu()
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu, closeContextMenu])

  const handleContextMenuAddFavorite = useCallback(() => {
    if (!contextMenu) return
    addFavoriteBattery(contextMenu.battery)
    closeContextMenu()
  }, [contextMenu, addFavoriteBattery, closeContextMenu])

  const handleContextMenuRemoveFavorite = useCallback(() => {
    if (!contextMenu) return
    removeFavoriteBattery(contextMenu.battery.id)
    closeContextMenu()
  }, [contextMenu, removeFavoriteBattery, closeContextMenu])

  const contextMenuIsFavorite = contextMenu
    ? favoriteBatteries.some((f) => f.batteryId === contextMenu.battery.id)
    : false

  // 当前 transport 是否支持删除 GROUPS 成组电池（暴露 deleteGroupTemplate 路由）。
  // 不支持时（如尚未实现该路由的 app）隐藏 group 删除入口，避免点了无反应。
  //
  // 关键：左栏在自己的挂载 useEffect 里才 configureEditorTransport，而 React 的
  // effect 自底向上执行 —— 本组件首帧渲染（含 useMemo）早于父级配置 transport。
  // 旧实现用抛错的 getEditorTransport() + useMemo([]) 会在首帧 catch 成 false 并
  // 永久锁死，导致 dev server 干净重启后删除入口整体消失。改用非抛错的
  // peekEditorTransport()，并在下一 tick（父 effect 配好 transport 之后）复查一次。
  const [canDeleteGroups, setCanDeleteGroups] = useState<boolean>(
    () => peekEditorTransport()?.api.supportsDeleteGroupBattery === true,
  )
  useEffect(() => {
    if (canDeleteGroups) return
    const id = setTimeout(() => {
      setCanDeleteGroups(peekEditorTransport()?.api.supportsDeleteGroupBattery === true)
    }, 0)
    return () => clearTimeout(id)
  }, [canDeleteGroups])

  // 删除一个 group 成组电池（带确认）：物理删除本地电池目录文件，成功后刷新目录。
  const deleteGroupName = useCallback((battery: Battery) => (
    langMode === 'zh' ? battery.name : (battery.nameEn || formatIdAsLabel(battery.id))
  ), [langMode])
  const confirmAndRemoveGroup = useCallback((groupId: string, name: string) => {
    const msg = langMode === 'en'
      ? `Delete group battery "${name}" from the local battery directory? This removes the files on disk and cannot be undone.`
      : `从本地电池目录删除 group 电池「${name}」？该操作会删除磁盘上的文件，且不可撤销。`
    if (typeof window !== 'undefined' && !window.confirm(msg)) return
    removeGroupBattery(groupId)
  }, [langMode, removeGroupBattery])

  // 当前右键目标是否为可删除的用户内容（用户提示词 / 用户模板 / GROUPS 成组电池）。
  const rawContextMenuDeletable = contextMenu ? getDeletableKind(contextMenu.battery) : null
  // group 删除受 transport 能力闸门约束；其余（prompt/template）不受影响。
  const contextMenuDeletable = rawContextMenuDeletable?.kind === 'group' && !canDeleteGroups
    ? null
    : rawContextMenuDeletable

  const handleContextMenuDelete = useCallback(() => {
    if (!contextMenu) return
    const deletable = getDeletableKind(contextMenu.battery)
    if (deletable?.kind === 'prompt') removePrompt(deletable.promptId)
    else if (deletable?.kind === 'template') removeUserTemplate(deletable.groupId)
    else if (deletable?.kind === 'group' && canDeleteGroups) {
      confirmAndRemoveGroup(deletable.groupId, deleteGroupName(contextMenu.battery))
    }
    closeContextMenu()
  }, [contextMenu, removePrompt, removeUserTemplate, canDeleteGroups, confirmAndRemoveGroup, deleteGroupName, closeContextMenu])

  // 行内删除按钮回调（仅 GROUPS 行启用）：稳定引用，供所有行复用，保持 BatteryRow memo 命中。
  const handleRowDelete = useCallback((battery: Battery) => {
    confirmAndRemoveGroup(battery.id, deleteGroupName(battery))
  }, [confirmAndRemoveGroup, deleteGroupName])

  // 已收藏电池/模板的 id 集合：行内用来决定是否渲染黄色五角星标记。
  const favoriteIds = useMemo(
    () => new Set(favoriteBatteries.map((f) => f.batteryId)),
    [favoriteBatteries],
  )

  const handleContextMenuDevNote = useCallback(() => {
    if (!contextMenu) return
    const battery = contextMenu.battery
    const displayName = langMode === 'zh' ? battery.name : (battery.nameEn || formatIdAsLabel(battery.id))
    setDevNoteTargets(prev => {
      if (prev.some(t => t.id === battery.id)) return prev
      return [...prev, { id: battery.id, name: displayName }]
    })
    closeContextMenu()
  }, [contextMenu, langMode, closeContextMenu])

  const contextMenuIsTemplate = contextMenu ? isTemplateBattery(contextMenu.battery) : false

  const handleContextMenuViewDetails = useCallback(() => {
    if (!contextMenu) return
    const battery = contextMenu.battery
    if (!isTemplateBattery(battery)) return
    const displayName = langMode === 'zh' ? battery.name : (battery.nameEn || formatIdAsLabel(battery.id))
    setTemplateDetailTarget({ id: battery.id, name: displayName })
    closeContextMenu()
  }, [contextMenu, langMode, closeContextMenu])

  // 渲染单个 rail 大标签按钮（电池组 / 收藏组共用）
  const renderRailButton = (label: string) => {
    const isActive = focusedBigLabel === label
    const fullLabel = formatBigLabel(label)
    const railText = formatBigLabelRailText(label)
    const railRest = formatBigLabelRailRest(label)
    const isFavorites = label === FAVORITES_BIG
    const isPresets = label === PRESETS_BIG
    const isIconButton = isFavorites || isPresets
    return (
      <button
        key={label}
        type="button"
        className={[
          'bb-rail-button',
          `tab-${label}`,
          isFavorites ? 'bb-rail-button--favorites' : '',
          isPresets ? 'bb-rail-button--presets' : '',
          isIconButton ? 'bb-rail-button--icon' : '',
          isActive ? 'active' : '',
          dragBigLabel === label ? 'tab-dragging' : '',
          dragOverBigLabel === label && dragBigLabel !== label ? 'tab-drag-over' : '',
        ].filter(Boolean).join(' ')}
        aria-label={fullLabel}
        aria-current={isActive ? 'true' : undefined}
        draggable
        onDragStart={e => handleTabDragStart(e, label)}
        onDragEnd={handleTabDragEnd}
        onDragOver={e => handleTabDragOver(e, label)}
        onDragLeave={handleTabDragLeave}
        onDrop={e => handleTabDrop(e, label)}
        onClick={() => handleRailBigLabelClick(label)}
      >
        {isIconButton ? (
          <span className="bb-rail-icon" aria-hidden>
            {isFavorites ? <FavoritesRailIcon /> : <PresetsRailIcon />}
          </span>
        ) : (
          <>
            <span className="bb-rail-button-short">{railText}</span>
            {railRest && <span className="bb-rail-button-rest">{railRest}</span>}
          </>
        )}
      </button>
    )
  }

  // 渲染单个电池条目（普通列表 + 覆盖层共用）
  // inFavoritesView：处于「收藏」视图内时不再重复显示黄色五角星（语境已表明已收藏）。
  const renderBatteryRow = (battery: Battery, inFavoritesView = false) => (
    <BatteryRow
      key={catalogBatteryKey(battery)}
      battery={battery}
      langMode={langMode}
      stars={batteryStars[battery.id] ?? 0}
      devNoteCount={batteryDevNotes[battery.id]?.length ?? 0}
      showDevNoteCount={showDevNoteCount}
      isFavorite={!inFavoritesView && favoriteIds.has(battery.id)}
      isContextActive={contextMenu?.battery.id === battery.id}
      templateMode={batteryFilterMode === 'templates'}
      templateMaxLineW={templateMaxLineW}
      onDragStart={handleDragStart}
      onContextMenu={handleRowContextMenu}
      onDelete={canDeleteGroups && getDeletableKind(battery)?.kind === 'group' ? handleRowDelete : undefined}
    />
  )

  // 大标签名称叠在分组分割线上：默认白色，带品牌色的大标签沿用其 rail 配色（tab-*）。
  // 收藏视图的「收藏」组自带同名小标签头，省略大标签标题避免重复。
  const renderBigSectionTitle = (bigLabel: string, index: number) => {
    if (bigLabel === FAVORITES_BIG) return null
    return (
      <div className={`bb-big-content-title tab-${bigLabel}${index === 0 ? ' bb-big-content-title--first' : ''}`}>
        {formatBigLabel(bigLabel)}
      </div>
    )
  }

  // 渲染单个小标签手风琴分组（Develop 与 Templates 共用，保证两模式小标签 UX 一致）
  const renderSmallSection = (
    bigLabel: string,
    smallLabel: string,
    items: Battery[],
    smallLabelsInSection: string[],
  ) => {
    const groupKey = smallGroupKey(bigLabel, smallLabel)
    const isOpen = isSmallOpen(bigLabel, smallLabel)
    const isExpandedOverlay = expandedSmallLabel === groupKey
    return (
      <div
        key={groupKey}
        className={[
          'bb-small-section',
          isOpen ? 'bb-small-section--open' : '',
          isExpandedOverlay ? 'bb-small-section--overlay' : '',
          dragSmallLabel === smallLabel ? 'group-dragging' : '',
          dragOverSmallLabel === smallLabel && dragSmallLabel !== smallLabel ? 'group-drag-over' : '',
        ].filter(Boolean).join(' ')}
        draggable
        onDragStart={e => handleGroupDragStart(e, smallLabel)}
        onDragEnd={handleGroupDragEnd}
        onDragOver={e => handleGroupDragOver(e, smallLabel)}
        onDragLeave={handleGroupDragLeave}
        onDrop={e => handleGroupDrop(e, bigLabel, smallLabelsInSection, smallLabel)}
      >
        <div
          className="bb-small-header"
          ref={el => { smallHeaderRefs.current[groupKey] = el }}
        >
          <button
            className="bb-small-toggle"
            onClick={() => toggleSmallOpen(bigLabel, smallLabel)}
          >
            <span className={`bb-chevron bb-chevron--sm${isOpen ? ' bb-chevron--open' : ''}`} aria-hidden>▶</span>
            <span className="bb-small-text">
              {smallLabel === FAVORITES_SMALL
                ? 'Favorites'
                : batteryFilterMode === 'templates'
                  ? formatIdAsLabel(smallLabel)
                  : formatSmallLabel(smallLabel)}
            </span>
            <span className="bb-small-count">{items.length}</span>
          </button>
        </div>

        {isOpen && !isExpandedOverlay && (
          <div className="bb-row-list">
            {items.length === 0 && (
              <div className="battery-empty-small">
                {smallLabel === FAVORITES_SMALL ? 'No favorites' : (langMode === 'en' ? 'No batteries' : '暂无电池')}
              </div>
            )}
            {items.map(b => renderBatteryRow(b, bigLabel === FAVORITES_BIG))}
          </div>
        )}
      </div>
    )
  }

  // 渲染单个大标签内容分组（电池视图 / 收藏视图共用；预设走专用面板）
  const renderBigSection = (bigLabel: string, index: number) => {
    if (bigLabel === PRESETS_BIG) {
      return (
        <div
          key={bigLabel}
          className={`bb-big-content-section${index > 0 ? ' bb-big-content-section--separated' : ''}`}
          ref={el => { bigSectionRefs.current[bigLabel] = el }}
        >
          {renderBigSectionTitle(bigLabel, index)}
          <PresetsRailPanel batteries={batteries} langMode={langMode} />
        </div>
      )
    }
    const groupedBySmall = groupBatteriesBySmall(getBatteriesForBig(bigLabel), bigLabel)
    const smallLabelsToRender = getSmallLabelsToRender(bigLabel, groupedBySmall)

    // Templates（非收藏）：与 Develop 一致地按小标签分组——目录结构为
    // `templates/{大标签}/{小标签}/{模板}/…` 的模板进小标签手风琴；扁平
    // `templates/{大标签}/{模板}/…`（子目录名即卡片名，无独立小标签）直接平铺卡片。
    if (batteryFilterMode === 'templates' && bigLabel !== FAVORITES_BIG) {
      const allItems = getBatteriesForBig(bigLabel)
      const flatItems: Battery[] = []
      const nestedBySmall: Record<string, Battery[]> = {}
      for (const b of allItems) {
        const small = getTemplateSmallLabel(b)
        if (small === null) flatItems.push(b)
        else (nestedBySmall[small] ??= []).push(b)
      }
      const sortedFlat = sortBatteriesInGroup(flatItems, bigLabel, '')
      const nestedLabels = applyOrder(
        batteryOrder.smallLabels[bigLabel] ?? [],
        sortSmallLabels(Object.keys(nestedBySmall), bigLabel),
      )
      for (const k of Object.keys(nestedBySmall)) {
        nestedBySmall[k] = sortBatteriesInGroup(nestedBySmall[k], bigLabel, k)
      }
      const isEmpty = sortedFlat.length === 0 && nestedLabels.length === 0
      return (
        <div
          key={bigLabel}
          className={`bb-big-content-section${index > 0 ? ' bb-big-content-section--separated' : ''}`}
          ref={el => { bigSectionRefs.current[bigLabel] = el }}
        >
          {isEmpty && (
            <div className="battery-empty-small">
              {langMode === 'en' ? 'No templates' : '暂无模板'}
            </div>
          )}
          {!isEmpty && renderBigSectionTitle(bigLabel, index)}
          {sortedFlat.length > 0 && (
            <div className="bb-row-list bb-row-list--templates-flat">
              {sortedFlat.map(b => renderBatteryRow(b))}
            </div>
          )}
          {nestedLabels.map(smallLabel =>
            renderSmallSection(bigLabel, smallLabel, nestedBySmall[smallLabel] ?? [], nestedLabels),
          )}
        </div>
      )
    }

    return (
      <div
        key={bigLabel}
        className={`bb-big-content-section${index > 0 ? ' bb-big-content-section--separated' : ''}`}
        ref={el => { bigSectionRefs.current[bigLabel] = el }}
      >
        {smallLabelsToRender.length === 0 && (
          <div className="battery-empty-small">
            {batteryFilterMode === 'templates'
              ? (langMode === 'en' ? 'No templates' : '暂无模板')
              : (langMode === 'en' ? 'No batteries' : '暂无电池')}
          </div>
        )}
        {smallLabelsToRender.length > 0 && renderBigSectionTitle(bigLabel, index)}
        {smallLabelsToRender.map(smallLabel =>
          renderSmallSection(bigLabel, smallLabel, groupedBySmall[smallLabel] ?? [], smallLabelsToRender),
        )}
      </div>
    )
  }

  return (
    <aside
      ref={asideRef}
      className={`battery-bar battery-bar--vertical${batteryFilterMode === 'templates' ? ' mode-templates' : ''}${isCollapsed ? ' battery-bar--collapsed' : ''}`}
      style={isCollapsed ? undefined : { width, minWidth: width }}
    >
      {/* 搜索结果计数（仅在搜索时显示） */}
      {!isCollapsed && searchQuery && (
        <div className="search-result-count">
          {searchResultCount > 0
            ? (langMode === 'en' ? `Found ${searchResultCount} node(s)` : `找到 ${searchResultCount} 个节点`)
            : (langMode === 'en' ? 'No matching nodes' : '未找到匹配节点')}
        </div>
      )}

      {/* ── Develop / Templates：竖向手风琴（大标签 → 小标签 → 电池行） ─── */}
      <div className="bb-body">
        {bigLabels.length > 0 && (
          <>
            {/* 悬浮展开（非钉住）时 nav 脱离文档流（绝对定位覆盖右侧），用占位元素保留 36px 槽位，
                确保右侧 .bb-scroller 宽度不因悬浮而变化（临时预览，不挤压、不回流）。
                钉住（isRailPinned）则相反：nav 保持在正常文档流中占据真实宽度，把
                .bb-scroller 正常挤窄，而不是浮在其上方遮挡内容（见 bb-big-rail--pinned）。 */}
            {isRailExpanded && !isRailPinned && <div className="bb-big-rail-spacer" aria-hidden />}
            <nav
              className={`bb-big-rail${isRailShown ? ' bb-big-rail--expanded' : ''}${isRailPinned ? ' bb-big-rail--pinned' : ''}`}
              aria-label={langMode === 'en' ? 'Battery categories' : '电池大标签'}
              onMouseEnter={handleRailMouseEnter}
              onMouseLeave={handleRailMouseLeave}
            >
              <div className="bb-rail-scroll-region">
                <div ref={railGroupRef} className="bb-rail-group bb-rail-group--batteries">
                  {batteryLabels.map(renderRailButton)}
                </div>
                {railThumb.visible && (
                  <span className="bb-rail-scrollbar" aria-hidden>
                    <span
                      className="bb-rail-scrollbar__thumb"
                      style={{ height: railThumb.height, transform: `translateY(${railThumb.top}px)` }}
                    />
                  </span>
                )}
              </div>
              <div className="bb-rail-group bb-rail-group--collection">
                <button
                  type="button"
                  className="bb-rail-button bb-rail-button--icon bb-rail-button--collapse"
                  aria-label={isCollapsed
                    ? (langMode === 'en' ? 'Expand battery list' : '展开电池栏')
                    : (langMode === 'en' ? 'Collapse battery list' : '收起电池栏')}
                  title={isCollapsed
                    ? (langMode === 'en' ? 'Expand' : '展开电池栏')
                    : (langMode === 'en' ? 'Collapse' : '收起电池栏')}
                  onClick={() => setIsCollapsed(c => !c)}
                >
                  <span className="bb-rail-icon" aria-hidden>
                    <CollapseRailIcon collapsed={isCollapsed} />
                  </span>
                </button>
                <button
                  type="button"
                  className={`bb-rail-button bb-rail-button--icon bb-rail-button--mode${batteryFilterMode === 'templates' ? ' is-templates' : ''}`}
                  aria-label={langMode === 'en'
                    ? (batteryFilterMode === 'templates' ? 'Switch to Develop' : 'Switch to Templates')
                    : (batteryFilterMode === 'templates' ? '切换到开发模式' : '切换到模板模式')}
                  title={langMode === 'en'
                    ? (batteryFilterMode === 'templates' ? 'Templates · click for Develop' : 'Develop · click for Templates')
                    : (batteryFilterMode === 'templates' ? '模板模式 · 点击切换开发' : '开发模式 · 点击切换模板')}
                  onClick={() => setBatteryFilterMode(batteryFilterMode === 'templates' ? 'develop' : 'templates')}
                >
                  <span className="bb-rail-icon" aria-hidden>
                    <ModeToggleRailIcon />
                  </span>
                </button>
                {collectionLabels.map(renderRailButton)}
              </div>
            </nav>
          </>
        )}

        {!isCollapsed && (
        <div
          className={`bb-scroller bb-scroller--${railView}${expandedSmallLabel ? ' bb-scroller--has-overlay' : ''}`}
          ref={scrollerRef}
          onScroll={persistScroll}
          onClick={handleScrollerClick}
        >
          {bigLabels.length === 0 && (
            <div className="battery-empty">
              {batteryFilterMode === 'templates'
                ? (langMode === 'en' ? 'No templates' : '暂无模板')
                : (langMode === 'en' ? 'No batteries' : '暂无电池')}
            </div>
          )}

          {searchQuery && batteryFilterMode === 'templates' && (
            <div className="bb-row-list bb-row-list--templates-flat">
              {searchBatteries.length === 0 && (
                <div className="battery-empty-small">
                  {langMode === 'en' ? 'No templates' : '暂无模板'}
                </div>
              )}
              {searchBatteries.map(b => renderBatteryRow(b))}
            </div>
          )}

          {searchQuery && batteryFilterMode !== 'templates' && (
            <div className="bb-small-list">
              {searchSmallLabelsToRender.length === 0 && (
                <div className="battery-empty-small">
                  {langMode === 'en' ? 'No batteries' : '暂无电池'}
                </div>
              )}
              {searchSmallLabelsToRender.map(smallLabel => {
                const sectionKey = '__search__'
                const groupKey = smallGroupKey(sectionKey, smallLabel)
                const items = searchGroupedBySmall[smallLabel] ?? []
                const isOpen = isSmallOpen(sectionKey, smallLabel)
                const isExpandedOverlay = expandedSmallLabel === groupKey
                return (
                  <div
                    key={groupKey}
                    className={[
                      'bb-small-section',
                      isOpen ? 'bb-small-section--open' : '',
                      isExpandedOverlay ? 'bb-small-section--overlay' : '',
                      dragSmallLabel === smallLabel ? 'group-dragging' : '',
                      dragOverSmallLabel === smallLabel && dragSmallLabel !== smallLabel ? 'group-drag-over' : '',
                    ].filter(Boolean).join(' ')}
                    draggable
                    onDragStart={e => handleGroupDragStart(e, smallLabel)}
                    onDragEnd={handleGroupDragEnd}
                    onDragOver={e => handleGroupDragOver(e, smallLabel)}
                    onDragLeave={handleGroupDragLeave}
                    onDrop={e => handleGroupDrop(e, sectionKey, searchSmallLabelsToRender, smallLabel)}
                  >
                    <div
                      className="bb-small-header"
                      ref={el => { smallHeaderRefs.current[groupKey] = el }}
                    >
                      <button
                        className="bb-small-toggle"
                        onClick={() => toggleSmallOpen(sectionKey, smallLabel)}
                      >
                        <span className={`bb-chevron bb-chevron--sm${isOpen ? ' bb-chevron--open' : ''}`} aria-hidden>▶</span>
                        <span className="bb-small-text">
                          {smallLabel === FAVORITES_SMALL
                            ? 'Favorites'
                            : formatSmallLabel(smallLabel)}
                        </span>
                        <span className="bb-small-count">{items.length}</span>
                      </button>
                    </div>

                    {isOpen && !isExpandedOverlay && (
                      <div className="bb-row-list">
                        {items.length === 0 && (
                          <div className="battery-empty-small">
                            {smallLabel === FAVORITES_SMALL ? 'No favorites' : (langMode === 'en' ? 'No batteries' : '暂无电池')}
                          </div>
                        )}
                        {items.map(b => renderBatteryRow(b))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!searchQuery && activeViewLabels.map((bigLabel, index) => renderBigSection(bigLabel, index))}

          {!searchQuery && activeViewLabels.length === 0 && railView === 'collection' && (
            <div className="battery-empty-small">
              {langMode === 'en' ? 'Empty' : '暂无内容'}
            </div>
          )}

          {/* 小标签 + 号展开覆盖层：从该小标签头部下方铺到容器底部，多列网格平铺该组全部电池 */}
          {expandedSmallLabel && overlayStyle && (
            <div
              className="bb-expanded-overlay"
              style={overlayStyle}
              onClick={e => e.stopPropagation()}
            >
              <div className="bb-expanded-overlay-grid">
                {expandedOverlayItems.map(b => renderBatteryRow(b, expandedOverlayIsFavorites))}
                {expandedOverlayItems.length === 0 && (
                  <div className="battery-empty-small">
                    {langMode === 'en' ? 'No batteries' : '暂无电池'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      {/* 图钉：固定在电池栏最底部（不属于 rail 内部可滚动区域），无论分类多少、rail 是否
          展开都始终可见可点；点击后大标签 rail 常驻展开，再次点击取消。 */}
      {bigLabels.length > 0 && (
        <div className="bb-pin-footer" style={{ width: isRailShown ? 98 : 36 }}>
          <button
            type="button"
            className={`bb-rail-button bb-rail-button--icon bb-rail-button--pin${isRailPinned ? ' active' : ''}`}
            aria-label={langMode === 'en'
              ? (isRailPinned ? 'Unpin category rail' : 'Pin category rail expanded')
              : (isRailPinned ? '取消常驻展开' : '钉住大标签常驻展开')}
            aria-pressed={isRailPinned}
            title={langMode === 'en'
              ? (isRailPinned ? 'Pinned · click to unpin' : 'Pin rail expanded')
              : (isRailPinned ? '已钉住 · 点击取消' : '钉住大标签，常驻展开')}
            onClick={() => setIsRailPinned(p => !p)}
          >
            <span className="bb-rail-icon" aria-hidden>
              <PinRailIcon />
            </span>
          </button>
        </div>
      )}

      {/* 右侧拖拽宽度把手 */}
      {!isCollapsed && (
        <div
          className="bb-resize-handle"
          onMouseDown={onResizeMouseDown}
          title={langMode === 'en' ? 'Drag to resize' : '拖动调整宽度'}
        />
      )}

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="battery-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          {contextMenuIsFavorite ? (
            <div className="battery-context-menu-item" onClick={handleContextMenuRemoveFavorite}>
              ⭐ Remove from Favorites
            </div>
          ) : (
            <div className="battery-context-menu-item" onClick={handleContextMenuAddFavorite}>
              ⭐ Add to Favorites
            </div>
          )}
          <div className="battery-context-menu-item" onClick={handleContextMenuDevNote}>
            📝 Dev Notes
          </div>
          {contextMenuIsTemplate && (
            <div className="battery-context-menu-item" onClick={handleContextMenuViewDetails}>
              {langMode === 'en' ? '📄 View details' : '📄 查看详细信息'}
            </div>
          )}
          {contextMenuDeletable && (
            <div
              className="battery-context-menu-item battery-context-menu-item--danger"
              onClick={handleContextMenuDelete}
            >
              🗑 {langMode === 'en'
                ? (contextMenuDeletable.kind === 'prompt'
                    ? 'Delete prompt'
                    : contextMenuDeletable.kind === 'group' ? 'Delete group battery' : 'Delete template')
                : (contextMenuDeletable.kind === 'prompt'
                    ? '删除此提示词'
                    : contextMenuDeletable.kind === 'group' ? '删除此 group 电池' : '删除此模板')}
            </div>
          )}
        </div>
      )}

      {/* 开发记录弹窗（多实例，每个电池独立一个，按 index 错开位置） */}
      {devNoteTargets.map((target, idx) => (
        <DevNoteModal
          key={target.id}
          batteryId={target.id}
          batteryName={target.name}
          index={idx}
          onClose={() => setDevNoteTargets(prev => prev.filter(t => t.id !== target.id))}
        />
      ))}

      {/* 模板详细信息弹窗 */}
      {templateDetailTarget && (
        <TemplateDetailModal
          batteryId={templateDetailTarget.id}
          batteryName={templateDetailTarget.name}
          onClose={() => setTemplateDetailTarget(null)}
        />
      )}
    </aside>
  )
}

export default BatteryBar
