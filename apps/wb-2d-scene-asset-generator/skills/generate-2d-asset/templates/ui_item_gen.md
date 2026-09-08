# 模板 · ui_item_gen（背包物品 / UI 图标）

> [SKILL.md](../SKILL.md) 路由到此。通用操作流程见 SKILL.md 第二节。**端口以 `asset2d:groups.get` 为准。**

适用：**背包物品 / UI 图标**（默认 64px 像素、纯白底、黑描边），按物品属性 + 可选参考图生成。

## 暴露输入（连到 `<groupId>.端口`，喂未 hidden 的）

| 端口 | 含义 | 类型 | 喂什么 |
|---|---|---|---|
| `in_15` | name | string | 物品名（入库名 + 提示词主体） |
| `in_16` | label | string | 物品标签/分类 |
| `in_17` | level | string | 等级/品级 |
| `in_18` | tooltip | string | 物品描述（tooltip 文案，供提示词理解物品语义） |
| `in_19` | background | string | 底色/背景说明 |
| `in_20` | visual | string | 视觉风格描述 |
| `in_7` | reference1 | image | 可选参考图（图生图） |
| `in_8` | reference2 | image | 可选第二参考图 |

> `name`/`label`/`level`/`tooltip`/`background`/`visual` 是内部图标提示词模板的占位符，按需填；留空走默认。

## Run（runButtons：**一个 image_gen**）
对该 image_gen 的 `nodeId` 调一次 `generation.generateImage`。

## 暴露输出

| 端口 | 含义 | 类型 | 说明 |
|---|---|---|---|
| `out_2` | image | image | 图标成品（像素修复 + 缩放 + 抠净杂点） |
| `out_3` | error | string | 错误汇总 |

## 自检 / 验收（发布前逐项过）

发布前对照下列条目逐项核对（看 `assets.get` 的尺寸/字节 + `out` 字段/error，不靠截图）；任意一条不过，**只重出这个图标**再发布，不动同批其它图标。

- **规格对**：默认 64px（或指定尺寸）像素图标，纯白底 + 黑描边。
- **单个居中**：画面只有一个图标且居中，**无场景 / 无背景元素 / 无地面 / 无投影**。
- **语义相符**：图标内容与 `name` / `label` / `tooltip` 表达的物品语义一致，一眼能认出。
- **像素干净**：边缘干净、无杂点 / 半透明毛边，可直接入背包 UI。
- **同批风格统一**：同一套图标配色 / 描边 / 体量一致，可成套使用。
