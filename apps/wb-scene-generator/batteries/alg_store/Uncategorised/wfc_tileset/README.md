# 波函数坍缩模版生成 (wfc_tileset)

生成多值 WFC 瓦片模板集，输出模板列表、邻接规则和权重三个数组，可直接连接 `wfc_tile_solver` 组装完整地图。

## 单元格值定义

| 值 | 含义 | 说明 |
|----|------|------|
| 0 | 背景 | 空地，不可行走也不可见的区域 |
| 1 | 墙壁 | 实体墙，不可通行的障碍 |
| 2 | 地板 | 房间或走廊的可行走区域 |
| 3 | 资源点 | 拾取物/道具放置位（由 resource 变体生成） |
| 4 | 柱子 | 柱子/掩体/障碍物（由 pillar/cover 变体生成） |

## 设计思路

基于 **边缘插槽匹配** 系统，自动生成全套互相兼容的瓦片：

| 插槽类型 | 含义 | 视觉效果 |
|----------|------|----------|
| 0 — 封闭 | 该边无开口 | 实墙封闭或背景 |
| 1 — 窄门 | 居中 corridorWidth 宽度的门洞 | 战术门廊 |
| 2 — 宽口 | 几乎整条边开放 | 相邻瓦片合并成大房间 |

两个瓦片在某方向可邻接，当且仅当它们接触面的插槽类型相同。

## 瓦片类别

### 基础瓦片（插槽 0/1，16 种边缘组合）

| 开口数 | 样式 | 代表 |
|--------|------|------|
| 0 | 背景/实墙块 | 全0=背景，全1=墙壁（由 backgroundWeight 控制比例） |
| 1 | 死胡同 | 物品房、弹药室 |
| 2 对面 | 直线通道 | 走廊 |
| 2 相邻 | L 形拐角 | 拐角房间 |
| 3 | T 形路口 | 分岔点 |
| 4 | 十字路口 | 中心枢纽 |

### 变体瓦片（全部默认启用）

- **background** — 全0，建筑外的空旷区域
- **wall** — 全1，建筑结构内的实心墙壁
- **room** — 墙壁(1)边框 + 地板(2)内部 + 门洞(2)
- **corridor** — 仅直线瓦片，走廊宽度的地板通道
- **pillar** — 房间内四角放置对称柱子(4)
- **cover** — 房间内随机散布 2-4 个障碍物方块(4)
- **alcove** — 墙壁从实墙面突入房间，创造凹室空间
- **resource** — 房间内随机放置 1-3 个资源点(3)
- **divided** — 房间内横/纵分隔墙，中央留通道，形成双室结构
- **barricade** — 房间内 1-2 段墙壁路障，提供战术掩护位
- **cross** — 四角填充墙壁形成菱形/十字形地板区域
- **irregular** — 在封闭边方向切除矩形区域为背景(0)，形成 L形/缺角等不规则轮廓

### 大房间瓦片（插槽 2，由 largeRoomWeight 控制）

宽开口瓦片在相邻放置时，地板打通合并成大型开阔区域。包含：
- 纯宽口瓦片（中心、角落、边缘）
- 窄-宽过渡瓦片（走廊通向大房间的入口）
- 大房间版柱子、掩体、资源点、分隔墙变体
- **open** — 整块瓦片几乎全为地板，散布少量柱子/资源点，用于创建无墙开阔区域
- 大房间版不规则变体

## 输入参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| tileSize | number | 11 | 瓦片边长（奇数，7~21） |
| corridorWidth | number | 3 | 走廊/门宽度（奇数） |
| wallThickness | number | 1 | 外墙厚度（1~3） |
| pillarSize | number | 2 | 柱子边长（1~4） |
| backgroundWeight | number | 3 | 背景权重（0~10），越大空旷区越多 |
| irregularRatio | number | 0.3 | 不规则比例（0~1），越大不规则房间越多 |
| largeRoomWeight | number | 2 | 大房间权重（0~10），越大大房间越多 |
| densityBias | number | 0.5 | 密度偏好（0=稀疏 1=密集） |
| seed | number | 0 | 随机种子（0=自动） |

## 输出参数

| 参数 | 类型 | 说明 |
|------|------|------|
| templates | array | 瓦片模板列表，每个为 tileSize×tileSize 二维网格（0=背景 1=墙壁 2=地板 3=资源点 4=柱子） |
| adjacency | array | 邻接规则列表，每个为 {N,E,S,W} → 可邻接索引数组 |
| weights | array | 权重列表，控制各瓦片选中概率 |

## 使用方法

1. 将本电池的 **templates** 输出连接到 `wfc_tile_solver` 的 **templates** 输入
2. 将 **adjacency** 输出连接到 `wfc_tile_solver` 的 **adjacency** 输入
3. 将 **weights** 输出连接到 `wfc_tile_solver` 的 **weights** 输入
4. 在 `wfc_tile_solver` 中设置行列数（如 8×10）即可生成完整地图

## 权重参数工作原理

### backgroundWeight

| 机制 | 公式 | 作用 |
|------|------|------|
| 背景瓦片权重 | bgW² | 直接提高背景瓦片被选中概率 |
| 房间权重缩放 | 1/(1+bgW×0.4) | 降低所有常规房间变体权重 |

### irregularRatio

独立控制不规则房间变体的出现比例：`irregFactor = irregularRatio × 3`。不规则变体与常规房间共享相同的边缘插槽，因此在 WFC 约束传播中不会被淘汰。设为 0 可完全关闭不规则房间。

### largeRoomWeight

控制大房间（宽开口/插槽 2）瓦片的整体权重：`lrScale = 0.3 + lrW × 0.35`。所有 type-2 边缘瓦片（room、pillar、cover、resource、open、irregular）的权重都乘以此系数。

| lrW | 大房间缩放 | 效果 |
|-----|-----------|------|
| 0 | 0.30 | 几乎无大房间 |
| 2 | 1.00 | 适中（默认） |
| 5 | 2.05 | 明显增多 |
| 10 | 3.80 | 大量大房间 |

## 参数调节指南

### 紧凑战术风（多掩体，不规则建筑轮廓）
- `tileSize=11`, `corridorWidth=3`, `backgroundWeight=4`, `irregularRatio=0.5`, `largeRoomWeight=1`, `densityBias=0.6`

### 迷宫风（曲折、狭窄、少空旷区）
- `tileSize=9`, `corridorWidth=1`, `backgroundWeight=1`, `irregularRatio=0.1`, `largeRoomWeight=0`, `densityBias=0.3`

### 竞技场风（开阔、大房间，大面积背景隔断）
- `tileSize=15`, `corridorWidth=5`, `backgroundWeight=7`, `irregularRatio=0.3`, `largeRoomWeight=8`, `densityBias=0.8`

### 密集堡垒风（无空旷区，全墙壁填充）
- `backgroundWeight=0`, `irregularRatio=0`, `largeRoomWeight=0`, `densityBias=0.7`

### 大型开阔战场（大房间为主，散布掩体和资源）
- `tileSize=13`, `corridorWidth=5`, `backgroundWeight=2`, `irregularRatio=0.2`, `largeRoomWeight=7`, `densityBias=0.7`

## 注意事项

1. `tileSize` 和 `corridorWidth` 建议使用奇数，偶数会自动 +1
2. 全功能启用时约产生 150+ 个瓦片，WFC 求解稍慢但多样性好
3. 如果 WFC 频繁失败，可尝试增大 `wfc_tile_solver` 的 `maxRetries`
4. `seed=0` 每次结果不同，固定 seed 可复现
