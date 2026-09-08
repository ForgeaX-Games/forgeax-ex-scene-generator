// Sentinel contract for content-addressed blob references embedded in
// OutputCache chunk files and (Phase 2) HTTP output envelopes. Kept in its own
// tiny module (no fs/crypto imports) so the frontend package can import just
// the key/guard without pulling in any Node-only storage code — see
// wb-scene-generator-scene-tree-storage.md.

export const OUTPUT_CACHE_BLOB_REF_KEY = '__outputCacheBlobRef' as const

export interface OutputCacheBlobRef {
  readonly [OUTPUT_CACHE_BLOB_REF_KEY]: string
}

export function isOutputCacheBlobRef(v: unknown): v is OutputCacheBlobRef {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as Partial<OutputCacheBlobRef>)[OUTPUT_CACHE_BLOB_REF_KEY] === 'string'
  )
}

export function makeOutputCacheBlobRef(hash: string): OutputCacheBlobRef {
  return { [OUTPUT_CACHE_BLOB_REF_KEY]: hash }
}
