/**
 * Geometry DSL —— 跨边界类型定义。
 *
 * 设计要点（与现 scene 同范式）：
 *   - 端口承载 Geometry 不可变值，沿 wire 流动；电池每次"加一行"返回新 Geometry
 *   - source 是真源（source of truth）；statements 是派生 + 缓存，可重新 parse 出
 *   - 持久化只存 source；运行期带上 statements / focus 加速下游
 *
 * 语法（Python-like SSA）：
 *   注释        # ...
 *   赋值        name = op(kw1=v1, kw2=v2, ...)
 *   值          number | string | bool | list | ref
 *     number    1.5  /  -2  /  0
 *     string    "metal"
 *     bool      true / false
 *     list      [v, v, v]   （嵌套合法）
 *     ref       name        （引用先前定义的 id；不带引号 == ref，带引号 == string）
 *
 * 约束：
 *   - 每个 name 全文唯一（SSA）
 *   - ref 必须指向之前已绑定的 name（前向无依赖）
 *   - 无控制流（for/if 由 forgeax-wb-scene pipeline 层处理）
 */

/** 参数原子值 */
export type Arg =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'bool';   readonly value: boolean }
  | { readonly kind: 'list';   readonly items: readonly Arg[] }
  | { readonly kind: 'ref';    readonly name: string };

/**
 * 一行 = 一条 SSA 语句。
 * 注释 / 空行不进 statements；它们只在 source 字符串里。
 */
export interface Statement {
  /** 左侧绑定的 name（id）；全文唯一 */
  readonly id: string;
  /** 算子名（box / cylinder / part / joint / material / ...） */
  readonly op: string;
  /** 关键字参数表（顺序不敏感；与 op-registry 对照校验） */
  readonly args: Readonly<Record<string, Arg>>;
  /** 该语句在 source 中的 1-based 行号；错误定位与编辑器跳转用 */
  readonly line: number;
}

/**
 * Geometry —— 端口值核心。
 *
 * 注意：所有字段在 makeGeometry / append / parse 处通过 Object.freeze 冻结；
 * 下游电池禁止就地修改，需要变更走 `append()` 等纯函数返回新 Geometry。
 */
export interface Geometry {
  /** DSL 源码。空 geometry = "" */
  readonly source: string;
  /** 派生：解析后的语句列表（无 parse 错误时存在；有错误时仍可存部分语句） */
  readonly statements: readonly Statement[];
  /**
   * 派生：当前 wire 聚焦的 id —— 最近一次新增语句的 id。
   * 下游电池要拿"上一步的产出"时读这个；可缺省（initial empty geom 没有 focus）。
   */
  readonly focus?: string;
  /** 版本号；每次 append 自增。任意 mutation 都会让版本递增 */
  readonly version: number;
}

/** Geometry 解析 / 校验错误。带 line/col 定位。 */
export interface GeometryError {
  readonly message: string;
  /** 1-based 行号 */
  readonly line: number;
  /** 0-based 列偏移（行内）。无定位时缺省 */
  readonly col?: number;
  /** 错误类别（便于上层分流处理） */
  readonly kind: 'parse' | 'duplicate-id' | 'unknown-ref' | 'unknown-op' | 'bad-arg';
}
