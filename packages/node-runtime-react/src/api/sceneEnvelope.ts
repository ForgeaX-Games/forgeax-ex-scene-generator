// Phase-2 wire envelope hydration — see
// wb-scene-generator-scene-tree-storage.md §3. The backend's
// `/nodes/outputs/batch` and single-port `/nodes/:id/outputs/:portId` routes
// can ship a DEDUPED payload instead of `tooLarge` for a port whose branches
// share one large field (e.g. `scene_focus_path`'s decoration tree broadcast):
// `value` still has the normal `DataTreeEntry[]` shape, but any item field
// that repeats is replaced by `{ __outputCacheBlobRef: hash }`, with the one
// real copy sitting in the sidecar `blobs[hash]`. `hydrateBlobRefs` undoes
// that substitution so every OTHER layer (nodeOutputs store, probes,
// tooltips, the renderer iframe) keeps seeing the exact same shape it always
// has — no envelope-awareness needed anywhere else.

// Deliberately NOT importing `isOutputCacheBlobRef` from `@forgeax/node-runtime`
// here: that package's root entry barrels in the WHOLE kernel (executor,
// dispatcher, storage, path-resolver, …), which pulls Node-only builtins
// (`node:fs`, `node:crypto`, `node:zlib`, …) into any bundle that imports this
// module as a VALUE — and this module IS reachable from the browser bundle
// (HttpApiClient, pipelineStore). Vite then fails at runtime with "Module
// node:fs has been externalized for browser compatibility", breaking the
// renderer surface's canvas mount entirely. The sentinel key is a tiny, stable
// string contract, so it's duplicated here instead — keep in sync with
// `packages/node-runtime/src/layer1/storage/blob-ref-contract.ts`.
const OUTPUT_CACHE_BLOB_REF_KEY = '__outputCacheBlobRef' as const

function isOutputCacheBlobRef(v: unknown): v is { readonly [OUTPUT_CACHE_BLOB_REF_KEY]: string } {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as Record<string, unknown>)[OUTPUT_CACHE_BLOB_REF_KEY] === 'string'
  )
}

/**
 * Walk `value` and replace every `{ __outputCacheBlobRef: hash }` occurrence
 * with `blobs[hash]`. A no-op (returns `value` unchanged, by reference) when
 * `blobs` is absent/empty — the common case for every port that never went
 * through the envelope path. Missing hashes (should not happen; defensive
 * only) resolve to `undefined` rather than throwing.
 */
export function hydrateBlobRefs(value: unknown, blobs: Record<string, unknown> | undefined): unknown {
  if (!blobs || Object.keys(blobs).length === 0) return value
  return hydrateRec(value, blobs)
}

function hydrateRec(value: unknown, blobs: Record<string, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value
  if (isOutputCacheBlobRef(value)) return blobs[value[OUTPUT_CACHE_BLOB_REF_KEY]]
  if (Array.isArray(value)) return value.map((el) => hydrateRec(el, blobs))
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(obj)) out[key] = hydrateRec(child, blobs)
  return out
}
