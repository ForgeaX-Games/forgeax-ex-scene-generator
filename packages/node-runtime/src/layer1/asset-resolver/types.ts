// Shared types for the asset-resolver module.

// One file under the asset root; type is the first path segment (e.g. 'textures/foo.png' → 'textures').
export interface AssetDescriptor {
  type: string
  relPath: string
  absPath: string
  size: number
  mtimeMs: number
}

// Watcher payloads (add / change / remove) and the handler that receives them.
export type AssetResolverEvent =
  | { kind: 'asset-added'; descriptor: AssetDescriptor }
  | { kind: 'asset-changed'; descriptor: AssetDescriptor }
  | { kind: 'asset-removed'; type: string; relPath: string; absPath: string }

export type AssetResolverEventHandler = (event: AssetResolverEvent) => void

// List filters (type prefix, path suffix) and factory config (root, type buckets, debounce).
export interface AssetListFilter {
  type?: string
  suffix?: string
}

export interface AssetResolverConfig {
  root: string
  types?: readonly string[]
  debounceMs?: number
}

// Stop callback returned from watch() and subscribe().
export type AssetUnsubscribe = () => void

// Root-sandboxed asset store returned by createAssetResolver.
export interface AssetResolver {
  list(filter?: AssetListFilter): AssetDescriptor[]
  read(relPath: string): Buffer | null
  write(relPath: string, bytes: Buffer): AssetDescriptor
  remove(relPath: string): void
  watch(): AssetUnsubscribe
  subscribe(handler: AssetResolverEventHandler): AssetUnsubscribe
  isWatching(): boolean
}
