// Group save-status tracking: derive a `saved` / `unsaved` / `unsaved*` status
// for a group instance on the canvas by comparing its CURRENT normalized
// content against the hash captured at the last save (or at drag-out from the
// library).
//
// Provenance lives on the `__group__` shadow node's params (a free-form
// Record<string, unknown> in both the kernel graph and the editor Pipeline), so
// no kernel type change is needed:
//   - groupSource: { category, batteryName } — which library file this instance
//       came from / was last saved to (enables overwrite-without-dialog).
//   - savedContentHash: hash of the normalized group content at save/drag time.
//   - isTemplate: marks the template-class group (locked ports, restyled, only
//       the "enter group view" button, no collapsed footer).
//
// The status is PURELY DERIVED at render time: status = saved when the live
// hash equals savedContentHash, unsaved* when they differ (a saved group that
// has since been edited), and unsaved when there is no savedContentHash at all
// (a freshly-formed group never saved to the library).
import type { NodeGroup, ExposedPort } from '../../types.js'

export type GroupSaveStatus = 'saved' | 'unsaved' | 'unsaved-dirty'

/** Provenance stamped onto a `__group__` node's params. */
export interface GroupProvenance {
  sourceCategory?: string
  sourceBatteryName?: string
  savedContentHash?: string
  isTemplate?: boolean
  /**
   * The STABLE library battery id this instance maps to. A dragged-out instance
   * gets a freshly remapped node id (so multiple copies never collide), so the
   * instance id is NOT the library id. We persist the original library id here
   * so a later overwrite writes back the SAME library entry (same disk id, same
   * catalog row) instead of minting a duplicate keyed on the volatile instance id.
   */
  sourceGroupId?: string
}

const GROUP_SOURCE_CATEGORY = '__groupSourceCategory'
const GROUP_SOURCE_NAME = '__groupSourceBatteryName'
const GROUP_SAVED_HASH = '__groupSavedContentHash'
const GROUP_IS_TEMPLATE = '__groupIsTemplate'
const GROUP_SOURCE_ID = '__groupSourceGroupId'

/**
 * Strip the volatile manual-trigger Run-result keys (`_gen_image` /
 * `_gen_result` / `_gen_error`) from an inner node's params. A DUPLICATE (copy /
 * Ctrl+drag / library instantiate) must start with NO cached generation result —
 * otherwise the copy would display the source's last-run image (the parent
 * 母体 cache) and hydrate it on execute instead of being empty until re-run.
 */
export function stripGenCacheParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!params) return {}
  const { _gen_image: _a, _gen_result: _b, _gen_error: _c, ...rest } = params
  void _a; void _b; void _c
  return rest
}

/** Read provenance fields out of a node's params (all optional / tolerant). */
export function readGroupProvenance(params: Record<string, unknown> | undefined): GroupProvenance {
  if (!params) return {}
  const sourceCategory = typeof params[GROUP_SOURCE_CATEGORY] === 'string' ? (params[GROUP_SOURCE_CATEGORY] as string) : undefined
  const sourceBatteryName = typeof params[GROUP_SOURCE_NAME] === 'string' ? (params[GROUP_SOURCE_NAME] as string) : undefined
  const savedContentHash = typeof params[GROUP_SAVED_HASH] === 'string' ? (params[GROUP_SAVED_HASH] as string) : undefined
  const isTemplate = params[GROUP_IS_TEMPLATE] === true
  const sourceGroupId = typeof params[GROUP_SOURCE_ID] === 'string' ? (params[GROUP_SOURCE_ID] as string) : undefined
  return { sourceCategory, sourceBatteryName, savedContentHash, isTemplate, sourceGroupId }
}

/** Merge provenance fields into an existing params object (returns a new object). */
export function writeGroupProvenance(
  params: Record<string, unknown> | undefined,
  provenance: GroupProvenance,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(params ?? {}) }
  if (provenance.sourceCategory !== undefined) next[GROUP_SOURCE_CATEGORY] = provenance.sourceCategory
  if (provenance.sourceBatteryName !== undefined) next[GROUP_SOURCE_NAME] = provenance.sourceBatteryName
  if (provenance.savedContentHash !== undefined) next[GROUP_SAVED_HASH] = provenance.savedContentHash
  if (provenance.isTemplate !== undefined) next[GROUP_IS_TEMPLATE] = provenance.isTemplate
  if (provenance.sourceGroupId !== undefined) next[GROUP_SOURCE_ID] = provenance.sourceGroupId
  return next
}

// ── Content hashing ─────────────────────────────────────────────────────────
// The hash must flip whenever the user does something the requirement counts as
// "modifying a saved group": reorder / hide / add / remove / rename a port, or
// change the inner wiring or inner node params. It must NOT flip on things that
// are pure canvas presentation (the group's own position, member node x/y), so
// that merely dragging a saved group around the canvas does not mark it dirty.

interface NormalizedPort {
  portName: string
  portType: string
  sourceNodeId: string
  sourcePortName: string
  order: number | null
  hidden: boolean
  customLabel: string
  customLabelEn: string
  options: string[]
}

function normalizePort(p: ExposedPort, index: number): NormalizedPort {
  return {
    portName: p.portName,
    portType: p.portType,
    sourceNodeId: p.sourceNodeId,
    sourcePortName: p.sourcePortName,
    order: typeof p.order === 'number' ? p.order : index,
    hidden: p.hidden === true,
    customLabel: p.customLabel?.trim() ?? '',
    customLabelEn: p.customLabelEn?.trim() ?? '',
    options: p.options ? [...p.options] : [],
  }
}

/**
 * Produce a stable, presentation-aware-but-position-free string describing a
 * group's content. Inner node ids are remapped to dense indices in a stable
 * order so two structurally-identical groups (e.g. one freshly remapped on
 * drag-out) hash the SAME — provenance comparison is about content equality,
 * not id identity.
 */
function canonicalizeGroup(group: NodeGroup): string {
  // Stable inner-node ordering: by batteryId then by params signature, so the
  // mapping does not depend on the (arbitrary, remapped) raw ids.
  const nodeSig = (n: NodeGroup['nodes'][number]) =>
    `${n.batteryId}\u0000${stableStringify(stripProvenance(n.params))}`
  const orderedNodes = [...group.nodes].sort((a, b) => {
    const sa = nodeSig(a)
    const sb = nodeSig(b)
    return sa < sb ? -1 : sa > sb ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
  const idIndex = new Map<string, number>()
  orderedNodes.forEach((n, i) => idIndex.set(n.id, i))

  const nodes = orderedNodes.map((n) => ({
    idx: idIndex.get(n.id),
    batteryId: n.batteryId,
    params: stripProvenance(n.params),
  }))

  const edges = group.edges
    .map((e) => ({
      s: idIndex.get(e.source.nodeId) ?? -1,
      sp: e.source.port,
      t: idIndex.get(e.target.nodeId) ?? -1,
      tp: e.target.port,
    }))
    .sort((a, b) => stableStringify(a) < stableStringify(b) ? -1 : 1)

  const remapPort = (p: ExposedPort, i: number) => {
    const np = normalizePort(p, i)
    return { ...np, sourceNodeId: idIndex.get(np.sourceNodeId) ?? -1 }
  }
  const inputs = group.exposedInputs
    .map(remapPort)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.portName < b.portName ? -1 : 1))
  const outputs = group.exposedOutputs
    .map(remapPort)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.portName < b.portName ? -1 : 1))

  return stableStringify({ nodes, edges, inputs, outputs })
}

/**
 * Remove bookkeeping keys that must never affect the content hash:
 *   - group provenance stamps (source/saved-hash/template), and
 *   - volatile manual-trigger Run results (`_gen_image` / `_gen_result` /
 *     `_gen_error`) persisted on an inner image_gen / text_gen node. Running a
 *     mapped inner battery is NOT a content edit, so it must not flip a saved
 *     group to `unsaved*` (the same trap the port-type fix avoided).
 */
function stripProvenance(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!params) return {}
  const {
    [GROUP_SOURCE_CATEGORY]: _a,
    [GROUP_SOURCE_NAME]: _b,
    [GROUP_SAVED_HASH]: _c,
    [GROUP_IS_TEMPLATE]: _d,
    [GROUP_SOURCE_ID]: _e,
    _gen_image: _f,
    _gen_result: _g,
    _gen_error: _h,
    ...rest
  } = params
  void _a; void _b; void _c; void _d; void _e; void _f; void _g; void _h
  return rest
}

/** Deterministic JSON: object keys sorted recursively. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** Fast, stable 53-bit string hash (cyrb53). Sufficient for change detection. */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Hash of a group's normalized (position-free) content. */
export function computeGroupContentHash(group: NodeGroup): string {
  return cyrb53(canonicalizeGroup(group))
}

/**
 * Derive the save status of a group instance from its provenance hash and its
 * live content.
 *   - no savedContentHash               → 'unsaved' (never saved to library)
 *   - savedContentHash === live hash    → 'saved'
 *   - savedContentHash !== live hash    → 'unsaved-dirty' (saved, then edited)
 */
export function deriveGroupSaveStatus(
  group: NodeGroup,
  provenance: GroupProvenance,
): GroupSaveStatus {
  if (!provenance.savedContentHash) return 'unsaved'
  return provenance.savedContentHash === computeGroupContentHash(group) ? 'saved' : 'unsaved-dirty'
}

export function formatGroupSaveStatus(status: GroupSaveStatus): string {
  switch (status) {
    case 'saved': return 'saved'
    case 'unsaved': return 'unsaved'
    case 'unsaved-dirty': return 'unsaved*'
  }
}
