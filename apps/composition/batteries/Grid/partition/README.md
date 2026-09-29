# Grid / partition

切成 **区号场**（每格一个整数，仍是 `Grid`）。不长 `ZoneMap`。  
mask 不是区号：mask 是 0–1 选区；这里要「1 号块 / 2 号块」。

| 算法 | 函数意向 | 状态 |
|---|---|---|
| 连通域标号 | `gridComponents({ grid, connectivity })` 4 / 8 | 已加载 |
| 种子 + 距离 → 势力 | `gridInfluence({ seeds, barrier? })` | 待做 |
| 规则切块 | `gridStrideId({ columns, rows, tileW, tileH })` | 待做 |
| 往低处划分 | `gridWatershed` — 先放 generator，和水文踩线 | 缓做 |

不放：按号汇总（zone）；二值选区（derive 的 threshold）。
