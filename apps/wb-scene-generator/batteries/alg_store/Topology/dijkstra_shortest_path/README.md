# Dijkstra 最短路 (dijkstra_shortest_path)

在带权代价网格上求多源/多终点最短路径，输出距离图、前驱方向图与路径并集。

## 功能特点

1. **多源多终点**：sources 和 targets 均接受多个坐标，一次执行覆盖整张图。
2. **权重感知**：网格值即为通过该格的代价（>0），可直接接入噪声/高度图作为成本场。
3. **4/8 连通**：支持对角移动，对角代价自动乘以 √2。
4. **三类输出**：距离图（可视化等距线）、路径并集（直接渲染道路）、前驱方向图（可继续做流场/反向追踪）。

## 适用情况

- 多个村庄/POI 之间的最短路径绘制
- 玩家到所有目标的最短距离场（迷雾/电子地图）
- 构建带成本的"远近度"网格，配合 grid_classify 做地形分级

## 基本使用方法

1. 接入 `costGrid`（或留空让节点自己生成 `width × height` 全 1 网格）。
2. 在 `sources` 输入起点列表 `"5,5; 30,20"`。
3. 可选地输入 `targets`，节点会自动追踪每个终点到最近起点的最短路径并合并到 pathGrid。
4. 若想看完整的"距离场"，留空 targets，只用 distanceGrid。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| costGrid | grid | — | 通过代价网格；缺省时按 width×height 生成全 1 网格 |
| sources | number rank 2 | [] | 起点列表 `[[x,y],...]`；为空则所有非障碍格作为源 |
| targets | number rank 2 | [] | 终点列表，同 sources 格式；为空则不输出路径 |
| diagonal | boolean | false | 是否允许对角 8 方向 |
| obstacleValue | number | 0 | 等于此值的格子视为墙 |
| width | number | 64 | 无 costGrid 时的输出宽度 |
| height | number | 64 | 无 costGrid 时的输出高度 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| distanceGrid | grid | 距离场，不可达 = -1 |
| pathGrid | grid | targets 反向追踪到 sources 的路径并集 0/1 |
| parentGrid | grid | 前驱方向编码 1~8（-1=源点或不可达） |

## 注意事项

1. **代价 ≤ 0 时自动当作 1**：节点把 `cell <= 0`（非障碍值）的格子统一按代价 1 处理，因此 0 在 `obstacleValue !== 0` 时不再是「障碍」。
2. **仅 `obstacleValue` 才是真正的障碍**：若希望 0 表示墙，请把 `obstacleValue` 设为 0（默认）；若希望区分「零成本通过」与「墙」，请改用其它显式 `obstacleValue`（如 -1）。
2. **distanceGrid 是连续值**：渲染器会按浮点显示，可用 grid_classify 离散化。
3. **parentGrid 方向编码**：与 8 方向数组顺序一致，1=右、2=右下、3=下、4=左下、5=左、6=左上、7=上、8=右上。
