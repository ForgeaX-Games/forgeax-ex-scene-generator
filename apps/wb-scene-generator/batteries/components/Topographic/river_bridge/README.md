# 河流架桥 (river_bridge)

分析单张网格中河流区域的局部流向，在垂直于流向的指定位置生成桥掩码，支持直线桥与折线桥两种形态。

## 数据格式（DataTree）

输入 `inputGrid` 与输出 `outputGrid` 均为 `grid` / `access:item`：每次只处理单张网格，网格列表由引擎自动逐张 fanout / 重组，无需算子内部维护列表。

## 功能特点

1. **局部 PCA 定流向**：在 `position` 附近取局部窗口做主成分分析，得到该处的流向，桥方向垂直于流向
2. **位置可控**：`position` 参数 0~1 控制桥沿主轴的位置（0=上游/起点端，1=下游/终点端）
3. **两种桥形**：直线（`straight`，Bresenham）或连连看折线（`zigzag`，≤2 次 H/V 转弯，失败降级直线）
4. **多值网格支持**：每个非零值视为独立河流，各自生成桥
5. **延伸到陆地**：`extendToLand` 开启时桥两端各延伸 1 格到河岸外，使桥真正连接两岸

## 输入参数

| 参数名 | 类型 | access | 默认值 | 说明 |
|--------|------|--------|--------|------|
| inputGrid | grid | item | — | 单张河流网格，非零值为河流区域 |
| width | number | item | 1 | 桥宽（格数） |
| position | number | item | 0.5 | 沿主轴的位置，0.0~1.0 |
| algorithm | string | item | "straight" | 桥形：straight / zigzag |
| extendToLand | boolean | item | true | 桥两端各延伸 1 格到河岸外的陆地 |

## 输出参数

| 参数名 | 类型 | access | 说明 |
|--------|------|--------|------|
| outputGrid | grid | item | 桥掩码网格，桥格值=1，其余为 0 |
| outputNameList | array | item | 名称清单，固定 `[{id:1, name:'桥', type:'tile'}]` |

## 注意事项

1. 桥端点用「岸外连通性 flood-fill」区分真正的两侧河岸，再取最近端点对
2. zigzag 找不到通道时降级为 Bresenham 直线桥
3. 后处理会把对角角接修复为四连通，避免桥断点
4. 同一网格多个非零值 → 每个值独立生成一座桥，共享同一组参数
