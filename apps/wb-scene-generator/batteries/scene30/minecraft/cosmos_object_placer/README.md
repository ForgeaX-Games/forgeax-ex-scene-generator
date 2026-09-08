# 宇宙对象布置 (cosmos_object_placer)

根据地形和区域网格生成装饰物、资源节点、建筑结构、敌人的放置数据。

## 功能特点

1. **四类对象**：装饰物(decoration)、资源节点(resource)、建筑结构(structure)、敌人(enemy)
2. **区域感知**：水晶区域生成水晶簇，结构区域生成建筑，远古区域跳过对象放置
3. **星球类型适配**：6种星球对应不同的装饰物、资源、敌人类型池
4. **区块化敌人生成**：按32x32区块生成1-4个敌人，保证分布均匀

## 适用情况

- 管线末端：在地形生成完毕后布置游戏对象
- 需要根据地形/区域差异化放置内容的场景

## 基本使用方法

1. 接入cosmos_terrain_variation的terrainGrid
2. 可选接入cosmos_zone_marker的zoneGrid
3. 设置planetType与上游保持一致
4. 输出objectsJson可传给渲染系统解析

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| terrainGrid | grid | - | 最终地形网格 |
| zoneGrid | grid | - | 区域标记网格（可选） |
| planetType | string | "lush" | 星球类型 |
| seed | number | 0 | 随机种子 |
| tileSize | number | 16 | 格子像素大小 |
| decorDensity | number | 1.0 | 装饰密度倍率 |
| resourceMultiplier | number | 1.0 | 资源生成倍率 |
| enemyDensity | number | 1.0 | 敌人密度倍率 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| objectsJson | string | 对象放置数据JSON字符串 |
| objectGrid | grid | 对象位置标记网格 |

## 输出JSON格式

```json
[
  { "type": "plant_small", "category": "decoration", "x": 128, "y": 64, "scale": 1.1 },
  { "type": "iron", "category": "resource", "x": 256, "y": 192 },
  { "type": "ruins_pillar", "category": "structure", "x": 512, "y": 384, "damaged": true },
  { "type": "swarmBug", "category": "enemy", "x": 320, "y": 160 }
]
```

## 注意事项

1. **坐标系**：x/y为像素世界坐标（格子坐标 × tileSize）
2. **objectGrid值**：1=装饰、2=资源、3=建筑、4=敌人，可用于可视化检查分布
3. **大地图性能**：超过128x128时对象数量可能较多，建议前端分批加载
