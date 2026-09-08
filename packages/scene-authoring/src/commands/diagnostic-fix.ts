import type { ActorKind, ContractRegistry, SceneDiagnosticFix, SceneModuleAst } from '../model/types.js'
import { applyAuthoringCommands } from './apply-module.js'
import { commandDiagnostic } from './helpers.js'
import type { ApplyAuthoringCommandsResult, AuthoringCommand } from './types.js'

/** Minimal executable Fix path: reference rewrites reuse the canonical command transaction. */
export function applySceneDiagnosticFix(
  input: SceneModuleAst,
  fix: SceneDiagnosticFix,
  options: { actor: ActorKind; registry: ContractRegistry },
): ApplyAuthoringCommandsResult {
  const commands: AuthoringCommand[] = []
  for (const edit of fix.edits) {
    if (edit.type === 'ReplaceReference') {
      commands.push({
        type: 'connectValue',
        statementId: edit.statementId,
        input: edit.argument,
        sourceStatementId: edit.sourceStatementId,
        ...(edit.sourceOutput ? { output: edit.sourceOutput } : {}),
      })
      continue
    }
    return {
      module: input,
      applied: 0,
      diagnostics: [commandDiagnostic(
        'SCENE_FIX_SOURCE_EDIT_UNSUPPORTED',
        `Fix '${fix.fixId}' requires a source text edit; apply it through the source revision route.`,
        'capability',
      )],
    }
  }
  return applyAuthoringCommands(input, commands, options)
}
