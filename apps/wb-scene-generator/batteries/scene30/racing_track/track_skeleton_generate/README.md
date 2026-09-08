# 赛道骨架生成 (track_skeleton_generate)

在指定尺寸空间内随机散布控制点，计算凸包后对各边施加随机扰动，生成一条闭合的多边形骨架顶点序列，作为赛道中心线的粗略轮廓。

## 功能特点

1. **凸包保证闭合**：输出天然是闭合回路，不会出现断路或交叉起点
2. **边中点扰动**：在凸包每条边的中点加入随机偏移，产生弯道和发卡弯效果
3. **可控随机性**：通过 `seed` 参数复现同一结果，或用 `0` 每次生成不同赛道
4. **参数化复杂度**：`pointCount` 控制圈数变化频率，`perturbScale` 控制弯道激烈程度

## 适用情况

- 赛车游戏赛道中心线骨架生成
- 需要一个闭合回路轮廓的任何场景（跑道、河道等）
- 与 `track_spline_smooth` → `track_mesh_rasterize` 配套使用

## 基本使用方法

1. 连接 `width`、`height` 指定地图尺寸
2. 调节 `pointCount`（建议 8~16）和 `perturbScale`（建议 0.2~0.5）
3. 输出 `skeleton` 接入 `track_spline_smooth` 进行曲线平滑

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| width | number | 100 | 生成空间宽度（格子数） |
| height | number | 100 | 生成空间高度（格子数） |
| pointCount | number | 10 | 随机控制点数量（≥5） |
| perturbScale | number | 0.3 | 扰动幅度 [0~1] |
| margin | number | 10 | 距边界留白格子数 |
| seed | number | 0 | 随机种子，0 = 每次不同 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| skeleton | array | 闭合多边形顶点 JSON 字符串 `[{x,y}...]` |

## 注意事项

1. **pointCount 过少**：少于 5 个点时凸包退化为线段，建议至少 6~8 个
2. **perturbScale 过大**：超过 0.6 后部分扰动点可能超出 margin 范围，会被自动裁剪
3. **输出格式**：`skeleton` 是 JSON 字符串，需直接传入 `track_spline_smooth`，无需手动解析
