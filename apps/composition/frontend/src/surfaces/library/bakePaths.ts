import { pathParent } from '../../renderer/framework/pathTree.js'

/**
 * De-duplicate the scene paths of a bake batch.
 *
 * Output layers live in a `${nodeId}:${nodePath}` key space, so two rival
 * `scene_output` sinks can select layers that share a scene path with different
 * content. The backend's `bakeLayersForProjectDir` only de-duplicates the ROOT
 * segment (`/Island` → `/Island 2`) with one rename table for the whole batch,
 * so those two would land on the same full path and the second `upsertCells`
 * would silently overwrite the first. Renaming the colliding leaf here keeps
 * both, and keeps the backend untouched.
 *
 * `layers` must arrive in the panel's DFS order (parents before children) so a
 * renamed parent is already known when its children are remapped.
 */
export interface BakeSourceLayer {
  nodeId: string
  nodePath: string
}

export function dedupeBakePaths<T extends BakeSourceLayer>(
  layers: readonly T[],
): Array<{ layer: T; nodePath: string }> {
  /** `${nodeId}:${originalPath}` → final path (exact ancestor lookup). */
  const assigned = new Map<string, string>()
  /**
   * originalPath → first final path assigned to it. Fallback for a layer whose
   * parent came from a DIFFERENT sink (or was not selected): inherited ancestors
   * are byte-identical across sinks, so any of them is the correct parent.
   */
  const byOriginalPath = new Map<string, string>()
  const taken = new Set<string>()
  const out: Array<{ layer: T; nodePath: string }> = []

  for (const layer of layers) {
    const original = layer.nodePath
    const parent = pathParent(original)
    const base = original.split('/').filter(Boolean).pop() ?? ''
    const mappedParent =
      assigned.get(`${layer.nodeId}:${parent}`) ?? byOriginalPath.get(parent) ?? parent
    const join = (name: string): string => (mappedParent === '/' ? `/${name}` : `${mappedParent}/${name}`)

    let finalPath = join(base)
    let n = 2
    while (taken.has(finalPath)) finalPath = join(`${base} ${n++}`)

    taken.add(finalPath)
    assigned.set(`${layer.nodeId}:${original}`, finalPath)
    if (!byOriginalPath.has(original)) byOriginalPath.set(original, finalPath)
    out.push({ layer, nodePath: finalPath })
  }
  return out
}
