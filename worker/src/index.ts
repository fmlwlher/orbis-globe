/**
 * ORBIS 在线统计服务 —— Cloudflare Workers 版
 *
 * 与 Express 版（backend/）接口完全一致，前端无需改动：
 *   GET  /api/presence            统计快照
 *   GET  /api/presence/visitors   在线访客明细（脱敏）
 *   GET  /api/presence/stream     SSE 流
 *   POST /api/presence/heartbeat  轮询上报
 *   WS   /api/ws/presence         实时推送（Hibernation）
 *   GET  /api/health              健康检查
 *
 * 架构要点：
 * - 全局只有一个 Durable Object 实例（名字固定为 "global"），作为在线状态的唯一权威点
 * - 使用 WebSocket Hibernation API：连接空闲时 DO 会被驱逐，不产生时长费用，
 *   客户端连接保持不断；有新消息时 DO 自动重建
 * - 因休眠会清空内存，峰值与趋势等跨会话数据写入 storage（持久化）
 * - 每个连接的身份信息（sessionId/设备等）通过 serializeAttachment 存在连接上，
 *   休眠唤醒后仍可恢复，无需额外存储
 */

import { DurableObject } from 'cloudflare:workers'

export interface Env {
  PRESENCE: DurableObjectNamespace<PresenceRoom>
}

const HEARTBEAT_TIMEOUT_MS = 45_000
const TIMELINE_BUCKETS = 10
const TIMELINE_BUCKET_MS = 60_000

export type PresenceSnapshot = {
  online: number
  connections: number
  peak: number
  timeline: number[]
  avgDurationMs: number
  timestamp: number
}

type Attachment = {
  sessionId: string
  connectedAt: number
  lastSeenAt: number
  focus?: string
  lat?: number
  lng?: number
  lang?: string
  device?: string
  region?: string
}

function detectDevice(ua?: string | null): string {
  if (!ua) return 'unknown'
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet'
  if (/Mobile|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile'
  return 'desktop'
}

function parseLang(header?: string | null): string | undefined {
  if (!header) return undefined
  return header.split(',')[0]?.split(';')[0]?.trim() || undefined
}

// ── Durable Object：在线状态聚合 ─────────────────────────────
export class PresenceRoom extends DurableObject<Env> {
  /** 峰值与时间轴缓存在内存，写入 storage 以便休眠后恢复 */
  private peak = 0
  private timeline: { at: number; value: number }[] = []
  private hydrated = false

  private async hydrate(): Promise<void> {
    if (this.hydrated) return
    this.hydrated = true
    const stored = await this.ctx.storage.get<{ peak: number; timeline: { at: number; value: number }[] }>(
      'meta'
    )
    if (stored) {
      this.peak = stored.peak ?? 0
      this.timeline = stored.timeline ?? []
    }
    if (!this.timeline.length) this.timeline = [{ at: Date.now(), value: 0 }]
  }

  private async persistMeta(): Promise<void> {
    await this.ctx.storage.put('meta', { peak: this.peak, timeline: this.timeline })
  }

  // ── 连接生命周期 ───────────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    await this.hydrate()
    const url = new URL(request.url)

    // 非升级请求：返回快照（供 Worker 内部调用）
    if (request.headers.get('Upgrade') !== 'websocket') {
      return Response.json(await this.snapshot())
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // 关键：用 ctx.acceptWebSocket 而非 ws.accept，才能让 DO 休眠
    this.ctx.acceptWebSocket(server)

    const now = Date.now()
    const attachment: Attachment = {
      sessionId: url.searchParams.get('sid') || crypto.randomUUID(),
      connectedAt: now,
      lastSeenAt: now,
      focus: url.searchParams.get('focus') ?? undefined,
      lat: numOrUndef(url.searchParams.get('lat')),
      lng: numOrUndef(url.searchParams.get('lng')),
      lang: parseLang(request.headers.get('accept-language')),
      device: detectDevice(request.headers.get('user-agent')),
      region:
        request.headers.get('cf-ipcountry') && request.headers.get('cf-ipcountry') !== 'XX'
          ? request.headers.get('cf-ipcountry')!.toUpperCase()
          : undefined,
    }
    server.serializeAttachment(attachment)

    this.sweepStale()
    await this.bumpPeak()

    // 推送当前快照给新连接，并广播给其他人
    server.send(JSON.stringify({ type: 'welcome', snapshot: await this.snapshot() }))
    this.broadcast(await this.snapshot(), server)

    // 兜底闹钟：保证休眠唤醒后仍能清理超时连接
    await this.ctx.storage.setAlarm(Date.now() + 30_000)

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.hydrate()
    const att = ws.deserializeAttachment() as Attachment | null
    if (!att) return
    att.lastSeenAt = Date.now()

    if (typeof message === 'string') {
      try {
        const msg = JSON.parse(message) as Record<string, unknown>
        if (typeof msg.focus === 'string') att.focus = msg.focus.slice(0, 64)
        if (typeof msg.lat === 'number' && Number.isFinite(msg.lat)) att.lat = msg.lat
        if (typeof msg.lng === 'number' && Number.isFinite(msg.lng)) att.lng = msg.lng

        if (msg.type === 'ping' || msg.type === 'hello' || msg.type === 'state') {
          ws.serializeAttachment(att)
          ws.send(JSON.stringify({ type: 'pong', t: Date.now(), snapshot: await this.snapshot() }))
          return
        }
      } catch {
        // 非法消息忽略
      }
    }
    ws.serializeAttachment(att)
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason)
    } catch {
      // 已关闭则忽略
    }
    // 兜底闹钟：运行时可能还没把该连接从 getWebSockets() 摘除，
    // 由 alarm 在稍后再算一次，保证最终广播的是准确人数
    await this.ctx.storage.setAlarm(Date.now() + 200)
    this.broadcast(await this.snapshot())
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('presence ws error', error)
    try {
      ws.close(1011)
    } catch {
      // ignore
    }
  }

  /** 定时清理超时连接（负责休眠期间的兜底） */
  async alarm(): Promise<void> {
    await this.hydrate()
    const removed = this.sweepStale()
    if (removed) this.broadcast(await this.snapshot())
    if (this.ctx.getWebSockets().length) {
      await this.ctx.storage.setAlarm(Date.now() + 30_000)
    }
  }

  // ── 统计计算 ───────────────────────────────────────────
  private liveAttachments(): { ws: WebSocket; att: Attachment }[] {
    const out: { ws: WebSocket; att: Attachment }[] = []
    for (const ws of this.ctx.getWebSockets()) {
      // 关闭中的连接可能仍留在 getWebSockets() 里，需显式排除，
      // 否则刚有人离开时广播出去的人数会偏大一拍
      if (ws.readyState !== WebSocket.OPEN) continue
      const att = ws.deserializeAttachment() as Attachment | null
      if (att) out.push({ ws, att })
    }
    return out
  }

  /** 心跳超时清理，返回是否清掉了连接 */
  private sweepStale(): boolean {
    const deadline = Date.now() - HEARTBEAT_TIMEOUT_MS
    let removed = false
    for (const { ws, att } of this.liveAttachments()) {
      if (att.lastSeenAt < deadline) {
        try {
          ws.close(4000, 'heartbeat timeout')
        } catch {
          // ignore
        }
        removed = true
      }
    }
    return removed
  }

  private pushTimeline(online: number): void {
    const now = Date.now()
    const last = this.timeline[this.timeline.length - 1]
    if (!last || now - last.at >= TIMELINE_BUCKET_MS) {
      this.timeline.push({ at: now, value: online })
      while (this.timeline.length > TIMELINE_BUCKETS) this.timeline.shift()
    } else {
      last.value = online
    }
  }

  private async bumpPeak(): Promise<void> {
    const online = this.onlineCount()
    if (online > this.peak) {
      this.peak = online
      await this.persistMeta()
    }
  }

  /** 按 sessionId 去重得到独立访客数 */
  private onlineCount(): number {
    return new Set(this.liveAttachments().map(({ att }) => att.sessionId)).size
  }

  async snapshot(): Promise<PresenceSnapshot> {
    await this.hydrate()
    const now = Date.now()
    const list = this.liveAttachments()
    const sessions = new Map<string, Attachment>()
    for (const { att } of list) {
      const prev = sessions.get(att.sessionId)
      if (!prev || prev.connectedAt > att.connectedAt) sessions.set(att.sessionId, att)
    }
    const unique = [...sessions.values()]
    const online = unique.length

    this.pushTimeline(online)
    if (online > this.peak) this.peak = online

    return {
      online,
      connections: list.length,
      peak: this.peak,
      timeline: this.timeline.map((p) => p.value),
      avgDurationMs: unique.length
        ? Math.round(unique.reduce((s, a) => s + (now - a.connectedAt), 0) / unique.length)
        : 0,
      timestamp: now,
    }
  }

  async visitors() {
    await this.hydrate()
    const now = Date.now()
    return this.liveAttachments()
      .sort((a, b) => a.att.connectedAt - b.att.connectedAt)
      .map(({ att }) => ({
        id: att.sessionId.slice(0, 8),
        device: att.device ?? 'unknown',
        lang: att.lang ?? '—',
        region: att.region ?? '—',
        focus: att.focus ?? null,
        lat: att.lat ?? null,
        lng: att.lng ?? null,
        connectedAt: att.connectedAt,
        durationMs: now - att.connectedAt,
      }))
  }

  /** 广播快照，可排除某个连接（避免新连接收到两次） */
  private broadcast(snapshot: PresenceSnapshot, exclude?: WebSocket): void {
    const payload = JSON.stringify({ type: 'presence', snapshot })
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue
      try {
        ws.send(payload)
      } catch {
        // 连接已失效，忽略
      }
    }
  }
}

function numOrUndef(v: string | null): number | undefined {
  if (v === null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// ── Worker 入口：路由 + CORS ────────────────────────────────
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(),
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    // 健康检查
    if (path === '/api/health' || path === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() })
    }

    // 所有在线统计请求都转发到唯一的 DO 实例
    const stub = env.PRESENCE.get(env.PRESENCE.idFromName('global'))

    // WebSocket 升级
    if (path === '/api/ws/presence' || path === '/ws/presence') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return json({ status: 'error', message: 'Expected Upgrade: websocket' }, 426)
      }
      return stub.fetch(request)
    }

    if (path === '/api/presence' && request.method === 'GET') {
      const snap = await stub.snapshot()
      return json({ ...snap, heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS })
    }

    if (path === '/api/presence/visitors' && request.method === 'GET') {
      const snap = await stub.snapshot()
      return json({ online: snap.online, connections: snap.connections, visitors: await stub.visitors() })
    }

    // SSE：把 DO 的快照以流式方式定时推送
    if (path === '/api/presence/stream' && request.method === 'GET') {
      const encoder = new TextEncoder()
      let timer: ReturnType<typeof setInterval> | undefined

      const stream = new ReadableStream({
        async start(controller) {
          const push = async () => {
            try {
              const snap = await stub.snapshot()
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(snap)}\n\n`))
            } catch {
              // DO 暂时不可用时跳过本轮
            }
          }
          await push()
          timer = setInterval(push, 5000)
        },
        cancel() {
          if (timer) clearInterval(timer)
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          ...corsHeaders(),
        },
      })
    }

    // 轮询上报（SSE/WS 都不可用时）
    if (path === '/api/presence/heartbeat' && request.method === 'POST') {
      return json(await stub.snapshot())
    }

    if (path === '/' ) {
      return json({
        name: 'orbis-presence-api',
        runtime: 'cloudflare-workers',
        endpoints: [
          'GET /api/presence',
          'GET /api/presence/visitors',
          'GET /api/presence/stream',
          'WS  /api/ws/presence',
          'GET /api/health',
        ],
      })
    }

    return json({ status: 'error', message: 'Not Found' }, 404)
  },
} satisfies ExportedHandler<Env>
