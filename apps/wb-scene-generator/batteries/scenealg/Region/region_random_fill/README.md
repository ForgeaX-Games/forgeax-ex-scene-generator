# alg_region_random_fill · 概率填充

**带概率的随机栅格填充**：对输入区域内每个有效格独立以 `density` 概率保留为 1、其余置 0，得到一张按密度稀疏化的 0/1 点掩码（与输入同形状）。`density=1` 满铺，`density=0` 全空。

## 接口

| 端口 | 类型 | 说明 |
| --- | --- | --- |
| in `region` | grid (item) | 约束区，只在非零格采样 |
| in `density` | number 0..1 | 每格保留概率（铺设密度） |
| in `seed` | number | 随机种子，0=当前时间 |
| out `region` | grid (item) | 0/1 点掩码，保留格=1 |
| out `count` | number | 保留格数 |

## 算法

纯逐格伯努利采样：行优先遍历有效格，`rng() < density` 则保留。即便 `density=0/1` 也每格消耗一次 `rng`，保证调密度时随机时序稳定、给定 `seed` 完全可复现。PRNG 用项目约定的 `mulberry32`。

## 来源与去重提示

通用化老 `farmland_grid` 里「按 `plantDensity` 把地块格 `rng()<density` 稀疏成作物点位」的逻辑，去掉作物语义后是一个纯通用的「概率栅格填充 / 散布」算子。

> **去重提示**：本算子是通用的「带概率随机栅格填充/散布」。`natural_decoration` 一线很可能也需要同类能力（草丛/花/碎石等密度散布）。两线应共用此电池，避免重复造轮子。它与 `alg_points_scatter` 的区别：points_scatter 产**有间距约束**的稀疏种子点；本电池是**无间距的逐格密度铺点**（满铺/稀疏）。
