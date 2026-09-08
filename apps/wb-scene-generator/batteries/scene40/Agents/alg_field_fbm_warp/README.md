# alg_field_fbm_warp · 场 FBM 扰动

把一张标量场（典型是 `alg_field_inner_distance` 的距离场）用低频 FBM 值噪声做**零均值加性扰动**，
使下游 `alg_field_threshold` 切出来的分界不再是与源轮廓平行的等距同心环，而是忽宽忽窄、
带海湾与岬角的自然线条。

## 算法

```text
out(r,c) = clamp0( field(r,c) + (fbm(c*featureScale, r*featureScale, seed) - 0.5) * 2 * amplitude )
```

- FBM = 4 阶 value noise（与 `zone_nesting_riverbank` 同款），保证海岸线质感一致。
- 噪声零均值 ⇒ **阈值语义不变**：`threshold=3` 仍表示「平均 3 格内」，只是边界在 ±amplitude 内摆动。
- `amplitude = 0` 时原样透传，退化为原本的均匀等距分带。

## 端口

| 方向 | 端口 | 类型 | 默认 | 语义 |
|---|---|---|---|---|
| IN | `field` | grid (item) | — | 待扰动标量场。约定：无效格 0、源格 0、不可达 -1 |
| IN | `region` | grid (item) | — | 有效范围掩码，非零为有效格；应与产出 field 的 region 一致 |
| IN | `amplitude` | number | 2.5 | 偏移幅度（与 field 同单位，距离场即格数），推荐 1~4 |
| IN | `featureScale` | number | 0.08 | 噪声空间频率，越小波浪越长，推荐 0.03~0.15 |
| IN | `seed` | number | 0 | 0 = 用当前时间戳；同 seed + 同输入结果确定 |
| OUT | `field` | grid (item) | — | 扰动后的标量场，可直接喂 `alg_field_threshold` |

## 限制与约定

1. `field` 与 `region` 形状必须一致，否则报 `field and region must have the same shape`。
2. `region` 外的格恒输出 `0`；`field < 0`（BFS 不可达 -1）原样透传，不参与扰动。
3. 结果下限截断到 `0`，保证仍能被 `alg_field_threshold` 的 `0<=field<=threshold` 判为近处。
4. 多层分带请给每层用**不同 seed**，各层分界才互不平行；把上一层的扰动结果再喂给下一层
   （链式扰动）可保证外层分界始终在内层之外，只要 `amplitude < 两层阈值之差`。
5. 纯函数，无模块级可变状态；`seed=0` 是唯一的非确定性来源。

## 典型接法

```text
alg_field_inner_distance.field ─┬─ alg_field_fbm_warp(seed=1337, amplitude=2.5) ─┬─ alg_field_threshold(浅/非浅)
                                │                                                │
region ─────────────────────────┴────────────────────────────────────────────────┴─ alg_field_fbm_warp(seed=4211, amplitude=1.5)
                                                                                       └─ alg_field_threshold(中/深)
```

见 `batteries/templates/structures/water/WaterDepthZones`。
