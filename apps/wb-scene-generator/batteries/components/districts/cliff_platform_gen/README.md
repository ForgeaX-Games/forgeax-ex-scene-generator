# 梯田悬崖平台 (cliff_platform_gen)

**显式圆形平台放置算法**：每层地形由指定数量的独立有机平台构成，精确控制块数、面积占比、贴边程度，生成真正多块、层次清晰的梯田悬崖地形。

> **DataTree 数据格式**：`inputGrid` / `outputGrid` 均为 `grid`（`access: item`）。本电池每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。

## 与前代方案的根本区别

| 对比项 | 高度场切割方案 | 本方案（显式放置） |
|--------|--------------|----------------|
| 同层块数 | 通常1~2块大连通区域 | **精确 N 块**，由 tierPatchCounts 控制 |
| 块的形状 | 噪声场的等值面 | **每块独立噪声**，形状各不相同 |
| 位置控制 | 无法指定 | **edgeBias 控制贴边概率** |
| 面积控制 | 分位数精确控制 | 基于目标面积推算半径（近似） |

**核心思路：**
1. 每层放置 N 个圆形平台（圆 + 独立柏林噪声轮廓扰动）
2. 每个平台有自己的噪声偏移 → 形状各不相同
3. 贴边放置选项 → 平台与地图边缘融合，形成半圆形悬崖墙
4. 从低层到高层叠加覆盖 → 高层自然"压在"低层之上

## 功能特点

1. **精确块数控制**：每层平台数量由 `tierPatchCounts` 直接指定
2. **形状多样性**：每块平台有独立噪声偏移，形状互不相同
3. **贴边悬崖效果**：`edgeBias` 控制部分平台靠近地图边缘，产生半圆弧形地图边界悬崖
4. **大小变化**：`patchSizeVariation` 控制同层平台之间的尺寸差异
5. **面积占比参考**：通过目标面积计算平均半径，使各层面积接近指定比例

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| inputGrid | grid | — | 单张输入网格（DataTree 逐张处理） |
| tierCount | number | 4 | 地形层数（含底层），建议 3~5 |
| tierAreaRatios | string | 自动 | 各层面积占比 JSON，从最高到倒数第二层，长度=tierCount-1 |
| tierPatchCounts | string | 自动 | 各层平台数量 JSON，从最高到倒数第二层，长度=tierCount-1 |
| patchEdgeDetail | number | 2.5 | 边缘细节频率：1=光滑圆润，4=细密褶皱 |
| patchRoundness | number | 0.65 | 圆度：0=不规则，1=正圆 |
| edgeBias | number | 0.3 | 贴边概率：0=全内部，1=全贴边 |
| patchSizeVariation | number | 0.45 | 大小变化：0=均一，1=差异显著 |
| seed | number | 0 | 随机种子 |

### tierAreaRatios 与 tierPatchCounts 对应关系

以 `tierCount=4` 为例（4层：最高地、高地、中地、底层）：

```json
tierAreaRatios   = "[0.08, 0.18, 0.28]"
tierPatchCounts  = "[2, 3, 4]"
```

| 层级 | 掩码值 | 面积占比 | 平台数 | 说明 |
|------|--------|---------|--------|------|
| 最高地 | 1 | 8% | 2块 | 少量高地平台 |
| 高地 | 2 | 18% | 3块 | 中等数量 |
| 中地 | 3 | 28% | 4块 | 较多平台 |
| 底层 | 4 | 46% (补足) | — | 填充剩余 |

## 使用示例

### 星露谷山野（仿图2风格）

```json
{
  "tierCount": 4,
  "tierAreaRatios": "[0.08, 0.18, 0.28]",
  "tierPatchCounts": "[2, 4, 3]",
  "patchEdgeDetail": 2.5,
  "patchRoundness": 0.6,
  "edgeBias": 0.35,
  "patchSizeVariation": 0.5,
  "seed": 42
}
```

### 单条悬崖分高低（仿图1）

```json
{
  "tierCount": 2,
  "tierAreaRatios": "[0.4]",
  "tierPatchCounts": "[3]",
  "patchEdgeDetail": 2,
  "patchRoundness": 0.65,
  "edgeBias": 0.4,
  "patchSizeVariation": 0.5,
  "seed": 0
}
```

### 多层细碎地形（山地感）

```json
{
  "tierCount": 5,
  "tierAreaRatios": "[0.05, 0.12, 0.2, 0.28]",
  "tierPatchCounts": "[2, 3, 5, 4]",
  "patchEdgeDetail": 3,
  "patchRoundness": 0.55,
  "edgeBias": 0.25,
  "patchSizeVariation": 0.6,
  "seed": 0
}
```

## edgeBias 效果说明

| edgeBias | 效果 |
|---------|------|
| 0.0 | 所有平台分布在内部，远离地图边缘 |
| 0.2~0.4 | 部分平台贴边，产生边缘悬崖墙感（推荐） |
| 0.7+ | 大部分平台在边缘，地图中心为底层，形成"盆地"效果 |

## 注意事项

1. **面积占比是近似值**：显式放置无法精确控制面积，实际面积受平台重叠、噪声扰动影响，与设定值有 ±5~15% 偏差
2. **tierAreaRatios 总和须 < 1**：底层面积 = 1 - 总和；若总和 ≥ 1 则退回自动分配
3. **平台重叠时高层覆盖低层**：同层的两个平台若重叠，视为同一层（掩码值相同）；不同层的平台重叠，高层掩码值覆盖低层
4. **tierPatchCounts 过多可能导致放置失败**：若平台数量远超面积能容纳的数量，泊松盘采样会有部分位置随机放置（不保证最小距离）
5. **建议先用默认参数试效果**，再通过 tierPatchCounts 调整各层块数，最后微调 patchRoundness 和 edgeBias
