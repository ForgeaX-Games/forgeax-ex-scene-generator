# islands_resource_scatter (islands_resource_scatter)

根据最终地形散布食物资源，并提取可以靠近饮水的岸边水源点。

## 功能特点

1. **地形驱动**：不同地块会生成不同类型的资源点。
2. **统一资源网格**：食物点和岸边水源都会被编码进 `resourceGrid`。
3. **不改地形**：本节点只附加资源数据，不再修改主地形网格。

## 适用情况

- 岛屿场景地形和 POI 已经稳定，需要补玩法资源时。
- 需要给 AI、生存系统、动物系统提供食物和水源输入时。
- 不适合还在大幅修改主地形结构的早期阶段。

## 基本使用方法

把 `islands_poi_layout.outputGrid` 接到本节点。`resourceGrid` 和 `resourceNameList` 可以继续接给后续筛选、渲染或玩法节点。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| grid | grid | - | 最终地形网格 |
| seed | number | 0 | 随机种子 |
| foodDensityScale | number | 1 | 食物生成密度倍率 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 原样透传的最终地形 |
| outputNameList | array | 地形名称清单 |
| resourceGrid | grid | 统一编码后的资源网格 |
| resourceNameList | array | 资源网格名称清单 |

## 处理规则说明

### 处理规则格式

```json
[]
```

### 处理规则参数

本电池不使用 `processRules`，资源规则固定基于地形类型和密度倍率。

## 使用示例

### 输入示例

```json
{
  "grid": [[0,1,2,3,5],[0,1,10,4,11]],
  "seed": 42,
  "foodDensityScale": 1.2
}
```

### 输入文件格式

```json
{
  "districts": [{"id":3,"name":"草地"}],
  "grid": [[0,1,2,3,5],[0,1,10,4,11]]
}
```

### 输出示例

```json
{
  "outputGrid": [[0,1,2,3,5],[0,1,10,4,11]],
  "outputNameList": [{"id":3,"name":"草地"}],
  "resourceGrid": [[0,1,0,3,0],[0,1,2,0,0]],
  "resourceNameList": [{"id":1,"name":"岸边水源"},{"id":2,"name":"浆果"},{"id":3,"name":"草料"}]
}
```

## 注意事项

1. **资源是概率生成**：同一地形在不同种子下会有不同资源布局。
2. **水源只取岸边**：深海中央不会被输出为可饮水点。
3. **同格冲突时优先保留食物**：若某格同时命中食物和岸边水源，`resourceGrid` 会优先保留食物编码。
