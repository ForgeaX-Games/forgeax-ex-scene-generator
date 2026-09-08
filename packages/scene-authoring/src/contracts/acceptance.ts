import type { ContractRegistry, NodeFunctionContract } from '../model/types.js'

/**
 * Lifecycle of an authoring capability. This is deliberately derived from the
 * registered contract plus evidence, rather than copied into each battery's
 * `meta.json`, so palette labels cannot drift from compiler capability.
 */
export type SceneScriptStatus = 'legacy' | 'script-callable' | 'equivalence-verified'

export type AcceptanceGateId =
  | 'contract'
  | 'roundTrip'
  | 'graphWriteBack'
  | 'execute'
  | 'sourceMap'
  | 'capability'
  | 'visual'

export interface AcceptanceRecord {
  key: string
  functionName: string
  status: SceneScriptStatus
  passedGates: AcceptanceGateId[]
  missingGates: AcceptanceGateId[]
}

const requiredGates: AcceptanceGateId[] = [
  'contract',
  'roundTrip',
  'graphWriteBack',
  'execute',
  'sourceMap',
  'capability',
  'visual',
]

/**
 * The initial registry is intentionally conservative. A call may be legal
 * Scene Script while still lacking proof that all editing and execution paths
 * are equivalent. Callers can supply promoted records only after their tests
 * and visual acceptance are checked in.
 */
export class AcceptanceCoverageMatrix {
  private readonly promoted: ReadonlyMap<string, readonly AcceptanceGateId[]>

  constructor(promoted: Readonly<Record<string, readonly AcceptanceGateId[]>> = {}) {
    this.promoted = new Map(Object.entries(promoted))
  }

  static keyFor(contract: NodeFunctionContract): string {
    const identity = contract.kind === 'atomic' ? contract.opId : contract.functionName
    return `${contract.kind}:${identity ?? contract.functionName}`
  }

  record(contract: NodeFunctionContract | undefined, functionName: string): AcceptanceRecord {
    if (!contract) {
      return { key: `legacy:${functionName}`, functionName, status: 'legacy', passedGates: [], missingGates: requiredGates }
    }
    const key = AcceptanceCoverageMatrix.keyFor(contract)
    const passedGates = [...(this.promoted.get(key) ?? ['contract'])]
    const missingGates = requiredGates.filter((gate) => !passedGates.includes(gate))
    return {
      key,
      functionName,
      status: missingGates.length === 0 ? 'equivalence-verified' : 'script-callable',
      passedGates,
      missingGates,
    }
  }

  records(registry: ContractRegistry): AcceptanceRecord[] {
    return registry.list().map((contract) => this.record(contract, contract.functionName))
  }

  byOpId(registry: ContractRegistry): Map<string, AcceptanceRecord> {
    const output = new Map<string, AcceptanceRecord>()
    for (const contract of registry.list()) {
      if (!contract.opId) continue
      const record = this.record(contract, contract.functionName)
      const previous = output.get(contract.opId)
      // Multiple typed facades may share an opId (tree_merge); retain the
      // strongest status while exposing the first stable function name.
      if (!previous || previous.status === 'legacy') output.set(contract.opId, record)
    }
    return output
  }
}

export function sceneScriptStatusForContract(
  registry: ContractRegistry,
  functionName: string,
  matrix = new AcceptanceCoverageMatrix(),
): AcceptanceRecord {
  return matrix.record(registry.get(functionName), functionName)
}
