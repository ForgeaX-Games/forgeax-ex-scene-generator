import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeypointModel, KNode } from './parse.js'

function TreeCaret({ collapsed }: { collapsed: boolean }): JSX.Element {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" className="kpg-list__caret-icon">
      <path
        d={collapsed ? 'M3 1L7 5L3 9' : 'M1 3L5 7L9 3'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function KeypointHierarchyList({
  model,
  selectedId,
  onSelect,
}: {
  model: KeypointModel
  selectedId: string | null
  onSelect: (id: string | null) => void
}): JSX.Element {
  const childrenMap = useMemo(() => {
    const map = new Map<string, KNode[]>()
    for (const node of model.nodes) {
      if (node.parentId === null) continue
      const arr = map.get(node.parentId) ?? []
      arr.push(node)
      map.set(node.parentId, arr)
    }
    return map
  }, [model.nodes])

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map())

  // Scroll the selected row into view and auto-expand its ancestors.
  useEffect(() => {
    if (!selectedId) return
    setCollapsed((prev) => {
      if (prev.size === 0) return prev
      const next = new Set(prev)
      const byId = new Map(model.nodes.map((n) => [n.id, n]))
      let cur = byId.get(selectedId)?.parentId ?? null
      while (cur) {
        next.delete(cur)
        cur = byId.get(cur)?.parentId ?? null
      }
      return next
    })
    const row = rowRefs.current.get(selectedId)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, model.nodes])

  const onToggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const renderNode = (node: KNode): JSX.Element => {
    const kids = childrenMap.get(node.id) ?? []
    const hasKids = kids.length > 0
    const isCollapsed = collapsed.has(node.id)
    const isSel = node.id === selectedId
    return (
      <li key={node.id} className="kpg-list__item">
        <div
          ref={(el) => {
            if (el) rowRefs.current.set(node.id, el as unknown as HTMLLIElement)
            else rowRefs.current.delete(node.id)
          }}
          className={`kpg-list__row${isSel ? ' is-selected' : ''}`}
          style={{ paddingLeft: `${node.depth * 12 + 4}px` }}
          onClick={() => onSelect(node.id)}
        >
          {hasKids ? (
            <button
              type="button"
              className="kpg-list__caret nodrag"
              aria-expanded={!isCollapsed}
              onClick={(e) => {
                e.stopPropagation()
                onToggle(node.id)
              }}
            >
              <TreeCaret collapsed={isCollapsed} />
            </button>
          ) : (
            <span className="kpg-list__caret kpg-list__caret--spacer" aria-hidden />
          )}
          <span className="kpg-list__name" title={node.id}>
            {node.name}
          </span>
          <span className="kpg-list__area">{node.area} m²</span>
        </div>
        {hasKids && !isCollapsed ? <ul className="kpg-list__children">{kids.map(renderNode)}</ul> : null}
      </li>
    )
  }

  const root = model.rootId ? model.nodes.find((n) => n.id === model.rootId) : null

  return (
    <ul className="kpg-list" role="tree">
      {root ? renderNode(root) : <li className="kpg-list__empty">无层级数据</li>}
    </ul>
  )
}
