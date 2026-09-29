# Grid / morph

集合运算。值当 0–1 或二值。不要命名 `erodeGrid`。

**已加载**（6）：`gridDilate` `gridErodeMorph` `gridOpen` `gridClose` `gridMajority` `gridOutline`。

| 算法 | 函数意向 |
|---|---|
| 膨胀 | `gridDilate({ grid, radius })` |
| 腐蚀（形态学） | `gridErodeMorph({ grid, radius })` |
| 开 / 闭 | `gridOpen` `gridClose` |
| 邻域投票 | `gridMajority` |
| 形态学轮廓 | `gridOutline({ grid, thickness })` — 正=内轮廓，负=外缓冲 |

不放：水力 / 热应力；`gridBlur`（那是连续量 filter）。
