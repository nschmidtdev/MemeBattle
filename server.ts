import './src/lib/polyfills' // must stay first: Next.js needs the AsyncLocalStorage global before it loads
import './src/lib/env' // second: loads .env* before src/lib/config reads process.env
import http from 'http'
import { parse } from 'node:url'
import next from 'next'
import { Server } from 'socket.io'
import { config } from './src/lib/config'
import { initSockets } from './src/server/io'
import { ensureAdmin } from './src/lib/admin'
import { prisma } from './src/lib/prisma'

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })

/** Origin check for Socket.io handshakes (browsers also enforce CORS before this). */
function isOriginAllowed(origin: string | undefined, host: string | undefined): boolean {
  // Non-browser clients may omit Origin; browsers always send it on WebSocket
  // handshakes. Requests without an Origin header are allowed, as before.
  if (!origin) return true
  if (config.corsAllowAll) return true

  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  // Same-origin is always trusted, even when an explicit allowlist is set.
  if (host && url.host.toLowerCase() === host.toLowerCase()) return true

  return config.corsOrigins.includes(url.origin)
}

function socketCorsOptions() {
  if (config.corsAllowAll) return { origin: true, methods: ['GET', 'POST'] }
  if (config.corsOrigins.length > 0) return { origin: config.corsOrigins, methods: ['GET', 'POST'] }
  // Same-origin only: browsers do not need CORS response headers for that.
  return undefined
}

async function main() {
  await app.prepare()
  await ensureAdmin()

  const handle = app.getRequestHandler()
  const server = http.createServer((req, res) => handle(req, res, parse(req.url!, true)))
  const io = new Server(server, {
    cors: socketCorsOptions(),
    allowRequest: (req, callback) => {
      callback(null, isOriginAllowed(req.headers.origin, req.headers.host))
    },
  })
  const stop = initSockets(io)

  server.on('error', (err) => {
    console.error('HTTP server error:', err)
    process.exit(1)
  })

  server.listen(config.port, () => {
    console.log(`meme-battle listening on http://localhost:${config.port} (${dev ? 'dev' : 'production'})`)
  })

  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Received ${signal}, shutting down...`)

    const forceExit = setTimeout(() => {
      console.error('Shutdown timed out after 10s, forcing exit.')
      process.exit(1)
    }, 10_000)

    try {
      stop()
    } catch (err) {
      console.error('Socket cleanup failed:', err)
    }

    io.close().catch((err) => console.error('Socket.io close failed:', err))

    const finish = async () => {
      try {
        await prisma.$disconnect()
      } catch (err) {
        console.error('Prisma disconnect failed:', err)
      }
      clearTimeout(forceExit)
      process.exit(0)
    }

    // `io.close()` also closes the attached HTTP server; calling `close()`
    // explicitly is harmless and covers a future detached setup.
    server.close((err) => {
      if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        console.error('HTTP server close failed:', err)
      }
      void finish()
    })
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
