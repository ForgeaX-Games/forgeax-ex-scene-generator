# 填充家具放置器 (furniture_filler)

将填充类家具（如小柜子、盆栽等）反复放置到室内空间网格中，直到房间占用率达到上限或连续找不到合法位置为止。通常接在单一家具放置器之后使用。

## 功能特点

1. **循环填充**：对每类填充家具反复执行放置，直到占用率达到上限（贴边 65%、居中 80%）或连续 5 次失败
2. **保留旧家具**：读取已有的 maskA/maskB，旧家具占用状态完整保留，新填充家具编号从旧最大 rank 偏移
3. **同类共享 rank**：同一类填充家具的所有实例共用同一 effectiveRank（与 Python 版逻辑一致）
4. **去重索引**：输出的 furnitureIndex 中相同 rank 只保留一条记录

## 适用情况

- 配合单一家具放置器使用，作为布置流水线的第二步
- 需要将小型重复家具（椅子、盆栽、小柜子等）密集填充到房间剩余空间
- 完整流水线：`room_mask_init` → `furniture_placer` → `furniture_filler`

## 基本使用方法

1. 将单一家具放置器的 `newMaskA`、`newMaskB`、`furnitureIndex` 分别接入本电池的 `maskA`、`maskB`、`oldFurnitureIndex`
2. 将 `furniture_rank_split` 输出的 `fill_list` 接入 `furnitureList`
3. 将室内空间网格接入 `roomGrid`（与单一家具放置器相同）
4. 执行后获取 `newMaskA`、`newMaskB` 和 `furnitureIndex`

家具模板库（`simple_furniture_demo.json` 和 `desk_chair_set.json`）已内置在电池目录中，无需外部接入。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| roomGrid | grid | - | 室内空间网格，1=可用格，0=墙 |
| maskA | grid | - | 已有家具实体网格，无旧家具时传全零网格 |
| maskB | grid | - | 已有过道预留网格，无旧家具时传全零网格 |
| oldFurnitureIndex | array | - | 旧家具编号列表；无旧家具时传 `[]` |
| furnitureList | array | - | 填充家具清单，每项含 rank/name/furniture_id/type/placement |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| newMaskA | grid | 更新后的家具实体网格 |
| newMaskB | grid | 更新后的过道预留网格 |
| furnitureIndex | array | 完整家具编号列表（旧+新），每项含 rank、name、isGroup |
| diagnostics | array | 填充过程诊断日志 |

## 注意事项

1. **占用率上限**：贴边填充达到 65% 停止，居中填充达到 80% 停止；若房间本身已超过上限则直接跳过
2. **编号规则**：新填充家具 effectiveRank = 旧最大 rank + 填充 rank；同类家具所有实例编号相同
3. **连续失败上限**：连续 5 次找不到合法位置时停止当前类型的填充，继续处理下一类
