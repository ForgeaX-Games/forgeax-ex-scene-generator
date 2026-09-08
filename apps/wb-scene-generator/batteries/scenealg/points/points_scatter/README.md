# alg_points_scatter · 区域散点

在输入区域内随机撒下若干互不重叠、彼此间距 ≥ `minSpacing` 的种子点，输出为与输入同形状的 0/1 **点掩码**（选中格 = 1）。

## 接口

| 端口 | 类型 | 说明 |
| --- | --- | --- |
| in `region` | grid (item) | 有效区域，点只落在有效格 |
| in `count` | number | 目标点数 |
| in `minSpacing` | number | 两点最小 BFS 间距，0=仅不重叠 |
| in `targetValue` | number | 0=任意非零格；非 0=精确匹配掩码 ID |
| in `seed` | number | 随机种子，0=当前时间 |
| out `points` | grid (item) | 0/1 点掩码 |
| out `count` | number | 实际点数 |

## 算法

搬自 `lake_gen` 的「候选格收集 + 多次尝试选种子 + 命中禁区剔除」，但只产点不生长：

1. 收集全部有效候选格；
2. 循环 `count` 次：从剩余候选随机取一格（命中禁区则剔除并重试，最多 80 次）；
3. 选中后以该点为中心做 `minSpacing` 步 4-邻接 BFS 建禁区，后续点自动避开。

PRNG 使用项目约定的 `mulberry32`，给定 `seed` 可复现。多分支 `region` 由 `autoIterate` fanout。

## 点的表达约定

项目里没有专门的 points 类型，点统一用 **grid 二值点掩码** 表达（与 `topology_connect_points` 从 grid 提取最大值格作为连接点的约定一致），因此输出 `points` 为 0/1 grid，可直接喂给下游需要「点 / POI」的电池。
