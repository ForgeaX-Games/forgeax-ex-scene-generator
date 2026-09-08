# 赛道样条平滑 (track_spline_smooth)

对赛道骨架多边形顶点执行 Catmull-Rom 样条插值，将折线轮廓平滑为光滑的闭合曲线，输出中心线的密集采样点序列。

## 功能特点

1. **Catmull-Rom 样条**：天然过控制点，无需额外参数，插值效果自然流畅
2. **闭合处理**：首尾自动连接，保证赛道形成完整回路
3. **可控密度**：通过 `samplesPerSegment` 调节输出点的密度
4. **张力调节**：`tension` 参数控制曲线贴近骨架的程度

## 适用情况

- 作为赛道生成管线的第二步，接收 `track_skeleton_generate` 的输出
- 任何需要将折线多边形平滑为曲线的场景

## 基本使用方法

1. 将 `track_skeleton_generate` 的 `skeleton` 输出连接到本电池 `skeleton` 输入
2. 调节 `samplesPerSegment`（建议 20~50）控制曲线细腻程度
3. 输出 `centerline` 接入 `track_mesh_rasterize` 进行栅格化

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| skeleton | array | - | 骨架顶点 JSON 字符串（来自 track_skeleton_generate） |
| samplesPerSegment | number | 30 | 每段插值采样点数（≥3） |
| tension | number | 0.5 | 张力系数 [0~1] |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| centerline | array | 平滑中心线点列 JSON 字符串 `[{x,y}...]` |

## 注意事项

1. **samplesPerSegment 与骨架点数**：最终中心线点数 ≈ 骨架顶点数 × samplesPerSegment
2. **tension = 0**：曲线最为圆滑，但可能偏离骨架较远；**tension = 1**：退化为折线
3. **输出格式**：与 `skeleton` 格式相同，直接传入 `track_mesh_rasterize` 即可
