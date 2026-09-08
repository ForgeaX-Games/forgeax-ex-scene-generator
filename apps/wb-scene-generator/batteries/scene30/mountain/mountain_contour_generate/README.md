# mountain_contour_generate (mountain_contour_generate)

用 FBM 噪声 + 高斯山峰增益生成山地高度场，按层切割并输出每层的等高线轮廓 mask 列表。

## 功能特点

1. **山头自然融入地形**：山峰通过高斯增益叠加在 FBM 噪声底层之上，两者连续过渡，不会出现孤立圆圈。
2. **等高线列表输出**：`contourLayers` 是一个网格列表，设几层就输出几个 grid，每个 grid 只保留该层的等高线轮廓（线宽=1格）。
3. **层数完全可控**：`contourLevels` 决定列表长度，层数高则轮廓细密，层数低则疏朗。
4. **多峰支持**：多个山头各自独立增益，彼此过渡区自然形成鞍部和复合等高线。

## 适用情况

- 需要每层等高线独立处理（染色、描边、碰撞等）的地形管线
- 需要俯视山地图、地形图、策略游戏海拔层
- 配合 `list_unpack` 逐层处理等高线

## 基本使用方法

1. 拖入电池，设置 `width / height / peakCount / contourLevels`。
2. `contourLayers` 输出网格列表，接 `list_unpack` 可逐层处理。
3. `heightGrid` 接下游地形分类或渲染器直接可视化。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| width | number | 128 | 输出网格宽度 |
| height | number | 128 | 输出网格高度 |
| peakCount | number | 3 | 山头数量（1=单峰，3以上=群山） |
| contourLevels | number | 8 | 等高线层数，决定列表长度 |
| peakRadius | number | 0.22 | 山头影响半径（归一化 0~1） |
| peakStrength | number | 0.9 | 山头增益强度（越大越突出） |
| noiseScale | number | 2.2 | 底层噪声频率（越大地形越细碎） |
| seed | number | 0 | 随机种子，0 使用当前时间 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| contourLayers | array | 网格列表，共 contourLevels 个，每个是该层等高线轮廓 mask |
| heightGrid | grid | 0~100 连续高度场 |
| outputNameList | array | 各层名称清单，与 contourLayers 下标对应 |

## 注意事项

1. **`contourLayers[i]` 是轮廓线，不是填充区域**：每个 grid 只有等高线边界格有值（值=层序号），其余为 0。
2. **层数与山头半径联动**：层数多而 `peakRadius` 小时，高处等高线间距会很窄，建议 `peakRadius ≥ 0.18`。
3. **`noiseScale` 调大后底层起伏明显**：低山区域也会出现等高线，这是正常现象，可调低 `noiseScale` 或提高 `peakStrength` 让山头主导。
