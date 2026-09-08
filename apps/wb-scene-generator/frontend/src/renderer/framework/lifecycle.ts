// 💡 渲染器生命周期事件中心
//
// 用途：让各 mode（mode-top / mode-iso / mode-topBillboard / 未来 mode-xxx）在
// 自己的模块顶部 register 必要的 invalidate / cleanup 监听，shared 层（App.tsx /
// RenderCanvas）只 emit 信号，不直接 import 任何 mode-specific 模块。
//
// 这是渲染框架的「插件向下注册」入口。新增 mode 时不应触碰本文件，只在 mode
// 内部 import 它并 .on() 注册。
//
// 设计取舍：
//   * 不用 RxJS / mitt 等第三方库，30 行手撸够了
//   * 监听器抛错不阻断后续监听器（catch + console.error）
//   * 不保证调用顺序（Set 迭代顺序事实上是插入顺序，但不暴露给消费方依赖）
//   * emit 同步执行；若监听器需要异步处理，自行 Promise

type Listener<T> = (payload: T) => void

class EventBus<T> {
  private listeners = new Set<Listener<T>>()
  /** 注册监听器，返回 unsubscribe 函数 */
  on(fn: Listener<T>): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  /** 同步广播；监听器抛错不阻断其他监听器 */
  emit(payload: T): void {
    for (const fn of this.listeners) {
      try { fn(payload) } catch (e) { console.error('[RenderLifecycle] listener error:', e) }
    }
  }
}

export const RenderLifecycle = {
  /** 项目切换（用户或 AI Agent 触发），mode 据此清整套缓存 */
  projectChanged: new EventBus<{ projectId?: string; type?: string; name?: string }>(),
}
