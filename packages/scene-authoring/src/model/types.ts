import type { Op } from '@forgeax/node-runtime'

export const SCENE_SCRIPT_VERSION = '0.1'

export type ContractKind = 'atomic' | 'group' | 'template'
export type PortAccess = 'item' | 'list' | 'tree'
export type ActorKind = 'user' | 'agent' | 'template-maintainer' | 'compiler'
export type GroupCapability =
  | 'instantiate'
  | 'configure'
  | 'connect'
  | 'move'
  | 'replace'
  | 'remove'
  | 'observeSummary'
  | 'inspectDefinition'
  | 'editInstanceOverride'
  | 'editDefinition'
  | 'connectInternalPort'

export interface SourceRange {
  file: string
  start: number
  end: number
  line: number
  column: number
  endLine?: number
  endColumn?: number
  statementId?: string
}

export type SceneDiagnosticPhase =
  | 'parse'
  | 'type'
  | 'resolve'
  | 'compile'
  | 'execute'
  | 'verify'
  | 'platform'
  | 'capability'

export type SceneDiagnosticEscalation = 'none' | 'compiler' | 'battery' | 'platform'

export type SceneDiagnosticFixEdit =
  | {
      type: 'ReplaceReference'
      statementId: string
      argument: string
      sourceStatementId: string
      sourceOutput?: string
    }
  | {
      type: 'ReplaceSource'
      file: string
      start: number
      end: number
      text: string
    }

export interface SceneDiagnosticFix {
  fixId: string
  title: string
  edits: SceneDiagnosticFixEdit[]
}

export interface SceneDiagnosticGraphLocation {
  authoringNodeId?: string
  runtimeNodeIds?: string[]
  runtimeEdgeIds?: string[]
  sceneNodeIds?: string[]
}

export interface SceneDiagnosticTransaction {
  applied: boolean
  rolledBack: boolean
  undoToken?: string
}

export interface SceneDiagnostic {
  code: string
  phase: SceneDiagnosticPhase
  severity: 'error' | 'warning' | 'info'
  /** Optional on legacy producers; constructors and route serialization always supply it. */
  title?: string
  message: string
  source?: SourceRange
  graph?: SceneDiagnosticGraphLocation
  expected?: unknown
  actual?: unknown
  fixes?: SceneDiagnosticFix[]
  transaction?: SceneDiagnosticTransaction
  /** Optional on legacy producers; constructors and route serialization always supply it. */
  retryable?: boolean
  escalation?: SceneDiagnosticEscalation
  /** @deprecated Use source.statementId and graph.authoringNodeId. */
  statementId?: string
  operation?: string
  signature?: string
  possibleCauses?: string[]
  howToFix?: string[]
  documentationHint?: string
  /** Assembled repair-slip text. Same payload for humans and agents. */
  repairSlip?: string
}

export interface PortContract {
  name: string
  type: string
  access?: PortAccess
  required?: boolean
  defaultValue?: unknown
  runtimePort?: string
  description?: string
  label?: string
  hidden?: boolean
  order?: number
  options?: string[]
  mode?: 'value' | 'parameter'
  /** Scene-level Control: collected by the Valley panel (S9). */
  control?: boolean
  /** Spatial protocol name when `type` is `any`. */
  runtimeType?: string
  parameterTarget?: { templateNodeId?: string; param: string }
}

/** A contract reserved for implementation details of a native group definition. */
export type DefinitionScope = 'any' | 'group-body'

export interface SemanticEffectContract {
  creates?: string[]
  modifies?: string[]
  deletes?: string[]
  outputRoles?: Record<string, string>
}

export interface RawPosition {
  x: number
  y: number
}

export interface RawTemplateNode {
  id: string
  opId: string
  name?: string
  position?: RawPosition
  params?: Record<string, unknown>
}

export interface RawTemplateEdge {
  id: string
  source: { nodeId: string; port: string }
  target: { nodeId: string; port: string }
}

export interface RawTemplatePort {
  portName: string
  portType?: string
  access?: PortAccess
  sourceNodeId: string
  sourcePortName: string
  hidden?: boolean
  order?: number
  customLabel?: string
  customLabelEn?: string
}

export interface RawTemplateGroup {
  id: string
  name?: string
  nameEn?: string
  nodes?: RawTemplateNode[]
  edges?: RawTemplateEdge[]
  position?: RawPosition
  exposedInputs?: RawTemplatePort[]
  exposedOutputs?: RawTemplatePort[]
  _nestedGroups?: RawTemplateGroup[]
}

export interface NodeFunctionContract {
  functionName: string
  kind: ContractKind
  contractVersion: string
  opId?: string
  definitionId?: string
  definitionVersion?: string
  /** Evidence-derived authoring status; omitted when no acceptance source is attached. */
  sceneScriptStatus?: 'legacy' | 'script-callable' | 'equivalence-verified'
  description: string
  agentVisible?: boolean
  definitionScope?: DefinitionScope
  runtimeDefaults?: Record<string, unknown>
  inputs: PortContract[]
  outputs: PortContract[]
  effects?: SemanticEffectContract
  deterministic?: boolean
  contextDependencies?: Array<'seed' | 'frame' | 'unit' | 'asset-version'>
  capabilities?: Partial<Record<ActorKind, GroupCapability[]>>
  definition?: RawTemplateGroup
  /** Project-local Generator source path, relative to the scene root. */
  sourceFile?: string
  sourceKind?: 'battery' | 'generator' | 'group'
}

/** A data-only contract for one runtime operation. */
export type AtomicNodeFunctionContract = NodeFunctionContract & {
  kind: 'atomic'
  opId: string
}

/** Static input accepted by defineAtomic; atomic is the only permitted explicit kind. */
export type AtomicNodeFunctionContractDefinition = Omit<NodeFunctionContract, 'kind' | 'opId'> & {
  kind?: 'atomic'
  opId: string
}

export type SceneLiteral = string | number | boolean | null

export type SceneExpression =
  | { kind: 'literal'; value: SceneLiteral }
  | { kind: 'reference'; binding: string; output?: string }
  /** A statically resolved Scene function used by a compiler builtin such as repeat. */
  | { kind: 'callable'; functionName: string }
  | { kind: 'array'; items: SceneExpression[] }
  | { kind: 'object'; properties: Record<string, SceneExpression> }

export interface SceneCallStatement {
  kind: 'call'
  statementId: string
  binding?: string
  functionName: string
  args: Record<string, SceneExpression>
  contractKind?: ContractKind
  source: SourceRange
}

export type ScenePortTypeName =
  | 'Scene'
  | 'NumberValue'
  | 'StringValue'
  | 'BooleanValue'
  | 'Grid'
  | 'Point2d'
  | 'Mesh'
  | 'NumberList'
  | 'StringList'
  | 'Any'
  | 'Plane'
  | 'WorkGrid'
  | 'RegionSet'
  | 'RoadNetwork'
  | 'ParcelSet'
  | 'PlacementSet'
  | 'Reserved'

export interface SceneGroupDefinitionMeta {
  id: string
  version: string
  inputs: Record<string, SceneDefinitionPort>
  outputs: Record<string, SceneDefinitionPort>
  /** Sealed definitions may only be expanded by actors with definition access. */
  sealed?: boolean
}

/** Static public port declaration for a native group Definition. */
export interface SceneDefinitionPort {
  type: ScenePortTypeName
  /** Exact runtime type when the portable Scene type catalog uses `Any`. */
  runtimeType?: string
  runtimePort?: string
  access?: PortAccess
  hidden?: boolean
  required?: boolean
  mode?: 'parameter' | 'value'
  label?: string
  description?: string
  order?: number
  labelEn?: string
  defaultValue?: SceneLiteral
}

/** A restricted, statically analyzable group definition authored in Scene Script. */
export interface SceneGroupDefinition {
  kind: 'group-definition'
  definitionId: string
  exportName: string
  meta: SceneGroupDefinitionMeta
  paramNames: string[]
  body: SceneCallStatement[]
  returnOutputs: Record<string, SceneExpression>
  source: SourceRange
}

export interface SceneImport {
  /** Local names retained for compatibility and canonical display. */
  names: string[]
  specifiers: Array<{
    imported: string
    local: string
  }>
  from: string
  source: SourceRange
}

export interface SceneExport {
  local: string
  exported: string
  source: SourceRange
}

export interface SceneModuleAst {
  moduleId: string
  file: string
  imports: SceneImport[]
  exports: SceneExport[]
  definitions: SceneGroupDefinition[]
  statements: SceneCallStatement[]
}

export interface SceneProjectAst {
  entryModuleId: string
  modules: Record<string, SceneModuleAst>
}

export interface SceneDefinitionPortProposal {
  name: string
  type: ScenePortTypeName
  runtimeType?: string
  access?: PortAccess
  sourceStatementId: string
  sourcePort: string
}

/** User-visible metadata proposed before an extract-definition transaction. */
export interface SceneDefinitionAuthoringMeta {
  name: string
  file: string
  definitionId: string
  version: string
  inputs: SceneDefinitionPortProposal[]
  outputs: SceneDefinitionPortProposal[]
  seal: boolean
  confirmed: boolean
}

export interface SceneAuthoringConfirmation {
  kind: 'extract-definition'
  commandIndex: number
  selectedStatementIds: string[]
  meta: SceneDefinitionAuthoringMeta
}

export interface SceneProjectModuleRevision {
  moduleId: string
  file: string
  revision: string
}

export interface SceneProjectRevision {
  revision: string
  modules: Record<string, SceneProjectModuleRevision>
}

export interface SceneModuleDependencyInfo {
  moduleId: string
  file: string
  dependencies: string[]
  dependents: string[]
  /** Changes only when the module's exported API changes. */
  publicSignatureHash: string
  /** Changes for any source-level semantic change in the module. */
  semanticHash: string
}

export interface SceneIncrementalCompileInfo {
  modules: Record<string, SceneModuleDependencyInfo>
  reparsedModuleIds: string[]
  invalidatedModuleIds: string[]
}

export interface ParseSceneModuleResult {
  module: SceneModuleAst
  diagnostics: SceneDiagnostic[]
}

export interface SourceMapEntry {
  moduleId: string
  file: string
  statementId: string
  source: SourceRange
  entityId: string
  runtimeNodeIds: string[]
  runtimeEdgeIds: string[]
  runtimeOrigins?: Record<string, string>
  runtimeEdgeOrigins?: Record<string, string>
  definitionId?: string
  definitionVersion?: string
  instancePath?: string
}

/** Stable, data-only provenance for one public runtime result and its projections. */
export interface ResultLineage {
  lineageId: string
  runtime: {
    nodeId: string
    port: string
    edgeIds?: string[]
  }
  authoring: {
    moduleId: string
    file: string
    statementId: string
    entityId: string
    source: SourceRange
    definitionId?: string
    definitionVersion?: string
    instancePath?: string
    runtimeOrigin?: string
  }
  sceneNodes: Array<{
    id: string
    path: string
    /** A result may contain several SceneGraphs; this keeps duplicate node ids unambiguous. */
    graphIndex?: number
  }>
  bakedLayers: Array<{
    id: string
    path: string
    sourceSceneNodeId?: string
    sourceScenePath?: string
    cellSource?: { kind: 'scene-node-content'; ref: string }
  }>
  summary: {
    sceneNodeCount: number
    bakedLayerCount: number
    /** Lineage deliberately never embeds SceneGraph/DataTree/voxel payloads. */
    payload: 'reference-only'
  }
}

/** Backward-compatible capture descriptor (kind is explicit; no payload guessing). */
export type ResultCaptureKind = 'sceneOutput'

export interface ResultCapture {
  entityId: string
  kind: ResultCaptureKind
  functionName: string
  opId: string
}

export interface CompiledSceneModule {
  module: SceneModuleAst
  ops: Op[]
  sourceMap: SourceMapEntry[]
  diagnostics: SceneDiagnostic[]
  entityIds: string[]
  /** Legacy entity id list derived from resultCaptures. */
  resultEntityIds: string[]
  /** Explicit capture kinds for canonical scene output. */
  resultCaptures: ResultCapture[]
}

export interface ContractRegistry {
  get(functionName: string): NodeFunctionContract | undefined
  list(): NodeFunctionContract[]
}
