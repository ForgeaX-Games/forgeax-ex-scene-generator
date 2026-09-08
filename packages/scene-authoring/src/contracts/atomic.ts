import type {
  AtomicNodeFunctionContract,
  AtomicNodeFunctionContractDefinition,
  ContractKind,
  NodeFunctionContract,
} from '../model/types.js'

/**
 * Declares a static atomic-node contract.
 *
 * This helper only normalizes contract metadata. It does not accept or execute
 * an implementation callback.
 */
export function defineAtomic(
  definition: AtomicNodeFunctionContractDefinition,
): AtomicNodeFunctionContract {
  const candidate = definition as Omit<NodeFunctionContract, 'kind'> & {
    kind?: ContractKind
    opId?: string
  }

  if (candidate.kind !== undefined && candidate.kind !== 'atomic') {
    throw new TypeError(`defineAtomic only accepts kind 'atomic'; received '${candidate.kind}'`)
  }
  if (typeof candidate.opId !== 'string' || candidate.opId.trim().length === 0) {
    throw new TypeError('defineAtomic requires a non-empty opId')
  }

  return {
    ...definition,
    kind: 'atomic',
  }
}
