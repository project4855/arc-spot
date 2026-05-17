import { useState, useMemo } from 'react'
import {
  useHLLeaderboard,
  useHLTrades,
  useHLTraderFills,
} from '../hooks/useHyperliquid'
import type { LbWindow, HLTraderFill } from '../hooks/useHyperliquid'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtUSD(n: number, compact = true): string {
  if (compact) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`
  }
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
}

function fmtRelTime(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000)
  if (sec <  60) return `${sec}s trước`
  if (sec < 3600) return `${Math.floor(sec / 60)}p trước`
  return `${Math.floor(sec / 3600)}h trước`
}

function shortAddr(addr: string, name: string | null): string {
  if (name) return name
  if (!addr || addr === '—') return '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// Direction badge
function DirBadge({ dir, side }: { dir: string; side: 'buy' | 'sell' }) {
  const isLong  = dir.toLowerCase().includes('long')
  const isShort = dir.toLowerCase().includes('short')
  const isOpen  = dir.toLowerCase().startsWith('open') || dir.includes('>')
  const isClose = dir.toLowerCase().startsWith('close')

  const base  = isLong ? 'text-green-400' : isShort ? 'text-red-400' : side === 'buy' ? 'text-green-400' : 'text-red-400'
  const label = dir || (side === 'buy' ? 'Buy' : 'Sell')

  return (
    <span className={`font-semibold font-mono text-xs ${base} ${isClose ? 'opacity-70' : ''} ${isOpen ? '' : ''}`}>
      {label.replace('Long > Short', 'L→S').replace('Short > Long', 'S→L')}
    </span>
  )
}

// ── Leaderboard section ───────────────────────────────────────────────────────

const WINDOWS: { key: LbWindow; label: string; sublabel: string }[] = [
  { key: 'day',     label: '1 Ngày',  sublabel: '24h' },
  { key: 'week',    label: '1 Tuần',  sublabel: '7D'  },
  { key: 'month',   label: '1 Tháng', sublabel: '30D' },
  { key: 'allTime', label: 'Tất cả',  sublabel: 'All' },
]

function Leaderboard({
  onTradersLoaded,
}: {
  onTradersLoaded: (traders: { address: string; displayName: string | null; rank: number }[]) => void
}) {
  const [timeWindow, setTimeWindow] = useState<LbWindow>('day')
  const { traders, loading, error, refresh } = useHLLeaderboard(timeWindow)

  // Notify parent when traders change
  useMemo(() => {
    if (traders.length > 0) {
      onTradersLoaded(traders.slice(0, 8).map((t) => ({
        address:     t.address,
        displayName: t.displayName,
        rank:        t.rank,
      })))
    }
  }, [traders, onTradersLoaded])

  const currentLabel = WINDOWS.find((w) => w.key === timeWindow)?.label ?? ''

  return (
    <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">🏆</span>
          <h3 className="text-white font-semibold text-sm">Top Traders</h3>
          <span className="text-xs text-gray-600">Hyperliquid</span>
        </div>
        <button onClick={refresh} className="text-gray-600 hover:text-gray-400 transition-colors text-sm" title="Refresh">↻</button>
      </div>

      {/* Window selector */}
      <div className="grid grid-cols-4 gap-1 bg-gray-900/60 rounded-xl p-1">
        {WINDOWS.map(({ key, label, sublabel }) => (
          <button
            key={key}
            onClick={() => setTimeWindow(key)}
            className={`flex flex-col items-center py-1.5 rounded-lg text-xs font-medium transition-all ${
              timeWindow === key ? 'bg-violet-600 text-white shadow-md' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <span className="font-semibold">{label}</span>
            <span className={`text-[10px] ${timeWindow === key ? 'text-violet-200' : 'text-gray-600'}`}>{sublabel}</span>
          </button>
        ))}
      </div>

      {/* Column labels */}
      <div className="grid grid-cols-[28px_1fr_95px_75px_80px] text-[11px] text-gray-600 px-1 gap-1">
        <span>#</span><span>Địa chỉ</span>
        <span className="text-right">PnL ({currentLabel})</span>
        <span className="text-right">ROI</span>
        <span className="text-right">Tài khoản</span>
      </div>

      {/* Rows */}
      <div className="flex flex-col gap-px max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700">
        {loading && !traders.length ? (
          <Spinner />
        ) : error ? (
          <div className="text-center py-10 text-red-400/70 text-xs">{error}</div>
        ) : (
          traders.map((t) => {
            const medal = t.rank === 1 ? '🥇' : t.rank === 2 ? '🥈' : t.rank === 3 ? '🥉' : null
            const pos   = t.windowPnl >= 0
            return (
              <div key={t.address + t.rank}
                className="grid grid-cols-[28px_1fr_95px_75px_80px] items-center px-1 py-1.5 rounded-lg hover:bg-white/5 transition-colors group gap-1">
                <span className="text-gray-500 font-mono text-xs">{medal ?? <span className="text-gray-600">#{t.rank}</span>}</span>
                <a href={`https://app.hyperliquid.xyz/stats/${t.address}`} target="_blank" rel="noreferrer"
                  className="text-gray-300 font-mono text-xs hover:text-violet-400 transition-colors truncate">
                  {shortAddr(t.address, t.displayName)}
                  <span className="opacity-0 group-hover:opacity-60 text-violet-400 ml-1 text-[10px]">↗</span>
                </a>
                <span className={`text-right font-mono text-xs font-semibold ${pos ? 'text-green-400' : 'text-red-400'}`}>
                  {pos ? '+' : ''}{fmtUSD(t.windowPnl)}
                </span>
                <span className={`text-right font-mono text-xs ${pos ? 'text-green-400/80' : 'text-red-400/80'}`}>
                  {pos ? '+' : ''}{t.roi.toFixed(2)}%
                </span>
                <span className="text-right text-gray-500 font-mono text-xs">{fmtUSD(t.accountValue)}</span>
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-gray-600">
        <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
        <span>Live · {traders.length} traders · 60s</span>
        <a href="https://app.hyperliquid.xyz/leaderboard" target="_blank" rel="noreferrer"
          className="ml-auto text-gray-600 hover:text-violet-400 transition-colors">Xem đầy đủ ↗</a>
      </div>
    </div>
  )
}

// ── Recent market trades ──────────────────────────────────────────────────────

const COIN_ICONS: Record<string, string> = { BTC: '₿', ETH: 'Ξ', SOL: '◎' }

function RecentTrades() {
  const [filterCoin, setFilterCoin] = useState('ALL')
  const { trades, loading, error } = useHLTrades()
  const displayed = filterCoin === 'ALL' ? trades : trades.filter((t) => t.coin === filterCoin)

  return (
    <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">⚡</span>
          <h3 className="text-white font-semibold text-sm">Lệnh thị trường</h3>
          <span className="text-xs text-gray-600">Hyperliquid</span>
        </div>
        <div className="flex gap-1">
          {['ALL', 'BTC', 'ETH', 'SOL'].map((c) => (
            <button key={c} onClick={() => setFilterCoin(c)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                filterCoin === c ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}>
              {c === 'ALL' ? 'Tất cả' : `${COIN_ICONS[c]} ${c}`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[52px_46px_32px_92px_72px_82px] text-[11px] text-gray-600 px-1">
        <span>Giờ</span><span>Token</span><span>Chiều</span>
        <span className="text-right">Giá</span><span className="text-right">KL</span><span className="text-right">Giá trị</span>
      </div>

      <div className="flex flex-col gap-px max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700">
        {loading && !trades.length ? <Spinner /> : error ? (
          <div className="text-center py-10 text-red-400/70 text-xs">{error}</div>
        ) : displayed.map((t) => (
          <div key={`${t.id}-${t.time}`}
            className={`grid grid-cols-[52px_46px_32px_92px_72px_82px] items-center px-1 py-1 rounded hover:bg-white/5 text-xs ${t.value >= 100_000 ? 'bg-yellow-500/5' : ''}`}>
            <span className="text-gray-500 font-mono">{fmtTime(t.time)}</span>
            <span className="text-gray-300 font-mono">{COIN_ICONS[t.coin] ?? ''} {t.coin}</span>
            <span className={`font-bold font-mono ${t.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
              {t.side === 'buy' ? 'B' : 'S'}
            </span>
            <span className={`text-right font-mono ${t.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
              {t.price >= 1000 ? t.price.toLocaleString(undefined, { maximumFractionDigits: 1 }) : t.price.toFixed(2)}
            </span>
            <span className="text-right text-gray-300 font-mono">
              {t.size >= 1 ? t.size.toFixed(3) : t.size.toFixed(5)}
            </span>
            <span className={`text-right font-mono font-semibold ${
              t.value >= 100_000 ? 'text-yellow-400' : t.value >= 10_000 ? 'text-gray-200' : 'text-gray-500'
            }`}>
              {fmtUSD(t.value)}{t.value >= 100_000 && <span className="ml-0.5">🐋</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-gray-600">
        <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
        <span>Live · 5s · {displayed.length} lệnh</span>
        <a href="https://app.hyperliquid.xyz" target="_blank" rel="noreferrer"
          className="ml-auto text-gray-600 hover:text-violet-400">hyperliquid.xyz ↗</a>
      </div>
    </div>
  )
}

// ── Copy Trade Signals ────────────────────────────────────────────────────────

interface SignalData {
  coin:       string
  dir:        'Open Long' | 'Open Short'
  traders:    Set<string>
  totalValue: number
  latestTime: number
}

function CopyTradeSignals({ fills }: { fills: HLTraderFill[] }) {
  const signals = useMemo((): SignalData[] => {
    const map = new Map<string, SignalData>()

    for (const f of fills) {
      // Chỉ quan tâm lệnh MỞ vị thế (Open Long / Open Short)
      if (f.dir !== 'Open Long' && f.dir !== 'Open Short') continue

      const key = `${f.coin}|${f.dir}`
      if (!map.has(key)) {
        map.set(key, {
          coin:       f.coin,
          dir:        f.dir as 'Open Long' | 'Open Short',
          traders:    new Set(),
          totalValue: 0,
          latestTime: 0,
        })
      }
      const s = map.get(key)!
      s.traders.add(f.trader)
      s.totalValue += f.value
      s.latestTime = Math.max(s.latestTime, f.time)
    }

    return [...map.values()]
      .filter((s) => s.traders.size >= 2)              // Ít nhất 2 top trader cùng mở
      .sort((a, b) => b.traders.size - a.traders.size || b.totalValue - a.totalValue)
      .slice(0, 6)
  }, [fills])

  if (signals.length === 0) return null

  return (
    <div className="bg-gradient-to-r from-violet-900/20 via-indigo-900/10 to-blue-900/20 border border-violet-500/25 rounded-xl p-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-base">🔥</span>
        <h4 className="text-white text-xs font-bold">Copy Trade Signal</h4>
        <span className="px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-300 text-[10px] font-semibold animate-pulse">
          LIVE
        </span>
        <span className="text-[10px] text-gray-500">— Coin nhiều top trader đang mở vị thế</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {signals.map((s) => {
          const isLong     = s.dir === 'Open Long'
          const strength   = s.traders.size >= 4 ? 'Rất mạnh' : s.traders.size >= 3 ? 'Mạnh' : 'Trung bình'
          const strengthCl = s.traders.size >= 4 ? 'text-yellow-400' : s.traders.size >= 3 ? 'text-orange-400' : 'text-gray-400'

          return (
            <div
              key={`${s.coin}|${s.dir}`}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all hover:scale-[1.02] ${
                isLong
                  ? 'bg-green-500/10 border-green-500/30 hover:border-green-500/50'
                  : 'bg-red-500/10 border-red-500/30 hover:border-red-500/50'
              }`}
            >
              <span className={`text-sm font-bold ${isLong ? 'text-green-400' : 'text-red-400'}`}>
                {isLong ? '▲' : '▼'}
              </span>
              <span className={`font-bold text-sm ${isLong ? 'text-green-300' : 'text-red-300'}`}>
                {s.coin}
              </span>
              <span className={`text-xs ${isLong ? 'text-green-500' : 'text-red-500'}`}>
                {isLong ? 'Long' : 'Short'}
              </span>
              <div className="w-px h-3 bg-gray-700" />
              <div className="flex flex-col items-center">
                <span className="text-white font-bold text-xs">{s.traders.size}</span>
                <span className="text-gray-600 text-[9px]">traders</span>
              </div>
              <div className="flex flex-col">
                <span className={`text-[10px] font-semibold ${strengthCl}`}>{strength}</span>
                <span className="text-gray-600 text-[10px]">{fmtUSD(s.totalValue)}</span>
              </div>
              <span className="text-gray-700 text-[10px]">{fmtRelTime(s.latestTime)}</span>
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-gray-700">
        ⚠️ Tín hiệu tham khảo · Không phải lời khuyên đầu tư · Luôn DYOR trước khi giao dịch
      </p>
    </div>
  )
}

// ── Top Trader Fills ──────────────────────────────────────────────────────────

const DIR_ICON: Record<string, string> = {
  'Open Long':    '▲',
  'Close Long':   '▽',
  'Open Short':   '▼',
  'Close Short':  '△',
}

function TopTraderFills({
  traders,
}: {
  traders: { address: string; displayName: string | null; rank: number }[]
}) {
  const [filterCoin, setFilterCoin] = useState('Tất cả')
  const [filterDir,  setFilterDir]  = useState('Tất cả')

  const { fills, loading, error } = useHLTraderFills(traders, 8)

  const coins   = ['Tất cả', ...Array.from(new Set(fills.map((f) => f.coin))).sort()]
  const dirs    = ['Tất cả', 'Open Long', 'Close Long', 'Open Short', 'Close Short']

  const displayed = fills.filter((f) => {
    if (filterCoin !== 'Tất cả' && f.coin !== filterCoin) return false
    if (filterDir  !== 'Tất cả' && !f.dir.includes(filterDir.replace('Open Long', 'Long').replace('Close Long', 'Long'))) {
      // simple dir match
      if (filterDir === 'Open Long'   && f.dir !== 'Open Long')   return false
      if (filterDir === 'Close Long'  && f.dir !== 'Close Long')   return false
      if (filterDir === 'Open Short'  && f.dir !== 'Open Short')   return false
      if (filterDir === 'Close Short' && f.dir !== 'Close Short')  return false
    }
    return true
  })

  return (
    <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-4 flex flex-col gap-3 border-b border-gray-800">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🔭</span>
            <h3 className="text-white font-semibold text-sm">Lệnh của Top Traders</h3>
            <span className="px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/25 text-violet-400 text-[10px] font-semibold">
              Top {traders.length} traders
            </span>
            {loading && (
              <svg className="animate-spin h-3 w-3 text-gray-600" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
            <span>Cập nhật 15s</span>
          </div>
        </div>

        {/* Copy Trade Signals */}
        <CopyTradeSignals fills={fills} />

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Coin filter */}
          <div className="flex gap-1 flex-wrap">
            {coins.slice(0, 8).map((c) => (
              <button key={c} onClick={() => setFilterCoin(c)}
                className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  filterCoin === c ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}>
                {c === 'Tất cả' ? 'Tất cả' : `${COIN_ICONS[c] ?? ''}${c}`}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-gray-800 hidden sm:block" />

          {/* Direction filter */}
          <div className="flex gap-1 flex-wrap">
            {dirs.map((d) => {
              const isLong  = d.includes('Long')
              const isShort = d.includes('Short')
              const isOpen  = d.startsWith('Open')
              return (
                <button key={d} onClick={() => setFilterDir(d)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                    filterDir === d
                      ? 'bg-violet-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}>
                  {d === 'Tất cả' ? 'Tất cả' : `${DIR_ICON[d] ?? ''} ${isOpen ? 'Mở' : 'Đóng'} ${isLong ? 'Long' : isShort ? 'Short' : d}`}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Column header */}
      <div className="grid grid-cols-[36px_110px_100px_50px_90px_72px_82px_90px] text-[11px] text-gray-600 px-4 py-2 border-b border-gray-800/60 gap-1">
        <span>#</span>
        <span>Trader</span>
        <span>Thời gian</span>
        <span>Token</span>
        <span>Chiều</span>
        <span className="text-right">Giá</span>
        <span className="text-right">Giá trị</span>
        <span className="text-right">PnL đóng</span>
      </div>

      {/* Rows */}
      <div className="flex flex-col gap-px max-h-[460px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700">
        {loading && fills.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-600 text-sm gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Đang tải lệnh của top traders...
          </div>
        ) : error ? (
          <div className="text-center py-10 text-red-400/70 text-xs px-4">{error}</div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-10 text-gray-600 text-sm">Không có lệnh phù hợp</div>
        ) : (
          displayed.map((f, idx) => {
            const isLong    = f.dir.toLowerCase().includes('long')
            const isOpen    = f.dir.toLowerCase().startsWith('open') || f.dir.includes('>')
            const hasPnl    = f.closedPnl !== 0
            const pnlPos    = f.closedPnl >= 0
            const isWhale   = f.value >= 100_000
            const medal     = f.rank === 1 ? '🥇' : f.rank === 2 ? '🥈' : f.rank === 3 ? '🥉' : null

            return (
              <div
                key={`${f.id}-${idx}`}
                className={`grid grid-cols-[36px_110px_100px_50px_90px_72px_82px_90px] items-center px-4 py-2 gap-1 hover:bg-white/5 transition-colors text-xs group ${
                  isWhale ? 'bg-yellow-500/5' : ''
                } ${isOpen ? '' : 'opacity-80'}`}
              >
                {/* Rank */}
                <span className="font-mono text-gray-600 text-[11px]">
                  {medal ?? `#${f.rank}`}
                </span>

                {/* Trader address */}
                <a
                  href={`https://app.hyperliquid.xyz/stats/${f.trader}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[11px] text-gray-400 hover:text-violet-400 transition-colors truncate"
                >
                  {shortAddr(f.trader, f.displayName)}
                  <span className="opacity-0 group-hover:opacity-60 text-violet-400 ml-1">↗</span>
                </a>

                {/* Time */}
                <div className="flex flex-col">
                  <span className="text-gray-500 font-mono text-[11px]">{fmtTime(f.time)}</span>
                  <span className="text-gray-700 text-[10px]">{fmtRelTime(f.time)}</span>
                </div>

                {/* Coin */}
                <span className="font-mono font-semibold text-gray-300 text-[11px]">
                  {COIN_ICONS[f.coin] ?? ''}{f.coin}
                </span>

                {/* Direction */}
                <div className="flex items-center gap-1">
                  <span className={`text-sm ${isOpen ? (isLong ? 'text-green-400' : 'text-red-400') : 'text-gray-500'}`}>
                    {DIR_ICON[f.dir] ?? (f.side === 'buy' ? '▲' : '▼')}
                  </span>
                  <DirBadge dir={f.dir} side={f.side} />
                </div>

                {/* Price */}
                <span className="text-right font-mono text-[11px] text-gray-300">
                  {f.price >= 1000
                    ? f.price.toLocaleString(undefined, { maximumFractionDigits: 1 })
                    : f.price.toFixed(3)}
                </span>

                {/* Value */}
                <span className={`text-right font-mono text-[11px] font-semibold ${
                  isWhale ? 'text-yellow-400' : f.value >= 10_000 ? 'text-gray-200' : 'text-gray-500'
                }`}>
                  {fmtUSD(f.value)}{isWhale && ' 🐋'}
                </span>

                {/* Closed PnL */}
                <span className={`text-right font-mono text-[11px] font-semibold ${
                  !hasPnl  ? 'text-gray-700'
                  : pnlPos ? 'text-green-400'
                  :          'text-red-400'
                }`}>
                  {!hasPnl ? '—' : `${pnlPos ? '+' : ''}${fmtUSD(f.closedPnl)}`}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-gray-800 flex items-center gap-2 text-[11px] text-gray-600">
        <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
        <span>{displayed.length} lệnh · Top {traders.length} traders · Cập nhật 15s</span>
        <span className="ml-auto text-gray-700">▲▽ Open/Close · B/S · 🐋 ≥ $100K</span>
      </div>
    </div>
  )
}

// ── Shared spinner ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12 text-gray-600 text-sm gap-2">
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      Đang tải...
    </div>
  )
}

// ── Combined panel ────────────────────────────────────────────────────────────

export default function HyperliquidPanel() {
  const [topTraders, setTopTraders] = useState<
    { address: string; displayName: string | null; rank: number }[]
  >([])

  return (
    <div className="flex flex-col gap-4">
      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-800" />
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#0d0e12] border border-gray-800">
          <img
            src="https://app.hyperliquid.xyz/favicon.ico"
            alt=""
            className="w-4 h-4 rounded-sm"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <span className="text-gray-400 text-xs font-medium">Dữ liệu thực từ Hyperliquid Mainnet</span>
        </div>
        <div className="flex-1 h-px bg-gray-800" />
      </div>

      {/* Row 1: Leaderboard + Market trades */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Leaderboard onTradersLoaded={setTopTraders} />
        <RecentTrades />
      </div>

      {/* Row 2: Top trader fills — full width */}
      {topTraders.length > 0 && (
        <TopTraderFills traders={topTraders} />
      )}
    </div>
  )
}
