# 精准POI分布 (poi_place)

在单张网格的指定坐标处放置兴趣点（POI）。若坐标格子的值不等于 `targetValue`，则搜索整个网格找到最近的合法格子，从所有等距候选格中必定随机选取一个，保证 POI 始终落在目标地形上且具有自然随机感。

> **DataTree 数据格式**：`inputGrid` / `outputGrid` 均为 `grid`（`access: item`）。本电池每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。

## 功能特点

1. **精准坐标放置**：每条规则显式指定 `(x, y)`，适合有明确位置意图的地标布置。
2. **全图 BFS 就近搜索**：若坐标不在目标区域值内，BFS 遍历整个网格直到找到最近的合法格，不设搜索半径上限，一定能放置成功（只要网格中存在 targetValue）。
3. **必定随机选取**：无论坐标合法与否，都从所有等距最近的候选格中随机选取一个，保证自然感。
4. **同名共享 ID**：相同 `decoration` 名称的 POI 共用同一掩码 ID，方便下游按类型筛选。
5. **多值网格输出**：每种 POI 一个递增 id 写入同一张 `outputGrid`，配合 `outputNameList` 可接 `grid_split_by_value` 拆分。

## 适用情况

- 已有场景设计意图（如"在地图中心附近放一个城堡"）时使用，比随机散布更可控。
- 配合 AI Agent 根据描述生成带坐标的 POI 规则，再由本电池精确落位。
- 不适合大批量随机散布的场景，那种情况请用「随机POI分布」电池。

## 基本使用方法

1. 将上游地形网格接入 `inputGrid` 端口。
2. 在 `poiRules` 端口输入规则数组，每条规则需要 `decoration`、`targetValue`、`points` 字段。
3. `seed=0` 时随机，固定 seed 可复现结果。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| inputGrid | grid | - | 单张输入网格 `number[][]`（DataTree 逐张处理） |
| poiRules | array | - | POI规则列表，见下方说明 |
| minDistance | number | 8 | 所有 POI 点之间的最小格距 |
| scatterR | number | 5 | 找到最近合法格后的额外随机散播半径，0=精确就近 |
| seed | number | 0 | 随机种子，0 使用当前时间自动随机 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 单张多值网格：每种 POI 一个递增 id，未放置处为 0 |
| outputNameList | array | 网格中实际出现的 POI 清单：`[{id, name, type}]`，type 固定为 asset |
| placedCount | number | 成功放置的 POI 点总数 |

## POI规则格式

### 规则数组格式

```json
[
  {
    "decoration": "城堡",
    "targetValue": 4,
    "points": [[64, 32], [80, 50]]
  },
  {
    "decoration": "洞穴入口",
    "targetValue": 7,
    "points": [[10, 90], [30, 20], [55, 70]]
  }
]
```

### 规则参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| decoration | string | POI 名称，同名共享同一掩码 ID |
| targetValue | number | 目标格值，POI 必须落在该值的格子上 |
| points | \[\[x,y\],…\] | 坐标列表，每个元素为 `[列号, 行号]`，支持一次放多个同类点 |

## 就近移动逻辑说明

```
输入坐标 (x, y)
    │
    └─ BFS 搜索整个网格（无半径限制）
           │
           └─ 收集所有等距最近的合法格（值 == targetValue）
                  │
                  ├─ 坐标本身合法 → candidates = [(x,y)]，仍随机选取（即选本身）
                  │
                  └─ 坐标不合法 → candidates = 最近距离层的所有合法格
                                        │
                                        └─ 从 candidates 中随机选一个 → 写入 POI
```

## 使用示例

### 输入示例

```json
{
  "inputGrid": [[4,4,7,4],[4,4,4,7],[3,3,3,3]],
  "poiRules": [
    {"decoration": "洞穴", "targetValue": 7, "points": [[1, 0], [3, 1]]},
    {"decoration": "营火", "targetValue": 4, "points": [[0, 2]]}
  ],
  "seed": 42
}
```

第一条规则：坐标 `(1,0)` 的值是 4，不等于 targetValue 7，BFS 找到最近的 7（`(2,0)`），随机选取并放置。坐标 `(3,1)` 合法，直接放置。  
第二条规则：坐标 `(0,2)` 的值是 3，不等于 4，BFS 找到最近的 4，随机选取放置。

### 输出示例

```json
{
  "outputGrid": [[0,0,9,0],[0,0,0,9],[0,10,0,0]],
  "outputNameList": [
    {"id": 9, "name": "洞穴", "type": "asset"},
    {"id": 10, "name": "营火", "type": "asset"}
  ],
  "placedCount": 3
}
```

## 注意事项

1. **坐标从 0 起始**：`x` 是列号，`y` 是行号，均从 0 开始，确保不越界。
2. **一定能放置**：BFS 搜索整张网格，只要 `targetValue` 在网格中存在，POI 就一定能放置成功。
3. **随机性说明**：坐标与目标格相差越远，等距候选格越多，随机选取的范围越大（偏移感越强）；坐标恰好合法时候选格只有自身，实际上是确定性的。
4. **同名 decoration 共享 ID**：若希望多个 POI 点各有不同 ID，请使用不同的 `decoration` 名称。
5. **不改写地形**：只在 POI 中心格写入新 ID，不覆盖周边格子。
