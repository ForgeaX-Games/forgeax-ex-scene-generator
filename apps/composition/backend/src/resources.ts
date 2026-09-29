import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Both source backend/src and bundled dist/server are two levels below the app.
export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const isPackaged = process.env.FORGEAX_SCENE_PACKAGED === '1'
