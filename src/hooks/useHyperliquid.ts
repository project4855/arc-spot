import { useState, useEffect, useCallback, useRef } from 'react'

// Dùng Cloudflare proxy để tránh CORS (production)
// Dev: proxy qua vite.config.ts
const PROXY = '/api/hyperliquid'

// ── Types ─────────────────────────────────────────────────────────────────────

export type LbWindow = 'day' | 'week' | 'month' | 'allTime'

export interface HLTrader {
  rank:         number
  address:      string
  displayName:  string | null
  accountValue: number
  windowPnl:    number
  roi:          number
  volume:       number
}

export interface HLTrade {
  id:    number | string
  coin:  string
  side:  'buy' | 'sell'
  price: number
  size:  number
  value: number
  time:  number
  hash:  string
}

export interface HLTraderFill {
  id:          number | string
  trader:      string          // address
  displayName: string | null
  rank:        number
  coin:        string
  side:        'buy' | 'sell'
  dir:         string          // 'Open Long' | 'Close Long' | 'Open Short' | 'Close Short' | ...
  price:       number
  size:        number
  value:       number
  closedPnl:   number
  fee:         number
  time:        number
  hash:        string
}

// ── Leaderboard hook ──────────────────────────────────────────────────────────
// Fetch 1 lần duy nhất (mỗi 60s), sort/filter theo timeWindow trong memory
// Không re-fetch khi đổi tab → nhanh hơn, không race condition

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawRow = any

export function useHLLeaderboard(timeWindow: LbWindow = 'day') {
  const [rawRows,  setRawRows]  = useState<RawRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    // Huỷ request cũ nếu đang chạy
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      setLoading(true)
      const res = await fetch(`${PROXY}/leaderboard`, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json()

      const rows: RawRow[] = Array.isArray(data)
        ? data
        : (data.leaderboardRows ?? data.rows ?? [])

      setRawRows(rows.slice(0, 200))
      setError(null)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return  // bị huỷ chủ động, bỏ qua
      console.error('HL leaderboard error:', e)
      setError('Không thể tải leaderboard')
    } finally {
      setLoading(false)
    }
  }, [])  // không có deps → hàm ổn định, không recreate

  // Fetch khi mount, sau đó mỗi 60s
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => {
      clearInterval(id)
      abortRef.current?.abort()
    }
  }, [load])

  // Parse & sort theo timeWindow trong memory (không fetch lại)
  const traders: HLTrader[] = rawRows
    .map((r: RawRow, i: number) => {
      const accountValue = parseFloat(r.accountValue ?? '0')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const perfs: [string, any][] = Array.isArray(r.windowPerformances)
        ? r.windowPerformances : []
      const perf  = perfs.find(([key]) => key === timeWindow)?.[1] ?? {}
      const windowPnl = parseFloat(perf.pnl ?? '0')
      const roi       = parseFloat(perf.roi ?? '0') * 100
      const volume    = parseFloat(perf.vlm ?? '0')
      return {
        rank:        i + 1,
        address:     r.ethAddress ?? r.address ?? '—',
        displayName: r.displayName ?? null,
        accountValue, windowPnl, roi, volume,
      }
    })
    .sort((a, b) => b.windowPnl - a.windowPnl)
    .map((t, i) => ({ ...t, rank: i + 1 }))

  return { traders, loading, error, refresh: load }
}

// ── Recent trades hook ────────────────────────────────────────────────────────

const COINS = ['BTC', 'ETH', 'SOL']

export function useHLTrades() {
  const [trades,  setTrades]  = useState<HLTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const results = await Promise.all(
        COINS.map((coin) =>
          fetch(`${PROXY}/trades`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ type: 'recentTrades', coin }),
          })
            .then((r) => r.json())
            .catch(() => [])
        )
      )

      const all: HLTrade[] = []
      results.forEach((rows, ci) => {
        const coin = COINS[ci]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(Array.isArray(rows) ? rows : []).slice(0, 20).forEach((t: any) => {
          const price = parseFloat(t.px ?? '0')
          const size  = parseFloat(t.sz ?? '0')
          all.push({
            id:    t.tid ?? `${coin}-${t.time}-${Math.random()}`,
            coin,
            side:  t.side === 'B' ? 'buy' : 'sell',
            price,
            size,
            value: price * size,
            time:  t.time ?? Date.now(),
            hash:  t.hash ?? '',
          })
        })
      })

      all.sort((a, b) => b.time - a.time)
      setTrades(all.slice(0, 60))
      setError(null)
    } catch (e) {
      console.error('HL trades error:', e)
      setError('Không thể tải trades')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 5_000)
    return () => clearInterval(id)
  }, [load])

  return { trades, loading, error }
}

// ── Top-trader fills hook ─────────────────────────────────────────────────────
// Lấy các lệnh vừa thực hiện của top N traders trên leaderboard

export interface TraderInfo {
  address:     string
  displayName: string | null
  rank:        number
}

export function useHLTraderFills(traders: TraderInfo[], topN = 8) {
  const [fills,   setFills]   = useState<HLTraderFill[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Dùng key ổn định thay vì so sánh reference của array
  // Chỉ re-fetch khi danh sách địa chỉ thực sự thay đổi
  const tradersKey = traders.slice(0, topN).map(t => t.address).join(',')

  const load = useCallback(async (targets: TraderInfo[]) => {
    if (targets.length === 0) return

    try {
      setLoading(true)

      const results = await Promise.all(
        targets.map((t) =>
          fetch(`${PROXY}/trades`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ type: 'userFills', user: t.address }),
          })
            .then((r) => r.json())
            .catch(() => [])
        )
      )

      const all: HLTraderFill[] = []
      results.forEach((rows, ti) => {
        const trader = targets[ti]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(Array.isArray(rows) ? rows : []).slice(0, 10).forEach((f: any) => {
          const price     = parseFloat(f.px ?? '0')
          const size      = parseFloat(f.sz ?? '0')
          const closedPnl = parseFloat(f.closedPnl ?? '0')
          const fee       = parseFloat(f.fee ?? '0')
          all.push({
            id:          f.tid ?? `${trader.address}-${f.time}`,
            trader:      trader.address,
            displayName: trader.displayName,
            rank:        trader.rank,
            coin:        f.coin ?? '?',
            side:        f.side === 'B' ? 'buy' : 'sell',
            dir:         f.dir  ?? '',
            price,
            size,
            value:       price * size,
            closedPnl,
            fee,
            time:        f.time ?? Date.now(),
            hash:        f.hash ?? '',
          })
        })
      })

      all.sort((a, b) => b.time - a.time)
      setFills(all.slice(0, 80))
      setError(null)
    } catch (e) {
      console.error('HL trader fills error:', e)
      setError('Không thể tải lệnh trader')
    } finally {
      setLoading(false)
    }
  }, [])  // hàm ổn định, nhận targets làm tham số

  // Chỉ re-subscribe khi danh sách địa chỉ trader thực sự thay đổi
  useEffect(() => {
    const targets = traders.slice(0, topN)
    if (targets.length === 0) return

    load(targets)
    const id = setInterval(() => load(targets), 15_000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradersKey, topN, load])  // tradersKey thay vì traders object

  return { fills, loading, error }
}
