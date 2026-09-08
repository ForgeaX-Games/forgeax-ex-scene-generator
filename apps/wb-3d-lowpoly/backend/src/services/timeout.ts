/**
 * withTimeout —— 给可能挂起的 Promise（OCCT baker 烘焙、pipeline 执行）套上超时。
 *
 * 背景（Workstream C · 卡死治理）：baker 走 replicad/OCCT WASM，某些病态 CSG /
 * 齿轮参数会让内核长时间自旋甚至卡死，工具调用随之挂起并持续吞 token。这里给关键
 * 路径加上明确超时：到点即以可读错误 reject（而非无限等待），调用方据此给 agent 一个
 * 干净的失败回执。
 */

export class TimeoutError extends Error {
  constructor(
    public readonly label: string,
    public readonly ms: number,
  ) {
    super(`${label} timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * 竞速 promise 与一个定时器；超时则 reject(TimeoutError)。定时器用 unref() 以免
 * 空转的 timer 把 Node 事件循环吊住（短命进程仍能干净退出）。
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!(ms > 0)) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      ;(timer as { unref: () => void }).unref()
    }
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/** 单次 bake / geometry-shape bake 的默认超时（毫秒）。可用 env 覆盖。 */
export function bakeTimeoutMs(): number {
  const raw = Number(process.env.FORGEAX_BAKE_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000
}

/** pipeline 执行（model.apply 内）超时（毫秒）。 */
export function executeTimeoutMs(): number {
  const raw = Number(process.env.FORGEAX_EXECUTE_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000
}

/** baker WASM 预热超时（毫秒）。 */
export function warmupTimeoutMs(): number {
  const raw = Number(process.env.FORGEAX_BAKER_WARMUP_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 20_000
}
