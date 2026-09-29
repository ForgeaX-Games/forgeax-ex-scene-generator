# Grid 分组

大标签 `Grid`。小标签是数学族，不是「地形 / 城市」。  
分类合同：[`docs/grid-operators.md`](../../../../docs/grid-operators.md)。

**第一批扫描 `Grid/init` 五颗 + `Grid/noise` 七颗。** 再往下的组没有进 `firstBatchBatteries.ts` 就不会进栏。  
世界米贴地是 `sampleHeight`，不在本目录。水力 / 热应力写 `.generator.ts`。

栏上小标签顺序：`init → noise → arith → filter → morph → sample → derive → partition → zone → global → lattice → ca`。

| 小标签 | 邻域 | 意图 | 放什么 |
|---|---|---|---|
| `init` | — | 造 | 解析造表：常数、斜坡、细分。不要拷贝电池 |
| `noise` | — | 造 | 采样造表：一核多电池，不和 `createGrid` 挤一格 |
| `arith` | local | 改原场 | 点态场运算 |
| `filter` | focal | 改原场 | 局部核（连续量） |
| `morph` | focal | 改原场 | 形态学（集合） |
| `sample` | local | 解释 | 按下标读写 / 撒点 |
| `derive` | local/focal | 解释 | 坡、阈值 mask、边 |
| `partition` | global | 解释 | 切成区号场 |
| `zone` | zonal | 改原场 | 按区号汇总铺回 |
| `global` | global | 改/解释 | 整表：归一化、距离 |
| `lattice` | — | 换划分 | resize / crop |
| `ca` | focal×步 | 改原场 | 步进壳，规则外置 |

归档对照（只抽核，不加载 `obsolete/`）：[`grid-operators.md` §8](../../../../docs/grid-operators.md)。  
噪声抽屉：[`noise/README.md`](./noise/README.md)。两轴仍是造表，栏上不进 `init`。
