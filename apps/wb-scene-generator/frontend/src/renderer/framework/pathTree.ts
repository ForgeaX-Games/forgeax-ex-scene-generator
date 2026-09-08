export interface PathTreeNode {
  pathKey: string
  segment: string
  /**
   * Every layer that projects to this exact scene path, in arrival order.
   * Usually one. More than one happens when SEVERAL `scene_output` sinks project
   * the SAME scene path with DIFFERENT content — e.g. two parallel branches that
   * both name their region `沙滩` under `/Island`. The panel renders one row per
   * entry so no sink is silently dropped (see `dedupeByContent` below for why
   * identical content still collapses to a single row).
   */
  layerKeys: string[]
  /**
   * Duplicate layers folded into a row, keyed by the `layerKeys` entry that
   * represents them. Every `scene_output` re-projects the ancestors it inherited
   * from upstream, so a path like `/Island` legitimately exists once per sink
   * with byte-identical content — one row is the right thing to SHOW. But the
   * canvas paints every layer in the store, so the row's eye toggle has to reach
   * the folded copies too, or hiding it visibly does nothing (only 1 of N copies
   * stops painting).
   */
  layerAliases?: Record<string, string[]>
  /** First entry of `layerKeys`; kept for single-layer consumers (baked rows). */
  layerKey?: string
  children: PathTreeNode[]
}

export interface VisiblePathTreeRow {
  node: PathTreeNode
  depth: number
}

interface FingerprintableLayer {
  nodePath: string
  nodeName?: string
  cells?: ReadonlyArray<{ x: number; y: number; z: number; token?: string }>
  assetName?: string
  schema?: string
}

// Content fingerprints are cached per layer OBJECT. The render store keeps a
// layer's object reference verbatim when its content is unchanged (see
// `voxelLayerEqual` in store.ts), so an unrelated graph edit that rebuilds the
// tree re-uses every cached fingerprint and only pays for what actually moved.
const fingerprintCache = new WeakMap<object, string>()

/**
 * Cheap content identity for a layer: cell count + an order-sensitive numeric
 * hash of the coordinates + the distinct token set + asset/schema. Numeric on
 * purpose — a JSON.stringify over a 25k-cell layer would dominate tree builds.
 */
function contentFingerprint(layer: FingerprintableLayer): string {
  const cached = fingerprintCache.get(layer)
  if (cached !== undefined) return cached
  const cells = layer.cells ?? []
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const tokens = new Set<string>()
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    h1 = (Math.imul(h1 ^ c.x, 16777619) ^ Math.imul(c.y + 1, 2654435761)) >>> 0
    h2 = (Math.imul(h2 ^ c.z, 2246822519) + h1) >>> 0
    if (c.token) tokens.add(c.token)
  }
  const fp = [
    cells.length,
    h1.toString(36),
    h2.toString(36),
    [...tokens].sort().join(','),
    layer.assetName ?? '',
    layer.schema ?? '',
  ].join('|')
  fingerprintCache.set(layer, fp)
  return fp
}

/**
 * Build the Layers-panel tree from a flat layer-key list.
 *
 * The tree is keyed by SCENE PATH, deliberately merging across sinks: every
 * `scene_output` shares one coordinate origin and re-projects the ancestors it
 * inherited from upstream, so the shared ancestors are byte-identical and must
 * appear once. That merge is why the panel shows one coherent scene tree rather
 * than one subtree per sink.
 *
 * Layer KEYS, however, live in a `${nodeId}:${nodePath}` space, so a path can
 * legitimately carry several distinct layers. Collecting them into `layerKeys`
 * (rather than overwriting a single `layerKey`) is what keeps a parallel branch
 * from being silently swallowed; `dedupeByContent` then collapses the
 * byte-identical ancestors back down to one row.
 */
export function buildPathTree<T extends FingerprintableLayer>(
  layerKeys: string[],
  layerOf: (key: string) => T | undefined,
  opts?: { dedupeByContent?: boolean },
): PathTreeNode[] {
  const dedupe = opts?.dedupeByContent !== false
  const root: PathTreeNode = { pathKey: '', segment: '', layerKeys: [], children: [] }
  // pathKey → fingerprint → the layerKey whose row represents that content.
  const seenContent = new Map<string, Map<string, string>>()
  for (const layerKey of layerKeys) {
    const layer = layerOf(layerKey)
    if (!layer) continue
    const segs = layer.nodePath.split('/').filter(Boolean)
    let cur = root
    let acc = ''
    for (let i = 0; i < segs.length; i++) {
      const segment = segs[i]
      acc += '/' + segment
      let child = cur.children.find((c) => c.pathKey === acc)
      if (!child) {
        child = { pathKey: acc, segment, layerKeys: [], children: [] }
        cur.children.push(child)
      }
      if (i === segs.length - 1) {
        let representedBy: string | undefined
        if (dedupe) {
          const fp = contentFingerprint(layer)
          let fps = seenContent.get(acc)
          if (!fps) { fps = new Map(); seenContent.set(acc, fps) }
          representedBy = fps.get(fp)
          if (representedBy === undefined) fps.set(fp, layerKey)
        }
        if (representedBy === undefined) {
          child.layerKeys.push(layerKey)
          if (child.layerKey === undefined) child.layerKey = layerKey
        } else {
          // Folded into an existing row — remember it so the row's visibility
          // toggle reaches this copy as well.
          const aliases = child.layerAliases ?? (child.layerAliases = {})
          ;(aliases[representedBy] ??= []).push(layerKey)
        }
      }
      cur = child
    }
  }
  return root.children
}

export function flattenVisiblePathTree(
  nodes: PathTreeNode[],
  collapsed: ReadonlySet<string>,
  depth = 0,
): VisiblePathTreeRow[] {
  const out: VisiblePathTreeRow[] = []
  for (const node of nodes) {
    out.push({ node, depth })
    if (!collapsed.has(node.pathKey)) {
      out.push(...flattenVisiblePathTree(node.children, collapsed, depth + 1))
    }
  }
  return out
}

/**
 * Every layer key below `node` (descendants only, excluding the node's own
 * rows), aliases included. Drives the Layers panel's Alt-click "hide this layer
 * AND everything under it": a scene path is both a layer with its own cells and
 * a parent, so the plain eye stays single-layer and the modifier opts into the
 * recursive sweep.
 */
export function collectDescendantLayerKeys(node: PathTreeNode): string[] {
  const out: string[] = []
  const walk = (n: PathTreeNode): void => {
    for (const key of n.layerKeys) {
      out.push(key)
      out.push(...(n.layerAliases?.[key] ?? []))
    }
    n.children.forEach(walk)
  }
  node.children.forEach(walk)
  return out
}

export function pathParent(p: string): string {
  const segs = p.split('/').filter(Boolean)
  segs.pop()
  return segs.length ? '/' + segs.join('/') : '/'
}
