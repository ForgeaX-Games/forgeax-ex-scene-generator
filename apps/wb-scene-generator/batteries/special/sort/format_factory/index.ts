/**
 * formatFactory: 格式工厂 — 网格与名称清单的格式校验、拆分、规范化
 *
 * 输入：
 *   inputGrid  (any)    — 单值网格 / 多值网格 / 网格列表 / 任意嵌套混合
 *   nameList   (array)  — 任意格式的名称清单（支持嵌套）
 *   mode       (string) — all / validate / split / flatten
 *
 * 输出：
 *   outputGridList (array)  — 01 单值网格列表
 *   outputNameList (array)  — 标准化名称清单 [{id, name, type}]
 *   detail         (string) — 各步骤报告
 *
 * 四大功能：
 *   ① 网格与名称清单的数量对应关系校验
 *   ② 名称清单子项格式校验（{id, name, type}）
 *   ③ 将各种格式网格递归拆分为 01 单值网格列表
 *   ④ 将任意嵌套名称清单拍平并规范化为标准格式
 */

// ─── 类型定义 ────────────────────────────────────────────────────────────────

type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

interface StepReport {
  step: string;
  status: "ok" | "error" | "skip";
  message: string;
}

// ─── 网格判断工具 ────────────────────────────────────────────────────────────

/** 检查值是否为合法的二维网格（number[][]） */
function isGrid(v: unknown): v is Grid {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[][])[0];
  return Array.isArray(first) && first.length > 0 && typeof first[0] === "number";
}

/** 递归从任意嵌套结构中收集所有 Grid */
function collectGrids(node: unknown, out: Grid[]): void {
  if (isGrid(node)) {
    out.push(node as Grid);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectGrids(item, out);
    }
  }
}

/** 收集网格中所有不同非零值，按升序排列 */
function distinctNonZeroValues(grid: Grid): number[] {
  const seen = new Set<number>();
  for (const row of grid) {
    for (const cell of row) {
      if (cell !== 0) seen.add(cell);
    }
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/** 判断网格是否已是 01 网格（非零只有 1） */
function isBinaryGrid(grid: Grid): boolean {
  for (const row of grid) {
    for (const cell of row) {
      if (cell !== 0 && cell !== 1) return false;
    }
  }
  return true;
}

/** 将多值网格拆分为多张 01 网格（每种填充值 → 1，其余 → 0） */
function splitToBinaryGrids(grid: Grid): Grid[] {
  if (isBinaryGrid(grid)) return [grid];
  const values = distinctNonZeroValues(grid);
  return values.map(v =>
    grid.map(row => row.map(cell => (cell === v ? 1 : 0)))
  );
}

// ─── 名称清单工具 ────────────────────────────────────────────────────────────

/** 判断对象是否为原始 NameEntry（含 id 和 name 字段） */
function isRawNameEntry(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o["id"] === "number" && typeof o["name"] === "string";
}

/** 递归遍历任意嵌套结构，收集所有 NameEntry 对象 */
function collectNameEntries(node: unknown, seenIds: Set<number>, out: NameEntry[]): void {
  if (isRawNameEntry(node)) {
    const o = node as Record<string, unknown>;
    const id = o["id"] as number;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      out.push({
        id,
        name: o["name"] as string,
        type: typeof o["type"] === "string" ? o["type"] : "",
      });
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectNameEntries(item, seenIds, out);
    }
  }
}

// ─── 步骤实现 ────────────────────────────────────────────────────────────────

/**
 * 步骤①：校验网格的唯一值数量与名称清单条目数量是否匹配
 * 支持多值网格、01网格列表等场景
 */
function stepValidateCount(grids: Grid[], flatNameList: NameEntry[]): StepReport {
  const step = "① 数量对应关系校验";

  if (grids.length === 0) {
    return { step, status: "error", message: "未找到有效网格，无法校验。" };
  }
  if (flatNameList.length === 0) {
    return { step, status: "error", message: "名称清单为空，无法校验。" };
  }

  // 收集所有网格中出现的不同非零值（跨网格合并）
  const allValues = new Set<number>();
  for (const grid of grids) {
    for (const v of distinctNonZeroValues(grid)) allValues.add(v);
  }

  const uniqueValueCount = allValues.size;
  const nameCount = flatNameList.length;

  if (uniqueValueCount === nameCount) {
    return {
      step,
      status: "ok",
      message: `✓ 匹配：网格包含 ${uniqueValueCount} 个唯一非零值，名称清单有 ${nameCount} 条，数量一致。`,
    };
  } else {
    return {
      step,
      status: "error",
      message: `✗ 不匹配：网格包含 ${uniqueValueCount} 个唯一非零值，但名称清单有 ${nameCount} 条。`,
    };
  }
}

/**
 * 步骤②：校验名称清单子项是否符合标准格式 {id, name, type}
 */
function stepValidateFormat(rawNameList: unknown): StepReport {
  const step = "② 名称清单格式校验";

  if (!Array.isArray(rawNameList)) {
    return { step, status: "error", message: "名称清单不是数组格式。" };
  }

  const issues: string[] = [];
  let checked = 0;

  function checkNode(node: unknown, path: string): void {
    if (isRawNameEntry(node)) {
      checked++;
      const o = node as Record<string, unknown>;
      const hasType = "type" in o && typeof o["type"] === "string";
      if (!hasType) {
        issues.push(`${path}: 缺少 type 字段（将留空处理）`);
      }
    } else if (Array.isArray(node)) {
      node.forEach((item, i) => checkNode(item, `${path}[${i}]`));
    } else if (node !== null && typeof node === "object") {
      const o = node as Record<string, unknown>;
      const hasId = typeof o["id"] === "number";
      const hasName = typeof o["name"] === "string";
      if (hasId || hasName) {
        checked++;
        if (!hasId) issues.push(`${path}: id 字段缺失或类型错误`);
        if (!hasName) issues.push(`${path}: name 字段缺失或类型错误`);
        if (!("type" in o)) issues.push(`${path}: 缺少 type 字段（将留空处理）`);
      }
    }
  }

  (rawNameList as unknown[]).forEach((item, i) => checkNode(item, `[${i}]`));

  if (checked === 0) {
    return { step, status: "error", message: "未找到有效的名称清单条目。" };
  }

  if (issues.length === 0) {
    return {
      step,
      status: "ok",
      message: `✓ 格式正确：共 ${checked} 条，所有条目均含 {id, name, type} 字段。`,
    };
  } else {
    const typeOnlyIssues = issues.filter(s => s.includes("缺少 type"));
    const otherIssues = issues.filter(s => !s.includes("缺少 type"));
    const parts: string[] = [`检查了 ${checked} 条`];
    if (typeOnlyIssues.length > 0) parts.push(`${typeOnlyIssues.length} 条缺少 type（已留空）`);
    if (otherIssues.length > 0) {
      parts.push(`${otherIssues.length} 条格式错误`);
      return { step, status: "error", message: `✗ ${parts.join("，")}：${otherIssues.slice(0, 3).join("；")}` };
    }
    return { step, status: "ok", message: `✓ ${parts.join("，")}。` };
  }
}

/**
 * 步骤③：递归解析所有网格格式，拆分为 01 单值网格列表
 */
function stepSplitGrids(inputGrid: unknown): { report: StepReport; outputGridList: Grid[] } {
  const step = "③ 网格拆分为 01 单值网格";

  const rawGrids: Grid[] = [];
  collectGrids(inputGrid, rawGrids);

  if (rawGrids.length === 0) {
    return {
      report: { step, status: "error", message: "未找到有效的网格数据。" },
      outputGridList: [],
    };
  }

  const outputGridList: Grid[] = [];
  let multiValueCount = 0;
  let binaryCount = 0;

  for (const grid of rawGrids) {
    if (isBinaryGrid(grid)) {
      outputGridList.push(grid);
      binaryCount++;
    } else {
      const parts = splitToBinaryGrids(grid);
      outputGridList.push(...parts);
      multiValueCount++;
    }
  }

  const msg =
    `✓ 共解析 ${rawGrids.length} 张网格` +
    (multiValueCount > 0 ? `，其中 ${multiValueCount} 张多值网格已拆分` : "") +
    `，输出 ${outputGridList.length} 张 01 单值网格。`;

  return {
    report: { step, status: "ok", message: msg },
    outputGridList,
  };
}

/**
 * 步骤④：将任意嵌套名称清单拍平并规范化为 [{id, name, type}]
 */
function stepFlattenNameList(rawNameList: unknown): { report: StepReport; outputNameList: NameEntry[] } {
  const step = "④ 名称清单拍平与规范化";

  const seenIds = new Set<number>();
  const outputNameList: NameEntry[] = [];
  collectNameEntries(rawNameList, seenIds, outputNameList);

  if (outputNameList.length === 0) {
    return {
      report: { step, status: "error", message: "名称清单为空或无有效条目。" },
      outputNameList: [],
    };
  }

  const missingType = outputNameList.filter(e => !e.type).length;
  const msg =
    `✓ 拍平完成：共 ${outputNameList.length} 条` +
    (missingType > 0 ? `，其中 ${missingType} 条 type 字段留空。` : "，所有条目均含 type 字段。");

  return {
    report: { step, status: "ok", message: msg },
    outputNameList,
  };
}

// ─── 主导出函数 ──────────────────────────────────────────────────────────────

export function formatFactory(input: Record<string, unknown>): Record<string, unknown> {
  const inputGrid = input.inputGrid;
  const nameListRaw = input.nameList;
  const mode = typeof input.mode === "string" ? input.mode : "sort";

  const reports: StepReport[] = [];

  // 步骤③：先解析网格（后续步骤需要基础数据）
  const { report: splitReport, outputGridList } = stepSplitGrids(inputGrid);

  // 步骤④：先拍平名称清单（步骤①需要用到拍平结果）
  const { report: flattenReport, outputNameList } = stepFlattenNameList(nameListRaw);

  // sort 模式：执行全部四个步骤
  // 此处用 switch 结构便于后续扩展新模式
  switch (mode) {
    case "sort":
    default: {
      // 步骤①：数量校验
      const rawGrids: Grid[] = [];
      collectGrids(inputGrid, rawGrids);
      reports.push(stepValidateCount(rawGrids, outputNameList));

      // 步骤②：格式校验
      reports.push(stepValidateFormat(nameListRaw));

      // 步骤③：网格拆分
      reports.push(splitReport);

      // 步骤④：名称清单拍平
      reports.push(flattenReport);
      break;
    }
  }

  const detail = reports
    .map(r => {
      const prefix = r.status === "ok" ? "" : r.status === "error" ? "[错误] " : "[跳过] ";
      return `${r.step}\n${prefix}${r.message}`;
    })
    .join("\n\n");

  return { outputGridList, outputNameList, detail };
}
