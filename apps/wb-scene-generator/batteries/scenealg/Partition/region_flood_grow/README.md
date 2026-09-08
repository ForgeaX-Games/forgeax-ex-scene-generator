# alg_region_flood_grow · 洪泛生长

从一组种子点出发，在 `region` 约束内做**随机 frontier 洪泛**，长成一组有机斑块（organic blob）。每个斑块一张 0/1 网格，顺序 = 生长顺序，与 `region_components` / `region_bsp` 的 partition 输出契约一致。

## 接口

| 端口 | 类型 | 说明 |
| --- | --- | --- |
| in `region` | grid (item) | 约束区，斑块只长在非零格 |
| in `points` | grid (item) | 种子点掩码（来自 `alg_points_scatter`） |
| in `size` | number | 每个斑块目标格数 |
| in `sizeVariance` | number 0..1 | 目标格数 ± 抖动比例 |
| in `seed` | number | 随机种子，0=当前时间 |
| out `partition` | grid (list) | 每斑块一张 0/1 网格 |
| out `count` | number | 实际斑块数 |

## 算法

搬自 `lake_gen` 的 `growLake`：对每个种子点，从生长前沿（frontier）**随机**取一格而非最旧格，把它的有效未占用 4-邻接格立即纳入并入队，达到 `targetSize` 截停 —— 随机取格正是有机不规则形态的来源。后长的斑块避开 `occupied`（已长格），保证互不重叠。

`targetSize = round(size · (1 + jitter))`，`jitter ∈ [-sizeVariance, +sizeVariance]`。PRNG 用项目约定的 `mulberry32`，给定 `seed` 可复现。

## 与 lake_gen 的差异

老电池 `lake_gen` 把「选种子 → 生长 → 建间距禁区」串在一个共享 PRNG 的循环里逐位交织。这里把它解耦成：上游 `alg_points_scatter` 一次性产全部点（含 `minSpacing` 间距约束），本电池只按点列表逐个生长。因此最终 blob 布局与 `lake_gen` **不逐位一致**，但形态同为 organic，且换来生长算子的高复用性（任何「点 + 约束区 → 有机子区域」场景皆可用）。
