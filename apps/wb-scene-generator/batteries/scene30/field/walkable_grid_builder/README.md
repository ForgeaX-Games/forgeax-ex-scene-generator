# 可通行网格构建器 (walkable_grid_builder)

合并地形网格和装饰物列表，生成供碰撞检测使用的布尔型可通行网格。

## 功能特点

1. **两层叠加**：先由地形确定基础可通行性，再由装饰物覆盖特定格子
2. **规则清晰**：明确定义每种地形和装饰物类型的阻挡行为
3. **轻量高效**：单次遍历完成，无复杂算法

## 适用情况

- 野外场景流水线的第四环节，为渲染层和物理系统提供碰撞数据
- 游戏运行时通过 `walkableGrid[row][col] === 1` 判断玩家是否可以移动到该格

## 基本使用方法

1. 将 `terrain_smoother` 的 `smoothedGrid` 连接至 `terrainGrid` 输入
2. 将 `field_decoration_sampler` 的 `decorations` 连接至 `decorations` 输入
3. 将输出 `walkableGrid` 传入 `field_scene_merger` 或直接在游戏逻辑中使用

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| terrainGrid | grid | — | 平滑后的地形网格（0=水/1=沙/2=草） |
| decorations | array | — | 装饰物列表（来自 field_decoration_sampler） |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| walkableGrid | grid | 布尔型网格，0=阻挡，1=可通行 |

## 参数说明

### 碰撞规则详情

| 地形类型 | 基础可通行性 | 会被装饰物覆盖 |
|---------|------------|-------------|
| 水系 (0) | 阻挡 (0) | 否（荷叶不改变水面阻挡） |
| 沙滩 (1) | 可通行 (1) | 是（树/岩可以覆盖） |
| 草地 (2) | 可通行 (1) | 是（树/岩可以覆盖） |

| 装饰物类型 | 对可通行性的影响 |
|-----------|---------------|
| tree | 将该格改为阻挡 (0) |
| rock | 将该格改为阻挡 (0) |
| bush | 不改变（可通行） |
| lilypad | 不改变（水面仍阻挡） |

## 注意事项

1. **坐标系**：`walkableGrid[row][col]` 中，row 对应 y（纵向），col 对应 x（横向），与 terrainGrid 一致
2. **游戏中使用**：`isWalkable(pixelX, pixelY)` 可通过 `walkableGrid[Math.floor(pixelY / tileSize)][Math.floor(pixelX / tileSize)]` 实现
3. **decorations 为空**：传入空数组 `[]` 时，完全由地形决定可通行性，节点正常工作
