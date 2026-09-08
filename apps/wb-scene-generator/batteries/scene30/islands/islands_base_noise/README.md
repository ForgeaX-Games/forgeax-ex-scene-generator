# islands_base_noise (islands_base_noise)

生成岛屿高度图、湿度图，并给出一个可直接预览的海岸草图网格。

## 功能特点

1. **双图生成**：同时输出高度图和湿度图，方便后续地形分类。
2. **岛屿收边**：内置中心衰减，让陆地更自然地收束为岛形。
3. **可视预览**：额外输出预览地形，便于先检查海岸线轮廓。

## 适用情况

- 需要从零开始生成岛屿场景底图时。
- 需要把高度图和湿度图拆到后续多个节点复用时。
- 不适合已经有明确地形网格、只想做局部修补的情况。

## 基本使用方法

先放置 `islands_base_noise` 作为整条管线起点。把 `heightMap` 和 `moistureMap` 连接到 `islands_biome_assign`，把 `outputGrid` 接到渲染器做海岸预览。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| width | number | 96 | 输出地图宽度 |
| height | number | 96 | 输出地图高度 |
| seed | number | 0 | 随机种子，0 使用当前时间 |
| heightOctaves | number | 5 | 高度图叠加层数 |
| heightPersistence | number | 0.55 | 高度图振幅衰减 |
| moistureOctaves | number | 4 | 湿度图叠加层数 |
| moisturePersistence | number | 0.5 | 湿度图振幅衰减 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 海岸预览网格 |
| outputNameList | array | 预览网格名称清单 |
| heightMap | grid | 0~1 浮点高度图 |
| moistureMap | grid | 0~1 浮点湿度图 |

## 处理规则说明

### 处理规则格式

```json
[]
```

### 处理规则参数

本电池不使用 `processRules`，全部通过普通输入参数控制。

## 使用示例

### 输入示例

```json
{
  "width": 128,
  "height": 128,
  "seed": 42,
  "heightOctaves": 5,
  "heightPersistence": 0.55,
  "moistureOctaves": 4,
  "moisturePersistence": 0.5
}
```

### 输入文件格式

```json
{
  "grid": [],
  "districts": []
}
```

### 输出示例

```json
{
  "outputGrid": [[0,0,1,2,3]],
  "outputNameList": [{"id":0,"name":"深水"}],
  "heightMap": [[0.12,0.21,0.41,0.59,0.77]],
  "moistureMap": [[0.33,0.28,0.51,0.62,0.48]]
}
```

## 注意事项

1. **浮点网格**：`heightMap` 和 `moistureMap` 是浮点二维数组，不是掩码图。
2. **预览仅供检查**：`outputGrid` 只是海岸预览，正式地形应使用后续 `islands_biome_assign`。
3. **大尺寸成本更高**：地图尺寸越大，执行时间和下游数据量也会增加。
