# Grid / global

整张表看一遍。

| 算法 | 函数意向 | 状态 |
|---|---|---|
| 场统计 | `gridStats({ grid, mask? })` → `{ min, max, mean, sum, count, coverage }` | 已加载 |
| 到种子或障碍的格距 | `gridDistance({ seeds, mask?, connectivity? })` | 已加载 |
| 全局 min/max 拉到 0–1 | 不要单独电池：`gridStats` + `gridRemap` | 用组合 |
| 连通域 | 实现在 `partition/gridComponents` | 已加载 |
| 按下标坡累加 | `gridAccumulate` | 缓做，易滑进水文 |

不放：区内统计（zone）；`sampleHeight`。
