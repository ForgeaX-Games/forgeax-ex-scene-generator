# alg_region_grid_split · 网格细分

在区域外接矩形内做**规则网格细分**：行、列两个方向同时按 `cellHeight × cellWidth` 切块，块之间留 `gapWidth` 间隙（同时充当横向与纵向小径）。每个网格单元一张 0/1 网格，行优先顺序，与 `region_bsp` / `region_components` 的 partition 输出契约一致。

## 接口

| 端口 | 类型 | 说明 |
| --- | --- | --- |
| in `region` | grid (item) | 约束区，单元只落在非零格 |
| in `cellWidth` | number | 单元列宽，≥1 |
| in `cellHeight` | number | 单元行高，≥1 |
| in `gapWidth` | number | 单元间隙宽度（行列通用），≥0 |
| in `seed` | number | 随机种子，0=当前时间 |
| out `partition` | grid (list) | 每个单元一张 0/1 网格，行优先 |
| out `gap` | grid (item) | 所有横/纵间隙合并的一张 0/1 网格 |
| out `count` | number | 非空单元数 |

## 算法

通用化老 `farmland_grid` 的 `generateGrid`：取区域外接矩形，行方向按 `cellHeight + gapWidth`、列方向按 `cellWidth + gapWidth` 排 band；两个方向各自不能整除的余量整体并入随机一个 band（复刻老电池行为）。落在某 `(bandR, bandC)` 单元内的格写入该单元网格，落在间隙的格写入 `gap`。PRNG 用项目约定的 `mulberry32`，给定 `seed` 可复现。

## 与老电池的差异

去掉了「田垄/作物类型」语义，只产纯规则网格分区；老电池里按 `(bandR*997+bandC)%4` 循环分配作物类型的逻辑交给连接图（用 list 索引取模 + 着色）处理。`gap` 输出对应老电池的「田垄（小径）」层。
