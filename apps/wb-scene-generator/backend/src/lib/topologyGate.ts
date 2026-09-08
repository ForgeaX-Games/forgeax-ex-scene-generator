// Server-side, synchronous topology diagnostics for the Sino/sino-constructor
// scene graph construction loop.
//
// The original three checks (Rest-chain fan-out, illegal local tree_merge,
// silent manual_points zero-default) were written client-side in
// aw-support (`src/orchestration/scene-graph-analysis.ts`) and only ever ran
// when aw-support built the NEXT continuation message — i.e. an agent that
// tripped one of these anti-patterns would not find out until an entire
// extra dispatch round-trip later. In the original production incident, the
// agent burned dozens
// of turns adjusting tree_merge params when the actual bug was fan-out
// topology).
//
// This module ports the pure analysis functions so wb-scene-generator's own
// `scene:pipeline.execute` can run them synchronously and hand back a
// structured, copy-pasteable fix (`verification.topologyIssues`) in the SAME
// tool call the agent just made — the same upgrade `lib/locationNameGate.ts`
// already made for narrative location-name alignment (see its 2026-07-01/
// 2026-07-10 postmortem comments in execution-summary.ts).
//
// aw-support's copy is left in place (it still backstops non-Sino callers and
// the checklist-driven continuation flow); this is deliberately a fork, not a
// shared package, to keep this change scoped to wb-scene-generator. A future
// cleanup could de-duplicate by having aw-support call this module's HTTP
// route instead of maintaining its own disk-reading copy.

export interface TopologyGraphNode {
  id?: string
  opId?: string
  name?: string
  params?: Record<string, unknown>
  exposedOutputs?: Array<{ portName?: string; customLabel?: string; customLabelEn?: string }>
}

export type TopologyEdgePort = string | { label?: string; portName?: string }

export interface TopologyGraphEdge {
  id?: string
  source?: { nodeId?: string; port?: TopologyEdgePort }
  target?: { nodeId?: string; port?: TopologyEdgePort }
}

/**
 * Coerce edge port refs to a physical port string before string ops.
 * Agents sometimes persist `{ label, portName }` joint refs onto edges;
 * calling `.startsWith` on those objects 500'd execute (production).
 */
export function normalizeEdgePort(port: unknown): string | undefined {
  if (typeof port === 'string' && port.length > 0) return port
  if (port && typeof port === 'object') {
    const portName = (port as { portName?: unknown }).portName
    if (typeof portName === 'string' && portName.length > 0) return portName
  }
  return undefined
}

export function batteryName(node: TopologyGraphNode): string | undefined {
  const fromName = typeof node.name === 'string' ? node.name : undefined
  const fromParams = node.params?.__groupSourceBatteryName
  return fromName ?? (typeof fromParams === 'string' ? fromParams : undefined)
}

/** Ports that accept upstream Scene / Rest on structure batteries. */
const SCENE_INPUT_PORTS = new Set(['in_0', 'in_1', 'in_2', 'in_6'])

/** Preview / export helpers — not Rest-chain consumers. */
const PREVIEW_MERGE_NODE_IDS = /^m0_merge$|^.*_merge$/

function findAddBaseGridNodeId(nodeById: Map<string, TopologyGraphNode>): string | null {
  for (const [id, n] of nodeById) {
    if (n.opId === '__group__' && batteryName(n) === 'AddBaseGrid') return id
  }
  return null
}

function isPreviewOnlyTarget(nodeId: string, port: string, target: TopologyGraphNode | undefined): boolean {
  if (port.startsWith('item_')) return true
  if (PREVIEW_MERGE_NODE_IDS.test(nodeId)) return port === 'item_0' || port.startsWith('item_')
  if (target?.opId === 'tree_merge' || target?.opId === 'tree_flatten') return true
  return false
}

export interface RestChainConsumer {
  edgeId: string
  targetNodeId: string
  targetPort: string
  batteryName?: string
}

export interface RestFanOutViolation {
  sourceNodeId: string
  sourcePort: string
  sourceBatteryName?: string
  consumers: RestChainConsumer[]
}

export interface RestChainReport {
  addBaseGridNodeId: string | null
  baseNodeFanOutCount: number
  restFanOutViolations: RestFanOutViolation[]
  ok: boolean
}

/**
 * Detect Rest/Scene fan-out: the same upstream Scene/Rest output wired in
 * parallel into 2+ template-group Scene inputs. `AddBaseGrid.out_1` fan-out
 * and any other group's Rest-output fan-out are both covered; the original
 * incident had five templates fed from the same output port.
 *
 * Returns `ok: true` (no violations, not an error) when no `AddBaseGrid`
 * group exists — this Rest-chain discipline is specific to the aw-support
 * scene-composition convention; graphs that never use `AddBaseGrid` (hand-
 * authored projects, other workbenches) are simply out of scope for this
 * check, not flagged as violating it.
 */
export function analyzeRestChainTopology(
  edges: readonly TopologyGraphEdge[],
  nodeById: Map<string, TopologyGraphNode>,
): RestChainReport {
  const addBaseGridNodeId = findAddBaseGridNodeId(nodeById)
  if (!addBaseGridNodeId) {
    return { addBaseGridNodeId: null, baseNodeFanOutCount: 0, restFanOutViolations: [], ok: true }
  }

  const baseNodeSceneConsumers: RestChainConsumer[] = []
  for (const edge of edges) {
    const srcId = edge.source?.nodeId
    const srcPort = normalizeEdgePort(edge.source?.port)
    const tgtId = edge.target?.nodeId
    const tgtPort = normalizeEdgePort(edge.target?.port)
    if (srcId !== addBaseGridNodeId || srcPort !== 'out_1' || !tgtId || !tgtPort) continue

    const target = nodeById.get(tgtId)
    if (isPreviewOnlyTarget(tgtId, tgtPort, target)) continue

    const isTemplateGroup = target?.opId === '__group__' && batteryName(target) !== 'AddBaseGrid'
    const isSceneInput = SCENE_INPUT_PORTS.has(tgtPort)
    if (isTemplateGroup && isSceneInput) {
      baseNodeSceneConsumers.push({
        edgeId: edge.id ?? `${srcId}->${tgtId}`,
        targetNodeId: tgtId,
        targetPort: tgtPort,
        batteryName: batteryName(target),
      })
    }
  }

  const restFanOutViolations: RestFanOutViolation[] = []
  if (baseNodeSceneConsumers.length > 1) {
    restFanOutViolations.push({
      sourceNodeId: addBaseGridNodeId,
      sourcePort: 'out_1',
      sourceBatteryName: 'AddBaseGrid',
      consumers: baseNodeSceneConsumers,
    })
  }

  const restFanOut = new Map<string, RestChainConsumer[]>()
  for (const edge of edges) {
    const srcId = edge.source?.nodeId
    const srcPort = normalizeEdgePort(edge.source?.port)
    const tgtId = edge.target?.nodeId
    const tgtPort = normalizeEdgePort(edge.target?.port)
    if (!srcId || !srcPort || !tgtId || !tgtPort) continue
    if (srcId === addBaseGridNodeId && srcPort === 'out_1') continue

    const source = nodeById.get(srcId)
    const target = nodeById.get(tgtId)
    if (source?.opId !== '__group__') continue
    if (!SCENE_INPUT_PORTS.has(tgtPort)) continue
    if (target?.opId !== '__group__' || batteryName(target) === 'AddBaseGrid') continue

    const key = `${srcId}:${srcPort}`
    const bucket = restFanOut.get(key) ?? []
    bucket.push({
      edgeId: edge.id ?? `${srcId}->${tgtId}`,
      targetNodeId: tgtId,
      targetPort: tgtPort,
      batteryName: batteryName(target),
    })
    restFanOut.set(key, bucket)
  }

  for (const [key, consumers] of restFanOut) {
    if (consumers.length <= 1) continue
    const [srcId, srcPort] = key.split(':')
    restFanOutViolations.push({
      sourceNodeId: srcId!,
      sourcePort: srcPort!,
      sourceBatteryName: batteryName(nodeById.get(srcId!) ?? {}) ?? srcId,
      consumers,
    })
  }

  return {
    addBaseGridNodeId,
    baseNodeFanOutCount: baseNodeSceneConsumers.length,
    restFanOutViolations,
    ok: restFanOutViolations.length === 0,
  }
}

function targetLabel(c: RestChainConsumer): string {
  const hint = c.batteryName && c.batteryName !== c.targetNodeId ? `(${c.batteryName})` : ''
  return `${c.targetNodeId}${hint}.${c.targetPort}`
}

/**
 * Format each Rest fan-out violation as agent-actionable prose. Unlike
 * `formatLocalMergeViolationLines` below, this deliberately does NOT emit a
 * ready-to-paste `applyBatch` ops array: fixing a Rest fan-out requires
 * connecting to the PREVIOUS consumer's Rest output port, and which port
 * that is (conventionally `out_2`, but template-dependent) can only be read
 * off that group's `exposedOutputs` label — guessing it here risks handing
 * the agent a wrong, confidently-formatted "fix" that's worse than no
 * suggestion at all. The reason string still names the exact edge to delete
 * and the exact node/port to re-target, so the agent isn't re-deriving those.
 */
function formatRestFanOutViolation(v: RestFanOutViolation): string {
  const [keep, ...rest] = v.consumers
  if (!keep || rest.length === 0) {
    return (
      `${v.sourceBatteryName ?? v.sourceNodeId}.${v.sourcePort} 并行 fan-out ×${v.consumers.length} — ` +
      'Rest 须单链消费，禁止同一个 Rest 同时喂多组。'
    )
  }
  const keepLabel = targetLabel(keep)
  const steps = rest.map((c, i) => {
    const prevLabel = i === 0 ? keepLabel : targetLabel(rest[i - 1]!)
    return (
      `  ${i + 1}. deleteEdge \`${c.edgeId}\`（断开 ${v.sourceBatteryName ?? v.sourceNodeId}.${v.sourcePort} → ${targetLabel(c)} 这条并行连线），` +
      `改为从 **${prevLabel} 所在组的 Rest 输出口**（查该组 exposedOutputs 里 label="Rest" 的 portName，通常是 \`out_2\`）` +
      `connect 到 \`${c.targetNodeId}\`.\`${c.targetPort}\`；`
    )
  })
  return [
    `**${v.sourceBatteryName ?? v.sourceNodeId}.${v.sourcePort} 并行 fan-out ×${v.consumers.length}**` +
      `（${v.consumers.map((c) => targetLabel(c)).join('、')}）——这条 Rest/Scene 输出同时喂给了 ${v.consumers.length} 个下游，` +
      `必须改成单链：只保留 \`${keepLabel}\` 直接接在 \`${v.sourceBatteryName ?? v.sourceNodeId}.${v.sourcePort}\` 上，` +
      `其余 ${rest.length} 组依次改接到前一组的 Rest 输出上，形成一条链，不是并联。具体步骤：`,
    ...steps,
    '  修完后重新 execute 一次，确认这几条边已经改成链式而不是都从同一个源头引出。',
  ].join('\n')
}

export interface LocalMergeViolation {
  mergeNodeId: string
  itemCount: number
  sources: Array<{ nodeId: string; batteryName?: string; port: string }>
}

/**
 * Detect an illegal *local* `tree_merge` — a `tree_merge` other than the
 * designated root merge (`rootMergeNodeId`) that collects 2+ template-group
 * content outputs before feeding them onward. Real incident this catches:
 * `tree_merge` requires every connected item to resolve, so a local pre-merge
 * with even one bad/undefined item silently kills the WHOLE merge — and that
 * failure then silently propagates to the root merge/flatten, making it look
 * like a completely unrelated node has no output.
 */
export function detectIllegalLocalMerge(
  edges: readonly TopologyGraphEdge[],
  nodeById: Map<string, TopologyGraphNode>,
  rootMergeNodeId: string | null,
): LocalMergeViolation[] {
  const itemSources = new Map<string, Array<{ nodeId: string; batteryName?: string; port: string }>>()

  for (const edge of edges) {
    const tgtId = edge.target?.nodeId
    const tgtPort = normalizeEdgePort(edge.target?.port)
    const srcId = edge.source?.nodeId
    const srcPort = normalizeEdgePort(edge.source?.port)
    if (!tgtId || !tgtPort || !srcId || !srcPort) continue
    if (rootMergeNodeId && tgtId === rootMergeNodeId) continue
    if (!tgtPort.startsWith('item_')) continue

    const target = nodeById.get(tgtId)
    if (target?.opId !== 'tree_merge') continue

    const source = nodeById.get(srcId)
    if (source?.opId !== '__group__') continue

    const bucket = itemSources.get(tgtId) ?? []
    bucket.push({ nodeId: srcId, batteryName: batteryName(source), port: srcPort })
    itemSources.set(tgtId, bucket)
  }

  const violations: LocalMergeViolation[] = []
  for (const [mergeNodeId, sources] of itemSources) {
    if (sources.length < 2) continue
    violations.push({ mergeNodeId, itemCount: sources.length, sources })
  }
  return violations
}

/**
 * Format a local-merge violation with a ready-to-paste `applyBatch` ops
 * array. Never replay the source ports found on the illegal merge: they are
 * commonly Island/Path/Decoration domain ports. `appendMergeItem` resolves
 * each group's semantic Scene output at apply time, so the repair cannot
 * silently reconnect the same invalid domain ports to the root merge.
 */
export function formatLocalMergeViolation(
  v: LocalMergeViolation,
  nodeById: Map<string, TopologyGraphNode>,
  rootMergeNodeId: string,
): { reason: string; fix: string; suggestedOps?: unknown[] } {
  const list = v.sources.map((s) => `${s.batteryName ?? s.nodeId}.${s.port}`).join('、')
  const reason =
    `节点 \`${v.mergeNodeId}\` 是一个非法的局部 tree_merge，汇总了 ${v.itemCount} 个模板的内容（${list}）后再整体接一次——` +
    '这违反「领域口不得接 merge；每个模板只能用 Scene 汇总口接入根 merge」的纪律：只要其中一路的输出端口在 execute 时不存在，整个局部 merge 就完全没有输出，' +
    '并连累根 merge/flatten 也显示无输出，看起来像是完全不相关的节点出了问题。'
  const fix =
    `修复：删掉节点 \`${v.mergeNodeId}\`，再对这 ${v.itemCount} 个模板分别执行 appendMergeItem，` +
    'source.port 只写语义 label=Scene，由工具解析真实物理口并自动分配 item_N。'

  const rootNode = nodeById.get(rootMergeNodeId)
  const currentPortCount = typeof rootNode?.params?.portCount === 'number' ? rootNode.params.portCount : undefined
  if (currentPortCount === undefined) return { reason, fix }

  const suggestedOps: unknown[] = [
    { type: 'deleteNode', nodeId: v.mergeNodeId },
    ...v.sources.map((s) => ({
      type: 'appendMergeItem',
      mergeNodeId: rootMergeNodeId,
      source: { nodeId: s.nodeId, port: { label: 'Scene' } },
    })),
  ]
  return { reason, fix, suggestedOps }
}

export interface ManualPointsZeroDefault {
  nodeId: string
  x: number
  y: number
}

/**
 * Detect `manual_points` nodes that are wired into the graph (their `point`
 * output feeds something) but whose `x`/`y` end up genuinely unsupplied —
 * neither an explicit non-zero `params.x`/`params.y` NOR an incoming edge
 * into the node's `x`/`y` input ports — so the battery's own silent defaults
 * (both 0) silently kick in. `execute` reports `completed`/`ok:true` for this
 * because nothing errors — it's just wrong.
 *
 * Unlike aw-support's copy of this check, this module has no access to the
 * task spec's *intended* coordinate (that lives in aw-support's run
 * directory, not in the graph) — so it can only flag "this looks like an
 * unset default", not confirm it's wrong. The `fix` text says so explicitly
 * rather than asserting a specific expected value it doesn't have.
 */
export function detectManualPointsZeroDefaults(
  edges: readonly TopologyGraphEdge[],
  nodeById: Map<string, TopologyGraphNode>,
): ManualPointsZeroDefault[] {
  const wiredSourceIds = new Set<string>()
  const incomingByTargetPort = new Map<string, TopologyGraphEdge>()
  for (const edge of edges) {
    if (edge.source?.nodeId) wiredSourceIds.add(edge.source.nodeId)
    const tgtPort = normalizeEdgePort(edge.target?.port)
    if (edge.target?.nodeId && tgtPort) {
      incomingByTargetPort.set(`${edge.target.nodeId}:${tgtPort}`, edge)
    }
  }

  const isAxisSupplied = (nodeId: string, port: 'x' | 'y', paramVal: unknown): boolean => {
    if (typeof paramVal === 'number' && paramVal !== 0) return true
    return incomingByTargetPort.has(`${nodeId}:${port}`)
  }

  const hits: ManualPointsZeroDefault[] = []
  for (const [id, node] of nodeById) {
    if (node.opId !== 'manual_points') continue
    if (!wiredSourceIds.has(id)) continue
    const params = node.params ?? {}
    if (isAxisSupplied(id, 'x', params.x) && isAxisSupplied(id, 'y', params.y)) continue
    const x = typeof params.x === 'number' ? params.x : 0
    const y = typeof params.y === 'number' ? params.y : 0
    hits.push({ nodeId: id, x, y })
  }
  return hits
}

/** One structured, agent-actionable topology issue surfaced in `verification.topologyIssues`. */
export interface TopologyIssue {
  kind: 'rest-fan-out' | 'illegal-local-merge' | 'domain-merge-violation' | 'manual-points-zero-default'
  reason: string
  fix: string
  /** Ready-to-paste `applyBatch` ops, when the fix is fully mechanical (see per-kind docs above). */
  suggestedOps?: unknown[]
}

function exposedOutputLabel(output: NonNullable<TopologyGraphNode['exposedOutputs']>[number]): string | undefined {
  return output.customLabelEn ?? output.customLabel
}

function domainMergeIssues(
  edges: readonly TopologyGraphEdge[],
  nodeById: Map<string, TopologyGraphNode>,
  rootMergeNodeId: string,
): TopologyIssue[] {
  const issues: TopologyIssue[] = []
  for (const edge of edges) {
    const tgtPort = normalizeEdgePort(edge.target?.port)
    if (edge.target?.nodeId !== rootMergeNodeId || !tgtPort?.startsWith('item_')) continue
    const sourceNodeId = edge.source?.nodeId
    const sourcePort = normalizeEdgePort(edge.source?.port)
    if (!sourceNodeId || !sourcePort) continue
    const sourceNode = nodeById.get(sourceNodeId)
    if (sourceNode?.opId !== '__group__') continue
    const outputs = sourceNode.exposedOutputs ?? []
    const selected = outputs.find((output) => output.portName === sourcePort)
    const selectedLabel = selected ? exposedOutputLabel(selected) : undefined
    if (!selectedLabel || selectedLabel === 'Scene' || selectedLabel === 'RootScene') continue
    const sceneOutput = outputs.find((output) => exposedOutputLabel(output) === 'Scene')
    if (!sceneOutput?.portName) continue
    const reason =
      `节点 \`${sourceNodeId}\` 的领域口 \`${sourcePort}\`(${selectedLabel}) 直接接入根 merge \`${rootMergeNodeId}\`。` +
      `根 merge 只接受 Scene 汇总口；${selectedLabel} 仅用于细化/串链。`
    const fix =
      `把这条边改为 \`${sourceNodeId}.${sceneOutput.portName}\`(Scene) → ` +
      `\`${rootMergeNodeId}.${tgtPort}\`。`
    const suggestedOps = edge.id
      ? [
          { type: 'disconnect', edgeId: edge.id },
          {
            type: 'connect',
            edgeId: `e_fix_domain_${sourceNodeId}_${tgtPort}`,
            source: {
              nodeId: sourceNodeId,
              port: { label: 'Scene', portName: sceneOutput.portName },
            },
            target: { nodeId: rootMergeNodeId, port: tgtPort },
          },
        ]
      : undefined
    issues.push({ kind: 'domain-merge-violation', reason, fix, ...(suggestedOps ? { suggestedOps } : {}) })
  }
  return issues
}

/**
 * Detect the root `tree_merge` a local-merge violation should reconnect
 * into: the `tree_merge` immediately upstream of `tree_flatten` /
 * `scene_merge_subtrees` / `scene_output`. Mirrors `detectExportChain` in
 * `pipeline-summary.ts` (kept independent to avoid a cross-import cycle
 * between the two lib modules).
 */
function findRootMergeNodeId(edges: readonly TopologyGraphEdge[], nodeById: Map<string, TopologyGraphNode>): string | null {
  const flattenOrOutputIds = new Set<string>()
  for (const [id, n] of nodeById) {
    if (n.opId === 'tree_flatten' || n.opId === 'scene_merge_subtrees' || n.opId === 'scene_output') {
      flattenOrOutputIds.add(id)
    }
  }
  if (flattenOrOutputIds.size === 0) return null
  for (const edge of edges) {
    const srcId = edge.source?.nodeId
    const tgtId = edge.target?.nodeId
    if (!srcId || !tgtId) continue
    if (!flattenOrOutputIds.has(tgtId)) continue
    const src = nodeById.get(srcId)
    if (src?.opId === 'tree_merge') return srcId
  }
  return null
}

/**
 * Run all topology checks against a live (in-memory) graph and format
 * them into `TopologyIssue[]` for `verification.topologyIssues`. Always
 * returns an array (empty = no issues, never a bare boolean) — same
 * philosophy as `locationNameAlignment`. Returns `[]` without error when the
 * graph doesn't use the `AddBaseGrid` scene-composition convention (see
 * `analyzeRestChainTopology`'s doc) — these checks are additive warnings for
 * that convention, not a general-purpose graph linter.
 */
export function buildTopologyIssues(
  edges: readonly TopologyGraphEdge[],
  nodeById: Map<string, TopologyGraphNode>,
): TopologyIssue[] {
  const issues: TopologyIssue[] = []

  const restReport = analyzeRestChainTopology(edges, nodeById)
  if (!restReport.ok) {
    for (const v of restReport.restFanOutViolations) {
      issues.push({ kind: 'rest-fan-out', reason: formatRestFanOutViolation(v), fix: '按上面步骤 deleteEdge + connect，然后重新 execute。' })
    }
  }

  // Local-merge check only makes sense once there's a root merge to reconnect
  // into — on graphs without one (e.g. mid-construction, before the M0 export
  // chain exists), skip rather than report a violation with no fix target.
  const rootMergeNodeId = findRootMergeNodeId(edges, nodeById)
  if (rootMergeNodeId) {
    issues.push(...domainMergeIssues(edges, nodeById, rootMergeNodeId))
    for (const v of detectIllegalLocalMerge(edges, nodeById, rootMergeNodeId)) {
      const { reason, fix, suggestedOps } = formatLocalMergeViolation(v, nodeById, rootMergeNodeId)
      issues.push({ kind: 'illegal-local-merge', reason, fix, ...(suggestedOps ? { suggestedOps } : {}) })
    }
  }

  for (const hit of detectManualPointsZeroDefaults(edges, nodeById)) {
    issues.push({
      kind: 'manual-points-zero-default',
      reason:
        `节点 \`${hit.nodeId}\` 是 manual_points 且 x/y 均为 0（值来自 params 显式 0 或未设置、且没有 connect 到 x/y 输入口）—— ` +
        '如果这不是故意要放在原点，很可能是 createNode 时忘了传 params.x/params.y，落回了 battery 自身的静默默认值。',
      fix: `确认这是否是本任务真正想要的坐标；如果不是，updateNode 把 \`${hit.nodeId}\` 的 params 显式设成正确坐标，再重新 execute。`,
    })
  }

  return issues
}
