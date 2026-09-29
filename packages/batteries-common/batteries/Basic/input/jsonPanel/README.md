# JSON (json_panel)

Edit a JSON object or array on the canvas. The output port is `dict`.

## 输出

| 参数名 | 类型 | 说明 |
|--------|------|------|
| value | dict | 解析后的对象或对象数组 |

不是合法 JSON 时节点报错，不写回 `.scene.ts`。脚本真值是对象字面量（`const rec = { … }`），不要写 `jsonPanel()`。
