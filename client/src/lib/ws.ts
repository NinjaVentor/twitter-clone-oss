// Minimal typed WebSocket client for the Go realtime hub (/ws?token=...).
// Singleton with automatic reconnect (exponential backoff) + heartbeat ping.

export type WsHandler = (msg: WsMessage) => void

export interface WsMessage {
  type: string
  [key: string]: unknown
}

const WS_URL = resolveWsUrl()
const PING_INTERVAL = 25000
const MAX_BACKOFF = 30000

// Production HTTPS must use wss://. If VITE_WS_URL is unset (or was set to an
// http(s) URL by mistake), derive the socket URL from VITE_API_URL so deploys
// like https://api.example.com/api/v1 automatically become wss://api.example.com/ws.
function resolveWsUrl(): string {
  const explicit = ((import.meta.env.VITE_WS_URL as string) || '').trim()
  if (explicit.startsWith('ws://') || explicit.startsWith('wss://')) return explicit
  const api = ((import.meta.env.VITE_API_URL as string) || '').trim().replace(/\/+$/, '')
  if (api.startsWith('http://') || api.startsWith('https://')) {
    return api.replace(/^http/, 'ws').replace(/\/api\/v1$/, '/ws')
  }
  return explicit || 'ws://localhost:8080/ws'
}

class WsClient {
  private socket: WebSocket | null = null
  private handlers = new Set<WsHandler>()
  private token: string | null = null
  private backoff = 1000
  private pingTimer: number | null = null
  private reconnectTimer: number | null = null
  private intentionalClose = false
  connected = false

  connect(token: string) {
    if (this.token === token && (this.connected || this.socket)) return
    this.disconnect()
    this.token = token
    this.intentionalClose = false
    this.backoff = 1000
    this.open()
  }

  disconnect() {
    this.intentionalClose = true
    this.token = null
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopPing()
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        /* already closed */
      }
      this.socket = null
    }
    this.connected = false
  }

  subscribe(handler: WsHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  private open() {
    if (!this.token || this.intentionalClose) return
    let socket: WebSocket
    try {
      socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(this.token)}`)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.connected = true
      this.backoff = 1000
      this.startPing()
    }
    socket.onmessage = (ev) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(ev.data as string) as WsMessage
      } catch {
        return
      }
      if (msg.type === 'pong') return
      this.handlers.forEach((h) => {
        try {
          h(msg)
        } catch {
          /* handler errors must not kill the socket */
        }
      })
    }
    const onDown = () => {
      if (this.socket !== socket) return
      this.connected = false
      this.stopPing()
      this.socket = null
      if (!this.intentionalClose) this.scheduleReconnect()
    }
    socket.onclose = onDown
    socket.onerror = onDown
  }

  private scheduleReconnect() {
    if (this.intentionalClose || this.reconnectTimer != null) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF)
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }

  private startPing() {
    this.stopPing()
    this.pingTimer = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify({ type: 'ping' }))
        } catch {
          /* reconnect loop will handle it */
        }
      }
    }, PING_INTERVAL)
  }

  private stopPing() {
    if (this.pingTimer != null) {
      window.clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }
}

export const wsClient = new WsClient()
