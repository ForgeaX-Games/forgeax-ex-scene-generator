// 💡 共享 asset 图缓存(engine-agnostic)
//
// 各 plugin 在 asset drawMode 下都通过这一处加载贴图。设计点:
//
//   1. 每张图按 URL 缓存一个 HTMLImageElement;Image 对象同时作"是否已尝试加载"
//      状态机(存在 = 加载中或已成功;不存在 = 从未试 / 已 onerror 清掉等下次重试)
//
//   2. **per-URL load tick**:每张图 onload / 显式失效都 +1 当 URL 的 tick。
//      plugin 把"该 master 涉及到的 url@tick 列表"写进 useLayerSurface 的 cacheKey,
//      就能做到"图 X 加载完只重 build 用到 X 的 master,无关 master cacheKey 不变 → skip"。
//
//   3. subscribeToAssetReadiness 给 plugin 一个"任意 url tick 变化时唤醒我"的信号,
//      plugin 拿到信号后让自己 re-render(读取最新 tick 重算 cacheKey),
//      具体哪个 master 实际 rebuild 由 cacheKey 比较决定 —— 失效粒度收敛在 cacheKey。
//
//   4. RenderLifecycle.projectChanged 自行 hook(整库失效)。shared 层只 emit 事件。

import { RenderLifecycle } from '../lifecycle'
import { pluginUrl } from '../../../api/pluginHttp'

// ── URL 构造 ─────────────────────────────────────────────────────────────

/** alias → HTTP URL(单租户,无 slug;<img src> 走浏览器原生 fetch) */
export function getRegisteredAssetUrl(alias: string): string {
  return pluginUrl(`/api/v1/library/serve/${encodeURIComponent(alias)}`)
}

// ── 缓存核心 ─────────────────────────────────────────────────────────────

const imgCache = new Map<string, HTMLImageElement>()
const loadTickByUrl = new Map<string, number>()
const subscribers = new Set<() => void>()

// ── server-side image resolver (additive; browser default unchanged) ──────
//
// Server render (renderer/server) has no <img>/fetch. The server caller injects
// a resolver that maps an asset alias to a preloaded @napi-rs `Image`
// (CanvasImageSource-compatible). When set, getOrLoadImage consults it FIRST and
// NEVER touches `new Image()`; when it returns null the asset path degrades to
// color (the build already no-ops on a null image). When unset, the browser
// fetch+Image path runs exactly as before.
let serverImageResolver: ((alias: string) => unknown | null) | null = null

/** Install (or clear) the server-side alias→image resolver. Browser leaves it null. */
export function setServerImageResolver(
  fn: ((alias: string) => unknown | null) | null,
): void {
  serverImageResolver = fn
}

/** Reverse getRegisteredAssetUrl(): pull the alias back out of the serve URL. */
function aliasFromUrl(url: string): string | null {
  const marker = '/api/v1/library/serve/'
  const idx = url.indexOf(marker)
  if (idx < 0) return null
  try {
    return decodeURIComponent(url.slice(idx + marker.length))
  } catch {
    return null
  }
}

function bumpTick(url: string): void {
  loadTickByUrl.set(url, (loadTickByUrl.get(url) ?? 0) + 1)
}

function notifyReadiness(): void {
  for (const cb of subscribers) cb()
}

/**
 * URL 当前 tick;首次 = 0,每次 onload 或失效 +1。
 * plugin 把 `${url}@${getLoadTick(url)}` 拼进 cacheKey,达成 per-URL 局部重 build。
 */
export function getLoadTick(url: string): number {
  return loadTickByUrl.get(url) ?? 0
}

/**
 * 订阅"任一 url tick 变化"的脉冲。
 * plugin 在挂载期 subscribe,在 callback 里触发自身 re-render
 * (无需自动重 build,build 与否取决于 useLayerSurface 看 cacheKey 是否变化)。
 */
export function subscribeToAssetReadiness(cb: () => void): () => void {
  subscribers.add(cb)
  return () => { subscribers.delete(cb) }
}

/**
 * 取(或异步开始加载)指定 URL 的 HTMLImageElement。
 * 返回 null 表示"加载中、还不能用";onload 后 bumpTick + notifyReadiness。
 */
export function getOrLoadImage(url: string): HTMLImageElement | null {
  // Server path: a resolver is injected → use it exclusively, never `new Image()`.
  // null result = no image for this alias → caller degrades to color.
  if (serverImageResolver) {
    const alias = aliasFromUrl(url)
    if (alias === null) return null
    return (serverImageResolver(alias) as HTMLImageElement | null) ?? null
  }
  // No browser Image (e.g. node test without a resolver): degrade cleanly.
  if (typeof Image === 'undefined') return null

  const cached = imgCache.get(url)
  if (cached) {
    if (cached.complete && cached.naturalWidth > 0) return cached
    return null
  }
  const img = new Image()
  imgCache.set(url, img)
  img.onload = () => { bumpTick(url); notifyReadiness() }
  img.onerror = () => {
    // 加载失败:删 cache 等下次重试。
    // 不 bumpTick(避免 fail loop 触发无意义重 build)。
    imgCache.delete(url)
  }
  img.src = url
  return null
}

// ── 失效入口 ─────────────────────────────────────────────────────────────

/** 单个 alias 失效:清缓存,bump tick,通知 */
export function clearRegisteredAssetImgCache(alias: string): void {
  const url = getRegisteredAssetUrl(alias)
  imgCache.delete(url)
  bumpTick(url)
  notifyReadiness()
}

/** 整库失效:所有 url tick +1,清缓存 */
export function clearAllImgCache(): void {
  for (const url of imgCache.keys()) bumpTick(url)
  imgCache.clear()
  notifyReadiness()
}

// ── 模块加载即向 RenderLifecycle 注册 ────────────────────────────────────
// shared 层只 emit 事件,不 import 本模块。
// 注:legacy 的 registeredAssetReady / libraryZoneInvalidated 两个事件本仓库
// 尚未存在,故只 hook projectChanged(整库失效)。alias 级失效仍可由调用方
// 直接调 clearRegisteredAssetImgCache。

RenderLifecycle.projectChanged.on(() => clearAllImgCache())
