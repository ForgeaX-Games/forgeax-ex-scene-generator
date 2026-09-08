// Storage barrel — graph.json, history.jsonl, outputs/.

export * from './types.js'
export { canonicalize, computeGraphHash, GraphStore } from './graph-store.js'
export { HistoryLog } from './history-log.js'
export { OutputCache } from './output-cache.js'
export type { OutputCacheMeta, OutputCacheRetention, OutputCachePruneResult } from './output-cache.js'
export { OutputCacheBlobStore, BLOB_DIR_NAME } from './output-cache-blob-store.js'
export {
  OUTPUT_CACHE_BLOB_REF_KEY,
  isOutputCacheBlobRef,
  makeOutputCacheBlobRef,
  type OutputCacheBlobRef,
} from './blob-ref-contract.js'
export {
  compressPayload,
  expandPayload,
  compressVoxelCells,
  expandVoxelCells,
} from './voxel-cells-codec.js'
