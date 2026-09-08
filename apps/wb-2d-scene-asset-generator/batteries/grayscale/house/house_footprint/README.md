# house_footprint — 房屋底面

**与 `house_template` 严格对应的底面黑白图。** 输入同一份只表达房顶的二维数组（1=房顶，0=空）与「高度」，输出一张黑白图：**黑色 = 房屋接触地面的底面（footprint）**，白色 = 背景。

## 为什么能与 HouseTemplate 逐像素对齐

`house_template` 的渲染管线是：

```
ExpandMask(roof, height) → OffsetByHeight → DifferentiateFacades → ResizeMask(_, size) → render
```

其中 `ResizeMask` 的等比缩放与居中**只依赖网格尺寸 `H×W`**；`OffsetByHeight` / `DifferentiateFacades` 不改变网格尺寸，而 `ExpandMask` 把高度设为 `(height+origH)×W`。

因此本电池只需走**同一个** `ExpandMask(roof, height)`（得到相同的 `(height+origH)×W` 网格）再走**同一个** `ResizeMask(_, size)`，缩放/居中就与 `house_template` 完全一致。「接触地面的部分」正是原始房顶 mask（建筑平面占位），位于扩展网格底部 `[height, height+origH)` 行——恰好落在 `house_template` 渲染图中房屋底部所在的像素。

几何直接**复用** `house_template` 已导出的纯函数 `ParseMasks` / `ExpandMask` / `ResizeMask`，底面图永远跟随主电池的几何，不会漂移。

## 输入

| 端口 | 类型 | 默认 | 说明 |
|------|------|------|------|
| spec | string | — | 只表达房顶的二维数组字符串，如 `[[1,1,0],[1,1,1],[1,1,1]]`。与 HouseTemplate 用同一份输入即可对齐。也兼容三维 `[[[...]],[[...]]]` 批量产出 |
| height | number | 1 | 房屋高度（向上投影行数）。**须与对应 HouseTemplate 的「高度」一致**才能严格对齐 |

## 参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| imageSize | number | 300 | 输出黑白图边长（正方形像素）。**须与 HouseTemplate 的 imageSize 一致** |

## 输出

| 端口 | 类型 | 说明 |
|------|------|------|
| image | image[] | 黑白底面图引用（资产库 alias），黑=底面、白=背景，每个 entry 一张 |
| error | string | 失败信息，成功为空串 |

## 落点（双写）

每张图同时归档到顶层 `.forgeax/grayscale/` 并导入资产库（同 `house_template`）。

> 要得到一对严格对齐的「房屋图 + 底面图」，把同一份 `spec`、相同的 `height`、相同的 `imageSize` 分别接给 `house_template` 与 `house_footprint` 即可。
