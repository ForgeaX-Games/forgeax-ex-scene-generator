import type { BakedLayer } from '../baked/store.js'

function parentPath(path: string): string {
  const segs = path.split('/').filter(Boolean)
  segs.pop()
  return segs.length ? `/${segs.join('/')}` : '/'
}

export function orderBakedLayersForExport(layers: readonly BakedLayer[]): BakedLayer[] {
  const byPath = new Map(layers.map((layer) => [layer.nodePath, layer]))
  const childrenOf = (path: string): BakedLayer[] => layers.filter((layer) => parentPath(layer.nodePath) === path)
  const out: BakedLayer[] = []
  const seen = new Set<string>()

  const visit = (layer: BakedLayer): void => {
    if (seen.has(layer.nodePath)) return
    seen.add(layer.nodePath)
    out.push(layer)
    const kids = childrenOf(layer.nodePath)
    for (let i = kids.length - 1; i >= 0; i--) visit(kids[i]!)
  }

  const roots = layers.filter((layer) => parentPath(layer.nodePath) === '/')
  for (let i = roots.length - 1; i >= 0; i--) visit(roots[i]!)
  for (const layer of layers) {
    if (!seen.has(layer.nodePath) && !byPath.has(parentPath(layer.nodePath))) visit(layer)
  }
  for (const layer of layers) if (!seen.has(layer.nodePath)) out.push(layer)
  return out
}
