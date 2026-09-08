# 复杂室内布局 (complex_indoor_gen)

通过迭代增长机制生成复杂多房间室内平面布局，支持走廊连接与直接拼接两种增长方式，带外轮廓复杂度控制与连通性校验。

## 功能特点

1. **双增长模式**：每步随机选择走廊连接或直接拼接，模拟真实室内布局的混合连接方式
2. **面积比例继承**：新房间面积为父房间的 0.8~2 倍（常规），小概率触发 2~4 倍超大房间
3. **轮廓复杂度控制**：通过外轮廓角数/房间数比值的软约束，防止布局过于碎片化或过于单调
4. **全连通保证**：生成后进行图连通性校验 + 网格级 BFS 验证，确保所有房间可达
5. **自动开门**：在相邻房间的共享墙壁上自动开设 2~边宽 的门洞

## 适用情况

- 射击游戏室内关卡（类似异形射手、CS 等）
- 恐怖游戏探索场景
- 地牢爬塔类室内环境
- 任何需要复杂多房间平面布局的 2D 游戏

## 基本使用方法

1. 将电池拖入画布
2. 设置网格尺寸（width × height）和目标房间数（targetRoomCount）
3. 调整走廊概率（corridorProb）控制走廊与直接拼接的比例
4. 运行后获得完整的室内布局网格

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| width | number | 200 | 输出网格总宽度（格数） |
| height | number | 150 | 输出网格总高度（格数） |
| targetRoomCount | number | 25 | 目标房间数量（不含走廊） |
| initRoomMinSize | number | 10 | 初始房间最小边长 |
| initRoomMaxSize | number | 18 | 初始房间最大边长 |
| corridorProb | number | 0.4 | 走廊连接概率（0~1） |
| corridorWidthMin | number | 2 | 走廊最小宽度 |
| corridorWidthMax | number | 6 | 走廊最大宽度 |
| corridorLenMin | number | 3 | 走廊最小长度 |
| corridorLenMax | number | 12 | 走廊最大长度 |
| doorWidthMin | number | 2 | 门洞最小宽度 |
| roomMinDim | number | 4 | 生成房间最小边长 |
| silhouetteRMax | number | 6.0 | 轮廓复杂度上限（角数/房间数） |
| seed | number | 0 | 随机种子，0 使用当前时间戳 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 布局网格：0=墙壁, 1=房间, 2=走廊, 3=门 |
| nameList | array | 网格值与名称映射 [{id, name}] |
| roomList | object | 所有房间信息 [{id, x, y, w, h, area, isCorridor, parentId}] |

## 算法说明

### 增长流程

1. 在网格中心放置初始方形房间
2. 每轮随机选取一个已有房间作为父节点
3. 在父节点的可用边段上选择增长方向
4. 按 `corridorProb` 概率选择增长方式：
   - **走廊连接**：先生成走廊（宽 2~边长，长 3~12），再在走廊末端挂接新房间
   - **直接拼接**：新房间直接贴在父房间边缘（共享 1 格墙壁，后续开门）
5. 新房间面积 = 父房间面积 × 比率（94% 概率 0.8~2.0，6% 概率 2.0~4.0）
6. 检查碰撞（含 1 格墙壁间距）和外轮廓复杂度
7. 重复直到达到目标房间数或用尽尝试次数

### 轮廓复杂度控制

使用 2×2 网格块扫描统计外轮廓拐角数，计算 R = 拐角数 / 房间数：
- R ≤ silhouetteRMax：接受
- R > silhouetteRMax：按超出比例的概率拒绝（软约束）
- 前 4 个房间不做限制

### 连通性保证

- 图级别：BFS 遍历连接关系图，对孤立房间打通 L 形修复走廊
- 网格级别：在门洞开设后，BFS 遍历所有可行走格子，对不可达区域打通壁墙

## 使用示例

### 输入示例

```json
{
  "width": 200,
  "height": 150,
  "targetRoomCount": 25,
  "corridorProb": 0.4,
  "seed": 42
}
```

### 输出示例

```json
{
  "outputGrid": [[0,0,0,...], [0,1,1,...], ...],
  "nameList": [
    {"id": 0, "name": "墙壁"},
    {"id": 1, "name": "房间"},
    {"id": 2, "name": "走廊"},
    {"id": 3, "name": "门"}
  ],
  "roomList": [
    {"id": 1, "x": 91, "y": 66, "w": 14, "h": 12, "area": 168, "isCorridor": false, "parentId": -1},
    {"id": 2, "x": 106, "y": 68, "w": 8, "h": 6, "area": 48, "isCorridor": false, "parentId": 1}
  ]
}
```

## 注意事项

1. **网格尺寸与房间数**：网格过小或房间数过多会导致实际生成房间数少于目标值，建议 width×height 至少为 targetRoomCount 的 400 倍
2. **走廊概率调参**：corridorProb=0 全部直接拼接（紧凑布局），corridorProb=1 全部走廊连接（分散布局），推荐 0.3~0.5
3. **轮廓复杂度**：silhouetteRMax 过低（<3）会导致布局过于方正，过高（>8）会导致视觉疲劳，推荐 4~7
4. **内置硬编码参数**：roomAreaRatioMin=0.8, roomAreaRatioMax=2.0, rareLargeRoomProb=0.06, rareLargeRoomRatioMax=4.0, maxAttemptsPerRoom=40，如需调整请修改源码
5. **门洞位置**：门洞开在两个相邻结构共享墙壁上，宽度为 doorWidthMin 到共享边长之间的随机值
