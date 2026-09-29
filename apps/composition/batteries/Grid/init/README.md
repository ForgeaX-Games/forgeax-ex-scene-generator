# Grid / init

解析造表：常数、斜坡、细分。没有上游场，或只拿行列当形状。

采样噪声在 [`../noise/`](../noise/README.md)，不要堆进本抽屉。

| 算法 | 函数意向 | 状态 |
|---|---|---|
| 常数填充 | `createGrid({ columns, rows, fill })` | 已加载 |
| 同形改填充 | `gridFill({ grid, fill })` | 已加载 |
| 行/列/径向斜坡 | `gridGradient({ columns, rows, kind })` | 已加载 |
| 菱形方块 / 中点位移 | `gridDiamondSquare` / `gridMidpoint` | 已加载；边长 `2^n+1` |

不放：`gridCopy`（脚本赋值即可）；Perlin / Worley 等采样噪声；洞穴 4–5；世界米噪声；山 / 岛菜谱。
