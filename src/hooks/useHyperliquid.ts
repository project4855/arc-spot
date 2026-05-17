import { useState, useEffect, useCallback } from 'react'

// Dùng Cloudflare proxy để tránh CORS
const PROXY  = '/api/hyperliquid'

// ── Types ─────────────────────────────────────────────────────────────────────

export type LbWindow = 'day' | 'week' | 'month' | 'allTime'

export interface HLTrader {
  rank:         number
  address:      string
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

// ── Leaderboard hook ──────────────────────────────────────────────────────────

export function useHLLeaderboard(window: LbWindow = 'day') {
  const [traders, setTraders] = useState<HLTrader[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)

      // stats-data.hyperliquid.xyz/Mainnet/leaderboard (qua proxy)
      const res  = await fetch(`${PROXY}/leaderboard`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json()

      // Response là array hoặc có field leaderboardRows
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = Array.isArray(data)
        ? data
        : (data.leaderboardRows ?? data.rows ?? [])

      const parsed: HLTrader[] = rows
        .slice(0, 25)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any, i: number) => {
          const accountValue = parseFloat(r.accountValue ?? r.account_value ?? r.equity ?? '0')

          // windowPnl: thử nhiều key khác nhau
          const pnlKey = window === 'day'     ? 'pnl1d'
                       : window === 'week'    ? 'pnl7d'
                       : window === 'month'   ? 'pnl30d'
                       : 'pnlAllTime'
          const windowPnl = parseFloat(
            r[pnlKey] ?? r.windowPnl ?? r.window_pnl ?? r.pnl ?? '0'
          )

          const volume = parseFloat(r.vlm ?? r.volume ?? r.volume30d ?? '0')

          // ROI = PnL / (equity - PnL), tránh chia 0
          const base = accountValue - windowPnl
          const roi  = base > 0 ? (windowPnl / base) * 100 : 0

          return {
            rank:         (r.prize ?? r.rank ?? i + 1) as number,
            address:      r.ethAddress ?? r.eth_address ?? r.address ?? r.user ?? '—',
            accountValue,
            windowPnl,
            roi,
            volume,
          }
        })
        .sort((a, b) => b.windowPnl - a.windowPnl)   // sort by PnL desc
        .map((t, i) => ({ ...t, rank: i + 1 }))       // re-number rank

      setTraders(parsed)
      setError(null)
    } catch (e) {
      console.error('HL leaderboard error:', e)
      setError('Không thể tải leaderboard')
    } finally {
      setLoading(false)
    }
  }, [window])

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
