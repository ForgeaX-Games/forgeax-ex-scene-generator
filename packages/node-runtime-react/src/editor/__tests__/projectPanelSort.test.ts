import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectMeta } from '@forgeax/node-runtime'
import { setLocale } from '@forgeax/i18n'
import { compareProjectsForList } from '../components/chrome/ProjectPanel.js'
import { formatProjectTimestamp } from '../components/chrome/projectViews.js'
import { ensureProjectI18n, pt } from '../components/chrome/projectI18n.js'

function meta(id: string, overrides: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    id,
    type: 'scene',
    name: id,
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('compareProjectsForList', () => {
  it('does not promote the viewing project — order stays by updatedAt', () => {
    const locked = new Set<string>()
    const pipelined = new Set<string>()
    const a = meta('a', { updatedAt: '2026-06-01T00:00:00.000Z', name: 'Alpha' })
    const b = meta('b', { updatedAt: '2026-06-02T00:00:00.000Z', name: 'Bravo' })
    const sorted = [a, b].sort((x, y) => compareProjectsForList(x, y, locked, pipelined))
    expect(sorted.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('pins executing projects above the rest without reshuffling on select', () => {
    const locked = new Set(['exec'])
    const pipelined = new Set<string>()
    const exec = meta('exec', { updatedAt: '2026-01-01T00:00:00.000Z' })
    const recent = meta('recent', { updatedAt: '2026-06-10T00:00:00.000Z' })
    const sorted = [recent, exec].sort((x, y) => compareProjectsForList(x, y, locked, pipelined))
    expect(sorted.map((p) => p.id)).toEqual(['exec', 'recent'])
  })
})

describe('formatProjectTimestamp', () => {
  beforeEach(() => {
    ensureProjectI18n()
    localStorage.setItem('forgeax.locale', 'en')
    setLocale('en')
  })

  it('defaults to English when studio locale is en', () => {
    expect(pt('title')).toBe('Projects')
  })

  it('returns null for empty or invalid dates', () => {
    expect(formatProjectTimestamp('', 'created', 'en')).toBeNull()
    expect(formatProjectTimestamp('not-a-date', 'edited', 'en')).toBeNull()
  })

  it('labels created vs edited in English', () => {
    setLocale('en')
    const iso = new Date(Date.now() - 120_000).toISOString()
    expect(formatProjectTimestamp(iso, 'created', 'en')).toMatch(/^Created /)
    expect(formatProjectTimestamp(iso, 'edited', 'en')).toMatch(/^Edited /)
  })

  it('labels created vs edited in Chinese', () => {
    setLocale('zh')
    const iso = new Date(Date.now() - 120_000).toISOString()
    expect(formatProjectTimestamp(iso, 'created', 'zh')).toMatch(/^创建于/)
    expect(formatProjectTimestamp(iso, 'edited', 'zh')).toMatch(/^编辑于/)
  })
})
