# Grid / lattice

唯一允许改 `(rows, columns)` 的族。两张表做 arith 之前先显式对齐。

| 算法 | 函数意向 | 状态 |
|---|---|---|
| 改行列 | `gridResize({ grid, columns, rows, mode })` nearest / bilinear | 已加载 |
| 下标裁切 | `gridCrop({ grid, col, row, columns, rows })` | 待做 |
| 下标补边 | `gridPad({ grid, …, fill })` | 待做 |
| 转置 | `gridTranspose` | 待做 |

不放：`heightfield` 铺满平面（那是绑世界时的拉伸）。
