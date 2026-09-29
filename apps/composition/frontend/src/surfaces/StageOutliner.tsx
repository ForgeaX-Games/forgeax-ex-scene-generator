import { useDisplayIndex } from '../renderer/framework/displayIndex.js'
import { buildStageOutliner, nodeIdsForOutlinerNode, type StageOutlinerNode } from '../renderer/framework/stageOutliner.js'
import { commitStageSelect } from '../renderer/bridge/stageSelectBridge.js'
import { useRenderStore } from '../renderer/store.js'
import { sceneT } from '../sceneI18n.js'

function isSelected(node: StageOutlinerNode, selected: readonly string[]): boolean {
  const ids = nodeIdsForOutlinerNode(node)
  return ids.length > 0 && ids.every((id) => selected.includes(id))
}

function OutlinerRow({ node, depth }: { node: StageOutlinerNode; depth: number }): JSX.Element {
  const selectedIds = useRenderStore((s) => s.selectedEditorNodeIds)
  const selected = isSelected(node, selectedIds)
  const ids = nodeIdsForOutlinerNode(node)
  return (
    <li>
      <button
        type="button"
        className={`stage-outliner__row${selected ? ' is-selected' : ''}${ids.length === 0 ? ' is-empty' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        data-path={node.path}
        aria-pressed={selected}
        disabled={ids.length === 0}
        onClick={() => { if (ids.length) commitStageSelect(ids) }}
      >
        <span className="stage-outliner__label">{node.label}</span>
        <span className="renderer-schema-badge" data-schema-badge={node.schema}>{node.schema}</span>
        {node.children.length > 0 && (
          <span className="stage-outliner__count">{node.children.length}</span>
        )}
      </button>
      {node.children.length > 0 && (
        <ul className="stage-outliner__list">
          {node.children.map((child) => (
            <OutlinerRow key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function StageOutliner(): JSX.Element {
  const index = useDisplayIndex()
  const tree = buildStageOutliner(index)
  return (
    <div
      className="stage-outliner"
      data-testid="stage-outliner"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('.stage-outliner__row')) return
        commitStageSelect([])
      }}
    >
      <p className="stage-outliner__hint">{sceneT('outliner.hint')}</p>
      <ul className="stage-outliner__list" role="tree">
        {tree.map((node) => (
          <OutlinerRow key={node.path} node={node} depth={0} />
        ))}
      </ul>
    </div>
  )
}
