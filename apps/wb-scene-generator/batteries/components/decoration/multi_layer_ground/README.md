# 多层地面 (multi_layer_ground)

在单张基准网格的目标区域内生成多层 Perlin 噪声地面，合并为单张多值网格（每层一个递增 id，重叠处取较高层），自动过滤小碎片区域。

## 数据格式（DataTree）

输入 `inputGrid` 与输出 `outputGrid` 均为 `grid` / `access:item`：每次只处理单张网格，网格列表由引擎自动逐张 fanout / 重组。多层合并在同一张多值网格中输出，下游可 `grid_split_by_value` 按值拆分后分别命名。

## 内部管线

每层：`perlin_noise → grid_binarize(threshold) → grid_mask_apply(仅目标区域) → 过滤面积 < 总像素/200 的连通碎片`；目标区域 = 基准网格最大值所在区域。多层按递增 id 合并，重叠处较高层覆盖较低层。

## 输入参数

| 参数名 | 类型 | access | 默认值 | 说明 |
|--------|------|--------|--------|------|
| inputGrid | grid | item | — | 单张基准网格，目标区域=最大值所在区 |
| layerCount | number | item | 4 | 地面层数 |
| threshold | number | item | 0.6 | Perlin 二值化阈值 0~1，越高覆盖越小 |
| frequency | number | item | 0.02 | 噪声采样频率，越小斑块越大越平滑 |
| octaves | number | item | 3 | 噪声叠加倍频数，越大细节越丰富 |
| seed | number | item | 0 | 随机种子，0 使用当前时间戳，每层自动偏移 |

## 输出参数

| 参数名 | 类型 | access | 说明 |
|--------|------|--------|------|
| outputGrid | grid | item | 多值地面网格，每层一个递增 id（从 max+1 起），重叠处取较高层，其余为 0 |
| nameList | array | item | 实际出现的地面层 `[{id, name, type:'tile'}]` |
