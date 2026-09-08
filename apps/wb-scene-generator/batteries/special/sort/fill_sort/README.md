# 填充值整理 (fill_sort)

将多个 `[网格, 名称清单]` 包的填充值去重并从 1 起重新编号，输出**重编号后的网格列表**与统一名称清单（网格保持独立，不合并）。

## 功能特点

1. **去重重编号**：不同层的网格可能都含值 1，本电池将每层的每个值独立映射为全局唯一 ID（从 1 起递增），彻底消除 ID 冲突
2. **网格保持独立**：输出的 `outputGrids` 是一个列表，每层网格各自独立，顺序与输入一致，不做合并
3. **多值网格支持**：支持 01 二值网格和多值网格（如地块网格 1/2/3/…）混合输入；多值网格的每个值都单独分配新 ID
4. **名称清单可选**：若某层包中 `nameList` 为空数组，自动从来源端口标签派生名称
5. **动态层数**：连接最后一个 `层N` 槽位后自动追加新槽

## 适用情况

- 将 `chess_road` 的主路、辅路、地块三层合并为一张完整的城市地图
- 将多个 `grid_label` 打标后的层叠加为带完整名称清单的多值网格
- 任何需要把多张独立掩码层归并为一张带语义 ID 的网格的场景

## 基本使用方法

每个输入端口接收一个由 `merge` 电池打好的 **两元素列表 `[网格, 名称清单]`**：

```
merge(mainRoad, mainRoadNameList)   → fill_sort.item_0
merge(subRoad,  subRoadNameList)    → fill_sort.item_1
merge(parcels,  parcelsNameList)    → fill_sort.item_2
```

### 典型用法：chess_road 三层合并

```
chess_road.mainRoad  ──┐
                       merge → item_0
                    ──┘  (nameList 为空或不连，自动用"主路"标签)

chess_road.subRoad   ──┐
                       merge → item_1
                    ──┘

chess_road.parcels   ──┐
                       merge → item_2
chess_road.nameList  ──┘
```

执行后：
- `outputGrids[0]`：主路网格，原来的 1 → 重编为 1
- `outputGrids[1]`：辅路网格，原来的 1 → 重编为 2
- `outputGrids[2]`：地块网格，原来的 1/2/3 → 重编为 3/4/5，…
- `outputNameList`：`[{id:1,name:"主路"},{id:2,name:"辅路"},{id:3,name:"地块1"},…]`

### 名称来源优先级

| 情况 | 名称来源 |
|------|---------|
| 包中 nameList 非空 | 直接使用 nameList 中的 name 字段 |
| nameList 为空，但来自命名输出端口 | 使用来源端口标签（如"主路"） |
| 以上都无，单值网格 | "层i" |
| 以上都无，多值网格 | "层i值N" |

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| description | string | "" | 说明信息，原封不动透传至同名输出端口 |
| item_0 | any | - | `[grid, nameList]` 两元素列表 |
| item_1 | any | - | `[grid, nameList]`；连接后自动追加新槽位 |
| item_N | any | - | 动态扩展，N 从 0 起递增 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| description | string | 与输入端口「说明信息」完全相同的字符串，透传不作任何修改 |
| outputGrids | array | 重编号后的网格列表，顺序与输入一致，各层独立不合并 |
| outputNameList | array | 统一名称清单：`[{id, name}]`，ID 与所有输出网格的值一一对应 |

## 注意事项

1. **包的格式**：每个端口接收 `[grid, nameList]` 两元素数组，用 `merge` 电池打包；网格在前（索引 0）、名称清单在后（索引 1）
2. **网格不合并**：`outputGrids` 是列表，下游若要叠加渲染可再接其他合并电池
3. **空 nameList**：允许传入 `[]` 作为 nameList，电池自动回退到来源端口标签命名
