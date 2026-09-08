// @forgeax/i18n — the node-editor's bilingual (zh/en) string layer: a single in-process catalog store every consumer (node-runtime React components, CLI, SKILL.md tooling) shares so one `t(key, vars?)` call resolves the active locale's message and formats ICU interpolations. It owns the whole locale contract: plugins contribute their own messages under a namespace via `registerCatalog` (namespaces merge to avoid key collisions), the active locale flips instantly without any module reload or React Suspense, and subscribers are notified so UIs can re-render in place. Sibling packages depend on this barrel for every user-facing string rather than holding their own ad-hoc dictionaries.

import IntlMessageFormat from 'intl-messageformat'

// Public vocabulary: the two supported locales, a per-namespace message map, and the nested locale → namespace → messages shape held in module state.
export type Locale = 'en' | 'zh'

export type MessageCatalog = Readonly<Record<string, string>>

interface CatalogStore {
  [locale: string]: { [namespace: string]: MessageCatalog }
}

// Module-level singleton state: the active locale, the merged catalog store, and the set of locale-change subscribers shared across every importer.
let activeLocale: Locale = 'en'
const store: CatalogStore = { en: {}, zh: {} }
const subscribers = new Set<(locale: Locale) => void>()

// Locale control surface: read the active locale, switch it instantly (notifying subscribers), and subscribe/unsubscribe to locale changes so UIs re-render in place.
export function getLocale(): Locale {
  return activeLocale
}

export function setLocale(locale: Locale): void {
  if (locale === activeLocale) return
  activeLocale = locale
  for (const sub of subscribers) sub(locale)
}

export function onLocaleChange(handler: (locale: Locale) => void): () => void {
  subscribers.add(handler)
  return () => subscribers.delete(handler)
}

// Catalog contribution entry point: each plugin registers its own messages under a namespace, merging into any existing entries so keys never collide across plugins.
export function registerCatalog(locale: Locale, namespace: string, messages: MessageCatalog): void {
  store[locale] ??= {}
  store[locale][namespace] = { ...(store[locale][namespace] ?? {}), ...messages }
}

// The lookup-and-format primitive every consumer calls, e.g. t('namespace.key', { name: 'Alice' }): resolves the active locale's message (falling back to English, then the raw key) and formats ICU interpolations when vars are given.
export function t(key: string, vars?: Record<string, string | number>): string {
  const [namespace, ...rest] = key.split('.')
  const messageKey = rest.join('.')
  const catalog = store[activeLocale]?.[namespace]
  const template = catalog?.[messageKey] ?? store.en?.[namespace]?.[messageKey] ?? key
  if (!vars || Object.keys(vars).length === 0) return template
  try {
    return new IntlMessageFormat(template, activeLocale).format(vars) as string
  } catch {
    return template
  }
}
