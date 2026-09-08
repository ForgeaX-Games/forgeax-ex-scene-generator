# complex_indoor_grow

通过迭代增长机制生成复杂室内布局。80% 概率直接拼接房间（墙壁重合），20% 概率使用走廊连接。支持 L 形不规则房间和外轮廓复杂度控制。

## 功能特点

1. **墙壁共享模型**：房间通过墙壁重合方式拼接，相邻房间共享一排墙壁
2. **双增长模式**：80% 直接拼接 + 20% 走廊连接
3. **不规则房间**：可生成 L 形房间填充缝隙，提高布局紧凑度
4. **轮廓复杂度控制**：限制建筑外轮廓复杂度，保持美观
5. **面积比控制**：新房间面积基于父房间面积的比例随机生成

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| inputGrid | grid | - | 包含初始房间的网格 |
| roomList | object | - | 已有房间数据 |
| nextRoomId | number | 3 | 新房间起始 ID |
| targetRoomCount | number | 20 | 目标房间总数 |
| corridorProb | number | 0.2 | 走廊概率 |
| areaRatioMin | number | 0.8 | 面积比下限 |
| areaRatioMax | number | 2.0 | 面积比上限 |
| rareLargeProb | number | 0.05 | 超大房间概率 |
| rareLargeMax | number | 4.0 | 超大房间面积比上限 |
| irregularProb | number | 0.3 | L形房间概率 |
| silhouetteRMax | number | 6.0 | 轮廓复杂度上限 |
| seed | number | 0 | 随机种子 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 包含所有房间和走廊的网格 |
| roomList | object | 全部房间数据 |
| connectionList | object | 房间连接关系 |
| nextRoomId | number | 下一个可用 ID |
