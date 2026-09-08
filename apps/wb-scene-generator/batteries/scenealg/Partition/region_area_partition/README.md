# alg_region_area_partition · 区域划分

在**父区域**掩码内，根据 **point2d 中心点列表** + **面积权重列表**，把可用区域切成若干互不重叠的子区域。输出 `partition[]`（每张 0/1 网格），与 `alg_region_flood_grow` / `alg_region_components` 的 partition 契约一致。

## 接口

| 端口 | 类型 | access | 说明 |
| --- | --- | --- | --- |
| in `region` | grid | item | 父区域掩码，非零格可划分 |
| in `points` | **point2d** | **list** | 中心点；**x→列，y→行** |
| in `areas` | number | list | 面积权重（相对比例） |
| in `boundaryStyle` | string | item | organic / smooth / rectilinear / voronoi |
| in `relaxIterations` | number | item | Lloyd 迭代（默认 5） |
| in `smoothIterations` | number | item | CA 平滑迭代（默认 5） |
| in `seed` | number | item | 随机种子 |
| in `stretch` | point2d | list | 各分区拉伸系数（x→水平、y→竖直），与 points 等长；1=正圆，范围 0.25-4，缺省补 1 |
| in `edgeNoise` | number | item | 边界扰动幅度（像素），默认 2.5；让边界自然蜿蜒、减少多区在一点汇聚；0 关闭 |
| out `partition` | grid | list | 每分区一张 0/1 网格 |
| out `count` | number | item | 分区数 |

## point2d 示例

```json
[
  {"x": 10, "y": 10},
  {"x": 30, "y": 10},
  {"x": 30, "y": 30}
]
```

配合面积权重：

```json
[3, 2, 2]
```

## 兼容口（高级）

| 口 | 说明 |
|---|---|
| `centers` | `[[row,col],...]` 或归一化坐标（优先用 `points`） |
| `positions` | 九宫格方位 `[1-9,...]`（优先用 `points`） |
