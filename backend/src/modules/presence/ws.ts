import { IncomingMessage, Server } from 'http'
import crypto from 'crypto'
import { Duplex } from 'stream'
import { presence, type PresenceSnapshot } from './store'
import { createLogger } from '../../config/logger'

const logger = createLogger('PresenceWS')

/**
 * 极简 RFC6455 WebSocket 服务端实现（仅支持文本帧）。
 *
 * 之所以不引入 `ws` 依赖：
 * 1. 本模块只需要「收文本消息 / 发文本消息 / 关闭」三种能力；
 * 2. 部署环境（含 GitHub Pages 静态托管之外的任意 Node 主机）无需额外安装包，
 *    也不会因新增依赖而拉长冷启动与构建时间。
 */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const OPCODE = {
  CONT: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
} as const

type WSConn = {
  id: string
  socket: Duplex
  alive: boolean
  buffer: Buffer
}

const conns = new Map<string, WSConn>()

/** 构造服务端 → 客户端的文本帧 */
function encodeFrame(payload: string, opcode: number = OPCODE.TEXT): Buffer {
  const data = Buffer.from(payload, 'utf8')
  const len = data.length
  let header: Buffer

  if (len < 126) {
    header = Buffer.alloc(2)
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  header[0] = 0x80 | opcode // FIN + opcode
  return Buffer.concat([header, data])
}

function send(conn: WSConn, payload: unknown, opcode?: number): void {
  if (conn.socket.destroyed) return
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  try {
    conn.socket.write(encodeFrame(text, opcode))
  } catch {
    // 写失败交由 close 事件清理
  }
}

function broadcast(payload: unknown): void {
  for (const conn of conns.values()) send(conn, payload)
}

/** 解出客户端帧（可能一次收到多帧，也可能半帧） */
function decodeFrames(conn: WSConn, chunk: Buffer): void {
  conn.buffer = Buffer.concat([conn.buffer, chunk])

  while (conn.buffer.length >= 2) {
    const b0 = conn.buffer[0]
    const b1 = conn.buffer[1]
    const fin = (b0 & 0x80) !== 0
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f
    let offset = 2

    if (len === 126) {
      if (conn.buffer.length < offset + 2) return
      len = conn.buffer.readUInt16BE(offset)
      offset += 2
    } else if (len === 127) {
      if (conn.buffer.length < offset + 8) return
      len = Number(conn.buffer.readBigUInt64BE(offset))
      offset += 8
    }

    const maskKey = masked ? conn.buffer.subarray(offset, offset + 4) : null
    if (masked) offset += 4

    if (conn.buffer.length < offset + len) return // 半包，等下一块数据

    let payload = conn.buffer.subarray(offset, offset + len)
    if (maskKey) {
      const out = Buffer.allocUnsafe(len)
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i % 4]
      payload = out
    }
    conn.buffer = conn.buffer.subarray(offset + len)

    if (!fin) continue // 本项目不使用分片消息

    switch (opcode) {
      case OPCODE.TEXT:
        handleMessage(conn, payload.toString('utf8'))
        break
      case OPCODE.CLOSE:
        closeConn(conn, 1000)
        return
      case OPCODE.PING:
        send(conn, payload.toString('utf8'), OPCODE.PONG)
        break
      case OPCODE.PONG:
        conn.alive = true
        break
      default:
        break
    }
  }
}

function handleMessage(conn: WSConn, raw: string): void {
  let msg: Record<string, unknown> | null = null
  try {
    msg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  if (!msg || typeof msg.type !== 'string') return

  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined

  switch (msg.type) {
    case 'hello':
      presence.touch(conn.id, {
        focus: typeof msg.focus === 'string' ? msg.focus : undefined,
        lat: num(msg.lat),
        lng: num(msg.lng),
      })
      send(conn, { type: 'welcome', id: conn.id, snapshot: presence.snapshot() })
      break
    case 'ping':
    case 'state':
      presence.touch(conn.id, {
        focus: typeof msg.focus === 'string' ? msg.focus : undefined,
        lat: num(msg.lat),
        lng: num(msg.lng),
      })
      send(conn, { type: 'pong', t: Date.now(), snapshot: presence.snapshot() })
      break
    default:
      break
  }
}

function closeConn(conn: WSConn, code = 1000): void {
  conns.delete(conn.id)
  presence.remove(conn.id)
  if (!conn.socket.destroyed) {
    try {
      const body = Buffer.alloc(2)
      body.writeUInt16BE(code, 0)
      conn.socket.write(encodeFrame(body.toString('binary'), OPCODE.CLOSE))
      conn.socket.end()
    } catch {
      // ignore
    }
  }
}

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

function parseCookies(cookie?: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!cookie) return out
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

/** 解析 URL 上的查询参数（升级请求里没有 body，参数全在 query） */
function parseQuery(req: IncomingMessage): URLSearchParams {
  const url = req.url ?? '/'
  const q = url.indexOf('?')
  return new URLSearchParams(q >= 0 ? url.slice(q + 1) : '')
}

export function setupPresenceWebSocket(server: Server): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    const path = (req.url ?? '').split('?')[0]
    // 同时接受 /ws/presence 与 /api/ws/presence：
    // 后者让开发环境（Vite 代理）与生产反代只需转发 /api 前缀即可承载 WebSocket
    if (path !== '/ws/presence' && path !== '/api/ws/presence') {
      socket.destroy()
      return
    }

    const key = readHeader(req, 'sec-websocket-key')
    if (!key) {
      socket.destroy()
      return
    }

    const accept = crypto
      .createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64')

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n')
    )

    const query = parseQuery(req)
    const cookie = parseCookies(readHeader(req, 'cookie'))
    // sessionId 优先取前端生成的持久化 ID，其次退回 cookie，最后随机
    const sessionId =
      query.get('sid') ||
      cookie['orbis_sid'] ||
      crypto.randomBytes(12).toString('hex')

    const id = crypto.randomBytes(8).toString('hex')
    const conn: WSConn = { id, socket, alive: true, buffer: Buffer.alloc(0) }
    conns.set(id, conn)

    const ua = readHeader(req, 'user-agent')
    const region =
      readHeader(req, 'cf-ipcountry') ??
      readHeader(req, 'x-vercel-ip-country') ??
      readHeader(req, 'x-country-code')

    presence.add({
      id,
      sessionId,
      ua,
      lang: parseLang(readHeader(req, 'accept-language')),
      region: region && region !== 'XX' ? region.toUpperCase() : undefined,
    })
    presence.touch(id, {
      focus: query.get('focus') ?? undefined,
      lat: query.get('lat') ? Number(query.get('lat')) : undefined,
      lng: query.get('lng') ? Number(query.get('lng')) : undefined,
    })

    logger.info({ id, online: presence.onlineCount() }, 'presence client connected')

    socket.on('data', (chunk: Buffer) => {
      try {
        decodeFrames(conn, chunk)
      } catch (err) {
        logger.warn({ err }, 'failed to decode websocket frame')
        closeConn(conn, 1002)
      }
    })
    socket.on('error', () => closeConn(conn, 1006))
    socket.on('close', () => {
      conns.delete(id)
      presence.remove(id)
    })

    send(conn, { type: 'welcome', id, snapshot: presence.snapshot() })
  })

  // 在线数变化时广播给所有连接
  presence.subscribe((snapshot: PresenceSnapshot) => {
    broadcast({ type: 'presence', snapshot })
  })

  // 服务端主动心跳，探测半开连接
  const ticker = setInterval(() => {
    for (const conn of conns.values()) {
      if (!conn.alive) {
        closeConn(conn, 1006)
        continue
      }
      conn.alive = false
      send(conn, 'hb', OPCODE.PING)
    }
  }, 25_000)
  ticker.unref?.()
}

function parseLang(header?: string): string | undefined {
  if (!header) return undefined
  return header.split(',')[0]?.split(';')[0]?.trim() || undefined
}
