import { hydrateBlobRefs } from '@forgeax/node-runtime-react'

export type OutputPageRecord =
  | { path: Array<string | number>; value: unknown }
  | { path: Array<string | number>; appendText: string }

/** Apply ordered pages without concatenating a scene-sized JSON string. */
export function applyOutputPage(root: unknown, records: OutputPageRecord[]): unknown {
  for (const record of records) {
    const { path } = record
    if (!path.length) {
      root = 'value' in record ? record.value : String(root) + record.appendText
      continue
    }
    let parent = root as Record<string | number, unknown>
    for (const key of path.slice(0, -1)) {
      if (!parent || !Object.hasOwn(parent, key)) throw new Error('invalid output page path')
      parent = parent[key] as Record<string | number, unknown>
    }
    const key = path[path.length - 1]!
    // Define an own property: a JSON key named __proto__ is data, not code.
    Object.defineProperty(parent, key, {
      value: 'value' in record ? record.value : String(parent[key]) + record.appendText,
      enumerable: true, configurable: true, writable: true,
    })
  }
  return root
}

/** Retry only an expired snapshot; never return a partially assembled value. */
export async function readPagedOutput(path: string, get: <T>(path: string) => Promise<T>): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const manifest = await get<{ format: string; snapshot: string; pages: number }>(`${path}/pages`)
    if (manifest.format !== 'output-pages/1' || !Number.isSafeInteger(manifest.pages) || manifest.pages < 1) {
      throw new Error('invalid output page manifest')
    }
    let root: unknown
    try {
      // Bound concurrent parsing/memory and preserve parent-before-child order.
      for (let page = 0; page < manifest.pages; page++) {
        const records = await get<OutputPageRecord[]>(`${path}/pages/${encodeURIComponent(manifest.snapshot)}/${page}`)
        root = applyOutputPage(root, records)
      }
    } catch (error) {
      if (attempt === 0 && typeof error === 'object' && error !== null && 'status' in error && error.status === 410) continue
      throw error
    }
    const envelope = root as { value: unknown; blobs?: Record<string, unknown> }
    return hydrateBlobRefs(envelope.value, envelope.blobs)
  }
  throw new Error('output snapshot repeatedly expired')
}


/** A deferred output is not an empty scene; retain all existing result metadata. */
export async function readOutputBatch<T extends {
  nodeId: string; portId: string; value?: unknown; blobs?: Record<string, unknown>; tooLarge?: boolean
}>(items: readonly T[], prefix: string, get: <R>(path: string) => Promise<R>, metaOnly: boolean) {
  const results = []
  for (const item of items) {
    const value = item.tooLarge && !metaOnly
      ? await readPagedOutput(`${prefix}/nodes/${encodeURIComponent(item.nodeId)}/outputs/${encodeURIComponent(item.portId)}`, get)
      : hydrateBlobRefs(item.value, item.blobs)
    results.push({ ...item, value, tooLarge: false })
  }
  return results
}
