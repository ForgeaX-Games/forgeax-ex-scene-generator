/**
 * Scene → Voxel 图层投影：把不可变 scene 子树展平为渲染器消费的体素图层列表。
 *
 * 与 ./tree.ts 的关系：tree 提供数据形状与读路径（readNode），projection 在其上做一次 DFS。
 * 该函数纯函数、无副作用，结果可被 SceneOutput 电池直接 emit。
 *
 * v1 简化：
 *   - 不累积 transform（multi-SceneOutput 共享同一坐标原点，自然叠加）
 *   - 体素仅保留 (x,y,z)，丢弃 token / state（渲染层只用坐标和图层 value 上色）
 *   - 节点级 layer：每个 cells.length > 0 的节点产出一条 layer，value 为 1-based 序号
 */

import type { Point3D } from '../point3d.js';
import type { SceneNodeSnapshot } from './types.js';
import { readNode } from './tree.js';

export interface VoxelLayer {
  /** 来自 scene-tree 节点 path（绝对路径） */
  nodePath: string;
  /** basename（用于面板显示与 nameList fallback） */
  nodeName: string;
  /** 1-based 序号；与同一 bundle 的 names[i].id 对齐 */
  value: number;
  /** 节点 schema（可选，用作 type fallback） */
  schema?: string;
  cells: Point3D[];
  /**
   * 多值（multi-value-per-layer）子层：当本节点的 cells 携带 >1 种不同 token 时，
   * 列出按首次出现顺序的去重 token 列表；单一 token 的节点不产出该字段（单值层）。
   * 渲染器据此把该层渲为可折叠父层 + 每 token 一个子层（带子层可见性 Eye）。
   */
  tokens?: string[];
  /**
   * 每个 token 的体素桶（与 tokens 对齐），仅多值层产出。渲染器用它在隐藏某子层时
   * 重算父层的可见 cells（cells 始终是全集，cellsByToken 提供按 token 的拆分）。
   */
  cellsByToken?: Record<string, Point3D[]>;
}

export interface NameListEntry {
  id: number;
  name: string;
  type?: string;
}

export interface VoxelOutputBundle {
  layers: VoxelLayer[];
  names: NameListEntry[];
}

function getStringAttr(
  attributes: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  if (!attributes) return undefined;
  const v = attributes[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function collect(
  node: SceneNodeSnapshot,
  out: VoxelOutputBundle,
): void {
  if (node.cells && node.cells.length > 0) {
    const value = out.layers.length + 1;
    const nodeName = node.name === '' ? '/' : node.name;
    // Split cells by their voxel `token` so a node carrying multiple distinct
    // tokens becomes a multi-value layer (one sub-layer per token). `cells`
    // stays the full set (back-compat); tokens/cellsByToken are added only when
    // there is genuinely more than one token (>1 ⇒ multi-value-per-layer).
    const cells: Point3D[] = [];
    const cellsByToken: Record<string, Point3D[]> = {};
    const tokens: string[] = [];
    for (const c of node.cells) {
      const p: Point3D = { x: c.x, y: c.y, z: c.z };
      cells.push(p);
      const tok = c.token ?? '';
      let bucket = cellsByToken[tok];
      if (!bucket) {
        bucket = [];
        cellsByToken[tok] = bucket;
        tokens.push(tok);
      }
      bucket.push(p);
    }
    const layer: VoxelLayer = {
      nodePath: node.path,
      nodeName,
      value,
      schema: node.schema,
      cells,
    };
    if (tokens.length > 1) {
      layer.tokens = tokens;
      layer.cellsByToken = cellsByToken;
    }
    out.layers.push(layer);
    // asset_name 缺失时**不再**回退到 nodeName,空串透传给 renderer。
    // 让 UI 能区分「scene 显式声明了 asset_name」与「scene 没设过」两种情况:
    // 前者 → 走 alias 匹配(命中 / 未命中);后者 → "no-field" 状态,UI 灰显。
    // asset_type 仍回退到 schema,语义上 schema 本就是节点类型的语言,作 fallback 合理。
    out.names.push({
      id: value,
      name: getStringAttr(node.attributes, 'asset_name') ?? '',
      type: getStringAttr(node.attributes, 'asset_type') ?? node.schema,
    });
  }
  // 渲染器对同一 voxel 坐标走「DFS 后入覆盖」的 dedup 规则:在 layers 数组里靠后的
  // 节点 wins。
  //
  // tree.ts 的 children 是 name 字典序存的(graftAt 走 insertChildSorted),按数组
  // 原序 DFS 会让兄弟节点的渲染优先级跟随字母,而不是用户的「加入顺序」直觉。
  // 这里按 node.version ASC 排序后再递归:低版本(早 touch)先,高版本(晚 touch)
  // 后 → 渲染器看到「后加入的子节点」在 bundle.layers 末尾 → dedup 时胜出。
  //
  // 注意:version 是「任意子孙变化时单调递增」的语义,严格说是 last-touched 而不是
  // first-added。绝大多数使用流(add child → 立即 set asset_name)二者一致;只有
  // 「先 add 后回头改老节点的属性」会让老节点的 version 反超新节点。这种边缘 case
  // 可接受,需要更严格时再加 creationVersion 字段(现在不做,YAGNI)。
  const sorted = [...node.children].sort((a, b) => a.version - b.version);
  for (const child of sorted) {
    collect(child, out);
  }
}

/**
 * 从 focus 子树展平出 voxel layers + 对齐的 nameList。
 *
 * focus 不存在：返回空 bundle（不抛错）。
 * focus 存在但子树无任何 cells：返回空 bundle。
 */
export function projectSceneToVoxelLayers(
  tree: SceneNodeSnapshot,
  focus: string,
): VoxelOutputBundle {
  const out: VoxelOutputBundle = { layers: [], names: [] };
  const root = readNode(tree, focus);
  if (!root) return out;
  collect(root, out);
  return out;
}
