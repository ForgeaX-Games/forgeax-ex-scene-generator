# islands_terrain_refine (islands_terrain_refine)

对原始岛屿地形做平滑，并补出靠水泥地和山地悬崖边。

## 功能特点

1. **多数平滑**：减少孤立噪点，让地形过渡更自然。
2. **泥地生成**：在近水草地和沙滩处补出潮湿泥地区。
3. **悬崖识别**：把山地边缘转换为不可行走的悬崖边。

## 适用情况

- 基础群系已经生成，但边缘过碎或缺少细节时。
- 需要增加更强“可探索地图”感觉时。
- 不适合高度图阶段，必须先有正式地形网格。

## 基本使用方法

把 `islands_biome_assign.outputGrid` 接入本节点。输出结果通常继续连接 `islands_path_generate`。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| grid | grid | - | 输入地形网格 |
| seed | number | 0 | 随机种子 |
| smoothPasses | number | 2 | 平滑迭代次数 |
| mudRadius | number | 2 | 搜索邻近水域半径 |
| mudChance | number | 0.6 | 泥地生成概率 |
| cliffChance | number | 0.65 | 悬崖边生成概率 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 细化后的岛屿地形 |
| outputNameList | array | 细化地形名称清单 |

## 处理规则说明

### 处理规则格式

```json
[]
```

### 处理规则参数

本电池不使用 `processRules`，所有地形细化规则由输入参数控制。

## 使用示例

### 输入示例

```json
{
  "grid": [[0,1,2,3,6],[0,1,3,3,6]],
  "seed": 42,
  "smoothPasses": 2,
  "mudRadius": 2,
  "mudChance": 0.6,
  "cliffChance": 0.65
}
```

### 输入文件格式

```json
{
  "districts": [{"id":3,"name":"草地"}],
  "grid": [[0,1,2,3,6],[0,1,3,3,6]]
}
```

### 输出示例

```json
{
  "outputGrid": [[0,1,2,10,8],[0,1,3,10,8]],
  "outputNameList": [{"id":10,"name":"泥地"},{"id":8,"name":"悬崖边"}]
}
```

## 注意事项

1. **参数耦合**：`mudRadius` 和 `mudChance` 会一起影响潮湿区域的覆盖范围。
2. **山体不一定全变悬崖**：悬崖使用概率采样，不是全部山缘都转换。
3. **过度平滑会损细节**：`smoothPasses` 太大时会损失小型沙滩和林带结构。
