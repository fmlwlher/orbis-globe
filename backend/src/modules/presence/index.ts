import { Request, Response, Router } from 'express'
import { presence, PRESENCE_HEARTBEAT_TIMEOUT_MS } from './store.js'
import { createLogger } from '../../config/logger.js'

const logger = createLogger('PresenceRouter')

export const presenceRouter: Router = Router()

/**
 * 在线统计快照（轮询 / 首屏兜底）
 * GET /api/presence
 */
presenceRouter.get('/', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store')
  res.json({
    ...presence.snapshot(),
    heartbeatTimeoutMs: PRESENCE_HEARTBEAT_TIMEOUT_MS,
    uptimeMs: presence.uptimeMs(),
  })
})

/**
 * 在线访客明细（脱敏）
 * GET /api/presence/visitors
 */
presenceRouter.get('/visitors', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store')
  const snapshot = presence.snapshot()
  res.json({
    online: snapshot.online,
    connections: snapshot.connections,
    visitors: presence.visitors(),
  })
})

/**
 * SSE 降级通道：反向代理不支持 WebSocket 时可改用此接口
 * GET /api/presence/stream
 */
presenceRouter.get('/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const push = () => {
    res.write(`data: ${JSON.stringify(presence.snapshot())}\n\n`)
  }
  push()

  const unsubscribe = presence.subscribe(push)
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 20_000)

  req.on('close', () => {
    clearInterval(keepAlive)
    unsubscribe()
  })
})

/**
 * 轻量上报：SSE / WS 都不可用时，前端可定时上报自身状态
 * POST /api/presence/heartbeat
 */
presenceRouter.post('/heartbeat', (req: Request, res: Response) => {
  const { clientId, focus, lat, lng } = req.body ?? {}
  if (typeof clientId !== 'string' || !clientId) {
    res.status(400).json({ status: 'error', message: 'clientId is required' })
    return
  }
  presence.touch(clientId, {
    focus: typeof focus === 'string' ? focus : undefined,
    lat: typeof lat === 'number' ? lat : undefined,
    lng: typeof lng === 'number' ? lng : undefined,
  })
  res.set('Cache-Control', 'no-store')
  res.json(presence.snapshot())
})

logger.debug('presence router mounted')
