/**
 * 在线用户统计核心模块
 *
 * 设计要点：
 * - 每个浏览器标签页视为一个「访客会话」（sessionId 由前端 localStorage 持久化，
 *   同一浏览器多标签共享同一 sessionId，按 session 去重统计「独立访客」）。
 * - 传输层使用 WebSocket（/ws/presence）。心跳：前端每 20s 发 ping，服务端 45s 无消息判定掉线。
 * - 心跳超时兜底：即使 TCP 连接没正常关闭（断网、休眠），也不会永久计入在线数。
 * - 额外提供 SSE 与 HTTP 轮询两种降级通道，保证反向代理不支持 WS 时仍能工作。
 *
 * 统计口径：
 * - online      当前在线访客数（按 sessionId 去重）
 * - connections 当前活跃连接数（含同一访客多标签）
 * - peak        本次进程启动以来的在线峰值
 *
 * 纯内存实现，单实例部署够用；多实例需换 Redis，接口形状保持一致。
 */

export type PresenceClient = {
  id: string
  sessionId: string
  connectedAt: number
  lastSeenAt: number
  /** 最近一次上报的所在观测站 / 坐标 */
  focus?: string
  lat?: number
  lng?: number
  /** 客户端语言与设备信息 */
  lang?: string
  device?: 'desktop' | 'mobile' | 'tablet' | 'unknown'
  /** 用户代理（仅用于内部展示，不外泄原始 UA） */
  ua?: string
  /** 归属地区（由 CDN 头推断，可能为空） */
  region?: string
}

export type PresenceSnapshot = {
  online: number
  connections: number
  peak: number
  /** 近 10 分钟每分钟的在线数采样，用于绘制迷你趋势图 */
  timeline: number[]
  /** 会话平均在线时长（毫秒） */
  avgDurationMs: number
  timestamp: number
}

const HEARTBEAT_TIMEOUT_MS = 45_000
const SWEEP_INTERVAL_MS = 10_000
const TIMELINE_BUCKETS = 10
const TIMELINE_BUCKET_MS = 60_000

class PresenceStore {
  private clients = new Map<string, PresenceClient>()
  private peak = 0
  private startedAt = Date.now()
  private timeline: { at: number; value: number }[] = []
  private sweepTimer: NodeJS.Timeout | null = null
  private listeners = new Set<(snapshot: PresenceSnapshot) => void>()
  private lastBroadcastKey = ''

  constructor() {
    this.timeline = [{ at: Date.now(), value: 0 }]
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    // 常驻定时器不应阻止进程退出
    this.sweepTimer.unref?.()

    // 兜底广播：每 30s 无条件推一次，保证订阅端不会停留在陈旧数值
    const broadcastTimer = setInterval(() => {
      if (this.listeners.size) this.broadcastCurrent()
    }, 30_000)
    broadcastTimer.unref?.()
  }

  /** 建立连接 */
  add(params: {
    id: string
    sessionId: string
    ua?: string
    lang?: string
    region?: string
  }): PresenceClient {
    const now = Date.now()
    const client: PresenceClient = {
      id: params.id,
      sessionId: params.sessionId,
      connectedAt: now,
      lastSeenAt: now,
      ua: params.ua,
      lang: params.lang,
      region: params.region,
      device: detectDevice(params.ua),
    }
    this.clients.set(client.id, client)
    this.recomputePeak()
    this.emit()
    return client
  }

  /** 移除连接 */
  remove(id: string): void {
    if (this.clients.delete(id)) this.emit()
  }

  /** 心跳 / 状态上报 */
  touch(
    id: string,
    patch?: { focus?: string; lat?: number; lng?: number }
  ): void {
    const client = this.clients.get(id)
    if (!client) return
    client.lastSeenAt = Date.now()
    if (patch) {
      if (typeof patch.focus === 'string') client.focus = patch.focus.slice(0, 64)
      if (typeof patch.lat === 'number' && Number.isFinite(patch.lat)) client.lat = patch.lat
      if (typeof patch.lng === 'number' && Number.isFinite(patch.lng)) client.lng = patch.lng
    }
    this.emit()
  }

  get size(): number {
    return this.clients.size
  }

  /** 去重后的在线访客数 */
  onlineCount(): number {
    return new Set([...this.clients.values()].map((c) => c.sessionId)).size
  }

  snapshot(): PresenceSnapshot {
    const now = Date.now()
    const sessions = new Map<string, PresenceClient>()
    for (const c of this.clients.values()) {
      const prev = sessions.get(c.sessionId)
      if (!prev || prev.connectedAt > c.connectedAt) sessions.set(c.sessionId, c)
    }
    const list = [...sessions.values()]
    const avgDurationMs = list.length
      ? Math.round(list.reduce((sum, c) => sum + (now - c.connectedAt), 0) / list.length)
      : 0

    return {
      online: list.length,
      connections: this.clients.size,
      peak: this.peak,
      timeline: this.timelineValues(),
      avgDurationMs,
      timestamp: now,
    }
  }

  /** 供 /api/presence/visitors 使用的明细（脱敏：不含原始 UA） */
  visitors() {
    const now = Date.now()
    return [...this.clients.values()]
      .sort((a, b) => a.connectedAt - b.connectedAt)
      .map((c) => ({
        id: c.id.slice(0, 8),
        sessionId: c.sessionId.slice(0, 8),
        device: c.device ?? 'unknown',
        lang: c.lang ?? '—',
        region: c.region ?? '—',
        focus: c.focus ?? null,
        lat: c.lat ?? null,
        lng: c.lng ?? null,
        connectedAt: c.connectedAt,
        durationMs: now - c.connectedAt,
      }))
  }

  uptimeMs(): number {
    return Date.now() - this.startedAt
  }

  /** 订阅快照变化（WebSocket 广播用） */
  subscribe(fn: (snapshot: PresenceSnapshot) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** 主动触发一次广播（节流：数值未变则不重复推送） */
  private emit(force = false): void {
    this.snapshot() // 先推进时间轴采样
    const key = `${this.onlineCount()}/${this.clients.size}`
    if (!force && key === this.lastBroadcastKey) return
    this.lastBroadcastKey = key
    const snap = this.snapshot()
    this.notify(snap)
  }

  /** 无条件广播最新快照（定时兜底，防止任何漏推导致长期陈旧） */
  broadcastCurrent(): void {
    this.lastBroadcastKey = `${this.onlineCount()}/${this.clients.size}`
    this.notify(this.snapshot())
  }

  private notify(snap: PresenceSnapshot): void {
    for (const fn of this.listeners) {
      try {
        fn(snap)
      } catch {
        // 单个订阅者异常不应影响其他订阅者
      }
    }
  }

  private recomputePeak(): void {
    const online = this.onlineCount()
    if (online > this.peak) this.peak = online
  }

  /** 清理心跳超时的连接 */
  private sweep(): void {
    const deadline = Date.now() - HEARTBEAT_TIMEOUT_MS
    let removed = false
    for (const [id, c] of this.clients) {
      if (c.lastSeenAt < deadline) {
        this.clients.delete(id)
        removed = true
      }
    }
    if (removed) {
      // 超时清理后必须无条件广播，否则前端会停留在旧值上
      this.broadcastCurrent()
    }
  }

  /** 1 分钟粒度采样，保留最近 10 个点 */
  private timelineValues(): number[] {
    const now = Date.now()
    const last = this.timeline[this.timeline.length - 1]
    if (!last || now - last.at >= TIMELINE_BUCKET_MS) {
      this.timeline.push({ at: now, value: this.onlineCount() })
      while (this.timeline.length > TIMELINE_BUCKETS) this.timeline.shift()
    } else {
      last.value = this.onlineCount()
    }
    return this.timeline.map((p) => p.value)
  }
}

function detectDevice(ua?: string): PresenceClient['device'] {
  if (!ua) return 'unknown'
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet'
  if (/Mobile|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile'
  return 'desktop'
}

export const presence = new PresenceStore()
export const PRESENCE_HEARTBEAT_TIMEOUT_MS = HEARTBEAT_TIMEOUT_MS
