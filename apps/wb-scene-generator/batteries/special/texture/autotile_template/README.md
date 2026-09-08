# 自动贴图模板 (autotile_template)

输出 autotile 切片与邻域拼接规则模板，供自定义渲染或下游规则消费者按格子四邻域选取合适的 sprite。

## 模板文件组织

当前内置模板已拆分为独立文件，位于 `templates/` 目录：

- `templates/single.json`
- `templates/4bit-cardinal-16.json`
- `templates/index.ts`：模板 registry，负责加载和导出模板

后续扩展模板时，优先新增一个独立 JSON 文件，再在 `templates/index.ts` 中注册；节点入口 `index.ts` 本身不再直接写模板内容。

## 输入

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| preset | string | `single` | 预设模板选择 |

### 预设说明

| 预设值 | 说明 |
|---|---|
| `single` | 整图直接渲染，和不接模板时完全相同，适合单张贴图 |
| `4bit-cardinal-16` | 标准 4-bit 四方向自动贴图，需要一张 4列×4~5行（16~20格）的图集 |

## 输出

| 端口 | 类型 | 说明 |
|---|---|---|
| template | dict | 包含切片坐标和邻域规则的模板字典 |

## 模板内容

模板 dict 现在同时包含两层信息：

- `sprites[]`：资产如何拆分，每个 sprite 都显式给出 `x / y / width / height`
- `map / randomRules`：拆分后如何按邻域与概率规则拼接

渲染器会优先使用 `sprites[]` 作为标准裁剪来源，不再依赖 `tileSize + columns` 去推导规则网格切片。

## 4bit-cardinal-16 图集格式

当前内置 `4bit-cardinal-16` 模板虽然仍是均匀的 16x16 网格，但模板内部已经展开成显式 `sprites[]` 定义。等价排布如下：

```
列:  0          1          2          3
行0: #0         #1         #2         #3
行1: #4         #5         #6(全包围) #7
行2: #8         #9         #10        #11
行3: #12        #13        #14        #15
行4: #16(变体)  #17        #18        #19   ← 可选，第5行全部替代 #6
```

**邻域签名格式**：`"up,down,left,right"`，1=有同类格子，0=无

前 16 个 sprite（行 0~3）覆盖所有 2^4=16 种四方向邻域组合。第 5 行（行 4，sprite 16~19）为可选变体，图集若实际存在第 5 行，sprite #6（全包围格子）会被这 4 个变体随机替换，增加视觉多样性。

后续若出现不均匀 atlas，可直接在模板里写新的 `sprites[]` 坐标列表，无需再改渲染代码。

## 典型消费方式

自定义渲染节点可同时消费 grid / image / template：grid 提供格子值，image 提供图集资源，template 提供每个格子的裁剪与邻域规则。
