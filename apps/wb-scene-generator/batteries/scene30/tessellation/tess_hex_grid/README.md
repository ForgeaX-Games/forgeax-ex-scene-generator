# 六边形镶嵌格 (tess_hex_grid)

将平面光栅化为六边形镶嵌网格，每个像素标注所属六边形单元的 ID。

## 功能特点

1. **轴坐标系 + Cube Rounding**：使用标准六边形坐标系精确判断像素归属，无缝隙无重叠
2. **两种朝向**：支持平顶（flat-top）和尖顶（pointy-top）两种六边形方向
3. **连续 ID 输出**：每个六边形分配 1-based 连续整数 ID，兼容 region_boundary_smooth 等下游电池

## 适用情况

- 生成六边形策略游戏地图底层分区（如《文明》系列）
- 作为 `tess_edge_deform` 的输入，进行六边形边界变形
- 结合 `island_poisson_gen` 等电池，在六边形分区内生成地形

## 基本使用方法

直接连接 `width`、`height`、`cellSize` 三个 `number_const` 节点到输入端口，运行后输出 `regionGrid`。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| width | number | 80 | 输出网格宽度（格） |
| height | number | 80 | 输出网格高度（格） |
| cellSize | number | 10 | 六边形外接圆半径（格） |
| orientation | string | flat | 朝向：flat=平顶，pointy=尖顶 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| regionGrid | grid | 每格存储所属六边形单元的 1-based ID |

## 注意事项

1. **cellSize 与格子数量**：`cellSize` 越小，单元格越多，处理越慢；建议 `cellSize ≥ 5`
2. **边缘六边形**：地图边缘的六边形会被裁切，但 ID 仍正常分配
3. **与 tess_edge_deform 配合**：将 regionGrid 传入 tess_edge_deform 可让六边形边界产生有机变形效果
