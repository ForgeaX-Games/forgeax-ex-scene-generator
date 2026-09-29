# Grid / arith

点态场运算。`out[i][j] = f(a[i][j], …)`。多场必须同格，否则 `{ error }`。可选 mask 掺回。

**已加载**（15）：`gridAdd` `gridSub` `gridMul` `gridMin` `gridMax` `gridLerp` `gridChoose` `gridMaskDiff` `gridMaskUnion` `gridAbs` `gridNeg` `gridClamp` `gridRemap` `gridSmoothstep` `gridQuantize`。

| 算法 | 函数意向 |
|---|---|
| 加 / 减 / 乘 | `gridAdd` `gridSub` `gridMul`（另一输入可以是标量） |
| 逐格最小 / 最大 | `gridMin` `gridMax` |
| 线性混合 | `gridLerp({ a, b, t })`，`t` 标量或同格 Grid |
| 按 mask 抽取 | `gridChoose({ a, b, mask })` — 不是 lerp |
| 绝对值 / 取负 | `gridAbs` `gridNeg` |
| 夹取 | `gridClamp({ grid, min, max })` |
| 区间重映射 | `gridRemap({ grid, from, to })` |
| 平滑阶跃 | `gridSmoothstep` |
| 量化分层 | `gridQuantize({ grid, steps })` — 格子台地，不是地质 Terrace SOP |

不放：模糊；形态学；按区号平均（那是 zone）。
