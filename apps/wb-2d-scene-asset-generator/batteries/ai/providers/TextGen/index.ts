// TextGen — AI 文本生成节点（AINode 前端驱动模式）
//
// 执行模型说明：
//   真正的 AI 调用由前端 AINode 组件负责（用户点击节点上的手动运行按钮）：
//     - 读取 prompt 输入，POST /api/v1/ai/text
//     - 将生成结果写入 node.params._gen_result
//   本函数仅在 pipeline 执行时运行，作用是将上次生成结果透传给下游节点。
//
// autoIterate 说明：
//   当上游连接 string[]（多条 prompt）时，dispatcher 自动对每条 prompt 调用本函数，
//   输出 string[]（多条结果）供批量下游消费。

export function textGen(input: Record<string, unknown>): Record<string, unknown> {
  const result =
    typeof input._gen_result === 'string' && input._gen_result
      ? input._gen_result
      : '';
  const error =
    typeof input._gen_error === 'string' && input._gen_error.trim()
      ? input._gen_error.trim()
      : '';

  return error ? { result, error } : { result };
}
