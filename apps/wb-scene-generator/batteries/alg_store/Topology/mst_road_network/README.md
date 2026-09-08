# 最小生成树路网 (mst_road_network)

对一组节点构造最小生成树（Kruskal/Prim），把每条边光栅化到网格输出为路网，可叠加额外环路边。

## 功能特点

1. **两种算法**：Kruskal（并查集）/ Prim（按 MST 框架），结果一致，性能上小数据 Kruskal 更快。
2. **三种度量**：欧氏 / 曼哈顿 / 网格最短路（grid_path 模式下用 Dijkstra 求两点间真实代价，能绕开障碍）。
3. **额外环路**：`extraEdgeRatio` 让你在纯 MST 之外加入若干次短边形成简单环路（村庄间不全是单线连接）。
4. **直接出图**：roadGrid 是 0/1 路网光栅图，可直接渲染或与上游 mask 合并。

## 适用情况

- 多个村庄/POI 之间生成最短总长度的道路骨架
- 树状或半网状路网生成（配合 extraEdgeRatio 控制连通密度）
- 配合 grid 输入做"绕开山脉的道路"

## 基本使用方法

1. 输入 `points`，例如 `"10,10; 50,10; 30,40; 70,60"`。
2. 默认输出 MST 路网。想要少量环路时把 `extraEdgeRatio` 调到 0.1~0.3。
3. 想绕开障碍：把障碍图（带高代价/0 障碍）接到 `grid`，把 `metric` 设为 `grid_path`。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| points | number rank 2 | [] | 节点坐标列表 `[[x,y],...]`（也兼容旧字符串 "x,y; x,y"） |
| grid | grid | — | 仅 metric=grid_path 时使用 |
| algorithm | string | kruskal | kruskal / prim |
| metric | string | euclidean | euclidean / manhattan / grid_path |
| extraEdgeRatio | number | 0 | 额外短边比例 0~1 |
| width | number | 64 | 无 grid 时的输出宽度 |
| height | number | 64 | 无 grid 时的输出高度 |
| diagonal | boolean | true | grid_path 模式 Dijkstra 是否走对角 |
## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| roadGrid | grid | 0/1 路网光栅图 |
| edges | dict rank 1 | 边列表 `[{from,to,cost,mst},...]` |
| totalCost | number | 所有输出边权重之和 |

## 注意事项

1. **grid_path 性能**：每对点都要跑一次 Dijkstra，n 个点要 n²/2 次，建议 n ≤ 50。
2. **光栅化使用 Bresenham 直线**，转折处宽度恒为 1，需要更宽的路请用 grid 形态学膨胀。
3. **extraEdgeRatio 取 1**：等价于把所有点两两连接的全图，不再具有"路网"含义。
