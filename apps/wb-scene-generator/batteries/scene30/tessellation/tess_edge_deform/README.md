# 镶嵌格边界变形 (tess_edge_deform)

对任意镶嵌格 ID 网格施加 FBM 位移场，将笔直的单元格边界变形为有机曲线。

## 功能特点

1. **域变形（Domain Warping）**：对每个像素计算 FBM 位移偏移，再查询原始 ID，使边界产生有机扭曲
2. **拓扑不破坏**：每个像素仍归属某个原始单元，不会产生 ID 越界或空洞
3. **多层 FBM**：支持 1~6 层噪声叠加，层数越多边界细节越丰富
4. **通用输入**：接受任意 regionGrid，不限于六边形或三角形

## 适用情况

- 让六边形格（tess_hex_grid）产生艾舍尔风有机边界
- 让三角形格（tess_tri_grid）产生复杂锯齿纹样
- 对任何分区地图做边界软化（非高斯平滑，保留分区 ID 语义）

## 基本使用方法

```
tess_hex_grid → regionGrid → tess_edge_deform → warpedGrid → （可视化 / 进一步处理）
```

调节 `warpScale` 控制变形强度，`warpFreq` 控制波纹密度。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| regionGrid | grid | — | 来自任意镶嵌格电池的 ID 网格（必填） |
| warpScale | number | 3 | 最大位移像素数（变形幅度），建议 1~10 |
| warpFreq | number | 0.1 | 位移场空间频率，建议 0.05~0.3 |
| octaves | number | 3 | FBM 层数（1~6） |
| seed | number | 0 | 随机种子，0=每次不同 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| warpedGrid | grid | 边界变形后的镶嵌格 ID 网格 |

## 注意事项

1. **warpScale 与 cellSize 的比例**：`warpScale` 建议设为 `cellSize × 0.2 ~ 0.5`。若 `warpScale` 远大于 cellSize，边界会完全消解，看不出原始镶嵌格形态
2. **多次叠加**：可将 `warpedGrid` 再次传入 `tess_edge_deform` 做二次变形，产生更复杂的有机纹样
3. **与 region_boundary_smooth 的区别**：本电池是位移场扭曲（保留 ID 不变），`region_boundary_smooth` 是邻域多数投票（会改变 ID 归属）

## 参数说明

| 效果 | 推荐参数组合 |
|------|------------|
| 轻微有机感（保留六边形轮廓） | warpScale=2, warpFreq=0.08, octaves=2 |
| 中等变形（默认）| warpScale=3, warpFreq=0.1, octaves=3 |
| 强烈变形（艾舍尔风） | warpScale=6, warpFreq=0.15, octaves=4 |
| 高频细碎纹样 | warpScale=2, warpFreq=0.3, octaves=5 |
