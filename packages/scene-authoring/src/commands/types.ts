import type {
  SceneDefinitionAuthoringMeta,
  SceneDiagnostic,
  SceneExpression,
  SceneModuleAst,
  SceneProjectAst,
  SceneAuthoringConfirmation,
} from '../model/types.js'

export type AuthoringCommand =
  | {
      type: 'addCall'
      /** Explicit destination for project transactions. */
      moduleId?: string
      file?: string
      functionName: string
      binding?: string
      args?: Record<string, SceneExpression>
      afterStatementId?: string
      statementId?: string
    }
  | {
      type: 'addLiteral'
      moduleId?: string
      file?: string
      binding: string
      value: string | number | boolean
      afterStatementId?: string
      statementId?: string
    }
  | {
      type: 'updateLiteral'
      moduleId?: string
      file?: string
      statementId: string
      value: string | number | boolean
    }
  | {
      type: 'updateArguments'
      moduleId?: string
      file?: string
      statementId: string
      set?: Record<string, SceneExpression>
      unset?: string[]
    }
  | {
      type: 'connectValue'
      moduleId?: string
      file?: string
      statementId: string
      input: string
      sourceStatementId: string
      sourceModuleId?: string
      sourceFile?: string
      output?: string
      append?: boolean
    }
  | { type: 'disconnectValue'; moduleId?: string; file?: string; statementId: string; input: string; sourceStatementId?: string; sourceModuleId?: string; sourceFile?: string; output?: string }
  | { type: 'removeCall'; moduleId?: string; file?: string; statementId: string }
  | { type: 'renameBinding'; moduleId?: string; file?: string; statementId: string; binding: string }
  | {
      type: 'moveStatement'
      moduleId?: string
      file?: string
      statementId: string
      targetModuleId?: string
      targetFile?: string
      afterStatementId?: string
    }
  | (({ type: 'extractDefinition' } | { type: 'wrapInGroup' }) & {
      moduleId?: string
      file?: string
      statementIds: string[]
      meta?: Partial<SceneDefinitionAuthoringMeta>
    })
  | (({ type: 'inlineDefinition' } | { type: 'ungroup' }) & {
      moduleId?: string
      file?: string
      statementId: string
      strategy?: 'current-instance' | 'shared-definition'
    })
  | {
      type: 'setCapturedOutput'
      moduleId?: string
      file?: string
      statementId: string
      sourceStatementId: string
      output?: string
      input?: string
    }
  | {
      type: 'editSealedInternal'
      moduleId?: string
      file?: string
      statementId: string
      runtimeNodeId: string
      patch: Record<string, unknown>
    }

export interface ApplyAuthoringCommandsResult {
  module: SceneModuleAst
  diagnostics: SceneDiagnostic[]
  applied: number
}

export interface ApplyProjectAuthoringCommandsResult {
  project: SceneProjectAst
  diagnostics: SceneDiagnostic[]
  applied: number
  changedModuleIds: string[]
  confirmations: SceneAuthoringConfirmation[]
}
