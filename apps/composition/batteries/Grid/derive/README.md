# Grid / derive

解释成另一张场。不声称还在改原语义。

**已加载**（7）：`gridSlope` `gridAspect` `gridCurvature` `gridThreshold` `gridRangeSelect` `gridEdge` `gridBBox`。

| 算法 | 函数意向 |
|---|---|
| 坡（Δ值/格） | `gridSlope` |
| 朝向 / 曲率 | `gridAspect` `gridCurvature` |
| 阈值 → mask | `gridThreshold({ grid, value })` |
| 区间选择 | `gridRangeSelect({ grid, min, max })` |
| 边缘带 | `gridEdge` |
| 非零包围盒 | `gridBBox` — 吐 `columns` `rows` `col` `row`，不是场 |

不放：世界坡度（度/米）当默认输出；区号（partition）；区内平均（zone）。
