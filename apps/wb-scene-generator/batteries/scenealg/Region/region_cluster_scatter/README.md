# 簇状散布 (alg_region_cluster_scatter)

**归类：Region**（grid → 单张 0/1 点掩码）

在输入区域内随机选取若干簇心，以距离衰减概率向周围散点，形成自然聚团的 0/1 点掩码。纯算法工具，无领域语义。

## 输入

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| region | grid | — | 约束区，点只落在非零有效格内 |
| density | number | 0.3 | 目标铺设密度（占有效格比例，0..1），同时决定簇心数量与扩散强度 |
| clusterRadius | number | 4 | 每个簇心的扩散半径（格） |
| seed | number | 0 | 随机种子，0=用当前时间 |

## 输出

| 参数 | 类型 | 说明 |
|------|------|------|
| region | grid | 与输入同形状的 0/1 点掩码 |
| count | number | 实际选中的格数 |

## 算法

1. 收集所有非零有效格，目标格数 `targetCount = 有效格数 × density`。
2. 随机选 `max(1, round(targetCount/6))` 个簇心。
3. 每个簇心在 `clusterRadius` 半径内按 `(1 - dist/(R+1)) × density × 2` 的衰减概率散点。
4. 累计达到 `targetCount` 截停。

PRNG 用 mulberry32，给定 seed 可复现。来源是老 `natural_decoration` 的 `fillCluster`，去除装饰语义后通用化。
