// 💡 右侧模型信息面板：按 viewer mode 展示模型信息（关节 / 静态场景 / 角色）
//    + articulated 模式下的可动关节滑块（revolute/continuous/prismatic）+ 重置按钮
import { useState } from 'react'
import { RotateCcw, ChevronDown, ChevronRight, Info } from 'lucide-react'
import type { UrdfSpec, UrdfJoint } from '../../three/urdf-parser'
import { useViewerStore } from '../../store/viewerStore'
import { useViewerI18n } from '../../i18n/strings'
import './SidePanel.css'

interface SidePanelProps {
  spec: UrdfSpec | null
  jointValues: Map<string, number>
  previewJointValues: Map<string, number>
  setJointValue: (name: string, value: number) => void
  resetAllJoints: () => void
  stats: {
    links: number
    joints: number
    movableJoints: number
    primitiveCount: number
    meshCount: number
    loadedMeshCount: number
    failedMeshCount: number
  }
}

const FALLBACK_PRISMATIC_RANGE = 0.4
const FALLBACK_REVOLUTE_RANGE = Math.PI

interface JointSliderRange {
  lower: number
  upper: number
  isFallback: boolean
}

function getJointSliderRange(joint: UrdfJoint): JointSliderRange {
  const lower = joint.limit?.lower
  const upper = joint.limit?.upper
  const hasRange = typeof lower === 'number' && Number.isFinite(lower)
    && typeof upper === 'number' && Number.isFinite(upper) && upper > lower
  if (hasRange) return { lower, upper, isFallback: false }

  if (joint.type === 'continuous') {
    return { lower: -Math.PI, upper: Math.PI, isFallback: true }
  }
  if (joint.type === 'prismatic') {
    return { lower: -FALLBACK_PRISMATIC_RANGE, upper: FALLBACK_PRISMATIC_RANGE, isFallback: true }
  }
  return { lower: -FALLBACK_REVOLUTE_RANGE, upper: FALLBACK_REVOLUTE_RANGE, isFallback: true }
}

function isMovable(joint: UrdfJoint): boolean {
  return !joint.mimic && (joint.type === 'revolute' || joint.type === 'continuous' || joint.type === 'prismatic')
}

function formatJointValue(joint: UrdfJoint, value: number): string {
  if (joint.type === 'prismatic') return `${value.toFixed(3)} m`
  const degrees = (value * 180) / Math.PI
  return `${degrees.toFixed(1)}°  (${value.toFixed(3)} rad)`
}

function SidePanel({ spec, jointValues, previewJointValues, setJointValue, resetAllJoints, stats }: SidePanelProps) {
  const sidePanelOpen = useViewerStore((s) => s.sidePanelOpen)
  const autoAnimate = useViewerStore((s) => s.render.autoAnimate)
  const mode = useViewerStore((s) => s.mode)
  const sceneSpec = useViewerStore((s) => s.sceneSpec)
  const rigSpec = useViewerStore((s) => s.rigSpec)
  const t = useViewerI18n()

  const [infoExpanded, setInfoExpanded] = useState(true)
  const [jointsExpanded, setJointsExpanded] = useState(true)

  if (!sidePanelOpen) return null

  const movableJoints = spec ? spec.joints.filter(isMovable) : []
  const mimicJoints = spec ? spec.joints.filter((j) => j.mimic) : []
  const fixedJoints = spec ? spec.joints.filter((j) => j.type === 'fixed') : []
  const valuesSource = autoAnimate ? previewJointValues : jointValues

  // The joint slider list only applies to the articulated (URDF) pipeline; the
  // static-scene and character pipelines have no interactive joints.
  const showJointsSection = mode === 'articulated'

  // A model is loaded when the active pipeline's source is present.
  const hasModel =
    (mode === 'articulated' && !!spec) ||
    (mode === 'static' && !!sceneSpec) ||
    (mode === 'character' && !!rigSpec)

  const meshSummary = (
    <>
      {stats.loadedMeshCount}/{stats.meshCount} {t.sidePanel.meshLoaded}
      {stats.failedMeshCount > 0 ? `, ${stats.failedMeshCount} ${t.sidePanel.meshFailed}` : ''}
    </>
  )

  return (
    <div className="viewer-sidepanel">
      <div className="viewer-sidepanel-section">
        <button className="viewer-sidepanel-header" onClick={() => setInfoExpanded((v) => !v)}>
          {infoExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Info size={12} />
          <span>{t.sidePanel.modelInfo}</span>
        </button>
        {infoExpanded && (
          <div className="viewer-sidepanel-body">
            {!hasModel && <div className="viewer-info-empty">{t.sidePanel.noModelLoaded}</div>}

            {hasModel && mode === 'articulated' && spec && (
              <div className="viewer-info-grid">
                <div className="viewer-info-row">
                  <span className="viewer-info-label">{t.sidePanel.typeLabel}</span>
                  <span className="viewer-info-value">{t.sidePanel.modeArticulated}</span>
                </div>
                <div className="viewer-info-row">
                  <span className="viewer-info-label">{t.sidePanel.robot}</span>
                  <span className="viewer-info-value">{spec.name}</span>
                </div>
                <div className="viewer-info-row">
                  <span className="viewer-info-label">{t.sidePanel.links}</span>
                  <span className="viewer-info-value">{stats.links}</span>
                </div>
                <div className="viewer-info-row">
                  <span className="viewer-info-label">{t.sidePanel.joints}</span>
                  <span className="viewer-info-value">{stats.joints} ({stats.movableJoints} {t.sidePanel.movableSuffix}, {fixedJoints.length} {t.sidePanel.fixedSuffix}, {mimicJoints.length} {t.sidePanel.mimicSuffix})</span>
                </div>
                <div className="viewer-info-row">
                  <span className="viewer-info-label">{t.sidePanel.visuals}</span>
                  <span className="viewer-info-value">
                    {stats.primitiveCount} {t.sidePanel.primitive}
                    {stats.meshCount > 0 && (
                      <>, {meshSummary}</>
                    )}
                  </span>
                </div>
              </div>
            )}

            {hasModel && mode === 'static' && sceneSpec && (
              <div className="viewer-info-grid">
                <div className="viewer-info-row">
                  <span className="viewer-info-label">{t.sidePanel.typeLabel}</span>
                  <span className="viewer-info-value">{t.sidePanel.modeStatic}</span>
                </div>
                <div className="viewer-info-row">
                  <span className="viewer-info-label">{t.sidePanel.items}</span>
                  <span className="viewer-info-value">{sceneSpec.itemCount}</span>
                </div>
                <div className="viewer-info-row">
                  <span className="viewer-info-label">{t.sidePanel.meshes}</span>
                  <span className="viewer-info-value">{meshSummary}</span>
                </div>
              </div>
            )}

            {hasModel && mode === 'character' && rigSpec && (
              <div className="viewer-info-grid">
                <div className="viewer-info-row">
                  <span className="viewer-info-label">{t.sidePanel.typeLabel}</span>
                  <span className="viewer-info-value">{t.sidePanel.modeCharacter}</span>
                </div>
                <div className="viewer-info-row">
                  <span className="viewer-info-label">{t.sidePanel.bones}</span>
                  <span className="viewer-info-value">{rigSpec.boneCount ?? rigSpec.bones.length}</span>
                </div>
                <div className="viewer-info-row">
                  <span className="viewer-info-label">{t.sidePanel.skinMethod}</span>
                  <span className="viewer-info-value">{rigSpec.skin.method}</span>
                </div>
                {rigSpec.clips.length > 0 && (
                  <div className="viewer-info-row">
                    <span className="viewer-info-label">{t.sidePanel.clips}</span>
                    <span className="viewer-info-value">{rigSpec.clips.length}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showJointsSection && (
      <div className="viewer-sidepanel-section">
        <button className="viewer-sidepanel-header" onClick={() => setJointsExpanded((v) => !v)}>
          {jointsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>{t.sidePanel.jointsHeader}</span>
          {movableJoints.length > 0 && <span className="viewer-sidepanel-badge">{movableJoints.length}</span>}
          {autoAnimate && <span className="viewer-sidepanel-tag">{t.sidePanel.animatingTag}</span>}
          {movableJoints.length > 0 && !autoAnimate && (
            <button
              className="viewer-sidepanel-reset"
              title={t.sidePanel.resetAllJoints}
              onClick={(e) => { e.stopPropagation(); resetAllJoints() }}
            >
              <RotateCcw size={12} />
            </button>
          )}
        </button>
        {jointsExpanded && (
          <div className="viewer-sidepanel-body">
            {movableJoints.length === 0 && (
              <div className="viewer-info-empty">
                {spec ? t.sidePanel.noMovableJoints : t.sidePanel.noModelLoaded}
              </div>
            )}
            {movableJoints.map((joint) => {
              const range = getJointSliderRange(joint)
              const value = valuesSource.get(joint.name) ?? 0
              return (
                <div key={joint.name} className="viewer-joint-row">
                  <div className="viewer-joint-row-top">
                    <span className="viewer-joint-name" title={joint.name}>{joint.name}</span>
                    <span className={`viewer-joint-type viewer-joint-type-${joint.type}`}>{joint.type}</span>
                  </div>
                  <div className="viewer-joint-row-mid">
                    <input
                      type="range"
                      min={range.lower}
                      max={range.upper}
                      step={joint.type === 'prismatic' ? 0.001 : 0.005}
                      value={value}
                      disabled={autoAnimate}
                      onChange={(e) => setJointValue(joint.name, parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="viewer-joint-row-bot">
                    <span className="viewer-joint-range">
                      {range.isFallback && <span className="viewer-joint-range-fallback">{t.sidePanel.noLimit}</span>}
                      <span>{range.lower.toFixed(2)} {t.sidePanel.rangeArrow} {range.upper.toFixed(2)}</span>
                    </span>
                    <span className="viewer-joint-value">{formatJointValue(joint, value)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}
    </div>
  )
}

export default SidePanel
