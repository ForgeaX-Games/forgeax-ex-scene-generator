# 河岸沙滩扩张 (shore_expander)

对已合并的地形+河流网格做 BFS 扩张，在河流格周围生成指定宽度的沙滩过渡带，还原目标图中河岸边清晰的沙黄色缓冲圈。

## 功能特点

1. **BFS 精确扩张**：从所有河流格出发逐层扩张，精确控制沙滩宽度
2. **不覆盖河流格**：只修改非河流格，保持水体完整性
3. **接口简单**：直接接收 `grid_max_merge` 输出，无需额外预处理

## 适用情况

- 需要在河流/水体周围生成自然沙滩过渡
- 与 `spline_river_mask` + `grid_max_merge` 组合使用

## 基本使用方法

```
grid_max_merge.outputGrid → shore_expander.terrainGrid
number_const (3)          → shore_expander.shoreWidth
shore_expander.terrainGrid → 最终输出
```

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `terrainGrid` | grid | — | `grid_max_merge` 输出的合并网格 |
| `shoreWidth` | number | 3 | 沙滩过渡带宽度（格数，建议 2–5） |
| `riverId` | number | 10 | 河流格标识值，须与 `spline_river_mask.riverId` 一致 |
| `shoreId` | number | 2 | 沙滩格标识值，须与 `biome_classifier` 的 beach biome ID 一致 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `terrainGrid` | grid | 带沙滩过渡带的最终网格 |

## 注意事项

1. **ID 对齐**：`riverId` 必须与上游 `spline_river_mask` 使用的 `riverId` 完全一致（默认均为 10）
2. **shoreId 含义**：默认 2 对应 `biome_classifier` 的沙滩 biome（beach），渲染器需将 ID=2 映射为沙黄色
3. **放置在 pipeline 末尾**：此节点应在 `grid_max_merge` 之后，是最终输出前的最后一步
