# 家具放置器 (furniture_placer)

将主家具清单中的家具按优先级（rank）逐一放置到室内空间网格中，支持保留旧家具状态、贴边/居中两种放置策略，输出更新后的掩码和家具编号列表。

## 功能特点

1. **保留旧家具**：读取已有的 maskA/maskB，旧家具占用状态完整保留，新家具编号从旧家具最大 rank + 1 开始偏移
2. **贴边/居中放置**：根据家具清单中的 `placement` 字段自动选择贴边（edge）或居中（center）策略，贴边家具沿房间内壁排列，居中家具分散在房间中央区域
3. **防碰撞检测**：家具本体不与已有家具或过道重叠，过道区域不与已有家具重叠
4. **边界均衡**：贴边家具自动分散到四面墙，避免单边过密；居中家具避免靠墙
5. **组合家具支持**：支持桌椅组等多子组件家具，子组件在网格中以 effectiveRank + 10 标记

## 适用情况

- 需要将 LLM 生成的家具清单自动布置到房间中
- 需要在已有家具基础上继续追加新家具
- 配合 `room_mask_init` → `furniture_placer` → `furniture_filler` 的完整室内布置流水线

## 基本使用方法

1. 将 `room_mask_init` 输出的 `maskA`、`maskB` 接入对应端口
2. 将 `furniture_rank_split` 输出的 `main_list` 接入 `furnitureList`
3. 无旧家具时，`oldFurnitureIndex` 传入空数组 `[]`
4. 执行后获取 `newMaskA`、`newMaskB` 和 `furnitureIndex`

家具模板库（`simple_furniture_demo.json` 和 `desk_chair_set.json`）已内置在电池目录中，无需外部接入。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| roomGrid | grid | - | 室内空间网格，1=可用格，0=墙 |
| maskA | grid | - | 家具实体网格，无旧家具时传全零网格 |
| maskB | grid | - | 过道预留网格，无旧家具时传全零网格 |
| oldFurnitureIndex | array | - | 旧家具编号列表；无旧家具时传 `[]` |
| furnitureList | array | - | 主家具清单，每项含 rank/name/furniture_id/type/placement |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| newMaskA | grid | 更新后的家具实体网格，非零值为 effectiveRank |
| newMaskB | grid | 更新后的过道预留网格，1=已预留 |
| furnitureIndex | array | 完整家具编号列表，每项含 `rank`（网格值）、`name`、`isGroup` |

## 注意事项

1. **编号规则**：新家具在网格中的编号 = 旧家具最大 rank（`rankOffset`）+ 新家具的 `rank`；家具组子组件额外 +10
2. **家具模板匹配**：单件家具按 `size_shape`（如 `medium_rect`）在 `singleLibrary` 中查找；组合家具（`type: "group"`）按 `furniture_id` 在 `groupLibrary` 中查找基础名称（去掉 `_edge{N}` / `_center_{suffix}` 后缀）
3. **maskA 和 maskB 不修改原网格**：内部深拷贝后操作，原始输入不受影响
4. **放置失败静默跳过**：若某件家具找不到合法位置或对应模板，该家具被跳过，不影响其他家具放置
