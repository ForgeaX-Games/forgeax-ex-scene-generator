/** Compile project-local `.generator.ts` files into sandboxed OpSpecs for this project. */
import { posix } from 'node:path'

import {
  artifactToOpSpec,
  compileGeneratorFile,
  writeGeneratorArtifact,
  type CompiledGeneratorArtifact,
} from '@forgeax/project-generator'
import {
  createSceneDiagnostic,
  type AtomicNodeFunctionContract,
  type SceneDiagnostic,
} from '@forgeax/scene-authoring'
import type { OverlayOpRegistry } from '@forgeax/node-runtime'

export interface CompiledProjectGenerators {
  contracts: AtomicNodeFunctionContract[]
  artifacts: CompiledGeneratorArtifact[]
  diagnostics: SceneDiagnostic[]
}

export function collectGeneratorImports(
  fromFile: string,
  imports: ReadonlyArray<{ from: string }>,
): string[] {
  return imports
    .filter((item) => item.from.startsWith('.') && item.from.endsWith('.generator.ts'))
    .map((item) => posix.normalize(posix.join(posix.dirname(fromFile), item.from)))
    .filter((file) => !file.split('/').includes('..'))
}

export async function compileProjectGenerators(
  projectDir: string,
  generatorFiles: readonly string[],
  sourceOverrides: Record<string, string> = {},
  overlay?: OverlayOpRegistry,
): Promise<CompiledProjectGenerators> {
  const diagnostics: SceneDiagnostic[] = []
  const artifacts: CompiledGeneratorArtifact[] = []
  const contracts: AtomicNodeFunctionContract[] = []
  const seenOpIds = new Set<string>()
  const seenNames = new Set<string>()
  for (const file of [...new Set(generatorFiles)].sort()) {
    const compiled = await compileGeneratorFile(`${projectDir}/scene`, file, sourceOverrides)
    diagnostics.push(...compiled.diagnostics)
    if (compiled.diagnostics.some((item) => item.severity === 'error')) continue
    for (const artifact of compiled.artifacts) {
      if (seenOpIds.has(artifact.opId) || seenNames.has(artifact.exportName)) {
        diagnostics.push(createSceneDiagnostic({
          code: 'GENERATOR_ID_CONFLICT',
          phase: 'compile',
          severity: 'error',
          message: `Project Generator '${artifact.exportName}' (${artifact.opId}) conflicts with another local Generator.`,
          source: { file, start: 0, end: 0, line: 1, column: 1 },
          operation: 'defineGenerator',
          possibleCauses: [
            'Two .generator.ts files use the same id.',
            'Two exports share the same function name.',
          ],
          howToFix: ['Rename one defineGenerator id or export so local/ ids are unique in this project.'],
        }))
        continue
      }
      seenOpIds.add(artifact.opId)
      seenNames.add(artifact.exportName)
      await writeGeneratorArtifact(projectDir, artifact)
      artifacts.push(artifact)
      contracts.push(artifact.contract)
      if (overlay) {
        const spec = artifactToOpSpec(projectDir, artifact)
        if (overlay.has(spec.id) && overlay.listLocal().some((item) => item.id === spec.id)) overlay.replace(spec)
        else overlay.register(spec)
      }
    }
  }
  return { contracts, artifacts, diagnostics }
}
