# 深空POI放置器 (deeper_poi_placer)

根据密度权重图在平坦地面上放置 100+ 种 POI 兴趣点。高密度区 POI 极度密集，未被覆盖的通道自然形成迷宫感道路；低密度区稀疏空旷，只有零星几个 POI。

## 功能特点

1. **密度加权放置**：密度场高的格子被优先选中，产生极度不均匀的空间分布
2. **100+ 种 POI 支持**：每种 POI 独立管理，各有计数和最小间距配置
3. **自然道路涌现**：没有显式道路算法——POI 挤占地面后，剩余格子自然形成通道
4. **迷宫感控制**：通过 `globalMinDist` 和 POI 密度共同控制通道宽窄，极端情况下道路复杂如迷宫
5. **输出格式兼容**：`outputGridList` / `outputNameList` 格式与 `poi_scatter` 一致，可无缝接入下游渲染

## 适用情况

- 配合 `deeper_density_field` 生成完整的深层空间场景
- 太空站内部、地下废墟、科幻仓库等 POI 密度极度不均的场景
- 需要道路由 POI 自然挤压形成的场景（而非预先规划路网）
- 不适用：需要精确控制道路走向的场景（用专用道路电池）

## 基本使用方法

```
[deeper_density_field]
  groundGrid  ──▶ [deeper_poi_placer].groundGrid
  densityGrid ──▶ [deeper_poi_placer].densityGrid

[JSON数据/手动配置]
  poiList ──▶ [deeper_poi_placer].poiList
```

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| groundGrid | grid | - | 全1地面底图（来自 deeper_density_field） |
| densityGrid | grid | - | 密度权重图 0–100（来自 deeper_density_field） |
| poiList | array | - | POI 规则数组，见下方格式说明 |
| globalMinDist | number | 2 | 所有 POI 之间的全局最小格子间距 |
| densityInfluence | number | 1.0 | 密度场影响权重（0=均匀，1=完全跟随密度） |
| seed | number | 0 | 随机种子，0 自动随机 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGridList | array | 每种 POI 的单值掩码网格列表 |
| outputNameList | array | 与列表一一对应的名称清单 [{id, name}] |
| roadGrid | grid | 道路网格（未被 POI 覆盖的地面，值=1） |
| mergedGrid | grid | 所有 POI 合并到一张网格（含道路值1） |
| placedCount | number | 成功放置的 POI 格子总数 |

## POI清单格式说明

### 标准格式

```json
[
  {"name": "货架", "count": 20, "minDist": 3},
  {"name": "能源柱", "count": 8, "minDist": 6},
  {"name": "废弃机器人", "count": 15, "minDist": 2}
]
```

### 简化格式（快速配置）

```json
[
  {"货架": "20:3"},
  {"能源柱": "8:6"},
  {"废弃机器人": 15}
]
```

格式：`{名称: "count:minDist"}` 或 `{名称: count}`（minDist 默认为 4）

### 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| name | string | - | POI 名称，作为掩码标签 |
| count | number | 5 | 希望放置的数量（实际数量可能因间距约束而减少） |
| minDist | number | 4 | 同种 POI 之间的最小格子间距 |

## 使用示例

### 小型深空站（64×64）

```json
{
  "globalMinDist": 2,
  "densityInfluence": 0.9,
  "poiList": [
    {"name": "储物箱", "count": 80, "minDist": 2},
    {"name": "控制台", "count": 12, "minDist": 5},
    {"name": "能量核心", "count": 4, "minDist": 10},
    {"name": "废弃飞船", "count": 6, "minDist": 8},
    {"name": "生命支持舱", "count": 8, "minDist": 6}
  ]
}
```

### 大型废墟地带（128×128，100+ 种 POI）

```json
{
  "globalMinDist": 1,
  "densityInfluence": 1.0,
  "poiList": [
    {"name": "墙壁碎片", "count": 200, "minDist": 1},
    {"name": "生锈管道", "count": 150, "minDist": 2},
    ...
  ]
}
```

## 注意事项

1. **count 是期望值而非保证值**：间距约束可能导致实际放置数量少于 count，`placedCount` 输出实际数量
2. **globalMinDist=1 可实现最密集布局**：几乎所有地面格子都被 POI 占据，道路极窄
3. **densityInfluence=0 时为纯随机散布**：忽略密度场，效果类似 poi_scatter
4. **POI id 自动从 groundGrid 最大值+1 开始**：确保与地面掩码不冲突，无需手动配置
5. **先执行 deeper_density_field 再连线**：densityGrid 和 groundGrid 均需要上游电池的实际输出值
