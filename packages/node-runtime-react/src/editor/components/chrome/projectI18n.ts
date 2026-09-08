import { useEffect, useState } from 'react'
import { getLocale, onLocaleChange, registerCatalog, setLocale, t, type Locale } from '@forgeax/i18n'

export type { Locale }

const EN = {
  title: 'Projects',
  countTitle: '{count} total',
  countActiveTitle: '{count} total · {active} active',
  countActive: ' · {active} active',
  new: '+ New',
  filterPlaceholder: 'Filter projects…',
  filterAria: 'Filter projects',
  scopeLabel: 'Scope',
  scopeAllGames: 'All games',
  scopeToggleToAll: 'Show projects from all games',
  scopeToggleToGame: 'Scope to game "{game}"',
  statusExecuting: 'Executing',
  statusPipeline: 'Pipeline',
  statusViewCanvas: '{name} — click to view canvas',
  statusExpand: '{count} active — show',
  statusCollapse: 'Hide activity',
  emptyNone: 'No projects yet — create one.',
  emptyFilter: 'No projects match filter.',
  created: 'Created {when}',
  edited: 'Edited {when}',
  rename: 'Rename',
  delete: 'Delete',
  deleteDisabled: 'Cannot delete the last project',
  save: 'Save project as JSON',
} as const

const ZH = {
  title: '项目',
  countTitle: '共 {count} 个',
  countActiveTitle: '共 {count} 个 · {active} 个活动中',
  countActive: ' · {active} 个活动中',
  new: '+ 新建',
  filterPlaceholder: '筛选项目…',
  filterAria: '筛选项目',
  scopeLabel: '范围',
  scopeAllGames: '全部游戏',
  scopeToggleToAll: '显示所有游戏的项目',
  scopeToggleToGame: '仅显示游戏「{game}」的项目',
  statusExecuting: '执行中',
  statusPipeline: '管线',
  statusViewCanvas: '{name} — 点击查看画布',
  statusExpand: '{count} 个活动中 — 展开',
  statusCollapse: '收起活动状态',
  emptyNone: '暂无项目 — 请新建一个。',
  emptyFilter: '没有匹配的项目。',
  created: '创建于 {when}',
  edited: '编辑于 {when}',
  rename: '重命名',
  delete: '删除',
  deleteDisabled: '无法删除最后一个项目',
  save: '保存项目为 JSON',
} as const

/** Studio interface persists locale here — stay in sync, never guess from navigator. */
const STUDIO_LOCALE_KEY = 'forgeax.locale'

let registered = false

function readStudioLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  try {
    const raw = window.localStorage.getItem(STUDIO_LOCALE_KEY)
    if (raw === 'zh' || raw === 'en') return raw
  } catch {
    /* private mode */
  }
  return 'en'
}

function syncLocaleFromStudio(): void {
  setLocale(readStudioLocale())
}

export function ensureProjectI18n(): void {
  if (registered) return
  registered = true
  registerCatalog('en', 'projects', EN)
  registerCatalog('zh', 'projects', ZH)
  syncLocaleFromStudio()
}

export function useProjectLocale(): Locale {
  ensureProjectI18n()
  const [locale, setLocaleState] = useState(getLocale)
  useEffect(() => {
    const unsub = onLocaleChange(setLocaleState)
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === STUDIO_LOCALE_KEY) syncLocaleFromStudio()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      unsub()
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return locale
}

export function pt(key: keyof typeof EN, vars?: Record<string, string | number>): string {
  ensureProjectI18n()
  return t(`projects.${key}`, vars)
}

export function intlLocaleOf(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en'
}

const rtfCache = new Map<string, Intl.RelativeTimeFormat>()
const shortDateCache = new Map<string, Intl.DateTimeFormat>()
const fullDateCache = new Map<string, Intl.DateTimeFormat>()

function relativeTimeFormat(intlLocale: string): Intl.RelativeTimeFormat {
  let rtf = rtfCache.get(intlLocale)
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto' })
    rtfCache.set(intlLocale, rtf)
  }
  return rtf
}

function shortDateFormat(intlLocale: string, includeYear: boolean): Intl.DateTimeFormat {
  const key = `${intlLocale}|${includeYear ? 'y' : 'n'}`
  let dtf = shortDateCache.get(key)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat(intlLocale, {
      month: 'short',
      day: 'numeric',
      year: includeYear ? 'numeric' : undefined,
    })
    shortDateCache.set(key, dtf)
  }
  return dtf
}

function fullDateFormat(intlLocale: string): Intl.DateTimeFormat {
  let dtf = fullDateCache.get(intlLocale)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat(intlLocale, { dateStyle: 'medium', timeStyle: 'short' })
    fullDateCache.set(intlLocale, dtf)
  }
  return dtf
}

/** Minute bucket so relative labels stay stable within a frame burst. */
function formatBucketMs(): number {
  return Math.floor(Date.now() / 60_000)
}

const whenCache = new Map<string, string | null>()
const whenFullCache = new Map<string, string | null>()
const projectTimestampCache = new Map<string, string | null>()

function trimFormatCache<T>(cache: Map<string, T>, max = 512): void {
  if (cache.size <= max) return
  const drop = cache.size - max
  const keys = cache.keys()
  for (let i = 0; i < drop; i++) {
    const k = keys.next().value
    if (k === undefined) break
    cache.delete(k)
  }
}

/** Locale-aware relative or short date for project cards. */
export function formatWhen(iso: string | undefined, locale: Locale): string | null {
  if (!iso?.trim()) return null
  const bucket = formatBucketMs()
  const cacheKey = `${locale}|${iso}|${bucket}`
  const cached = whenCache.get(cacheKey)
  if (cached !== undefined) return cached

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    whenCache.set(cacheKey, null)
    return null
  }

  const intlLocale = intlLocaleOf(locale)
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000)

  let when: string
  if (Math.abs(diffSec) < 86_400 * 7) {
    const rtf = relativeTimeFormat(intlLocale)
    if (Math.abs(diffSec) < 45) when = rtf.format(0, 'second')
    else {
      const diffMin = Math.round(diffSec / 60)
      if (Math.abs(diffMin) < 60) when = rtf.format(diffMin, 'minute')
      else {
        const diffHr = Math.round(diffSec / 3_600)
        if (Math.abs(diffHr) < 24) when = rtf.format(diffHr, 'hour')
        else when = rtf.format(Math.round(diffSec / 86_400), 'day')
      }
    }
  } else {
    when = shortDateFormat(intlLocale, date.getFullYear() !== new Date().getFullYear()).format(date)
  }

  whenCache.set(cacheKey, when)
  trimFormatCache(whenCache)
  return when
}

export function formatWhenFull(iso: string | undefined, locale: Locale): string | null {
  if (!iso?.trim()) return null
  const cacheKey = `${locale}|full|${iso}`
  const cached = whenFullCache.get(cacheKey)
  if (cached !== undefined) return cached

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    whenFullCache.set(cacheKey, null)
    return null
  }
  const when = fullDateFormat(intlLocaleOf(locale)).format(date)
  whenFullCache.set(cacheKey, when)
  trimFormatCache(whenFullCache)
  return when
}

export function formatProjectTimestamp(
  iso: string | undefined,
  kind: 'created' | 'edited',
  locale: Locale,
): string | null {
  const cacheKey = `${locale}|${kind}|${iso}|${formatBucketMs()}`
  const cached = projectTimestampCache.get(cacheKey)
  if (cached !== undefined) return cached

  const when = formatWhen(iso, locale)
  const label = when ? pt(kind, { when }) : null
  projectTimestampCache.set(cacheKey, label)
  trimFormatCache(projectTimestampCache)
  return label
}
