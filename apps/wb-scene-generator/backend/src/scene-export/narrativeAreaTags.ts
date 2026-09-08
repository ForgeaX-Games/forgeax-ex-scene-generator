/**
 * Narrative-driven area tags: given a raw scene-narrative node list
 * (`{ sceneName, locations: [{ name, parent }] }`, the shape produced by
 * upstream `scene_nodes.*.json` pipelines), validate that every narrative
 * location has exactly one same-named node in the baked scene, that the
 * narrative's parent chain holds as ancestor/descendant containment in the
 * baked tree (extra inserted layers between a matched parent and child are
 * allowed), and — only once validation fully passes — stamp `area_L{depth}`
 * onto every baked layer within each matched location's subtree. When
 * `narrative.sceneName` is present, it is also stamped as `region` onto
 * EVERY baked layer (not just matched subtrees — `region` is a whole-scene
 * identity, unlike the hierarchical `area_L{depth}`), matching how the
 * reference bundle sets every terrain template's `region` to the scene name.
 * See `docs/superpowers/specs/2026-07-01-scene-export-narrative-area-tag-design.md`
 * for the full design.
 */
import type { BakedLayer } from '../baked/store.js'

export interface NarrativeLocation {
  name: string
  parent: string | null
  [extra: string]: unknown
}

export interface NarrativeInput {
  sceneName?: string
  locations: NarrativeLocation[]
  [extra: string]: unknown
}

interface NarrativeNode {
  name: string
  parent: string | null
  depth: number
}

interface LocationMatch {
  name: string
  depth: number
  parent: string | null
  nodePath: string
}

class ValidationIssues {
  private readonly messages: string[] = []

  add(message: string): void {
    this.messages.push(message)
  }

  throwIfAny(): void {
    if (this.messages.length === 0) return
    const lines = this.messages.map((m) => `- ${m}`).join('\n')
    throw new Error(`Narrative area tag validation failed (${this.messages.length} issue${this.messages.length === 1 ? '' : 's'}):\n${lines}`)
  }
}

/**
 * Structural self-check of the narrative's name/parent tree, independent of
 * the baked scene. Returns a name → NarrativeNode map for locations whose
 * depth could be computed; dangling-parent and cycle members are excluded
 * (their problems are already recorded in `issues`) so later stages never
 * see a bogus depth for them.
 */
function buildNarrativeTree(narrative: NarrativeInput, issues: ValidationIssues): Map<string, NarrativeNode> {
  const byName = new Map<string, NarrativeLocation>()
  for (const loc of narrative.locations ?? []) {
    if (byName.has(loc.name)) {
      issues.add(`duplicate location name: "${loc.name}"`)
      continue
    }
    byName.set(loc.name, loc)
  }

  for (const loc of byName.values()) {
    if (loc.parent !== null && !byName.has(loc.parent)) {
      issues.add(`location "${loc.name}" has unknown parent "${loc.parent}"`)
    }
  }

  const nodes = new Map<string, NarrativeNode>()
  const resolving = new Set<string>()

  function depthOf(name: string): number | undefined {
    const cached = nodes.get(name)
    if (cached) return cached.depth
    const loc = byName.get(name)
    if (!loc) return undefined
    if (loc.parent === null) {
      nodes.set(name, { name, parent: null, depth: 0 })
      return 0
    }
    if (!byName.has(loc.parent)) return undefined // dangling parent — already reported above
    if (resolving.has(name)) {
      issues.add(`cycle detected in narrative parent chain involving "${name}"`)
      return undefined
    }
    resolving.add(name)
    const parentDepth = depthOf(loc.parent)
    resolving.delete(name)
    if (parentDepth === undefined) return undefined
    const node: NarrativeNode = { name, parent: loc.parent, depth: parentDepth + 1 }
    nodes.set(name, node)
    return node.depth
  }

  for (const name of byName.keys()) depthOf(name)
  return nodes
}

function matchLocationsToLayers(
  nodes: Map<string, NarrativeNode>,
  layers: readonly BakedLayer[],
  issues: ValidationIssues,
): Map<string, LocationMatch> {
  const byName = new Map<string, BakedLayer[]>()
  for (const layer of layers) {
    const arr = byName.get(layer.nodeName)
    if (arr) arr.push(layer)
    else byName.set(layer.nodeName, [layer])
  }

  const matches = new Map<string, LocationMatch>()
  for (const node of nodes.values()) {
    const candidates = byName.get(node.name) ?? []
    if (candidates.length === 0) {
      issues.add(`missing: location "${node.name}" has no matching scene node (by name) anywhere in the baked scene`)
      continue
    }
    if (candidates.length > 1) {
      const paths = candidates.map((c) => `"${c.nodePath}"`).join(', ')
      issues.add(`ambiguous: location "${node.name}" matches ${candidates.length} scene nodes: ${paths}`)
      continue
    }
    matches.set(node.name, { name: node.name, depth: node.depth, parent: node.parent, nodePath: candidates[0]!.nodePath })
  }
  return matches
}

function isDescendantPath(childPath: string, ancestorPath: string): boolean {
  return childPath !== ancestorPath && childPath.startsWith(`${ancestorPath}/`)
}

function validateContainment(matches: Map<string, LocationMatch>, issues: ValidationIssues): void {
  for (const match of matches.values()) {
    if (match.parent === null) continue
    const parentMatch = matches.get(match.parent)
    if (!parentMatch) continue // parent's own missing/ambiguous problem is already reported
    if (!isDescendantPath(match.nodePath, parentMatch.nodePath)) {
      issues.add(
        `bad_containment: location "${match.name}" (narrative parent "${match.parent}") resolved to node "${match.nodePath}", `
        + `which is not a descendant of "${match.parent}"'s resolved node "${parentMatch.nodePath}"`,
      )
    }
  }
}

/**
 * Sets `area_L{depth} = name` (bare string — `cooker.ts`'s `areaTags()` does
 * the one-element array wrapping itself) on every layer within each matched
 * location's subtree, overriding any existing value at that same depth.
 * When `sceneName` is non-blank, also sets `region = sceneName` on EVERY
 * layer (whole-scene scope, not subtree-scoped), overriding any existing
 * `region`. Does not mutate `layers`; a layer touched by neither is returned
 * unchanged (same object reference).
 */
function stampNarrativeAttributes(
  layers: readonly BakedLayer[],
  matches: Map<string, LocationMatch>,
  sceneName: string | undefined,
): BakedLayer[] {
  const region = sceneName?.trim() || undefined
  if (matches.size === 0 && !region) return layers.slice()
  return layers.map((layer) => {
    let attributes: Record<string, unknown> | undefined
    for (const match of matches.values()) {
      if (layer.nodePath !== match.nodePath && !isDescendantPath(layer.nodePath, match.nodePath)) continue
      attributes ??= { ...layer.attributes }
      attributes[`area_L${match.depth}`] = match.name
    }
    if (region) {
      attributes ??= { ...layer.attributes }
      attributes.region = region
    }
    return attributes ? { ...layer, attributes } : layer
  })
}

/**
 * Validates `narrative` against `layers` (as returned by
 * `listBakedLayersForProjectDir`) and returns a NEW layers array with
 * `area_L{depth}` merged into every layer whose `nodePath` falls under a
 * matched location's subtree, plus `region` merged onto every layer when
 * `narrative.sceneName` is set. Throws a single Error whose message lists
 * every problem found when validation fails; never mutates `layers`.
 */
export function applyNarrativeAreaTags(layers: readonly BakedLayer[], narrative: NarrativeInput): BakedLayer[] {
  const issues = new ValidationIssues()
  const nodes = buildNarrativeTree(narrative, issues)
  const matches = matchLocationsToLayers(nodes, layers, issues)
  validateContainment(matches, issues)
  issues.throwIfAny()
  return stampNarrativeAttributes(layers, matches, narrative.sceneName)
}
