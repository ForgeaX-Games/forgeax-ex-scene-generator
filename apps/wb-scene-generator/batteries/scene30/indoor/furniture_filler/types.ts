export type Grid = number[][];

export interface FurnitureTemplate {
  id: string;
  size: string;
  shape: string;
  placementEdges: number[];   // 0=上 1=右 2=下 3=左；空数组=居中
  mask: Grid;
  rows: number;
  cols: number;
  isGroup: boolean;
  components: Record<string, string>;  // {"1":"桌","2":"椅"}
}

export interface PlacedFurniture {
  name: string;
  rank: number;           // 原始 rank（1-based）
  effectiveRank: number;  // 写入网格的编号 = rankOffset + rank
  templateId: string;
  templateMask: Grid;     // 模板 mask，用于计算 group 子组件 direction
  anchor: [number, number];
  edge: number;           // -1 表示居中
  isGroup: boolean;
}

/** 家具模板库：key = size_shape（普通库）或 基础名称（组合库） */
export type TemplateLibrary = Record<string, FurnitureTemplate[]>;

/** 家具清单条目（来自 furniture_rank_split 输出的 main_list） */
export interface FurnitureListItem {
  rank: number;
  name: string;
  furniture_id: string;
  type?: "single" | "group";
  placement?: "edge" | "center";
}

export type FurnitureDirection = "top" | "right" | "bottom" | "left" | "square" | "h" | "v";

/** 输出家具编号列表条目 */
export interface FurnitureIndexEntry {
  rank: number;   // 网格中存储的编号（effectiveRank）
  name: string;
  isGroup: boolean;
  direction: FurnitureDirection;
}

/** 根据放置边（0上1右2下3左，-1居中）推断贴边家具朝向 */
export function edgeToDirection(edge: number): FurnitureDirection {
  switch (edge) {
    case 0: return "top";
    case 1: return "right";
    case 2: return "bottom";
    case 3: return "left";
    default: return "square";
  }
}

/** 根据模板 id 和放置边推断填充家具形状方向 */
export function shapeDirectionFromId(templateId: string, edge: number): FurnitureDirection {
  if (edge >= 0) return edgeToDirection(edge);
  // 居中家具：从 template id 中判断 h/v/square
  const lower = templateId.toLowerCase();
  if (lower.includes("_h_") || lower.endsWith("_h")) return "h";
  if (lower.includes("_v_") || lower.endsWith("_v")) return "v";
  return "square";
}

/** 从 PlacedFurniture 计算 direction（用于单件或整体 group） */
export function calcPlacedDirection(p: { edge: number; templateId: string }): FurnitureDirection {
  return shapeDirectionFromId(p.templateId, p.edge);
}

/**
 * 计算 group 家具中某个 slot 的 direction。
 * slot 1（桌）方向 = 整体贴边方向；
 * slot 2+（椅等子组件）方向 = 相对于 slot1（桌）位置的反向
 */
export function calcGroupSlotDirection(
  mask: Grid,
  slotIndex: number,
  overallDirection: FurnitureDirection
): FurnitureDirection {
  if (slotIndex === 1) return overallDirection;

  let r1 = 0, c1 = 0, n1 = 0;
  let r2 = 0, c2 = 0, n2 = 0;
  for (let r = 0; r < mask.length; r++) {
    for (let c = 0; c < (mask[r]?.length ?? 0); c++) {
      const v = mask[r][c];
      if (v === 1) { r1 += r; c1 += c; n1++; }
      else if (v === slotIndex) { r2 += r; c2 += c; n2++; }
    }
  }
  if (n1 === 0 || n2 === 0) return overallDirection;

  const dr = r2 / n2 - r1 / n1;
  const dc = c2 / n2 - c1 / n1;

  if (Math.abs(dr) >= Math.abs(dc)) {
    return dr > 0 ? "top" : "bottom";
  } else {
    return dc > 0 ? "left" : "right";
  }
}
