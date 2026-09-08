# 边缘绿簇 (Edge Green Cluster)

在指定区域（`targetValue` 掩码）的**边缘**处生成若干形状不规则的绿簇，每簇是一团从边缘向区域内部有机生长的连通像素块，粘附在内缘上。常用于给地块/水体边缘点缀灌木、苔藓、藻类等碎绿。

## 原理

1. **取边缘种子**：Moore 追踪区域外轮廓，沿轮廓等距 + 抖动取 `count` 个边缘点。
2. **有机生长**：每个种子用「欧氏距离 + FBM 噪声」优先级 BFS，在区域内部（`grid===targetValue`）长出约 `clusterSize` 个像素的不规则团块；`irregularity` 越大形状越破碎、带触须。每个簇**独立生长、只受区域掩码约束**（不互相阻塞），因此 `clusterSize` 能被如实兑现；相邻簇允许重叠/连片（写出取并集）。
3. **写出**：所有簇写入与输入同形状的输出网格（背景 0，簇 = `outputValue`）。

## 数据格式（DataTree）

输入 `inputGrid` 与输出 `outputGrid` 均为 `grid` / `access:item`：每次只处理单张网格，网格列表由引擎自动逐张 fanout / 重组。

## 输入参数

| 参数名 | 类型 | access | 默认值 | 说明 |
|--------|------|--------|--------|------|
| inputGrid | grid | item | — | 输入网格（单张） |
| targetValue | number | item | 1 | 目标区域掩码值 |
| count | number | item | 12 | 绿簇数量（沿轮廓分布） |
| clusterSize | number | item | 18 | 每簇平均像素数 |
| sizeVariance | number | item | 0.4 | 簇大小随机浮动 0~1 |
| irregularity | number | item | 0.6 | 形状破碎度 0~1 |
| outputValue | number | item | 1 | 簇像素写入的网格值 |
| seed | number | item | 0 | 随机种子，0=时间戳 |

## 输出参数

| 参数名 | 类型 | access | 说明 |
|--------|------|--------|------|
| outputGrid | grid | item | 绿簇掩码网格（背景 0，簇 = outputValue） |

## 注意事项

1. 簇只在区域内部生长，粘附在内缘；各簇独立生长、可重叠连片，`clusterSize` 直接决定单簇大小。`count` × `clusterSize` 很大时会沿边缘连成绿带（按需调低 `count`）。
2. 输出仅含绿簇本身，作为独立图层；通常接 `grid2node` 转场景后 `add_child` 到原区域上。
