// Layer2 — the stable editing API every consumer drives the runtime through. Where
// layer1 is the headless kernel (registry, executor, storage, datatree), layer2 is the
// orchestration surface above it: a single atomic mutation entry (applyBatch), read-only
// queries, a background execution walker, group/import flows, a multi-project registry,
// and a subscribe-only event bus. Every UI component, AI agent, CLI command, and test
// goes through this barrel rather than touching layer1 storage directly, so the kernel
// can evolve caching/auth/projection behind a fixed contract.

export * from './apply-batch.js'
export * from './diff-pipeline.js'
export { attachGraphExternalSync, markGraphSelfWrite } from './graph-external-sync.js'
export * from './derive-group-ports.js'
export * from './group-reachability.js'
export * from './import-graph.js'
export * from './project-registry.js'
export * from './queries.js'
export * from './runtime.js'
export * from './subscriptions.js'
export * from './execute-node.js'
export * from './write-output.js'
export { createEventBus } from './event-bus.js'
export type { EventBus } from './event-bus.js'
