// node serve.mjs <distDir> <port>  -> static SPA server that stays alive (for the repo's own UI verifications)
import { startServer } from './server.mjs'

const [dist, port = '8080'] = process.argv.slice(2)
const { url } = await startServer(dist, Number(port))
console.log(`serving ${dist} at ${url}`)
setInterval(() => {}, 1 << 30)
