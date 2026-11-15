import './src/lib/polyfills' // must stay first: Next.js needs the AsyncLocalStorage global before it loads
import http from 'http'
import { parse } from 'node:url'
import next from 'next'
import { Server } from 'socket.io'
import { config } from './src/lib/config'
import { initSockets } from './src/server/io'
import { ensureAdmin } from './src/lib/admin'

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })

async function main() {
  await app.prepare()
  await ensureAdmin()

  const handle = app.getRequestHandler()
  const server = http.createServer((req, res) => handle(req, res, parse(req.url!, true)))
  const io = new Server(server, {
    cors: { origin: config.corsOrigin, methods: ['GET', 'POST'] },
  })
  initSockets(io)

  server.listen(config.port, () => {
    console.log(`meme-battle listening on http://localhost:${config.port} (${dev ? 'dev' : 'production'})`)
  })
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
