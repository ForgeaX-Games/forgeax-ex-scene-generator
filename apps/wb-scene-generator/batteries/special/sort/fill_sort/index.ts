/**
 * fillSort — 标准化输出
 *
 * 处理流程（按用户规范严格执行）：
 *  1. 验证每个 item_i 是二元列表 [A, B]，否则报错跳过
 *  2. 递归识别 A/B 哪个是"网格侧"，哪个是"名称侧"：
 *       网格侧：全部由 number[][] 或 number[][][] 组成
 *       名称侧：全部由 {id, name, type?} 对象组成
 *     两者均不满足时报错跳过
 *  3. 检测打包名称条目（id 为数组），在网格侧找对应的打包网格；
 *     找不到或格式不符时加入错误信息
 *  4. 拍平剩余普通网格与名称条目，验证数量一一对应；
 *     数量不匹配时报错并跳过整个输入
 *  5. 全局重新分配 ID（从 1 起递增），保持网格填充值与名称条目 id 对应
 *
 * 数据结构层级（从浅到深）：
 *   number            → 数字
 *   number[]          → 行（row）：v[0] 是 number
 *   number[][]        → 单张网格（Grid）：v[0] 是行，v[0][0] 是 number
 *   number[][][]      → 打包网格（PackedGrid）：v[0] 是 Grid，v[0][0] 是行，v[0][0][0] 是 number
 *
 * 关键区分：
 *   isGrid(v)       → typeof v[0][0] === "number"（第二层是数字）
 *   isPackedGrid(v) → Array.isArray(v[0][0])（第二层是行，即 v[0] 是 Grid）
 */

interface NameEntry {
  id: number | number[];
  name: string;
  type?: string;
  [key: string]: unknown;
}

// ─── 类型检测（三层严格区分）────────────────────────────────────────────────

/** 是否为网格的一行：第一个元素是 number */
function isRow(v: unknown): v is number[] {
  if (!Array.isArray(v)) return false;
  const a = v as unknown[];
  return a.length === 0 || typeof a[0] === "number";
}

/**
 * 是否为单张网格（number[][]）：
 * v[0] 是行（isRow 为 true），即 v[0][0] 是 number。
 */
function isGrid(v: unknown): v is number[][] {
  if (!Array.isArray(v) || !(v as unknown[]).length) return false;
  return isRow((v as unknown[])[0]);
}

/**
 * 是否为打包网格（number[][][]）：
 * v[0] 是 Grid（isGrid 为 true），即 v[0][0] 是行（Array），v[0][0][0] 是 number。
 * 与 isGrid 的核心区别：isGrid 的 v[0][0] 是 number，isPackedGrid 的 v[0][0] 是 Array。
 */
function isPackedGrid(v: unknown): v is number[][][] {
  if (!Array.isArray(v) || !(v as unknown[]).length) return false;
  return isGrid((v as unknown[])[0]);
}

/** 是否为名称条目对象（必须有 id:number|number[] 和 name:string） */
function isNameEntryObj(v: unknown): v is NameEntry {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && (typeof o.id === "number" || Array.isArray(o.id));
}

/** 是否为打包名称条目（id 为数组） */
function isPackedEntry(e: NameEntry): e is NameEntry & { id: number[] } {
  return Array.isArray(e.id);
}

// ─── 网格侧解析 ───────────────────────────────────────────────────────────────

/**
 * GridSlot：网格侧展平后的最小处理单元
 *  - single：单张网格（number[][]），对应 1 个普通名称条目
 *  - packed：打包网格（number[][][]），对应 1 个打包名称条目（id 为数组）
 */
type GridSlot =
  | { kind: "single"; grid: number[][] }
  | { kind: "packed"; grids: number[][][] };

/**
 * 将网格侧数据解析为 GridSlot 列表（一层展平）。
 *
 * 规则（按优先级）：
 *  1. isGrid(v)                              → [{ kind:"single" }]
 *  2. 数组，v[0] 是 Grid 或 PackedGrid       → 遍历每个元素：
 *       isGrid(el)       → single
 *       isPackedGrid(el) → packed
 *       其他             → 错误
 *  3. 其他                                   → 错误
 */
function parseGridSide(v: unknown): { ok: true; slots: GridSlot[] } | { ok: false; error: string } {
  if (isGrid(v)) {
    return { ok: true, slots: [{ kind: "single", grid: v as number[][] }] };
  }

  if (!Array.isArray(v)) {
    return { ok: false, error: `类型 ${typeof v} 既非网格也非数组` };
  }
  const arr = v as unknown[];
  if (!arr.length) return { ok: false, error: "空数组，无法作为网格侧" };

  const first = arr[0];
  const firstOk = isGrid(first) || isPackedGrid(first);
  if (!firstOk) {
    return {
      ok: false,
      error: `首元素（${Array.isArray(first) ? "嵌套数组" : typeof first}）既非网格（number[][]）也非打包网格（number[][][]）`,
    };
  }

  const slots: GridSlot[] = [];
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    if (isGrid(el)) {
      slots.push({ kind: "single", grid: el as number[][] });
    } else if (isPackedGrid(el)) {
      // 再次校验所有子网格
      const sub = el as unknown[];
      for (let k = 0; k < sub.length; k++) {
        if (!isGrid(sub[k])) {
          return { ok: false, error: `第 ${i} 号打包网格的第 ${k} 张子网格不是有效网格` };
        }
      }
      slots.push({ kind: "packed", grids: el as number[][][] });
    } else if (Array.isArray(el)) {
      return { ok: false, error: `第 ${i} 号元素是数组，但既非网格（number[][]）也非打包网格（number[][][]）` };
    } else {
      return { ok: false, error: `第 ${i} 号元素（类型: ${typeof el}）既非网格也非数组` };
    }
  }
  return { ok: true, slots };
}

// ─── 名称侧解析 ───────────────────────────────────────────────────────────────

/**
 * 将名称侧数据解析为 NameEntry 列表（一层展平）。
 *
 * 支持：
 *  - 单个 NameEntry 对象
 *  - NameEntry[] 数组
 *
 * 不支持（报错）：
 *  - 嵌套数组（NameEntry[][]）
 *  - 非 {id, name} 格式的对象
 *  - 名称条目缺少 id 或 name 字段
 */
function parseNameSide(v: unknown): { ok: true; entries: NameEntry[] } | { ok: false; error: string } {
  if (isNameEntryObj(v)) return { ok: true, entries: [v as NameEntry] };

  if (!Array.isArray(v)) {
    return { ok: false, error: `类型 ${typeof v} 既非名称条目对象也非数组` };
  }
  const arr = v as unknown[];
  if (!arr.length) return { ok: false, error: "空数组，无法作为名称侧" };

  // 明确拒绝嵌套数组格式（NameEntry[][]）
  if (Array.isArray(arr[0])) {
    return {
      ok: false,
      error: "名称侧首元素是数组——名称清单必须是 {id,name} 对象的平铺数组，不支持嵌套列表格式",
    };
  }
  if (!isNameEntryObj(arr[0])) {
    return {
      ok: false,
      error: `名称侧首元素（类型: ${typeof arr[0]}）不是合法的 {id, name} 条目对象`,
    };
  }

  const entries: NameEntry[] = [];
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    if (!isNameEntryObj(el)) {
      return { ok: false, error: `名称清单第 ${i} 个条目不是 {id, name} 对象（类型: ${typeof el}）` };
    }
    entries.push(el as NameEntry);
  }
  return { ok: true, entries };
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 收集网格中所有非零填充值 */
function collectVals(grid: number[][]): Set<number> {
  const s = new Set<number>();
  for (const row of grid) for (const c of row) if (c !== 0) s.add(c);
  return s;
}

/** 按映射表对网格重编号（未映射的值归零） */
function remapGrid(grid: number[][], map: Map<number, number>): number[][] {
  return grid.map(row => row.map(c => (c === 0 ? 0 : (map.get(c) ?? 0))));
}

/** 复制名称条目并替换 id */
function copyEntry(e: NameEntry, newId: number | number[]): NameEntry {
  const out: NameEntry = { id: newId, name: e.name };
  if (e.type !== undefined) out.type = e.type;
  for (const k of Object.keys(e)) {
    if (k !== "id" && k !== "name" && k !== "type") out[k] = e[k];
  }
  return out;
}

// ─── 配对处理器 ───────────────────────────────────────────────────────────────

/**
 * 处理 单张网格 ↔ 单个标量名称条目。
 *
 * 填充值匹配策略（按优先级）：
 *  1. grid 中包含 entry.id → 直接映射
 *  2. grid 只有一个填充值（与 entry.id 不同）→ 直接映射该值
 *  3. grid 有多个填充值且均不匹配 → 全部映射到同一新 ID（报错提示）
 */
function processSinglePair(
  grid: number[][],
  entry: NameEntry & { id: number },
  outputGrids: Array<number[][] | number[][][]>,
  outputNameList: NameEntry[],
  nextIdRef: { value: number },
  errors: string[]
): void {
  const vals = collectVals(grid);
  const newId = nextIdRef.value++;
  outputNameList.push(copyEntry(entry, newId));

  if (!vals.size) {
    outputGrids.push(grid);
    return;
  }

  const sortedVals = [...vals].sort((a, b) => a - b);
  let keyVal: number;

  if (vals.has(entry.id)) {
    keyVal = entry.id;
  } else if (vals.size === 1) {
    keyVal = sortedVals[0];
  } else {
    // 多个填充值且无精确匹配：全部映射到同一新 ID
    keyVal = sortedVals[0];
    errors.push(
      `名称条目 "${entry.name}"(id=${entry.id}) 与网格多个填充值 [${sortedVals.join(",")}] 无精确匹配，` +
      `已将所有值全部映射到新 id=${newId}`
    );
    const allToNew = new Map<number, number>();
    for (const v of vals) allToNew.set(v, newId);
    outputGrids.push(remapGrid(grid, allToNew));
    return;
  }

  outputGrids.push(remapGrid(grid, new Map([[keyVal, newId]])));
}

/**
 * 处理 打包网格 ↔ 打包名称条目（id 为数组）。
 * 打包对【不参与全局重排】：内部 ID 与子网格原样传递，不重映射，不占用 nextIdRef。
 * 输出：1 个原始 bundle（number[][][]，整体作为一项 push）+ 1 个原始打包名称条目。
 */
function processPackedPair(
  grids: number[][][],
  entry: NameEntry & { id: number[] },
  outputGrids: Array<number[][] | number[][][]>,
  outputNameList: NameEntry[],
  errors: string[]
): void {
  if (grids.length !== entry.id.length) {
    errors.push(
      `打包条目 "${entry.name}": id 数组长度(${entry.id.length}) ≠ 子网格数(${grids.length})`
    );
  }
  // 打包对不参与重排，整体原样传递
  outputGrids.push(grids);
  outputNameList.push(entry);
}

/**
 * 处理 单张多值网格 ↔ 多个名称条目（chess_road parcels 等场景）。
 * grid 有 N 个填充值，entries 有 N 个条目，按 id 匹配或按排序顺序兜底匹配。
 * 输出：1 张重映射网格（保留多值结构）+ N 个名称条目。
 */
function processMultiValueGrid(
  grid: number[][],
  entries: NameEntry[],
  outputGrids: Array<number[][] | number[][][]>,
  outputNameList: NameEntry[],
  nextIdRef: { value: number },
  errors: string[]
): void {
  const vals = collectVals(grid);
  const sortedVals = [...vals].sort((a, b) => a - b);

  const byId = new Map<number, NameEntry>();
  for (const e of entries) {
    if (!isPackedEntry(e)) byId.set(e.id as number, e);
  }

  // 检测是否可以按排序顺序兜底配对（所有 grid 值在 nameList 中均找不到，但数量相同）
  const allMissing = sortedVals.every(v => !byId.has(v));
  const sortedEntries = [...byId.values()].sort((a, b) => (a.id as number) - (b.id as number));
  const matchByOrder = allMissing && sortedEntries.length === sortedVals.length;

  const oldToNew = new Map<number, number>();
  for (let i = 0; i < sortedVals.length; i++) {
    const v = sortedVals[i];
    const newId = nextIdRef.value++;
    oldToNew.set(v, newId);

    let matched: NameEntry;
    if (byId.has(v)) {
      matched = byId.get(v)!;
    } else if (matchByOrder) {
      matched = sortedEntries[i];
    } else {
      const fb = vals.size === 1 ? "未命名" : `未命名_${v}`;
      errors.push(`填充值 ${v} 无对应名称条目，使用兜底名称 "${fb}"`);
      matched = { id: v, name: fb };
    }
    outputNameList.push(copyEntry(matched, newId));
  }
  outputGrids.push(remapGrid(grid, oldToNew));
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

export function fillSort(input: Record<string, unknown>): Record<string, unknown> {
  const description = typeof input.description === "string" ? input.description : "";
  const portCount = typeof input.portCount === "number" ? input.portCount : 2;

  const outputGrids: Array<number[][] | number[][][]> = [];
  const outputNameList: NameEntry[] = [];
  const nextIdRef = { value: 1 };
  const errors: string[] = [];

  for (let i = 0; i < portCount; i++) {
    const item = input[`item_${i}`];
    const tag = `层${i}`;

    // ── 步骤1：验证二元列表 ────────────────────────────────────────────────────
    if (!Array.isArray(item)) continue; // 端口未连接，静默跳过
    const arr = item as unknown[];
    if (arr.length !== 2) {
      errors.push(`${tag}: 输入必须是二元列表 [网格侧, 名称侧]，当前长度为 ${arr.length}`);
      continue;
    }

    // ── 步骤2：识别网格侧与名称侧（尝试两种顺序）─────────────────────────────
    const g0 = parseGridSide(arr[0]);
    const n1 = parseNameSide(arr[1]);
    const g1 = parseGridSide(arr[1]);
    const n0 = parseNameSide(arr[0]);

    let gridSlots: GridSlot[];
    let nameEntries: NameEntry[];

    if (g0.ok && n1.ok) {
      gridSlots = g0.slots;
      nameEntries = n1.entries;
    } else if (g1.ok && n0.ok) {
      gridSlots = g1.slots;
      nameEntries = n0.entries;
    } else {
      const parts = [
        !g0.ok && `[0]→网格失败: ${g0.error}`,
        !n1.ok && `[1]→名称失败: ${n1.error}`,
        !g1.ok && `[1]→网格失败: ${g1.error}`,
        !n0.ok && `[0]→名称失败: ${n0.error}`,
      ].filter(Boolean);
      errors.push(`${tag}: 无法识别网格侧和名称侧 → ${parts.join("；")}`);
      continue;
    }

    // ── 步骤3+4（分支A）：等长 → 按索引顺序逐对处理，严格保持输入顺序 ──────────
    if (gridSlots.length === nameEntries.length) {
      for (let j = 0; j < gridSlots.length; j++) {
        const slot = gridSlots[j];
        const entry = nameEntries[j];

        if (slot.kind === "packed" && isPackedEntry(entry)) {
          // 打包对：整体原样传递，不重编号
          processPackedPair(slot.grids, entry, outputGrids, outputNameList, errors);
        } else if (slot.kind === "packed" && !isPackedEntry(entry)) {
          errors.push(
            `${tag}[${j}]: 网格是打包网格（${slot.grids.length} 张子网格），` +
            `但名称条目 "${entry.name}" 的 id=${entry.id} 不是数组，无法配对，跳过此对`
          );
        } else if (slot.kind === "single" && isPackedEntry(entry)) {
          errors.push(
            `${tag}[${j}]: 名称条目 "${entry.name}" 的 id=[${entry.id}] 是打包格式，` +
            `但对应网格是单张网格（需要打包网格 number[][][]），跳过此对`
          );
        } else {
          // 普通对：立即处理（与打包对同步输出，保持 j 顺序）
          processSinglePair(
            slot.grid,
            entry as NameEntry & { id: number },
            outputGrids,
            outputNameList,
            nextIdRef,
            errors
          );
        }
      }
      continue;
    }

    // ── 步骤4（分支B）：1 个 single 网格 ↔ 多个标量名称条目 → 多值单网格模式 ──
    if (
      gridSlots.length === 1 &&
      gridSlots[0].kind === "single" &&
      nameEntries.length > 1 &&
      nameEntries.every(e => !isPackedEntry(e))
    ) {
      processMultiValueGrid(
        gridSlots[0].grid,
        nameEntries,
        outputGrids,
        outputNameList,
        nextIdRef,
        errors
      );
      continue;
    }

    // ── 步骤4：数量不匹配 → 报错并跳过整个输入 ───────────────────────────────
    errors.push(
      `${tag}: 网格槽位数(${gridSlots.length}) 与名称条目数(${nameEntries.length}) 不匹配，跳过整个输入`
    );
  }

  // ── 后处理：检测重复名称与缺失 type 字段 ─────────────────────────────────────
  const nameCounts = new Map<string, number>();
  for (const e of outputNameList) {
    nameCounts.set(e.name, (nameCounts.get(e.name) ?? 0) + 1);
  }
  const dups = [...nameCounts.entries()]
    .filter(([, c]) => c > 1)
    .map(([n]) => `「${n}」`);
  if (dups.length > 0) errors.push(`名称重复：${dups.join("、")}`);

  const missingType = outputNameList.filter(e => !e.type).map(e => `「${e.name}」`);
  if (missingType.length > 0) errors.push(`缺少 type 字段：${missingType.join("、")}`);

  return { description, outputGrids, outputNameList, errorMessage: errors.join("；") };
}
