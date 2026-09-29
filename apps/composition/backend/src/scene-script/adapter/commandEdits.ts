import type { SourceEdit } from '@forgeax/scene'
import type { AuthoringCommand, SceneExpression } from '@forgeax/scene-authoring'

function expressionValue(expression: SceneExpression | undefined): string | number | boolean | undefined {
  if (!expression) return undefined
  if (expression.kind === 'literal') {
    const value = expression.value
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  }
  return undefined
}

function expressionBinding(expression: SceneExpression | undefined): string | undefined {
  if (expression?.kind === 'reference') return expression.binding
  return undefined
}

export function authoringCommandsToSourceEdits(commands: readonly AuthoringCommand[]): SourceEdit[] {
  const edits: SourceEdit[] = []
  for (const command of commands) {
    if (command.type === 'addCall') {
      const args: Record<string, unknown> = {}
      for (const [key, expression] of Object.entries(command.args ?? {})) {
        const value = expressionValue(expression)
        if (value !== undefined) args[key] = value
      }
      edits.push({
        type: 'insertCall',
        functionName: command.functionName,
        id: command.statementId ?? command.functionName,
        binding: command.binding,
        args,
        afterId: command.afterStatementId,
      })
      for (const [key, expression] of Object.entries(command.args ?? {})) {
        const binding = expressionBinding(expression)
        if (binding) {
          edits.push({
            type: 'connectBinding',
            id: command.statementId ?? command.functionName,
            arg: key,
            binding,
          })
        }
      }
      continue
    }
    if (command.type === 'addLiteral') {
      edits.push({
        type: 'insertLiteral',
        id: command.statementId ?? command.binding,
        binding: command.binding,
        value: command.value,
        afterId: command.afterStatementId,
      })
      continue
    }
    if (command.type === 'updateLiteral') {
      edits.push({ type: 'updateLiteral', id: command.statementId, value: command.value })
      continue
    }
    if (command.type === 'updateArguments') {
      for (const [key, expression] of Object.entries(command.set ?? {})) {
        const binding = expressionBinding(expression)
        const value = expressionValue(expression)
        if (binding) edits.push({ type: 'connectBinding', id: command.statementId, arg: key, binding })
        else if (value !== undefined) edits.push({ type: 'updateLiteral', id: command.statementId, path: [key], value })
      }
      for (const key of command.unset ?? []) {
        edits.push({ type: 'disconnectArg', id: command.statementId, arg: key })
      }
      continue
    }
    if (command.type === 'connectValue') {
      edits.push({
        type: 'connectBinding',
        id: command.statementId,
        arg: command.input,
        binding: command.sourceStatementId,
        output: command.output,
      })
      continue
    }
    if (command.type === 'disconnectValue') {
      edits.push({ type: 'disconnectArg', id: command.statementId, arg: command.input })
      continue
    }
    if (command.type === 'removeCall') {
      edits.push({ type: 'removeCall', id: command.statementId })
      continue
    }
    if (command.type === 'renameBinding') {
      edits.push({ type: 'renameBinding', id: command.statementId, binding: command.binding })
    }
  }
  return edits
}
