import { rebuildScenePack } from './rebuild.js'
const directory = process.argv[2]
if (!directory)
  throw new Error('Usage: bun run pack:rebuild <exported-pack-directory>')
console.log(JSON.stringify(await rebuildScenePack(directory), null, 2))
