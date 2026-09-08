/**
 * renderPreprocess: 渲染预处理
 *
 * 行为：
 *   ① 解析 renderOrder，找出其中 type=tile 的名称（忽略 type=asset）
 *   ② 按 renderOrder 顺序，对 tile 类型做累积合并：
 *      每一项（或 [] 内的平级项）会合并前面所有 tile 的网格（OR 操作），
 *      即越靠后的 tile 的网格包含越多的区域。
 *      [] 内的 tile 互相不合并，但它们都继承前面所有 tile 的累积结果，
 *      且对后面的 tile 来说，[] 内所有 tile 的并集会被继续向后传递。
 *   ③ 输出网格列表和名称清单按以下顺序排列：
 *      - renderOrder 中出现的 tile（按顺序，[] 内保持原相对顺序）
 *      - renderOrder 中未出现的 tile
 *      - 所有 asset（排在末尾）
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */

type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

/** 将 grid 中的 1 合并到 target（原地 OR 操作） */
function orGridInto(target: Grid, source: Grid): void {
  const rows = Math.min(target.length, source.length);
  for (let r = 0; r < rows; r++) {
    const cols = Math.min(target[r].length, source[r].length);
    for (let c = 0; c < cols; c++) {
      if (source[r][c] !== 0) target[r][c] = 1;
    }
  }
}

/** 深拷贝二维数组 */
function cloneGrid(grid: Grid): Grid {
  return grid.map(row => [...row]);
}

/** 将两张网格做 OR 合并，返回新网格 */
function orGrids(a: Grid, b: Grid): Grid {
  const result = cloneGrid(a);
  orGridInto(result, b);
  return result;
}

/**
 * 解析 renderOrder 字符串为顺序槽位数组
 * 每个槽位是字符串数组（单项也封装为单元素数组）
 * 例如：["浅水","中水",["草地","浓草地"],"山地"]
 * => [["浅水"], ["中水"], ["草地","浓草地"], ["山地"]]
 */
function parseRenderOrder(raw: string): string[][] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const slots: string[][] = [];
    for (const item of parsed) {
      if (typeof item === "string") {
        slots.push([item]);
      } else if (Array.isArray(item)) {
        const group: string[] = [];
        for (const sub of item) {
          if (typeof sub === "string") group.push(sub);
        }
        if (group.length > 0) slots.push(group);
      }
    }
    return slots;
  } catch {
    return null;
  }
}

export function renderPreprocess(input: Record<string, unknown>): Record<string, unknown> {
  const inputGridList = input.inputGridList;
  const nameListRaw = input.nameList;
  const renderOrderStr = typeof input.renderOrder === "string" ? input.renderOrder : "[]";

  // ─── 解析网格列表 ─────────────────────────────────────────────────────────
  let grids: Grid[] = [];
  if (Array.isArray(inputGridList)) {
    for (const item of inputGridList as unknown[]) {
      if (
        Array.isArray(item) &&
        item.length > 0 &&
        Array.isArray((item as unknown[][])[0])
      ) {
        grids.push(item as Grid);
      }
    }
  }

  // ─── 解析名称清单 ─────────────────────────────────────────────────────────
  let nameList: NameEntry[] = [];
  if (Array.isArray(nameListRaw)) {
    for (const item of nameListRaw as unknown[]) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item)
      ) {
        const o = item as Record<string, unknown>;
        if (typeof o["id"] === "number" && typeof o["name"] === "string") {
          nameList.push({
            id: o["id"] as number,
            name: o["name"] as string,
            type: typeof o["type"] === "string" ? (o["type"] as string) : "",
          });
        }
      }
    }
  }

  // ─── 建立 name→NameEntry 索引 ─────────────────────────────────────────────
  const nameToEntry = new Map<string, NameEntry>();
  for (const entry of nameList) {
    nameToEntry.set(entry.name, entry);
  }

  // ─── 建立 id→Grid 索引 ────────────────────────────────────────────────────
  // 假设 grids[i] 对应 nameList[i]（按位置对应）
  const idToGrid = new Map<number, Grid>();
  for (let i = 0; i < nameList.length; i++) {
    if (i < grids.length) {
      idToGrid.set(nameList[i].id, grids[i]);
    }
  }

  // ─── 解析渲染顺序 ─────────────────────────────────────────────────────────
  const slots = parseRenderOrder(renderOrderStr);
  if (!slots) {
    return {
      outputGridList: grids,
      outputNameList: nameList,
      detail: "[错误] renderOrder 解析失败，请检查 JSON 格式。",
    };
  }

  const logs: string[] = [];
  logs.push(`渲染顺序解析成功，共 ${slots.length} 个槽位。`);

  // ─── 过滤出 tile 类型，忽略 asset ─────────────────────────────────────────
  // 只处理 renderOrder 中 type=tile（或 type 为空）的名称；type=asset 的跳过
  // 按 slot 过滤，记录每个 slot 中有效的 tile 名称
  type ValidSlot = { names: string[]; entries: NameEntry[] };
  const validSlots: ValidSlot[] = [];

  for (const slot of slots) {
    const tileNames: string[] = [];
    const tileEntries: NameEntry[] = [];
    for (const name of slot) {
      const entry = nameToEntry.get(name);
      if (!entry) {
        logs.push(`⚠ 名称 "${name}" 在名称清单中不存在，已忽略。`);
        continue;
      }
      if (entry.type === "asset") {
        logs.push(`ℹ 名称 "${name}" 类型为 asset，已忽略。`);
        continue;
      }
      tileNames.push(name);
      tileEntries.push(entry);
    }
    if (tileEntries.length > 0) {
      validSlots.push({ names: tileNames, entries: tileEntries });
    }
  }

  logs.push(`有效 tile 槽位数：${validSlots.length}`);

  // ─── 累积合并逻辑（从后往前） ────────────────────────────────────────────
  // 渲染语义：排序第1位是最底层，面积最大；越靠后的 tile 是叠在上面的子集，面积更小。
  // 因此：每个 tile 的输出网格 = 自身原始网格 OR 后面所有 tile 的并集。
  // 实现：先正向收集每个 slot 的原始网格，再从后往前累积。

  // 第一步：正向收集每个有效 slot 的原始网格和 entry
  type SlotItem = { entry: NameEntry; ownGrid: Grid };
  const slotItems: SlotItem[][] = [];

  for (const slot of validSlots) {
    const items: SlotItem[] = [];
    for (const entry of slot.entries) {
      const ownGrid = idToGrid.get(entry.id);
      if (!ownGrid) {
        logs.push(`⚠ 名称 "${entry.name}"（id=${entry.id}）没有对应网格，使用空网格占位。`);
        const firstGrid = grids[0];
        const empty: Grid = firstGrid ? firstGrid.map(row => row.map(() => 0)) : [];
        items.push({ entry, ownGrid: empty });
        continue;
      }
      items.push({ entry, ownGrid });
    }
    slotItems.push(items);
  }

  // 第二步：从后往前累积
  // accumulatedGrid：当前 slot 之后所有 tile 的并集
  let accumulatedGrid: Grid | null = null;
  // 存储每个 slot 的计算结果（顺序与 slotItems 一致）
  const slotResults: Array<Array<{ entry: NameEntry; grid: Grid }>> = new Array(slotItems.length);

  for (let si = slotItems.length - 1; si >= 0; si--) {
    const slot = slotItems[si];
    const slotOut: Array<{ entry: NameEntry; grid: Grid }> = [];

    for (const { entry, ownGrid } of slot) {
      // 当前 tile = 自身 OR 后续累积
      const resultGrid = accumulatedGrid !== null
        ? orGrids(ownGrid, accumulatedGrid)
        : cloneGrid(ownGrid);
      slotOut.push({ entry, grid: resultGrid });
    }

    // 将本 slot 所有原始网格（未叠加，只用自身）并入 accumulatedGrid，供前面的 slot 使用
    for (const { ownGrid } of slot) {
      if (accumulatedGrid === null) {
        accumulatedGrid = cloneGrid(ownGrid);
      } else {
        orGridInto(accumulatedGrid, ownGrid);
      }
    }

    slotResults[si] = slotOut;
  }

  // 第三步：正向展开为有序结果数组
  const orderedResults: Array<{ entry: NameEntry; grid: Grid }> = [];
  for (const slotOut of slotResults) {
    orderedResults.push(...slotOut);
  }

  // ─── 收集 renderOrder 中出现的 tile id 集合 ───────────────────────────────
  const orderedIds = new Set<number>(orderedResults.map(r => r.entry.id));

  // ─── 收集未在 renderOrder 中出现的 tile ──────────────────────────────────
  const remainingTiles: Array<{ entry: NameEntry; grid: Grid }> = [];
  for (const entry of nameList) {
    if (entry.type === "asset") continue;
    if (orderedIds.has(entry.id)) continue;
    const grid = idToGrid.get(entry.id);
    if (grid) {
      remainingTiles.push({ entry, grid: cloneGrid(grid) });
    }
  }

  // ─── 收集 asset 类型（排在末尾） ─────────────────────────────────────────
  const assetItems: Array<{ entry: NameEntry; grid: Grid }> = [];
  for (const entry of nameList) {
    if (entry.type !== "asset") continue;
    const grid = idToGrid.get(entry.id);
    if (grid) {
      assetItems.push({ entry, grid: cloneGrid(grid) });
    }
  }

  // ─── 拼接最终顺序 ─────────────────────────────────────────────────────────
  const finalItems = [...orderedResults, ...remainingTiles, ...assetItems];

  const outputGridList = finalItems.map(item => item.grid);
  // 重新按位置从 1 开始连续编号，使 id 与 gridList 下标严格对应（id = index + 1）
  const outputNameList = finalItems.map((item, i) => ({
    ...item.entry,
    id: i + 1,
  }));

  logs.push(`输出顺序：${outputNameList.map(e => `[${e.id}]${e.name}`).join(" → ")}`);

  return {
    outputGridList,
    outputNameList,
    detail: logs.join("\n"),
  };
}
