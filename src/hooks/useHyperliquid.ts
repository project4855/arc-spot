import { useState, useEffect, useCallback } from 'react'

// Dùng Cloudflare proxy để tránh CORS
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

export function useHLLeaderboard(timeWindow: LbWindow = 'day') {
  const [traders, setTraders] = useState<HLTrader[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)

      const res = await fetch(`${PROXY}/leaderboard`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = Array.isArray(data)
        ? data
        : (data.leaderboardRows ?? data.rows ?? [])

      /*
       * Actual response shape (confirmed from API):
       * {
       *   ethAddress: "0x...",
       *   accountValue: "78142271.77",
       *   displayName: null,
       *   windowPerformances: [
       *     ["day",     { pnl: "62937.69", roi: "0.00113", vlm: "545986909.83" }],
       *     ["week",    { pnl: "...", ... }],
       *     ["month",   { pnl: "...", ... }],
       *     ["allTime", { pnl: "...", ... }],
       *   ]
       * }
       */
      const parsed: HLTrader[] = rows
        .slice(0, 100)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any, i: number) => {
          const accountValue = parseFloat(r.accountValue ?? '0')

          // windowPerformances: Array<[windowName, {pnl, roi, vlm}]>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const perfs: [string, any][] = Array.isArray(r.windowPerformances)
            ? r.windowPerformances
            : []

          // Find the tuple matching the chosen timeWindow
          const perf = perfs.find(([key]) => key === timeWindow)?.[1] ?? {}

          const windowPnl = parseFloat(perf.pnl ?? '0')
          const roi       = parseFloat(perf.roi ?? '0') * 100  // 0.045 → 4.5%
          const volume    = parseFloat(perf.vlm ?? '0')

          return {
            rank:        i + 1,
            address:     r.ethAddress ?? r.address ?? '—',
            displayName: r.displayName ?? null,
            accountValue,
            windowPnl,
            roi,
            volume,
          }
        })
        .sort((a, b) => b.windowPnl - a.windowPnl)
        .map((t, i) => ({ ...t, rank: i + 1 }))

      setTraders(parsed)
      setError(null)
    } catch (e) {
      console.error('HL leaderboard error:', e)
      setError('Không thể tải leaderboard')
    } finally {
      setLoading(false)
    }
  }, [timeWindow])

  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

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
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    const targets = traders.slice(0, topN)
    if (targets.length === 0) return

    try {
      setLoading(true)

      // Fetch fills cho mỗi trader song song
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
  }, [traders, topN])

  useEffect(() => {
    if (traders.length === 0) return
    load()
    const id = setInterval(load, 15_000)   // cập nhật 15s
    return () => clearInterval(id)
  }, [load, traders])

  return { fills, loading, error }
}
