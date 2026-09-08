# alg_region_stripe_split · 条带划分

在区域外接矩形内沿**单一方向**把有效格切成若干等宽条带，相邻条带之间留 `gapWidth` 间隙，可选在四周再留 `border` 边带圈。每条带一张 0/1 网格，与 `region_bsp` / `region_components` 的 partition 输出契约一致。

## 接口

| 端口 | 类型 | 说明 |
| --- | --- | --- |
| in `region` | grid (item) | 约束区，条带只落在非零格 |
| in `direction` | number | 0=按行（横向条带），1=按列（纵向条带），-1=种子随机 |
| in `bandWidth` | number | 单条带厚度（行高/列宽），≥1 |
| in `gapWidth` | number | 相邻条带间隙厚度，≥0 |
| in `border` | number | 四周边带圈数（计入 gap），≥0 |
| in `seed` | number | 随机种子，0=当前时间 |
| out `partition` | grid (list) | 每条带一张 0/1 网格，沿切分方向排序 |
| out `gap` | grid (item) | 所有间隙+边带合并的一张 0/1 网格 |
| out `count` | number | 非空条带数 |

## 算法

通用化老 `farmland_grid` 的 `generateStrip`：取区域外接矩形，去掉 `border` 圈得到内区，沿切分方向按 `period = bandWidth + gapWidth` 排带；不能整除的余量整体并入随机一条带（复刻老电池行为）。条带格写入对应 partition 网格，间隙与边带写入 `gap`。PRNG 用项目约定的 `mulberry32`，给定 `seed` 可复现。

## 与老电池的差异

去掉了「田垄/作物类型」语义，只产纯方向性条带分区。条带的下游用途（填什么作物、田垄如何命名）交给连接图组合。`direction=-1` 复刻老 strip 的「随机横/纵朝向」。
