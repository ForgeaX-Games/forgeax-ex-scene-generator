import type { OpSpec } from '@forgeax/node-runtime'
import { join } from 'node:path'

import type { CompiledGeneratorArtifact } from './compile.js'
import { runGeneratorSandbox } from './sandbox/host.js'

function seedFromArgs(args: Record<string, unknown>): number {
  const raw = args.seed
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  return 1
}

export function artifactToOpSpec(projectDir: string, artifact: CompiledGeneratorArtifact): OpSpec {
  const bundlePath = join(projectDir, 'state', 'generators', artifact.definitionId, 'bundle.js')
  return {
    id: artifact.opId,
    name: artifact.exportName,
    description: artifact.contract.description,
    inputs: artifact.contract.inputs.map((input) => ({
      name: input.name,
      type: input.type,
      required: input.required,
      default: input.defaultValue as never,
      description: input.description,
      label: input.label,
      access: input.access,
    })),
    outputs: artifact.contract.outputs.map((output) => ({
      name: output.name,
      type: output.type,
      description: output.description,
      label: output.label,
      access: output.access,
    })),
    params: [],
    implementationRevision: artifact.implementationRevision,
    execute: async (ctx, args) => {
      const result = await runGeneratorSandbox({
        bundlePath,
        exportName: artifact.exportName,
        args,
        seed: seedFromArgs(args),
        ctx,
      })
      if (!result.ok) throw new Error(result.error ?? 'Generator sandbox failed.')
      return result.value
    },
  }
}
