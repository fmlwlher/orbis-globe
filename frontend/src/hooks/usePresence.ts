import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 在线人数订阅 Hook
 *
 * 通道优先级（自动降级）：
 *   1. WebSocket  /ws/presence        —— 实时推送，延迟最低
 *   2. SSE        /api/presence/stream —— 代理不支持 WS 时
 *   3. 轮询       /api/presence        —— 最差网络兜底
 *   4. 本地模拟   —— 后端不可达（如 GitHub Pages 纯静态托管）时，
 *                    仅展示本机且在线的演示值，并标注「离线模式」
 *
 * 所有状态放在模块级 store 中，多个组件订阅同一份数据，避免重复建连。
 */

export type PresenceSnapshot = {
  online: number
  connections: number
  peak: number
  timeline: number[]
  avgDurationMs: number
  timestamp: number
}

export type PresenceChannel = 'connecting' | 'websocket' | 'sse' | 'polling' | 'offline'

export type PresenceState = {
  snapshot: PresenceSnapshot
  channel: PresenceChannel
}

const SESSION_KEY = 'orbis:session-id'
const HEARTBEAT_MS = 20_000

const EMPTY: PresenceSnapshot = {
  online: 0,
  connections: 0,
  peak: 0,
  timeline: [0],
  avgDurationMs: 0,
  timestamp: Date.now(),
}

/** 会话 ID：同一浏览器多标签共享，用于服务端去重统计独立访客 */
function getSessionId(): string {
  try {
    const saved = localStorage.getItem(SESSION_KEY)
    if (saved) return saved
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '')
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem(SESSION_KEY, id)
    return id
  } catch {
    // 隐私模式：退化为内存级 ID（刷新后变化，可接受）
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
}

type Store = {
  state: PresenceState
  listeners: Set<() => void>
  socket: WebSocket | null
  es: EventSource | null
  pollTimer: number | null
  pingTimer: number | null
  retry: number
  started: boolean
  sessionId: string
  focus: string | undefined
  coord: { lat: number; lng: number } | null
}

const store: Store = {
  state: { snapshot: EMPTY, channel: 'connecting' },
  listeners: new Set(),
  socket: null,
  es: null,
  pollTimer: null,
  pingTimer: null,
  retry: 0,
  started: false,
  sessionId: '',
  focus: undefined,
  coord: null,
}

function setState(next: Partial<PresenceState>) {
  store.state = { ...store.state, ...next }
  store.listeners.forEach((l) => l())
}

function setSnapshot(snapshot: PresenceSnapshot) {
  // 单调保护：轮询/推送可能乱序，旧的快照不覆盖新的
  if (snapshot.timestamp && snapshot.timestamp < store.state.snapshot.timestamp) return
  setState({ snapshot })
}

/** 后端可达性探测：决定走实时通道还是离线演示 */
async function probeBackend(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3500)
    const res = await fetch(apiUrl('presence'), {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timer)
    if (!res.ok) return false
    const data = (await res.json()) as PresenceSnapshot
    if (typeof data?.online !== 'number') return false
    setSnapshot(data)
    return true
  } catch {
    return false
  }
}

/**
 * 后端基地址解析
 *
 * - 本地开发（Vite）：留空，走同源 /api，由 dev server 代理到 localhost:3000
 * - GitHub Pages 等纯静态托管：构建时注入 VITE_API_BASE_URL 指向外部 Node 服务
 *   形如 https://orbis-api.onrender.com  （不带结尾斜杠，可含 /api 也可不含）
 *
 * 返回值为「可直接拼接 /presence 等路径」的前缀（含 /api）。
 */
const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')

/** REST 前缀，如 "" → "/api"；"https://x.com" → "https://x.com/api" */
const API_PREFIX = RAW_API_BASE ? `${RAW_API_BASE}/api` : '/api'

/** 拼 REST 路径：apiUrl('presence') → "/api/presence" 或 "https://x.com/api/presence" */
function apiUrl(path: string): string {
  return `${API_PREFIX}/${path.replace(/^\/+/, '')}`
}

/** WebSocket 地址：同源时用当前 host，跨域时把 API base 的 http(s) 换成 ws(s) */
function wsUrl(): string {
  const params = new URLSearchParams({ sid: store.sessionId })
  if (store.focus) params.set('focus', store.focus)
  if (store.coord) {
    params.set('lat', String(store.coord.lat))
    params.set('lng', String(store.coord.lng))
  }

  let origin = window.location.host
  let proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

  if (RAW_API_BASE) {
    // 外部后端：从绝对地址推导 ws 源
    const u = new URL(RAW_API_BASE)
    origin = u.host
    proto = u.protocol === 'https:' ? 'wss:' : 'ws:'
  }

  // 统一走 /api/ws/presence：开发时由 Vite 代理（ws: true），
  // 生产时由后端直接响应（后端同时接受 /ws/presence 与 /api/ws/presence）
  return `${proto}//${origin}/api/ws/presence?${params.toString()}`
}

function startPing(send: () => void) {
  stopPing()
  store.pingTimer = window.setInterval(send, HEARTBEAT_MS)
}

function stopPing() {
  if (store.pingTimer !== null) {
    window.clearInterval(store.pingTimer)
    store.pingTimer = null
  }
}

function startPolling() {
  stopPolling()
  setState({ channel: 'polling' })
  // 轮询模式下必须同时上报自身，否则服务端无从得知本访客在线（online 会恒为 0）
  const beacon = async () => {
    try {
      await fetch(apiUrl('presence/heartbeat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: store.sessionId,
          focus: store.focus,
          lat: store.coord?.lat,
          lng: store.coord?.lng,
        }),
      })
    } catch {
      // 上报失败不阻断取数，下一轮会重试
    }
  }
  const tick = async () => {
    try {
      const res = await fetch(apiUrl('presence'), { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(String(res.status))
      setSnapshot((await res.json()) as PresenceSnapshot)
      void beacon()
    } catch {
      setState({ channel: 'offline' })
    }
  }
  void tick()
  store.pollTimer = window.setInterval(tick, 12_000)
}

function stopPolling() {
  if (store.pollTimer !== null) {
    window.clearInterval(store.pollTimer)
    store.pollTimer = null
  }
}

function connectWebSocket() {
  try {
    const socket = new WebSocket(wsUrl())
    store.socket = socket

    socket.onopen = () => {
      store.retry = 0
      setState({ channel: 'websocket' })
      const hello = () =>
        socket.send(
          JSON.stringify({
            type: 'ping',
            focus: store.focus,
            lat: store.coord?.lat,
            lng: store.coord?.lng,
          })
        )
      hello()
      startPing(hello)
    }

    socket.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data === 'hb') return
      try {
        const msg = JSON.parse(e.data) as { type?: string; snapshot?: PresenceSnapshot }
        if (msg?.snapshot) setSnapshot(msg.snapshot)
      } catch {
        // 忽略非法消息
      }
    }

    socket.onerror = () => {
      // onclose 会跟着触发，降级逻辑集中在 onclose
    }

    socket.onclose = () => {
      stopPing()
      store.socket = null
      if (!store.started) return
      // 指数退避重连：1s → 2s → 4s，最多 8s；连续失败 3 次后转 SSE
      store.retry += 1
      if (store.retry >= 3) {
        connectSSE()
        return
      }
      setState({ channel: 'connecting' })
      window.setTimeout(() => {
        if (store.started && !store.socket) connectWebSocket()
      }, Math.min(1000 * 2 ** (store.retry - 1), 8000))
    }
  } catch {
    connectSSE()
  }
}

function connectSSE() {
  if (typeof EventSource === 'undefined') {
    startPolling()
    return
  }
  try {
    const es = new EventSource(apiUrl('presence/stream'))
    store.es = es
    setState({ channel: 'sse' })

    es.onmessage = (e) => {
      try {
        setSnapshot(JSON.parse(e.data) as PresenceSnapshot)
      } catch {
        // ignore
      }
    }
    es.onerror = () => {
      es.close()
      store.es = null
      if (store.started) startPolling()
    }
  } catch {
    startPolling()
  }
}

async function boot() {
  if (store.started) return
  store.started = true
  store.sessionId = getSessionId()

  const ok = await probeBackend()
  if (!ok) {
    // 静态托管 / 后端未启动：给出离线提示，不阻塞页面
    setState({ channel: 'offline', snapshot: { ...EMPTY, online: 1, connections: 1, peak: 1, timeline: [1] } })
    return
  }

  connectWebSocket()
}

function teardown() {
  store.started = false
  stopPing()
  stopPolling()
  store.socket?.close()
  store.socket = null
  store.es?.close()
  store.es = null
}

/** 组件订阅用：返回当前状态与手动刷新方法 */
export function usePresence() {
  const [, force] = useState(0)
  const ref = useRef(store.state)

  useEffect(() => {
    const listener = () => {
      ref.current = store.state
      force((n) => n + 1)
    }
    store.listeners.add(listener)

    // 首个订阅者触发连接
    void boot()

    // 标签页切回前台时立即刷新一次，避免后台节流造成的陈旧数据
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (store.socket?.readyState === WebSocket.OPEN) {
        store.socket.send(JSON.stringify({ type: 'ping', focus: store.focus }))
      } else if (store.state.channel === 'offline') {
        store.started = false
        void boot()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      store.listeners.delete(listener)
      document.removeEventListener('visibilitychange', onVisible)
      // 页面卸载时收尾（组件级卸载不主动断开，保持全局单连接）
    }
  }, [])

  /** 上报当前观测焦点，让服务端知道访客在看哪 */
  const reportFocus = useCallback((focus: string | undefined, coord?: { lat: number; lng: number }) => {
    store.focus = focus
    store.coord = coord ?? null
    if (store.socket?.readyState === WebSocket.OPEN) {
      store.socket.send(
        JSON.stringify({ type: 'state', focus, lat: coord?.lat, lng: coord?.lng })
      )
    }
  }, [])

  return { ...ref.current, reportFocus }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    store.socket?.close()
  })
}

export { teardown as teardownPresence }
