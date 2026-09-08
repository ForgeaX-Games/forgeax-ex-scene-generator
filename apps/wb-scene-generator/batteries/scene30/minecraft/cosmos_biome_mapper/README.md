# 宇宙生物群系映射 (cosmos_biome_mapper)

根据星球类型将高度图和湿度图映射为地形类型grid，支持6种星球风格。

## 功能特点

1. **6种星球类型**：lush(葱郁)、desert(沙漠)、frozen(冰冻)、volcanic(火山)、toxic(有毒)、barren(荒芜)
2. **双输入驱动**：高度+湿度共同决定地形分类，边缘地带更自然
3. **自动名称清单**：输出本次用到的地形ID与中文名称映射

## 适用情况

- 接在cosmos_terrain_gen后将噪声图转为地形grid
- 需要切换不同星球风格的场景
- 作为cosmos_terrain_variation / cosmos_object_placer的上游

## 基本使用方法

1. 将cosmos_terrain_gen的elevationGrid和moistureGrid接入
2. 选择planetType（下拉选择6种类型）
3. 输出terrainGrid可直接接入cosmos_terrain_variation

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| elevationGrid | grid | - | 高度图，值0-1000 |
| moistureGrid | grid | - | 湿度图，值0-1000（可选） |
| planetType | string | "lush" | 星球类型枚举 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| terrainGrid | grid | 地形类型网格（值0-11） |
| nameList | array | 地形ID与名称映射列表 |

## 地形ID对照表

| ID | 名称 | 说明 |
|----|------|------|
| 0 | 深水 | 不可通行 |
| 1 | 浅水 | 不可通行 |
| 2 | 沙地 | 可通行 |
| 3 | 草地 | 可通行 |
| 4 | 泥土 | 可通行 |
| 5 | 石头 | 可通行 |
| 6 | 山脉 | 不可通行，阻挡投射物 |
| 7 | 雪地 | 可通行 |
| 8 | 岩浆 | 不可通行 |
| 9 | 冰面 | 可通行 |
| 10 | 毒地 | 可通行 |
| 11 | 火山岩 | 可通行 |

## 注意事项

1. **输入格式**：elevationGrid值应为0-1000整数（来自cosmos_terrain_gen）
2. **moistureGrid可选**：不接时默认湿度0.5，lush/toxic星球表现会较平均
