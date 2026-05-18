// ── DerivativesPanel.tsx ─────────────────────────────────────────────────────
// Perpetual futures market data from Hyperliquid Mainnet — live every 15s

import { useState, useMemo } from 'react'
import { useHLDerivatives } from '../hooks/useHyperliquid'
import type { HLMarket } from '../hooks/useHyperliquid'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  if (n === 0) return '—'
  if (n >= 10_000)   return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1_000)    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}`
  if (n >= 1)        return `$${n.toLocaleString('en-US', { maximumFractionDigits: 3 })}`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 6 })}`
}

function fmtLargeUSD(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function fmtFunding(rate: number): string {
  // rate is already annualised %
  const sign = rate >= 0 ? '+' : ''
  return `${sign}${rate.toFixed(2)}%`
}

function fmtChange(pct: number): string {
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = 'coin' | 'markPx' | 'change24h' | 'fundingAnn' | 'openInterest' | 'volume24h'

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      <span className="text-sm">Loading market data…</span>
    </div>
  )
}

// ── Summary stats row ─────────────────────────────────────────────────────────

function StatsRow({ markets }: { markets: HLMarket[] }) {
  const totalOI  = markets.reduce((s, m) => s + m.openInterest, 0)
  const totalVol = markets.reduce((s, m) => s + m.volume24h,    0)
  const avgFund  = markets.length > 0
    ? markets.reduce((s, m) => s + m.fundingAnn, 0) / markets.length
    : 0
  const gainers  = markets.filter(m => m.change24h > 0).length
  const losers   = markets.filter(m => m.change24h < 0).length

  const stats = [
    { label: 'Total Open Interest', value: fmtLargeUSD(totalOI),  icon: '📊', color: 'text-violet-600' },
    { label: '24h Volume',          value: fmtLargeUSD(totalVol), icon: '⚡',  color: 'text-blue-600'   },
    { label: 'Avg Funding (Ann.)',   value: fmtFunding(avgFund),   icon: '💸',  color: avgFund >= 0 ? 'text-emerald-600' : 'text-red-600' },
    { label: 'Gainers / Losers',     value: `${gainers} / ${losers}`, icon: '📈', color: 'text-slate-700' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map(s => (
        <div key={s.label} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <span>{s.icon}</span>
            <p className="text-slate-400 text-xs">{s.label}</p>
          </div>
          <p className={`font-bold text-xl ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Top movers row ────────────────────────────────────────────────────────────

function TopMovers({ markets }: { markets: HLMarket[] }) {
  const sorted  = [...markets].sort((a, b) => b.change24h - a.change24h)
  const gainers = sorted.slice(0, 4)
  const losers  = sorted.slice(-4).reverse()

  const Card = ({ m, gain }: { m: HLMarket; gain: boolean }) => (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${
      gain ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
    }`}>
      <span className={`text-xl font-bold ${gain ? 'text-emerald-600' : 'text-red-500'}`}>
        {gain ? '▲' : '▼'}
      </span>
      <div className="min-w-0">
        <p className="text-slate-900 font-bold text-xs">{m.coin}</p>
        <p className="text-slate-500 text-[10px]">{fmtPrice(m.markPx)}</p>
      </div>
      <span className={`ml-auto font-bold text-sm ${gain ? 'text-emerald-600' : 'text-red-500'}`}>
        {fmtChange(m.change24h)}
      </span>
    </div>
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
          🚀 Top Gainers (24h)
        </p>
        <div className="flex flex-col gap-2">
          {gainers.map(m => <Card key={m.coin} m={m} gain={true} />)}
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
          📉 Top Losers (24h)
        </p>
        <div className="flex flex-col gap-2">
          {losers.map(m => <Card key={m.coin} m={m} gain={false} />)}
        </div>
      </div>
    </div>
  )
}

// ── Funding rate highlights ───────────────────────────────────────────────────

function FundingHighlights({ markets }: { markets: HLMarket[] }) {
  // Ann. funding > 50% = high positive (longs pay shorts) → bears winning
  // Ann. funding < -30% = high negative (shorts pay longs) → bulls winning
  const highPos = [...markets].filter(m => m.fundingAnn > 50)
    .sort((a, b) => b.fundingAnn - a.fundingAnn).slice(0, 6)
  const highNeg = [...markets].filter(m => m.fundingAnn < -30)
    .sort((a, b) => a.fundingAnn - b.fundingAnn).slice(0, 6)

  if (highPos.length === 0 && highNeg.length === 0) return null

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
      <div className="flex items-center gap-2 mb-4">
        <span>💸</span>
        <h3 className="font-bold text-slate-900 text-sm">Extreme Funding Rates</h3>
        <span className="text-xs text-slate-400 ml-1">(Annualised · 8h rate × 3 × 365)</span>
      </div>
      <div className="flex flex-wrap gap-4">
        {highPos.length > 0 && (
          <div className="flex-1 min-w-[200px]">
            <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wider mb-2">
              🔴 Longs pay shorts (bearish pressure)
            </p>
            <div className="flex flex-wrap gap-2">
              {highPos.map(m => (
                <div key={m.coin} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200">
                  <span className="text-slate-700 font-bold text-xs">{m.coin}</span>
                  <span className="text-red-600 font-bold text-xs">{fmtFunding(m.fundingAnn)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {highNeg.length > 0 && (
          <div className="flex-1 min-w-[200px]">
            <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider mb-2">
              🟢 Shorts pay longs (bullish pressure)
            </p>
            <div className="flex flex-wrap gap-2">
              {highNeg.map(m => (
                <div key={m.coin} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200">
                  <span className="text-slate-700 font-bold text-xs">{m.coin}</span>
                  <span className="text-emerald-600 font-bold text-xs">{fmtFunding(m.fundingAnn)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Market table ──────────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="text-slate-300 text-[10px]">⇅</span>
  return <span className="text-violet-600 text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span>
}

function MarketTable({ markets }: { markets: HLMarket[] }) {
  const [sortKey, setSortKey]   = useState<SortKey>('openInterest')
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc')
  const [search,  setSearch]    = useState('')
  const [page,    setPage]      = useState(0)
  const PAGE_SIZE = 20

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
    setPage(0)
  }

  const filtered = useMemo(() => {
    let list = markets
    if (search) list = list.filter(m => m.coin.toLowerCase().includes(search.toLowerCase()))
    return [...list].sort((a, b) => {
      const va = a[sortKey]
      const vb = b[sortKey]
      if (typeof va === 'string' && typeof vb === 'string')
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      return sortDir === 'asc'
        ? (va as number) - (vb as number)
        : (vb as number) - (va as number)
    })
  }, [markets, search, sortKey, sortDir])

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const cols: { key: SortKey; label: string; align: string }[] = [
    { key: 'coin',         label: 'Market',        align: 'text-left'  },
    { key: 'markPx',       label: 'Mark Price',    align: 'text-right' },
    { key: 'change24h',    label: '24h Change',    align: 'text-right' },
    { key: 'fundingAnn',   label: 'Funding (Ann)', align: 'text-right' },
    { key: 'openInterest', label: 'Open Interest', align: 'text-right' },
    { key: 'volume24h',    label: '24h Volume',    align: 'text-right' },
  ]

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Table header controls */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
        <span className="text-slate-900 font-bold text-sm">All Markets</span>
        <span className="text-xs text-slate-400">{filtered.length} perpetuals</span>
        <div className="relative ml-auto">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
          <input
            type="text"
            placeholder="Search coin…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="bg-slate-50 border border-slate-200 rounded-xl pl-7 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-400 w-32"
          />
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] px-5 py-2 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
        {cols.map(c => (
          <button
            key={c.key}
            onClick={() => handleSort(c.key)}
            className={`flex items-center gap-1 hover:text-slate-700 transition-colors ${c.align}`}
          >
            {c.align === 'text-right' && <SortIcon active={sortKey === c.key} dir={sortDir} />}
            {c.label}
            {c.align === 'text-left'  && <SortIcon active={sortKey === c.key} dir={sortDir} />}
          </button>
        ))}
      </div>

      {/* Rows */}
      <div className="divide-y divide-slate-50">
        {paginated.map(m => {
          const changePos  = m.change24h  >= 0
          const fundingPos = m.fundingAnn >= 0

          return (
            <div
              key={m.coin}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] px-5 py-3 items-center hover:bg-slate-50 transition-colors"
            >
              {/* Market */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-100 to-blue-100 border border-violet-200 flex items-center justify-center text-[10px] font-bold text-violet-600">
                  {m.coin.slice(0, 2)}
                </div>
                <div>
                  <p className="text-slate-900 font-bold text-xs">{m.coin}-PERP</p>
                  <p className="text-slate-400 text-[10px]">up to {m.maxLeverage}×</p>
                </div>
              </div>

              {/* Mark price */}
              <p className="text-slate-900 font-mono text-xs text-right">{fmtPrice(m.markPx)}</p>

              {/* 24h change */}
              <p className={`font-bold text-xs text-right ${changePos ? 'text-emerald-600' : 'text-red-500'}`}>
                {fmtChange(m.change24h)}
              </p>

              {/* Funding (annualised) */}
              <div className="text-right">
                <p className={`font-bold text-xs ${fundingPos ? 'text-red-500' : 'text-emerald-600'}`}>
                  {fmtFunding(m.fundingAnn)}
                </p>
                <p className="text-slate-400 text-[9px]">
                  8h: {(m.funding8h * 100).toFixed(4)}%
                </p>
              </div>

              {/* Open interest */}
              <p className="text-slate-700 text-xs text-right font-mono">{fmtLargeUSD(m.openInterest)}</p>

              {/* Volume */}
              <p className="text-slate-700 text-xs text-right font-mono">{fmtLargeUSD(m.volume24h)}</p>
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
          <span className="text-xs text-slate-400">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs disabled:opacity-30 hover:bg-slate-200 transition-colors"
            >← Prev</button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs disabled:opacity-30 hover:bg-slate-200 transition-colors"
            >Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function DerivativesPanel() {
  const { markets, loading, error, updatedAt, refresh } = useHLDerivatives()

  const [view, setView] = useState<'overview' | 'table'>('overview')

  const fmtUpdated = updatedAt
    ? new Date(updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'

  return (
    <div className="flex flex-col gap-5">

      {/* Header banner */}
      <div className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-gradient-to-r from-violet-50 via-blue-50 to-indigo-50 border border-violet-200">
        <span className="text-3xl">⚡</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-slate-900 font-bold text-lg">Perpetual Derivatives</h2>
            <span className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              Live · Hyperliquid Mainnet
            </span>
            <span className="text-xs text-slate-400 px-2 py-0.5 rounded-full bg-white border border-slate-200">
              {markets.length} markets
            </span>
          </div>
          <p className="text-slate-500 text-xs">
            Mark prices · Funding rates · Open interest · 24h volume · Updated every 15s
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <p className="text-xs text-slate-400 hidden sm:block">
            {fmtUpdated !== '—' ? `Updated ${fmtUpdated}` : ''}
          </p>
          <button
            onClick={refresh}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-violet-600 hover:border-violet-300 transition-all"
            title="Refresh"
          >
            🔄
          </button>
          <a
            href="https://app.hyperliquid.xyz/trade"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-xl bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 transition-colors"
          >
            Trade on HL ↗
          </a>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
          <span>⚠</span> {error}
        </div>
      )}

      {loading && markets.length === 0 ? (
        <Spinner />
      ) : (
        <>
          {/* View toggle */}
          <div className="flex gap-2">
            {([
              { key: 'overview', label: '📊 Overview' },
              { key: 'table',    label: '📋 All Markets' },
            ] as const).map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  view === v.key
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Stats always visible */}
          <StatsRow markets={markets} />

          {view === 'overview' && (
            <>
              <TopMovers markets={markets} />
              <FundingHighlights markets={markets} />

              {/* Preview table - top 10 by OI */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                  <span className="text-slate-900 font-bold text-sm">Top 10 by Open Interest</span>
                  <button
                    onClick={() => setView('table')}
                    className="text-xs text-violet-600 hover:text-violet-700 font-medium"
                  >
                    View all {markets.length} markets →
                  </button>
                </div>
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] px-5 py-2 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
                  <span>Market</span>
                  <span className="text-right">Mark Price</span>
                  <span className="text-right">24h Change</span>
                  <span className="text-right">Funding (Ann)</span>
                  <span className="text-right">Open Interest</span>
                  <span className="text-right">24h Volume</span>
                </div>
                <div className="divide-y divide-slate-50">
                  {[...markets]
                    .sort((a, b) => b.openInterest - a.openInterest)
                    .slice(0, 10)
                    .map(m => {
                      const changePos  = m.change24h  >= 0
                      const fundingPos = m.fundingAnn >= 0
                      return (
                        <div key={m.coin}
                          className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] px-5 py-3 items-center hover:bg-slate-50 transition-colors">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-100 to-blue-100 border border-violet-200 flex items-center justify-center text-[10px] font-bold text-violet-600">
                              {m.coin.slice(0, 2)}
                            </div>
                            <div>
                              <p className="text-slate-900 font-bold text-xs">{m.coin}-PERP</p>
                              <p className="text-slate-400 text-[10px]">up to {m.maxLeverage}×</p>
                            </div>
                          </div>
                          <p className="text-slate-900 font-mono text-xs text-right">{fmtPrice(m.markPx)}</p>
                          <p className={`font-bold text-xs text-right ${changePos ? 'text-emerald-600' : 'text-red-500'}`}>
                            {fmtChange(m.change24h)}
                          </p>
                          <div className="text-right">
                            <p className={`font-bold text-xs ${fundingPos ? 'text-red-500' : 'text-emerald-600'}`}>
                              {fmtFunding(m.fundingAnn)}
                            </p>
                            <p className="text-slate-400 text-[9px]">8h: {(m.funding8h * 100).toFixed(4)}%</p>
                          </div>
                          <p className="text-slate-700 text-xs text-right font-mono">{fmtLargeUSD(m.openInterest)}</p>
                          <p className="text-slate-700 text-xs text-right font-mono">{fmtLargeUSD(m.volume24h)}</p>
                        </div>
                      )
                    })}
                </div>
              </div>
            </>
          )}

          {view === 'table' && <MarketTable markets={markets} />}

          {/* Footer */}
          <p className="text-center text-xs text-slate-400 pb-2">
            Data from{' '}
            <a href="https://hyperliquid.xyz" target="_blank" rel="noreferrer" className="text-violet-600 hover:underline">
              Hyperliquid
            </a>{' '}
            Mainnet · For reference only · Not financial advice · Updates every 15s
          </p>
        </>
      )}
    </div>
  )
}
