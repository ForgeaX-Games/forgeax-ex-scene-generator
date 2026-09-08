# 指定锚点岛屿生成 (new_island_region_gen)

把传入的 **point 列表当作各岛锚点**（每点一岛），在输入网格掩码内用 `island_poisson_gen` 的内部算法生成有机形状的岛屿区域。

> **与 `island_poisson_gen` 的关系**：本电池**完全复用** `island_poisson_gen` 的内部生成算法（`placeSubSeeds` 子种子散布 → `competitiveGrow` 竞争 BFS 膨胀 → `removeSmallIslands` 去碎片 → `majoritySmooth` 多数投票平滑），**唯一差异**是把「Bridson 泊松盘随机采样锚点」这一步替换为「直接使用外部传入的 points 作锚点」。因此岛屿出现在**指定位置**而非随机位置。

## 算法流程

```
Step 0: points 锚点（外部指定，每点一岛，islandId = 序号+1）
    ↓
Step 1: 子种子散布
        每个锚点衍生 subSeeds 个子种子（按 subSpacing 间距散布）
        → 多个子种子融合形成多叶有机 blob
    ↓
Step 2: 竞争 BFS 膨胀
        所有子种子同时向外膨胀，各岛屿独立扩张，仅在 grid 掩码内生长
    ↓
Step 3: 去除小碎片 + 多数投票平滑（消除锯齿，保留多叶形态）
    ↓
输出: islandGrid（陆地）+ waterGrid（水面）+ regionGrid（各岛 ID）
```

每个岛的 `subSeeds`/`subSpacing`/`minArea`/`smoothRadius` 沿用 `island_poisson_gen` 中按 `islandSize` 派生的公式，只是把全局 `islandSize` 换成该岛自己的 `islandSizes[i]`：

- `subSeeds   = max(2, round(size / 3))`
- `subSpacing = max(2, size * 0.4)`
- `minArea    = max(4, round(minSize² * 0.1))`（取所有岛中最小尺寸，避免误删小岛）
- `smoothRadius = max(1, round(maxSize * 0.08))`

## 输入参数

| 参数名 | 类型 | access | 默认值 | 说明 |
|--------|------|--------|--------|------|
| grid | grid | item | （必填） | 可放置区域掩码（非零=可放置），尺寸决定输出大小 |
| points | point2d | list | （必填） | 各岛中心锚点（x→列、y→行），每点一岛，越界点忽略 |
| islandSizes | number | list | [12] | 各岛膨胀半径列表，与 points 一一对应；不足时复用最后一个值 |
| radiusVar | number | item | 0.3 | 子种子大小随机差异（0~0.8） |
| seed | number | item | 0 | 随机种子，0=时间戳 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| islandGrid | grid | 陆地掩码：1=陆地，0=水面（所有岛合并） |
| waterGrid | grid | 水面掩码：1=水面，0=陆地（= 1 − islandGrid） |
| regionGrid | grid | 各岛 1-based ID（对应 points 序号），0=水面 |

## 注意事项

1. **锚点位置**：`points` 落在掩码外（0 格）的点仍会播种，但只能向掩码内生长；落在掩码内更可控。越界（出网格范围）的点直接忽略。
2. **岛屿大小**：`islandSizes` 控制各岛膨胀半径；与 `points` 数量不一致时短则复用最后一个值、长则截断到 points 数量。
3. **无有效锚点**：`points` 全部越界/无效时返回整图全水（带 `error` 字段），不抛异常。
4. **典型用法**：作为 `IslandRegions` 模板的核心算法节点；模板负责从 scene 提取掩码网格、把 `islandGrid` 转回 scene 子树并拆分剩余区域（Rest）。
