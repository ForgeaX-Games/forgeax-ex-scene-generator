# alg_partition_field_quantize · 高度场整数截断

将 `[0,1]` **高度场**按整数层数截断为互斥的 **partition** 列表（与 `alg_region_flood_grow` 的 partition 契约一致）。

## maxElevationLayers 语义

| 值 | 含义 | partition 张数 |
|----|------|----------------|
| 0 | 全部平地，不改变高度 | 1（仅层 0） |
| 1 | 最多抬高 1 个单元 | 2（层 0、1） |
| N | 整数层 0..N | N+1 |

量化：`round(field × maxElevationLayers)`，clamp 到 `[0, maxElevationLayers]`；`maxElevationLayers=0` 时恒为 0。

## 输入 / 输出

见 `meta.json`。典型链：`region → alg_field_mountain_contour → field → 本电池 → partition`。

## 下游

- `partition` → `grid2node` + `MultiNames` / 资产组 → 场景子树  
- `levelGrid` → `alg_region_subtract` 求 Rest  
- `count` → `MultiNames.Count` 生成默认后缀名
