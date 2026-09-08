# 异形房间变形 (Complex Indoor Deform)

将矩形房间变形为不规则形状（L形、T形、U形），通过填充相邻空隙提高布局紧凑度。

## 功能特点

1. **可控概率**：通过 `deformProb` 控制变形概率，不加入管线则不变形
2. **智能扩展**：自动探测房间周围的空隙并延伸填充
3. **墙壁合并**：扩展部分与原房间共享墙壁，内部连通
4. **连接检测**：扩展后自动检测与其他房间的新邻接关系

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| inputGrid | grid | - | 包含所有房间的网格 |
| roomList | object | - | 房间数据 |
| connectionList | object | - | 连接关系 |
| deformProb | number | 0.5 | 变形概率 (0~1) |
| maxExtPerRoom | number | 2 | 每房间最大扩展次数 |
| minExtDim | number | 2 | 扩展内部最小尺寸 |
| seed | number | 0 | 随机种子 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 含异形房间的网格 |
| roomList | object | 更新后的房间数据 |
| connectionList | object | 更新后的连接关系 |
