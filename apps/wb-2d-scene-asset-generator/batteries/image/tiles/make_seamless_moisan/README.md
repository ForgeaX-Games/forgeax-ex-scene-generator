# 无缝贴图（Moisan） — `make_seamless_moisan`

将一张 AI 生成（或任意来源）的 PNG 贴图,转换为**严格可无缝平铺**的版本。结果贴图自我相邻时,上下边、左右边像素完全连续,不会出现拼接缝隙。

## 算法原理

实现 Moisan 2011《**Periodic plus Smooth Image Decomposition**》(JMIV)。

任意 M×N 图像 `u` 可唯一分解为:

```
u = p + s
```

- `p` 严格是 M×N 周期(沿水平、垂直循环均连续)
- `s` 是承载边界跳跃的平滑分量

我们丢掉 `s`、只保留 `p` 即可得到完美 tileable 贴图。求解方式是在频域用 FFT 一次性解出来的解析解,**无参数、无失真、毫秒级**。

### 求解步骤

1. **构造边界跳跃图 `v`**(M×N,内部为 0):
   - 列方向: `v[0,j] += u[M-1,j] - u[0,j]`, `v[M-1,j] -= u[M-1,j] - u[0,j]`
   - 行方向: `v[i,0] += u[i,N-1] - u[i,0]`, `v[i,N-1] -= u[i,N-1] - u[i,0]`
   - 四角自动累加双向贡献
2. `V = FFT2(v)`
3. 频域闭式解:
   ```
   S_hat[k,l] = V[k,l] / (2cos(2π k/M) + 2cos(2π l/N) - 4)
   S_hat[0,0] = 0   // 保留原图均值,避免直流偏置
   ```
4. `s = real(iFFT2(S_hat))`
5. `p = u - s`,按 RGB(可选 Alpha)三通道独立处理,最后裁剪到 `[0, 255]`

### 复杂度

| 输入尺寸 | 路径 | 单通道耗时(预估) |
|---|---|---|
| 2 的幂(8, 16, 32, ... 1024, 2048) | Cooley-Tukey radix-2 FFT, O(MN log MN) | 256×256: <10ms, 1024×1024: ~80ms |
| 非 2 的幂(如 96, 200) | O(n²) DFT 回退 | 96×96: ~30ms, 200×200: 慢,不建议 |

推荐输入尺寸为 2 的幂以走 FFT 快路径。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `image` | image | — | 资产库中的 PNG 别名(必填)。可来自 `image_gen`、导入资产或任何输出 image 的节点 |
| `process_alpha` | boolean | `false` | 是否同时处理 Alpha 通道。默认仅处理 RGB;对纯不透明 RGBA 贴图可开启 |

## 输出

| 端口 | 类型 | 说明 |
|---|---|---|
| `image` | image | 无缝化后的新图像别名(自动派生:`<源 alias 去扩展名>_seamless.png`,写入 staging 区作为内部缓存)。可直接接 `image_atlas_compose` / `texture_bind` 等下游消费节点 |
| `info` | string | 处理摘要(尺寸、通道数、FFT 路径、耗时) |

## 典型管线

```
imported asset / image_gen
        │ image (PNG alias)
        ▼
make_seamless_moisan      ← 此电池
        │ image (新别名)
        ▼
texture_bind  ← grid
        │ asset_grid
        ▼
渲染器(无缝平铺)
```

## 使用注意

1. **仅支持 PNG**。AI 出图建议保存为 PNG;JPEG 由于有损压缩本身就会引入边界噪声,不适合做无缝化。
2. **图像最大边长 4096**。Moisan 是 O(MN log(MN));超大图请先降采样。
3. **同一源图重复处理时,会原地覆盖 staging 区的 `<base>_seamless.png` 别名**(库的 `(alias, zone)` 唯一约束)。本电池不再暴露输出库/后缀设置,作为一个纯变换;如需正式归档到 raw 区,请下游接 `image_output`。
4. **像素艺术**(8×8 / 16×16 这类极小尺寸)虽然能跑,但视觉收益不大 ——
   极小贴图的"缝"主要来自抗锯齿/插值,而非边界跳跃;
   更建议在生成期就让 AI 用 circular padding 出图,本电池作兜底。
5. **若希望强制循环**(生成的 tile 边界本来就接近,但仍想保险一道),Moisan 是零成本兜底,推荐放在 AI 出图后的固定后处理槽位。
6. **Alpha 处理**:对带透明边的精灵开启 `process_alpha=true` 会让边缘晕开,默认关闭。

## 与其它方案的对比

| 方法 | 优点 | 缺点 |
|---|---|---|
| **Moisan(本电池)** | 解析解、无参数、无失真、毫秒级 | 仅修首尾跳跃,内部细节保持原样 |
| 边缘羽化混合 | 实现极简单 | 边缘高频细节(草尖、石粒)会被糊掉 |
| Offset + Inpaint(PS 经典法) | 可创意修补瑕疵 | 慢、需要 inpaint 模型、不稳定 |
| Graphcut 接缝 | 大图效果优秀 | 8×8/16×16 小贴图基本无效 |
| 改 SD 卷积为 circular padding | 生成期天然无缝 | 需改模型/插件,本电池可作兜底 |

## 参考文献

- Moisan, L. *Periodic Plus Smooth Image Decomposition*, **Journal of Mathematical Imaging and Vision** 39(2): 161-179, 2011. [PDF](https://hal.archives-ouvertes.fr/hal-00388020/document)

## 实现备注

- 电池在 backend 进程内执行(execution.service.ts 动态 `import`)
- 通过 backend 内的辅助模块 `backend/src/utils/png_codec.ts`(基于 `sharp`)处理 PNG 解码/编码
- 通过 `backend/src/services/library.service.ts.getLibraryService()` 读写资产库 blob
- FFT 实现为内联零依赖的 radix-2 Cooley-Tukey + O(n²) DFT 兜底
