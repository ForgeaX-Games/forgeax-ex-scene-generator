// `forgeax node create-template` — one-shot instantiation of a saved group
// template (a NodeGroup JSON, possibly carrying `_nestedGroups`) onto the
// current (or --project-id / --graph-file) graph, as a single `__group__`
// shadow node that behaves like a first-class battery.
//
// This is the AI-native, headless twin of the editor's "drag a saved group from
// the library onto the canvas" action. An agent or script can:
//   forgeax node create-template --group-file ArchitectureRegions.json \
//     --project-id p_xxx --x 0 --y 0
// to drop the group, then wire its stable exposed ports (in_0/out_0/Rest/…)
// with plain `node connect`. Output is JSON / NDJSON.
//
// Implementation: the template is remapped to FRESH ids (so the same template
// can be dropped many times into one graph without collision) while keeping its
// exposed `portName`s stable (in_N/out_N — the group's outward battery
// contract). It is then materialised through an ordered Op[] applied as a single
// atomic batch:
//   - createNode for every leaf member (deepest groups first),
//   - connect for every inner edge,
//   - createGroup (child groups before their parent) with the AUTHORITATIVE
//     exposedPorts contract so the kernel honours the stable port names.
// We emit the batch directly (rather than via importPipelineGraph) because
// nested groups need the child `createGroup` to MINT the shadow node — importing
// would `createNode` the nested shadow first and then collide on `createGroup`.
//
// SAME-SOURCE NOTICE: `buildTemplateOps` below has a backend twin at
// apps/wb-scene-generator/backend/src/lib/legacy/templateOps.ts (legacy JSON
// POST /api/v1/group-templates/:id/instantiate route). The remap + ordering +
// op-build logic is kept equivalent; when you change one, change the other.

import { readFileSync } from 'node:fs'
import { applyBatch } from '@forgeax/node-runtime'
import type { Op } from '@forgeax/node-runtime'
import { resolveConfig } from '../config.js'
import { loadRuntime } from '../runtime.js'
import { makeEmitter } from '../output.js'
import { CliError } from '../errors.js'
import { mode, numOpt, requireStr } from './shared.js'

const GROUP_OP_ID = '__group__'

interface RawPos {
  x: number
  y: number
}
interface RawNode {
  id: string
  opId: string
  name?: string
  position?: RawPos
  params?: Record<string, unknown>
}
interface RawEdge {
  id: string
  source: { nodeId: string; port: string }
  target: { nodeId: string; port: string }
}
interface RawExposedPort {
  portName: string
  portType?: string
  access?: 'item' | 'list' | 'tree'
  sourceNodeId: string
  sourcePortName: string
  hidden?: boolean
  order?: number
  customLabel?: string
  customLabelEn?: string
}
interface RawGroup {
  id: string
  name?: string
  nameEn?: string
  nodes?: RawNode[]
  edges?: RawEdge[]
  position?: RawPos
  exposedInputs?: RawExposedPort[]
  exposedOutputs?: RawExposedPort[]
  _nestedGroups?: RawGroup[]
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Build a single ordered Op[] that materialises `root` + its nested deps onto a
 * graph, every id freshly minted. Returns the ops plus the new root group id and
 * shadow node id (they are identical — the kernel keys the shadow on the group id).
 */
function buildTemplateOps(
  root: RawGroup,
  deps: RawGroup[],
  rootPosition: RawPos | undefined,
  explicitGroupId: string | undefined,
): { ops: Op[]; rootGroupId: string; exposedInputs: string[]; exposedOutputs: string[] } {
  const allGroups = [root, ...deps]
  const tag = Math.random().toString(36).slice(2, 8)

  // 1) Fresh group ids (root may be pinned via --group-id). The shadow node id
  //    equals the group id (kernel invariant), so this map doubles as the
  //    node-id map for nested `__group__` members.
  const groupIdMap: Record<string, string> = {}
  groupIdMap[root.id] = explicitGroupId ?? uid('group')
  for (const d of deps) groupIdMap[d.id] = uid('group')

  // 2) Fresh ids for every NON-group leaf member, across root + deps. A nested
  //    `__group__` member maps to its child group's (already-fresh) id instead.
  const nodeIdMap: Record<string, string> = {}
  for (const g of allGroups) {
    for (const n of g.nodes ?? []) {
      if (n.opId === GROUP_OP_ID) {
        const childOld = typeof n.params?.groupId === 'string' ? n.params.groupId : n.id
        nodeIdMap[n.id] = groupIdMap[childOld] ?? groupIdMap[n.id] ?? uid('node')
      } else {
        nodeIdMap[n.id] = `node_${tag}_${Math.random().toString(36).slice(2, 8)}`
      }
    }
  }
  const mapNode = (id: string): string => nodeIdMap[id] ?? groupIdMap[id] ?? id

  // 3) Order groups so a child is created before any parent that references it.
  //    Parent → child dependency: a group whose members include a `__group__`
  //    pointing at another group must come AFTER that child.
  const byOldId = new Map(allGroups.map((g) => [g.id, g] as const))
  const childrenOf = (g: RawGroup): string[] =>
    (g.nodes ?? [])
      .filter((n) => n.opId === GROUP_OP_ID)
      .map((n) => (typeof n.params?.groupId === 'string' ? n.params.groupId : n.id))
      .filter((cid) => byOldId.has(cid))
  const ordered: RawGroup[] = []
  const seen = new Set<string>()
  const visit = (g: RawGroup): void => {
    if (seen.has(g.id)) return
    seen.add(g.id)
    for (const cid of childrenOf(g)) {
      const child = byOldId.get(cid)
      if (child) visit(child)
    }
    ordered.push(g)
  }
  for (const g of allGroups) visit(g)

  // 4) Emit ops child-first. For each group: createNode its leaf members,
  //    connect its inner edges (every endpoint — leaf or already-created child
  //    shadow — now exists), then createGroup (which packs members + internal
  //    edges away and rewrites boundary edges to stable exposed ports). Doing
  //    this per group, child before parent, is what makes nested groups work:
  //    a child's shadow node exists by the time the parent connects to / groups
  //    it.
  const ops: Op[] = []
  const remapContract = (ports: RawExposedPort[] | undefined) =>
    (ports ?? []).map((p) => ({
      portName: p.portName, // STABLE outward identity — never remapped.
      sourceNodeId: mapNode(p.sourceNodeId),
      sourcePortName: p.sourcePortName,
      ...(p.hidden !== undefined ? { hidden: p.hidden } : {}),
      ...(p.order !== undefined ? { order: p.order } : {}),
      ...(p.customLabel !== undefined ? { customLabel: p.customLabel } : {}),
      ...(p.customLabelEn !== undefined ? { customLabelEn: p.customLabelEn } : {}),
    }))
  for (const g of ordered) {
    for (const n of g.nodes ?? []) {
      if (n.opId === GROUP_OP_ID) continue // minted by the child's createGroup
      ops.push({
        type: 'createNode',
        nodeId: mapNode(n.id),
        opId: n.opId,
        position: n.position ?? { x: 0, y: 0 },
        params: { ...(n.params ?? {}) },
        ...(n.name !== undefined ? { name: n.name } : {}),
      })
    }
    for (const e of g.edges ?? []) {
      ops.push({
        type: 'connect',
        edgeId: `edge_${tag}_${Math.random().toString(36).slice(2, 8)}`,
        source: { nodeId: mapNode(e.source.nodeId), port: e.source.port },
        target: { nodeId: mapNode(e.target.nodeId), port: e.target.port },
      })
    }
    const memberIds = (g.nodes ?? []).map((n) => mapNode(n.id))
    const inputs = remapContract(g.exposedInputs)
    const outputs = remapContract(g.exposedOutputs)
    const exposedPorts =
      inputs.length || outputs.length
        ? { ...(inputs.length ? { inputs } : {}), ...(outputs.length ? { outputs } : {}) }
        : undefined
    const isRoot = g.id === root.id
    ops.push({
      type: 'createGroup',
      groupId: groupIdMap[g.id]!,
      name: g.name ?? g.id,
      ...(g.nameEn !== undefined ? { nameEn: g.nameEn } : {}),
      ...(isRoot && rootPosition === undefined
        ? {}
        : { position: isRoot ? rootPosition! : (g.position ?? { x: 0, y: 0 }) }),
      memberNodeIds: memberIds,
      ...(exposedPorts ? { exposedPorts } : {}),
    })
  }

  return {
    ops,
    rootGroupId: groupIdMap[root.id]!,
    exposedInputs: (root.exposedInputs ?? []).map((p) => p.portName),
    exposedOutputs: (root.exposedOutputs ?? []).map((p) => p.portName),
  }
}

export async function nodeCreateTemplate(opts: Record<string, unknown>): Promise<void> {
  const file = requireStr(opts, 'groupFile', '--group-file')
  let raw: RawGroup
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as RawGroup & { graph?: RawGroup }
    // Accept a bare NodeGroup, or a { graph: NodeGroup } wrapper for symmetry
    // with the import command's file shape.
    raw = (parsed.nodes || parsed.exposedInputs || parsed.exposedOutputs ? parsed : parsed.graph) as RawGroup
  } catch (e) {
    throw new CliError(`failed to read group file '${file}': ${e instanceof Error ? e.message : String(e)}`, 2)
  }
  if (!raw || (!raw.nodes && !raw.exposedInputs && !raw.exposedOutputs)) {
    throw new CliError(`group file '${file}' is not a NodeGroup (expected nodes / exposedInputs / exposedOutputs)`, 2)
  }

  const deps = raw._nestedGroups ?? []
  const { _nestedGroups, ...root } = raw
  void _nestedGroups
  const rootPosition =
    opts.x === undefined && opts.y === undefined
      ? undefined
      : { x: numOpt(opts.x, 0), y: numOpt(opts.y, 0) }
  const explicitGroupId = typeof opts.groupId === 'string' && opts.groupId ? opts.groupId : undefined

  const { ops, rootGroupId, exposedInputs, exposedOutputs } = buildTemplateOps(
    root as RawGroup,
    deps as RawGroup[],
    rootPosition,
    explicitGroupId,
  )

  const config = resolveConfig(opts)
  // No battery scan needed: createGroup resolves boundary tiers from the inner
  // OpSpec when available and falls back to the template's contract otherwise,
  // so a template can be laid out even when its member ops aren't registered.
  const runtime = await loadRuntime({ ...config, batteriesDir: '' })
  const result = await applyBatch(runtime, ops, {
    actor: typeof opts.actor === 'string' ? opts.actor : 'cli:create-template',
    label: typeof opts.label === 'string' ? opts.label : `instantiate template ${root.name ?? rootGroupId}`,
  })

  const emit = makeEmitter(mode(opts))
  emit.record({
    ...result,
    groupId: rootGroupId,
    name: root.name ?? rootGroupId,
    exposedInputs,
    exposedOutputs,
    opCount: ops.length,
  })
  if (result.status !== 'ok') {
    const detail = result.diagnostics?.[0]?.message ?? result.reason ?? 'unknown'
    throw new CliError(`create-template rejected: ${detail}`, 1)
  }
}
