// Loader — the battery (op) loader cluster that turns on-disk battery folders into kernel-registered OpSpecs. The kernel knows no ops at compile time; an op is just a directory holding a meta.json (its port/param/UI contract) plus an index.ts (its execute function), and plugins add ops by dropping such a folder under their scan dirs. As a layer1 sibling of datatree and asset-resolver, this cluster owns the disk → registry mechanism: it defines the meta.json shape and loader contract, a pure meta.json → OpSpec parser, and the scanning/dynamic-import/registration engine with optional chokidar hot-reload. Plugins call createBatteryLoader(registry, config) at boot, run scan() (or startWatching()), and subscribe to events to mirror the registry diff into their own UI metadata.

export { createBatteryLoader } from './battery-loader.js'
export { metaToOpSpec } from './meta-parser.js'
export type {
  BatteryLoader,
  BatteryLoaderConfig,
  BatteryMeta,
  BatteryMetaDynamicConfig,
  BatteryMetaParam,
  BatteryMetaPort,
  LoaderEvent,
  LoaderUnsubscribe,
  ScanError,
  ScanLayout,
  ScanResult,
} from './types.js'
