/**
 * Bridge: raw pipeline ExecutionResult → bake-layer input list.
 *
 * 复盘(2026-07-01 sino bake/export 工具缺口):bake（`bakeLayersForProject`）和
 * export scene.zip（`cookSceneForProject`）后端逻辑早就有，且 UI 一直在用——但
 * 它们只挂了 HTTP 路由，从未包成 `scene:*` agent 工具，sino 完全摸不到。直接把
 * `scene:baked.bake` 原样暴露也不解决问题：它要的 `cells` 数组来自
 * `scene:pipeline.execute` 的**摘要**版本（`execution-summary.ts` 为了不把 28MB
 * 的场景倒进模型上下文，早把 cells 剥掉了),sino 手上根本没有真 cells 可传。
 *
 * 这里换一个方向：在服务端内部直接跑一次「raw」执行(不经过 HTTP 往返、不进模型
 * 上下文)，复用渲染器/`scene_output` 电池同款的体素投影(`projectSceneToVoxelLayers`,
 * 见 vendor `scene/projection.ts`)把每个 scene 端口的 `ScenePortValue{graph,focus}`
 * 展平成 `VoxelLayer[]`，再拼成 `bakeLayersForProject` 要的 DFS 顺序 layer 列表——
 * agent 侧只需要调一个高层工具（见 tool-handlers.ts `scene:baked.bakeFromExecute`），
 * 不需要也不可能自己搬运体素。
 *
 * v3 更新：scene 端口值的形状从 `{tree:SceneNodeSnapshot, focus:string}` 换成了
 * `{graph:SceneGraph, focus:NodeId}`（见 vendor `scene/port.ts`）。这里不再手写
 * duck-typing 识别 `.tree`/`.children` 数组，直接复用 vendor 自己的 `parseScenePort`
 * ——它已经处理了"进程内 live SceneGraph 实例"与"跨边界 JSON 唤醒"两种输入形态，
 * 不需要在这个消费端重新判断一遍。烘焙持久化格式（`store.ts`/`BakedCell`）本身
 * 不变，只是这一层"execute 输出→bake layer input"的识别逻辑跟着新 execute 输出改。
 */
import { parseScenePort, projectSceneToVoxelLayers } from '../../../vendor/dist/shared/types/scene/index.js'
import type { BakedCell } from './store.js'

/** Mirrors execution-summary.ts's local ExecutionResult (kept minimal + local). */
export interface ExecutionResultLike {
  outputs: Record<string, Record<string, unknown>>
}

export interface BakeLayerInput {
  nodePath?: string
  nodeName?: string
  cells: BakedCell[]
  assetName?: string
  assetAlias?: string
  assetType?: string
  schema?: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * One scene port item → zero-or-more bake layers, in the item's own DFS order
 * (parent before child — `bakeLayersForProject` relies on that ordering to
 * auto-create intermediate containers correctly). Defensive: any shape that
 * isn't a recognizable scene item yields `[]` instead of throwing, mirroring
 * execution-summary.ts's "unexpected shape → safe no-op" convention.
 */
function layersFromSceneItem(item: unknown): BakeLayerInput[] {
  const port = parseScenePort(item)
  if (!port) return []
  const { layers, names } = projectSceneToVoxelLayers(port.graph, port.focus)
  const nameById = new Map(names.map((n) => [n.id, n]))
  return layers.map((l) => {
    const meta = nameById.get(l.value)
    return {
      nodePath: l.nodePath,
      nodeName: l.nodeName,
      cells: l.cells.map((c) => ({
        x: c.x,
        y: c.y,
        z: c.z,
        token: c.token,
        ...(c.state ? { state: c.state } : {}),
      })),
      ...(l.schema ? { schema: l.schema } : {}),
      ...(meta?.name ? { assetName: meta.name } : {}),
      ...(meta?.alias ? { assetAlias: meta.alias } : {}),
      ...(meta?.type ? { assetType: meta.type } : {}),
    }
  })
}

/**
 * Walk a RAW (non-summarized) ExecutionResult.outputs — same wire shape the
 * `/execute` route returns (DataTreeEntry[] per port: `[{path, items}, ...]`,
 * see execution-summary.ts's header comment) — and collect every scene item's
 * voxel layers, concatenated in port/branch/item arrival order. Never throws.
 *
 * `terminalPorts` (optional, see collectTerminalPorts below): a whitelist of
 * `"nodeId:port"` keys — the port(s) that directly feed the graph's
 * `scene_output` sink. When the set is non-empty, ONLY those ports are baked;
 * everything else is skipped. When omitted/empty (no wired `scene_output`),
 * falls back to baking every scene-shaped port (old permissive behavior).
 *
 * 复盘(2026-07-01 v1→v2):v1 用了黑名单——"没有下游消费者的端口才是终端"，只看
 * *顶层*图的边。真实图里 24/185 个节点是 `__group__`(模板组)，组内部还有一层
 * 嵌套子图（组的中间合成节点也会产出 scene 端口），但顶层 edges 完全看不到组内部
 * 的连线，于是 v1 把组内部的中间产物也当"终端"放行——一张 185 节点图仍然跑出
 * 4432 条 layer（几乎没比不过滤的 4472 少），40s 起步。
 *
 * v2 换成白名单：真实图里 `scene_output` 永远只有一条输入边（Sino 的图
 * 约定单一出口），直接找"喂给 scene_output 的那条边的源端口"，其余一律跳过——
 * 不管中间嵌了多少层组，只要顶层有且只有这一条边喂 sink，就唯一确定了终端端口，
 * 不需要理解组内部拓扑。同一张 185 节点图验证后只剩个位数条 layer，秒级完成。
 */
export function buildBakeLayersFromExecutionResult(
  full: ExecutionResultLike,
  terminalPorts?: ReadonlySet<string>,
): BakeLayerInput[] {
  const out: BakeLayerInput[] = []
  const wantAll = !terminalPorts || terminalPorts.size === 0
  for (const [nodeId, ports] of Object.entries(full.outputs ?? {})) {
    if (!isRecord(ports)) continue
    for (const [port, value] of Object.entries(ports)) {
      if (!wantAll && !terminalPorts!.has(`${nodeId}:${port}`)) continue
      if (!Array.isArray(value)) continue
      for (const entry of value) {
        const items = isRecord(entry) && Array.isArray(entry.items) ? entry.items : []
        for (const item of items) out.push(...layersFromSceneItem(item))
      }
    }
  }
  return out
}

/**
 * Builds the `"nodeId:port"` whitelist for buildBakeLayersFromExecutionResult:
 * source ports of edges whose TARGET is a `scene_output` node. This is the
 * graph's declared "final scene" boundary — everything upstream of it
 * (including whatever composition happens inside nested `__group__` subgraphs,
 * invisible to this top-level edge list) is an implementation detail that must
 * NOT be baked on its own. Empty when the graph has no `scene_output` node or
 * it isn't wired yet — callers should treat that as "fall back to bake-all".
 */
export function collectTerminalPorts(
  nodes: Iterable<{ id: string; opId: string }>,
  edges: Iterable<{ source: { nodeId: string; port: string }; target: { nodeId: string; port: string } }>,
): Set<string> {
  const sinkNodeIds = new Set<string>()
  for (const node of nodes) if (node.opId === 'scene_output') sinkNodeIds.add(node.id)
  const terminal = new Set<string>()
  for (const edge of edges) {
    if (sinkNodeIds.has(edge.target.nodeId)) terminal.add(`${edge.source.nodeId}:${edge.source.port}`)
  }
  return terminal
}
