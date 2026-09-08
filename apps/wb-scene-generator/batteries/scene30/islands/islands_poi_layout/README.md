# islands_poi_layout (islands_poi_layout)

在岛屿地形上自动布置洞穴、遗迹、营火、绿洲等兴趣点，并把其足迹写回主地形。

## 功能特点

1. **多类地标**：内置洞穴入口、废墟、瞭望塔、营火、绿洲等多种 POI。
2. **地形感知**：不同 POI 只会落在合适的地形上。
3. **双输出**：既输出改写后的地形，也输出只标中心点位的 `poiGrid`。

## 适用情况

- 需要从纯地形进入“可讲故事地图”阶段时。
- 需要给后续渲染器或玩法系统提供 POI 元数据时。
- 不适合精确手工控制每个地标位置的场景。

## 基本使用方法

把 `islands_path_generate.outputGrid` 接到本节点。地形继续传给 `islands_resource_scatter`，`poiGrid` 可单独接给后续渲染或筛选节点。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| grid | grid | - | 输入地形网格 |
| seed | number | 0 | 随机种子 |
| poiDensityScale | number | 1 | POI 数量倍率 |
| minDistance | number | 12 | POI 最小间距 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 写入 POI 足迹后的地形 |
| outputNameList | array | 对应名称清单 |
| poiGrid | grid | 仅标记 POI 点位的网格 |
| poiNameList | array | POI 网格名称清单 |

## 处理规则说明

### 处理规则格式

```json
[]
```

### 处理规则参数

本电池不使用 `processRules`，POI 类型、落点规则和足迹逻辑固定在节点内部。

## 使用示例

### 输入示例

```json
{
  "grid": [[3,11,3,5,6],[3,3,2,3,6]],
  "seed": 42,
  "poiDensityScale": 1,
  "minDistance": 12
}
```

### 输入文件格式

```json
{
  "districts": [{"id":9,"name":"洞穴入口"}],
  "grid": [[3,11,3,5,6],[3,3,2,3,6]]
}
```

### 输出示例

```json
{
  "outputGrid": [[3,11,9,5,8],[3,3,2,11,6]],
  "outputNameList": [{"id":9,"name":"洞穴入口"}],
  "poiGrid": [[0,0,1,0,0],[0,0,0,0,0]],
  "poiNameList": [{"id":1,"name":"洞穴入口"}]
}
```

## 注意事项

1. **会改写主地形**：POI 足迹可能把局部草地改成洞穴地面、石圈或土路。
2. **密度过高会失败**：`poiDensityScale` 太高且 `minDistance` 太大时，部分 POI 会找不到位置。
3. **点位不含足迹形状**：`poiGrid` 只保留中心点位，不包含 POI 覆盖范围本身。
