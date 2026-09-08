// Asset-resolver — root-sandboxed filesystem CRUD for plugin asset directories. Call createAssetResolver(config): list assets (filter by type or suffix), read / write / remove by root-relative path, watch config.types buckets (or the full root) for external changes, subscribe to add / change / remove events. All I/O stays under config.root.

export * from './types.js'
export { createAssetResolver } from './asset-resolver.js'
