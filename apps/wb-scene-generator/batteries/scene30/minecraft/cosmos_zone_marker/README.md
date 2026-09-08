# 宇宙区域标记 (cosmos_zone_marker)

使用Voronoi噪声在地形网格上标记三类特殊POI区域。

## 功能特点

1. **Voronoi分布**：用简化Voronoi函数生成自然分散的特殊区域
2. **三级区域**：结构区(100)、水晶区(200)、远古区(300)，优先级递增
3. **非破坏性**：不可通行地形（水/山脉/岩浆）不会被标记

## 适用情况

- 接在cosmos_biome_mapper后为地形添加POI标记
- 作为cosmos_object_placer的上游，决定哪里生成建筑群

## 基本使用方法

1. 将cosmos_biome_mapper的terrainGrid接入
2. 调整三个阈值控制各类区域的密度
3. 输出zoneGrid接入cosmos_object_placer

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| terrainGrid | grid | - | 地形类型网格 |
| seed | number | 0 | 随机种子 |
| structureThreshold | number | 0.08 | 结构区域密度 |
| crystalThreshold | number | 0.05 | 水晶区域密度 |
| ancientThreshold | number | 0.04 | 远古区域密度 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| zoneGrid | grid | 带区域标记的网格 |
| nameList | array | 区域类型名称列表 |

## 区域ID说明

| ID | 类型 | 说明 |
|----|------|------|
| 100 | 结构区域 | 可生成遗迹/科技/采矿/神殿建筑群 |
| 200 | 水晶区域 | 可生成水晶地面覆盖 |
| 300 | 远古区域 | 可生成远古地砖/外星金属覆盖 |

## 注意事项

1. **阈值范围**：建议0.02-0.15，过大会导致区域连片
2. **优先级**：远古 > 水晶 > 结构，同位置只保留最高优先级
