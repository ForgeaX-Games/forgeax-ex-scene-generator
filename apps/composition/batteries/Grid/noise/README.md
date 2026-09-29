# Grid / noise

采样造表。两轴仍是「邻域 — / 意图 造」，和 `init` 一样；栏上单独一个小标签，避免七颗噪声和 `createGrid` 挤在一起。

合同：[`docs/grid-operators.md`](../../../../../docs/grid-operators.md) §3.1.0。

核不要 `scene.contract.ts`。七颗电池已进 `firstBatchBatteries.ts`。

| 文件夹 | 导出 | 比公共口多的参数 |
|---|---|---|
| `_noise/` | `runGridNoise`（核，无 contract） | — |
| `hash_noise/` | `hashNoise` | `scale` |
| `value_noise/` | `valueNoise` | — |
| `value_cubic_noise/` | `valueCubicNoise` | — |
| `perlin_noise/` | `perlinNoise` | — |
| `opensimplex2_noise/` | `openSimplex2Noise` | — |
| `opensimplex2s_noise/` | `openSimplex2sNoise` | — |
| `cellular_noise/` | `cellularNoise` | `distanceFunction` `returnType` `jitter` |

公共口：`columns` `rows` `seed`。采样核再加 `frequency` `fractal` `octaves` `lacunarity` `gain` `offsetX` `offsetY`。采样器不吃 `mask`；要裁切就后乘。

不放：一颗 `kind` 超级电池；`gridNoise.perlin(...)` 点号调用；Worley 当 CA；山 / 岛菜谱；`createGrid` / 斜坡 / 菱形方块（那些在 `init`）。
