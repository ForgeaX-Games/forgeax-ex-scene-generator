import type { ContractRegistry, GroupCapability, NodeFunctionContract } from '../model/types.js'

const AGENT_SEALED_CAPABILITIES: GroupCapability[] = [
  'instantiate',
  'configure',
  'connect',
  'move',
  'replace',
  'remove',
  'observeSummary',
]

const USER_GROUP_CAPABILITIES: GroupCapability[] = [
  ...AGENT_SEALED_CAPABILITIES,
  'inspectDefinition',
  'editInstanceOverride',
]

export function sealGroupContract(contract: NodeFunctionContract): NodeFunctionContract {
  if (contract.kind === 'atomic') return contract
  return {
    ...contract,
    capabilities: {
      ...contract.capabilities,
      agent: contract.capabilities?.agent ?? [...AGENT_SEALED_CAPABILITIES],
      user: contract.capabilities?.user ?? [...USER_GROUP_CAPABILITIES],
      'template-maintainer': contract.capabilities?.['template-maintainer'] ?? [
        ...USER_GROUP_CAPABILITIES,
        'editDefinition',
        'connectInternalPort',
      ],
      compiler: contract.capabilities?.compiler ?? [
        ...USER_GROUP_CAPABILITIES,
        'editDefinition',
        'connectInternalPort',
      ],
    },
  }
}

export class SceneContractRegistry implements ContractRegistry {
  readonly #contracts = new Map<string, NodeFunctionContract>()

  constructor(contracts: NodeFunctionContract[] = []) {
    for (const contract of contracts) this.register(contract)
  }

  register(contract: NodeFunctionContract): void {
    const normalized = sealGroupContract(contract)
    if (this.#contracts.has(normalized.functionName)) {
      throw new Error(`duplicate scene function contract: ${normalized.functionName}`)
    }
    if (normalized.kind === 'atomic' && !normalized.opId) {
      throw new Error(`atomic scene function '${normalized.functionName}' requires opId`)
    }
    if (normalized.kind !== 'atomic' && (!normalized.definitionId || !normalized.definition)) {
      throw new Error(`group scene function '${normalized.functionName}' requires definitionId and definition`)
    }
    this.#contracts.set(normalized.functionName, normalized)
  }

  get(functionName: string): NodeFunctionContract | undefined {
    return this.#contracts.get(functionName)
  }

  list(): NodeFunctionContract[] {
    return [...this.#contracts.values()]
  }
}

export function hasGroupCapability(
  contract: NodeFunctionContract,
  actor: keyof NonNullable<NodeFunctionContract['capabilities']>,
  capability: GroupCapability,
): boolean {
  if (contract.kind === 'atomic') return true
  return contract.capabilities?.[actor]?.includes(capability) ?? false
}

/**
 * Resolve a runtime atomic node back to its canonical Scene function. Dynamic
 * ops such as tree_merge must match their declared runtime specialization;
 * silently choosing the first facade would corrupt graph-to-script write-back.
 */
export function resolveAtomicContract(
  registry: ContractRegistry,
  opId: string,
  runtimeParams: Readonly<Record<string, unknown>> = {},
): NodeFunctionContract | undefined {
  const candidates = registry.list().filter((contract) => contract.kind === 'atomic' && contract.opId === opId)
  if (candidates.length <= 1) return candidates[0]
  const matches = candidates.filter((contract) => {
    const discriminator = contract.runtimeDefaults ?? {}
    const entries = Object.entries(discriminator).filter(([key]) => key.startsWith('inferred'))
    return entries.length > 0 && entries.every(([key, value]) => runtimeParams[key] === value)
  })
  return matches.length === 1 ? matches[0] : undefined
}
