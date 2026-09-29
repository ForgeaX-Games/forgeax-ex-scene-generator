# Grid / filter

固定邻域，写出仍是原来那种量（高度还是高度）。半径用格数。

**已加载**（5）：`gridBlur` `gridSharpen` `gridMedian` `gridNeighborhoodMin` `gridNeighborhoodMax`。

| 算法 | 函数意向 |
|---|---|
| 盒式 / 高斯模糊 | `gridBlur({ grid, radius, kind })` |
| 反锐化 | `gridSharpen` |
| 中值 | `gridMedian` |
| 邻域最小 / 最大 | `gridNeighborhoodMin` `gridNeighborhoodMax` |

不放：形态学胀缩（morph）；CA 步进（ca）；水力侵蚀。
