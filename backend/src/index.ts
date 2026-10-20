import { createServer } from 'http'
import { createApp } from './app'
import { env } from './config/env'
import { logger } from './config/logger'
import { setupPresenceWebSocket } from './modules/presence/ws'

const startServer = async () => {
  try {
    const app = createApp()

    // 用 http.Server 承载，才能在同一端口处理 WebSocket 升级请求
    const server = createServer(app)
    setupPresenceWebSocket(server)

    server.listen(env.PORT, () => {
      // Only show minimal startup info in development
      if (env.NODE_ENV === 'development') {
        console.log(`Server running on http://localhost:${env.PORT}${env.API_PREFIX}`)
        console.log(`Presence WebSocket on ws://localhost:${env.PORT}/ws/presence`)
      }
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server')
    process.exit(1)
  }
}

// Handle graceful shutdown silently
process.on('SIGTERM', async () => {
  process.exit(0)
})

process.on('SIGINT', async () => {
  process.exit(0)
})

startServer()
