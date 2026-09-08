// 💡 描边→可见绘制 延迟探针(仅保留计时骨架,日志已移除)。
//
// 之前用于把 `[bake-perf]` 行打印到控制台以诊断绘制延迟;性能已验证达标后,
// 这些 console.info 输出全部移除。导出的函数签名保持不变(markStage /
// beginStageTimeline / endStageTimeline / timeHandler / markPaintStart /
// logRenderPhase 以及各 reporter),因此所有调用点无需改动,且时间线的状态
// 维护(reset-safety 依赖)依然保留。需要时可再次接回日志。

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

let paintStartedAt: number | null = null

/** Called the instant a paint commit lands in the store (the click path). */
export function markPaintStart(): void {
  paintStartedAt = now()
}

/** Called once the painted cell is actually drawn. (Logging removed; the reset
 *  of the start marker is kept so the next paint measures from a clean state.) */
export function markPaintDrawn(_kind: 'incremental' | 'full-rebuild'): void {
  if (paintStartedAt === null) return
  paintStartedAt = null
}

// ── Staged click→visible profiler ──────────────────────────────────────────
// markStage('label') records a timestamped milestone. The FIRST stage in a
// gesture (mousedown) resets the timeline; each subsequent stage logs its delta
// from the previous stage AND the cumulative time since mousedown. endStage()
// prints a one-line summary. Lets us see exactly which segment of
// mousedown → resolve → bind → cellAt → enqueue → rAF → commit → bake → compose
// eats the latency (e.g. a hidden await, sprite/atlas decode, or full rebuild).

interface StageMark { label: string; t: number }
let stages: StageMark[] = []
let gestureStartedAt: number | null = null

/** Begin (or restart) a click→visible timeline. Call at mousedown. */
export function beginStageTimeline(label = 'mousedown'): void {
  gestureStartedAt = now()
  stages = [{ label, t: gestureStartedAt }]
}

/** Record a milestone in the current timeline. (Bookkeeping retained so the
 *  timeline stays balanced for the reset-safety logic; logging removed.) */
export function markStage(label: string): void {
  if (gestureStartedAt === null) return
  const t = now()
  stages.push({ label, t })
}

/** Close the timeline. (Logging removed; the state reset is kept so an open
 *  timeline never leaks across gestures — part of the dead-stop reset-safety.) */
export function endStageTimeline(label = 'visible'): void {
  if (gestureStartedAt === null) return
  markStage(label)
  gestureStartedAt = null
  stages = []
}

// ── Synchronous handler-body probe ──────────────────────────────────────────
// Wraps an event handler. Logging has been removed; the wrapper stays
// behavior-transparent (calls fn and returns its result) so all call sites are
// unchanged and the timing wrapper can be re-enabled later if needed.

export function timeHandler<T>(_name: string, fn: () => T): T {
  return fn()
}

// ── Incremental-append breakdown ────────────────────────────────────────────
// One concise line attributing the cost INSIDE appendCellsToVoxelMaster so we
// can see whether the per-paint ~hundreds of ms goes to sort(N), the object
// fixpoint, or the dirty-region repaint loop. nowMark() is exported so the
// append can timestamp its own internal segments cheaply.

export function nowMark(): number {
  return now()
}

export interface IncrementalBreakdown {
  n: number          // total cells in the merged snapshot
  sortMs: number
  fixpointMs: number
  fixpointObjs: number
  repaintMs: number
  cellsVisited: number
  cellsPainted: number
  dirtyPx: number
  prepMs: number     // de-dup + neighbor scan + bbox-grow setup
}

export function logIncrementalBreakdown(b: IncrementalBreakdown): void {
  void b
}

/** Visible-canvas compose cost reporter. Logging removed (no-op). */
export function logComposeMs(masterW: number, masterH: number, dirty: boolean, ms: number): void {
  void masterW; void masterH; void dirty; void ms
}

/** Column-occupancy index cost reporter. Logging removed (no-op). */
export function logOccupancyMs(kind: 'full' | 'incremental', cells: number, ms: number): void {
  void kind; void cells; void ms
}

/** Consolidated per-render accounting of every scene-wide computation that ran in
 *  the billboard plugin's body, so the WHOLE render phase is attributed (not one
 *  memo at a time). `segments` is an ordered list of [name, ms]; `reactCommit` is
 *  the React.Profiler actualDuration for the same commit (render+commit of the
 *  subtree). All unconditional. */
export function logRenderPhase(segments: Array<[string, number]>, bodyTotalMs: number, reactCommitMs?: number): void {
  void segments; void bodyTotalMs; void reactCommitMs
}
