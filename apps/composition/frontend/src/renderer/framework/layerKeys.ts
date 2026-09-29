/**
 * Render order shared by renderer plugins: graph output layers first, editable
 * baked layers second, so hand edits sit above generated output consistently.
 */
export function mergeRenderableVoxelLayerKeys(voxelKeys: string[], bakedKeys: string[]): string[] {
  return [...voxelKeys, ...bakedKeys]
}

// Baked-layer paint (painter) order. The panel lists baked layers top→bottom in
// pre-order DFS (parent above its indented children, first sibling on top). The
// painter draws back→front (later layerIdx = on top), so we invert that into a
// back-to-front sequence honoring two rules:
//   1. a child renders ON TOP of its parent  → emit parent first (lower layerIdx)
//   2. an upper-listed sibling renders ON TOP → emit siblings in REVERSE
// Keys are `baked:${nodePath}`, so the tree is derivable from the keys alone.
// (Shared here — both the billboard painter and the host's SELECT attribution
// need the identical order so "top-most" matches what is drawn on top.)
export function orderBakedKeysForRender(keys: string[]): string[] {
  const pathOf = (k: string): string => (k.startsWith('baked:') ? k.slice(6) : k)
  const parentPath = (p: string): string => {
    const segs = p.split('/').filter(Boolean)
    segs.pop()
    return segs.length ? '/' + segs.join('/') : '/'
  }
  const childrenOf = (pp: string): string[] => keys.filter((k) => parentPath(pathOf(k)) === pp)
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (k: string): void => {
    if (seen.has(k)) return
    seen.add(k)
    out.push(k) // parent first → below its children
    const kids = childrenOf(pathOf(k))
    for (let i = kids.length - 1; i >= 0; i--) visit(kids[i]) // first sibling last → on top
  }
  const roots = keys.filter((k) => parentPath(pathOf(k)) === '/')
  for (let i = roots.length - 1; i >= 0; i--) visit(roots[i])
  for (const k of keys) if (!seen.has(k)) out.push(k) // safety: orphaned paths
  return out
}
