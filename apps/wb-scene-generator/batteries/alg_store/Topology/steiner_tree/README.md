# Steiner 树 (steiner_tree)

构造连接所有必经点的近似 Steiner 树。比 MST 更短，可以经过中间转折点（Steiner 点）以缩短总长度，并支持网格上的障碍绕行。

## 功能特点

1. **经典启发式**：构造 terminals 间的距离图（metric closure）→ MST → 路径展开。最坏 2 倍最优解，实战非常接近最优。
2. **绕障感知**：grid 模式下用 Dijkstra 求两点最短路代价，能自动绕过 0 障碍。
3. **真实路径**：edges 给出 terminal 间逻辑边，treeGrid 给出展开后的实际网格路径，可直接渲染。
4. **Steiner 点输出**：自动列出路径展开过程中新出现的转折格子（非 terminal），方便分析。

## 适用情况

- 多个村庄/矿点 / POI 互相连通的最短网络（比 MST 短）
- 在带山脉的网格上构造道路骨架
- 有"必访"和"中转可选"的设施布局

## 基本使用方法

1. 输入 `terminals`，至少 2 个点。
2. **欧氏模式**：留空 grid，节点用 width×height 生成空网格，边为直线连接。
3. **网格模式**（推荐）：把代价图（0=障碍）接到 grid，metric 选 grid，每条边自动 Dijkstra 绕障。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| terminals | number rank 2 | [] | 必经点列表 `[[x,y],...]`（也兼容旧字符串 "x,y; x,y"） |
| grid | grid | — | 代价网格（0=障碍） |
| metric | string | grid | grid / euclidean |
| diagonal | boolean | true | grid 模式下是否允许 8 方向 |
| width | number | 64 | 无 grid 时输出宽度 |
| height | number | 64 | 无 grid 时输出高度 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| treeGrid | grid | 0/1 树网格 |
| edges | dict rank 1 | terminal 间 MST 边 `[{from,to,cost},...]` |
| steinerPoints | array | 新增中转点坐标 |
| totalLength | number | treeGrid 上 1 像素总数 |

## 注意事项

1. **本电池是近似算法**：精确 Steiner 树是 NP-Hard，使用 metric closure + MST 启发式，质量接近最优解。
2. **网格模式较慢**：每个 terminal 跑一次 Dijkstra，n 个 terminal 共 n 次，大网格 + 多 terminal 时注意性能。
3. **Steiner 点的语义**：是"展开 MST 边时路径上经过的非 terminal 格子"，并非传统理论中的"额外引入的最优位置点"。视觉上等价。
