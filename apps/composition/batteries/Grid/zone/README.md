# Grid / zone

邻域是「同一个区号的所有格」。一张 id + 一张 value → 每区一个统计，铺回同形 `Grid`。

| 算法 | 函数意向 | 状态 |
|---|---|---|
| 区均值 | `gridZonalMean({ grid, zones })`。区号 0 当背景，原值不动 | 已加载 |
| 区最小 / 最大 / 和 | `zonalMin` `zonalMax` `zonalSum` | 待做 |
| 区内用代表值填平 | `zonalFill({ ids, value })` | 待做 |
| 区计数（铺回） | `zonalCount({ ids })` | 待做 |

不放：连通域（partition）；mask lerp（arith）。
