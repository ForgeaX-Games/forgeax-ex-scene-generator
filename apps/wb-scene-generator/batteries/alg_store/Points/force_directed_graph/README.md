# 力导向图布局 (force_directed_graph)

基于《饥荒联机版》(DST) 世界生成中的物理仿真算法，通过库仑斥力与胡克弹簧引力迭代计算图节点的二维坐标，输出可视化网格。

## 功能特点

1. **DST 物理仿真**：忠实复现 DST placement.lua / forest_map.lua 中的弹簧-电荷力导向布局模型（Coulomb 斥力 + Hooke 引力 + 速度阻尼）
2. **Fermat 螺旋初始化**：未提供初始坐标时，采用 DST placement.lua genCircOffsetPositions 的 Fermat 向日葵螺旋分布作为初始位置，避免节点重叠
3. **完整参数控制**：斥力、引力、阻尼、迭代次数均可调，支持从简单链状图到复杂网络的各种拓扑

## 适用情况

- 需要将抽象图结构可视化到二维网格上
- PCG 流水线中需要对区域/房间节点进行空间布局
- 学习和演示力导向图布局算法原理

## 基本使用方法

1. 设定节点数量 `nodeCount`
2. 通过 `edges` 端口输入边列表（如 `[[0,1],[1,2],[2,3]]`），索引从 0 开始
3. 可选提供 `positions` 初始坐标，不提供则自动 Fermat 螺旋初始化
4. 调整网格大小和物理参数后执行
5. 从 `grid` 端口获取可视化网格（节点位置为 1），从 `nodePositions` 获取坐标列表

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| nodeCount | number | 10 | 节点数量（1~500） |
| edges | number rank 2 | - | 边列表 `[[src,dst],...]`，0-based 索引 |
| positions | number rank 2 | - | 初始坐标 `[[x,y],...]`，不输入则 Fermat 螺旋初始化 |
| gridWidth | number | 50 | 输出网格宽度（8~512） |
| gridHeight | number | 50 | 输出网格高度（8~512） |
| repulsion | number | 5000 | 库仑斥力系数，越大节点越分散 |
| attraction | number | 0.008 | 胡克引力系数，越大连接节点越近 |
| damping | number | 0.9 | 速度阻尼（0.01~1），越小收敛越快 |
| iterations | number | 300 | 仿真迭代次数（1~2000） |
| seed | number | 0 | 随机种子，0 使用默认种子 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| grid | grid | 可视化网格，节点位置值为 1，其余为 0 |
| nodePositions | array | 节点最终坐标列表 [[x, y], ...]，对应 grid 上的位置 |

## 注意事项

1. **边索引从 0 开始**：edges 中的节点索引为 0-based，最大值应小于 nodeCount
2. **节点数量上限 500**：节点过多时 O(N^2) 的斥力计算会较慢
3. **网格分辨率**：网格太小而节点太多时，部分节点可能被挤到相邻格子（自动去重偏移）
4. **参数调优**：默认参数适合 5~50 个节点的图；节点更多时建议增大 repulsion 或 gridWidth/gridHeight
