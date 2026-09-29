// Optional location-name alignment gate for callers that provide an external
// location contract. Every required location name must remain discoverable in
// the generated scene. The gate is implemented here rather than in an Agent
// prompt so it remains deterministic for every caller:
//   - 纯函数，无 Fastify / runtime 依赖，可独立单测；
//   - `null` = 通过；非 null = 结构化拒绝结果（reason + 明细 + fix），供 LLM
//     直接读懂"缺了什么、该怎么补"，而不是一个裸的布尔值。
//
// 命名对齐是「下限」，不是「上限」：调用方可以在保留原名节点的前提下
// 独立展开更丰富的子结构。本门控只检查每个
// 上游 name 能否在场景节点名集合里找到匹配，绝不会因为场景里出现了额外的补充/
// 装饰节点而判定不通过——多产出的结构不是违规，只有"核心命名缺失"才是。

/** One upstream narrative/location name that could not be matched in the scene graph. */
export interface MissingLocationName {
  /** The narrative entity name (verbatim from the upstream story/location tree). */
  name: string
  /** LLM-readable explanation of the miss + how to fix specifically this one entry. */
  reason: string
}

export interface LocationNameGateRejection {
  reason: string
  missing: MissingLocationName[]
  /** Actionable remediation returned with the structured rejection. */
  fix: string
}

// 去掉空白、常见全半角标点/连接符/引号/括号后再比较，容忍 Sino 给节点名加前后缀
// 或轻微格式化（如"望江客栈" → "望江客栈_主楼"、"望江 客栈" → "望江客栈"）。
// NFKC 归一化把全角/半角、组合形式先拉平，避免同一个字因编码差异比较失败。
const WHITESPACE_AND_PUNCT = /[\s\-_·・,，。.、/\\|()（）[\]【】'"“”‘’:：]+/gu

export function normalizeLocationName(name: string): string {
  return name.normalize('NFKC').replace(WHITESPACE_AND_PUNCT, '').toLowerCase()
}

/**
 * Fuzzy match: a narrative name "counts as present" in a scene node name when,
 * after normalization, either string contains the other (bidirectional
 * substring containment). This tolerates Sino adding a prefix/suffix
 * ("望江客栈" → "望江客栈_主楼") while still requiring the narrative name's core
 * identifying text to literally appear — a genuinely different/generalized name
 * ("城镇"/"建筑1") will NOT match.
 */
export function locationNamesMatch(narrativeName: string, sceneNodeName: string): boolean {
  const a = normalizeLocationName(narrativeName)
  const b = normalizeLocationName(sceneNodeName)
  if (!a || !b) return false
  return a === b || b.includes(a) || a.includes(b)
}

/**
 * Which upstream narrative names have NO match anywhere in `sceneNodeNames`.
 * Pure + order-preserving (dedup'd, blank entries dropped) so it's trivially
 * unit-testable and reusable outside the rejection-object wrapper below.
 */
export function findMissingLocationNames(
  narrativeNames: readonly string[],
  sceneNodeNames: readonly string[],
): MissingLocationName[] {
  const uniqueNarrative = [...new Set(narrativeNames.map((n) => (typeof n === 'string' ? n.trim() : '')).filter(Boolean))]
  const sceneNames = sceneNodeNames.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
  const missing: MissingLocationName[] = []
  for (const narrativeName of uniqueNarrative) {
    const hit = sceneNames.some((sceneName) => locationNamesMatch(narrativeName, sceneName))
    if (!hit) {
      missing.push({
        name: narrativeName,
        reason:
          `场景节点名里找不到任何包含"${narrativeName}"的节点——上游叙事/契约地点名必须原样字符串出现在对应场景节点名里` +
          '（用模板 Name 端口喂入，如 BaseName/IslandName/ZoneNames/BuildingName/DecorationName/NamePrefix，禁止用顶层 scene_set_attribute）。' +
          `允许加前后缀或作为子节点名的一部分（如"${narrativeName}_主楼"仍算命中），但不能整体替换成泛化名或漏项。`,
      })
    }
  }
  return missing
}

/**
 * Validate a Sino deliverable's scene-graph node names against the upstream
 * narrative/location-tree entity names. Returns the first-class rejection
 * object (never a bare boolean) so the caller (aw-support orchestration / the
 * execute-summary verification hints) can hand Sino back an actionable,
 * structured "here's exactly what's missing and how to fix it" list — never
 * just pass/fail.
 *
 * Returns `null` when `narrativeNames` is empty (nothing to gate against — the
 * caller didn't supply an upstream contract, so this check is a no-op) or when every
 * narrative name has a match.
 */
export function checkLocationNameAlignment(
  narrativeNames: readonly string[],
  sceneNodeNames: readonly string[],
): LocationNameGateRejection | null {
  if (!Array.isArray(narrativeNames) || narrativeNames.length === 0) return null
  const missing = findMissingLocationNames(narrativeNames, sceneNodeNames)
  if (missing.length === 0) return null
  return {
    reason:
      `location-names-not-aligned: ${missing.length} 个上游叙事/契约地点名在最终场景节点名里找不到匹配` +
      '（硬门控 stage3.location_names 未通过）。',
    missing,
    fix:
      '为每一个缺失的地点名在场景里补一个节点，其名称包含该原名字符串（模板 Name 端口命名：BaseName/IslandName/ZoneNames/' +
      'BuildingName/DecorationName/NamePrefix 等，绝不用顶层 scene_set_attribute）。允许在原名基础上加前后缀或作为父节点下的' +
      '子结构（如"望江客栈_主楼"仍算命中"望江客栈"），但不能用泛化名整体替换（"城镇"/"区域A"/"建筑1"）或彻底省略。' +
      '补齐命名的同时必须按叙事语义展开足够丰富的子结构/数量（例如"市集/城镇"应对应多栋建筑+摊位/灯柱等，而非一个空节点）——' +
      '这是下限，不是可选项；额外的补充节点/细节不算违规，只有核心命名缺失才算。',
  }
}
