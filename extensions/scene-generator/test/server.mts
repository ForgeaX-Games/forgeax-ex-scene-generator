import { buildApp } from '../../../apps/composition/backend/src/main.js'

const app = await buildApp()
const address = await app.listen({ port: 0, host: '127.0.0.1' })
process.send!({ address })
process.on('message', async (message) => {
  if (message === 'close') {
    await app.close()
    process.disconnect()
  }
})
