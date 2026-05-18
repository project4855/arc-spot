// ── DerivativesPanel.tsx ─────────────────────────────────────────────────────
// On-chain perpetual futures — real-time prices from Hyperliquid + price chart

import { useState, useCallback, useMemo } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  ResponsiveContainer, AreaChart, BarChart, Area, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import {
  useHLDerivatives,
  useCandleData,
} from '../hooks/useHyperliquid'
import type { HLMarket, CandleInterval } from '../hooks/useHyperliquid'
import {
  usePerpPositions,
  usePerpTrade,
} from '../hooks/usePerpsContract'
import type { PerpPosition } from '../hooks/usePerpsContract'
import { PERPS_ADDRESS, PERPS_COINS } from '../config/contracts'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  if (n === 0) return '—'
  if (n >= 10_000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1_000)  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}`
  if (n >= 1)      return `$${n.toLocaleString('en-US', { maximumFractionDigits: 3 })}`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 5 })}`
}

function fmtUSD(n: number, sign = false): string {
  const s = sign && n > 0 ? '+' : ''
  if (Math.abs(n) >= 1_000_000_000) return `${s}$${(n / 1_000_000_000).toFixed(2)}B`
  if (Math.abs(n) >= 1_000_000)     return `${s}$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000)         return `${s}$${(n / 1_000).toFixed(1)}K`
  return `${s}$${n.toFixed(2)}`
}

function fmtPct(n: number, plus = true): string {
  const s = plus && n > 0 ? '+' : ''
  return `${s}${n.toFixed(2)}%`
}

function fmtTime(ms: number, interval: CandleInterval): string {
  const d = new Date(ms)
  if (interval === '1D') {
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  if (interval === '1h' || interval === '4h') {
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── Coin icon ─────────────────────────────────────────────────────────────────

function CoinIcon({ coin, size = 8 }: { coin: string; size?: number }) {
  return (
    <div className={`w-${size} h-${size} rounded-xl bg-gradient-to-br from-violet-100 to-blue-100 border border-violet-200 flex items-center justify-center text-[11px] font-bold text-violet-700 shrink-0`}>
      {coin.slice(0, 2)}
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      <span className="text-sm">{label}</span>
    </div>
  )
}

// ── Tx Status badge ───────────────────────────────────────────────────────────

function TxBadge({ step, hash, error }: { step: string; hash: string | null; error: string | null }) {
  if (step === 'idle') return null
  const config = {
    approving: { cls: 'bg-amber-50 border-amber-200 text-amber-700',      icon: '⏳', label: 'Approving USDC…' },
    sending:   { cls: 'bg-violet-50 border-violet-200 text-violet-700',   icon: '⏳', label: 'Sending transaction…' },
    done:      { cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', icon: '✅', label: 'Confirmed!' },
    error:     { cls: 'bg-red-50 border-red-200 text-red-700',            icon: '⚠',  label: error ?? 'Transaction failed' },
  }
  const c = config[step as keyof typeof config]
  if (!c) return null
  return (
    <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-xs ${c.cls}`}>
      <span>{c.icon}</span>
      <div className="flex-1">
        <p className="font-semibold">{c.label}</p>
        {hash && step !== 'error' && (
          <a href={`https://testnet.arcscan.app/tx/${hash}`} target="_blank" rel="noreferrer"
            className="underline opacity-70 hover:opacity-100 font-mono text-[10px] block mt-0.5">
            {hash.slice(0, 18)}… ↗ ArcScan
          </a>
        )}
      </div>
    </div>
  )
}

// ── Price chart ───────────────────────────────────────────────────────────────

const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1D']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-slate-900 text-white rounded-xl px-3 py-2 text-[11px] shadow-xl border border-slate-700">
      <p className="text-slate-400 mb-1">{new Date(d.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</p>
      <p className="font-bold">{fmtPrice(d.close)}</p>
      <p className="text-slate-400">O: {fmtPrice(d.open)} H: {fmtPrice(d.high)}</p>
      <p className="text-slate-400">L: {fmtPrice(d.low)}  V: {fmtUSD(d.volume)}</p>
    </div>
  )
}

function PerpChart({ coin, livePrice }: { coin: string; livePrice: number }) {
  const [interval, setInterval] = useState<CandleInterval>('15m')
  const { candles, loading } = useCandleData(coin, interval)

  const last    = candles[candles.length - 1]
  const current = livePrice > 0 ? livePrice : last?.close ?? 0
  const open24  = candles[0]?.open ?? 0
  const change  = open24 > 0 ? ((current - open24) / open24) * 100 : 0
  const isUp    = change >= 0

  const chartData = useMemo(() => candles.map(c => ({
    time:   c.time,
    open:   c.open,
    high:   c.high,
    low:    c.low,
    close:  c.close,
    volume: c.volume,
  })), [candles])

  const [minPrice, maxPrice] = useMemo(() => {
    if (!candles.length) return [0, 1]
    const lows  = candles.map(c => c.low)
    const highs = candles.map(c => c.high)
    const mn = Math.min(...lows)
    const mx = Math.max(...highs)
    const pad = (mx - mn) * 0.05
    return [mn - pad, mx + pad]
  }, [candles])

  const strokeColor = isUp ? '#10b981' : '#ef4444'
  const gradientId  = `grad-${coin}-${isUp ? 'up' : 'dn'}`

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CoinIcon coin={coin} size={9} />
          <div>
            <span className="font-bold text-slate-900 text-base">{coin}-PERP</span>
            <span className={`ml-2 text-sm font-bold ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
              {fmtPrice(current)}
            </span>
          </div>
        </div>
        <span className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${
          isUp ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
               : 'bg-red-50 border border-red-200 text-red-600'
        }`}>
          {isUp ? '▲' : '▼'} {fmtPct(Math.abs(change), false)} (24h)
        </span>

        {/* Interval selector */}
        <div className="flex gap-1 ml-auto bg-slate-100 p-0.5 rounded-xl">
          {INTERVALS.map(iv => (
            <button key={iv}
              onClick={() => setInterval(iv)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                interval === iv
                  ? 'bg-white text-violet-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}>
              {iv}
            </button>
          ))}
        </div>
      </div>

      {/* Chart area */}
      {loading && candles.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center">
          <Spinner label="Loading chart…" />
        </div>
      ) : candles.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">
          No chart data available
        </div>
      ) : (
        <>
          {/* Price area chart */}
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={strokeColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={strokeColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="time"
                tickFormatter={t => fmtTime(t as number, interval)}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickLine={false} axisLine={false} minTickGap={50}
              />
              <YAxis
                domain={[minPrice, maxPrice]}
                tickFormatter={v => fmtPrice(v as number)}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                tickLine={false} axisLine={false}
                width={64} orientation="right"
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone" dataKey="close"
                stroke={strokeColor} strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                dot={false} activeDot={{ r: 3, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>

          {/* Volume bar chart */}
          <ResponsiveContainer width="100%" height={48}>
            <BarChart data={chartData} margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="time" hide />
              <YAxis hide />
              <Tooltip content={() => null} />
              <Bar dataKey="volume" fill={strokeColor} opacity={0.35} radius={[1, 1, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}

// ── Coin selector ─────────────────────────────────────────────────────────────

function MarketSelector({
  selected, markets, onSelect,
}: {
  selected: string
  markets:  HLMarket[]
  onSelect: (c: string) => void
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {(PERPS_COINS as readonly string[]).map(coin => {
        const m   = markets.find(x => x.coin === coin)
        const sel = coin === selected
        const up  = (m?.change24h ?? 0) >= 0
        return (
          <button
            key={coin}
            onClick={() => onSelect(coin)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
              sel
                ? 'bg-violet-600 border-violet-500 text-white shadow-sm'
                : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300 hover:text-slate-900'
            }`}
          >
            <span className={`font-bold ${sel ? 'text-white' : 'text-violet-600'}`}>{coin}</span>
            {m && m.markPx > 0 && (
              <span className="flex flex-col items-end leading-none gap-0.5">
                <span className={`${sel ? 'text-violet-200' : 'text-slate-500'} text-[10px] font-mono`}>
                  {fmtPrice(m.markPx)}
                </span>
                <span className={`text-[9px] font-semibold ${
                  sel ? (up ? 'text-emerald-300' : 'text-red-300')
                      : (up ? 'text-emerald-600' : 'text-red-500')
                }`}>
                  {fmtPct(m.change24h)}
                </span>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Trade form ────────────────────────────────────────────────────────────────

function TradeForm({
  coin, market, balanceUSDC, onOpen, txStep, txHash, txError, onReset,
}: {
  coin:        string
  market:      HLMarket | undefined
  balanceUSDC: number
  onOpen:      (coin: string, isLong: boolean, margin: string, leverage: number) => void
  txStep:      string
  txHash:      string | null
  txError:     string | null
  onReset:     () => void
}) {
  const [side,     setSide]     = useState<'long' | 'short'>('long')
  const [margin,   setMargin]   = useState('')
  const [leverage, setLeverage] = useState(5)

  const price   = market?.markPx ?? 0
  const marginN = parseFloat(margin) || 0
  const sizeUsd = marginN * leverage
  const fee     = sizeUsd * 0.001
  const liqMove = price > 0 ? price * marginN * 0.95 / sizeUsd : 0
  const liqPrice = side === 'long' ? price - liqMove : price + liqMove

  const canTrade = marginN > 0 && marginN <= balanceUSDC && price > 0

  return (
    <div className="flex flex-col gap-4">

      {/* Long / Short */}
      <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
        {(['long', 'short'] as const).map(s => (
          <button key={s} onClick={() => setSide(s)}
            className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
              side === s
                ? s === 'long' ? 'bg-emerald-500 text-white shadow-md'
                               : 'bg-red-500 text-white shadow-md'
                : 'text-slate-500 hover:text-slate-700'
            }`}>
            {s === 'long' ? '▲ Long' : '▼ Short'}
          </button>
        ))}
      </div>

      {/* Margin input */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Margin (USDC)</label>
          <span className="text-xs text-slate-400">Bal: <strong>{balanceUSDC.toFixed(2)}</strong></span>
        </div>
        <div className={`flex items-center gap-2 bg-slate-50 border rounded-xl px-3 py-2.5 focus-within:border-violet-400 transition-colors ${marginN > balanceUSDC ? 'border-red-300' : 'border-slate-200'}`}>
          <span className="text-slate-400 text-sm">💵</span>
          <input
            type="number" min="0" step="1" placeholder="0.00"
            value={margin}
            onChange={e => { setMargin(e.target.value); onReset() }}
            className="flex-1 bg-transparent text-slate-900 font-bold text-lg outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-slate-500 text-sm font-semibold">USDC</span>
        </div>
        <div className="flex gap-1.5 mt-2">
          {[5, 10, 25, 50].map(v => (
            <button key={v} onClick={() => { setMargin(String(v)); onReset() }}
              className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 text-xs transition-colors">
              ${v}
            </button>
          ))}
          <button onClick={() => { setMargin(String(Math.floor(balanceUSDC))); onReset() }}
            className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 text-xs transition-colors ml-auto">
            Max
          </button>
        </div>
      </div>

      {/* Leverage */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Leverage</label>
          <span className={`text-sm font-bold px-2 py-0.5 rounded-lg border ${
            leverage >= 15 ? 'bg-red-50 text-red-600 border-red-200' :
            leverage >= 8  ? 'bg-amber-50 text-amber-600 border-amber-200' :
                             'bg-emerald-50 text-emerald-600 border-emerald-200'
          }`}>{leverage}×</span>
        </div>
        <input type="range" min="1" max="20" value={leverage}
          onChange={e => setLeverage(Number(e.target.value))}
          className="w-full accent-violet-600" />
        <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
          {['1×', '5×', '10×', '15×', '20×'].map(l => <span key={l}>{l}</span>)}
        </div>
      </div>

      {/* Order summary */}
      {marginN > 0 && price > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs flex flex-col gap-2">
          {[
            { label: 'Position size',    value: fmtUSD(sizeUsd),   cls: 'text-slate-900 font-semibold' },
            { label: 'Entry price',      value: fmtPrice(price),    cls: 'text-slate-900 font-semibold' },
            { label: 'Liq. price (est.)', value: fmtPrice(liqPrice), cls: 'text-red-600 font-semibold' },
            { label: 'Opening fee (0.1%)', value: fmtUSD(fee),      cls: 'text-slate-600' },
          ].map(r => (
            <div key={r.label} className="flex justify-between">
              <span className="text-slate-500">{r.label}</span>
              <span className={r.cls}>{r.value}</span>
            </div>
          ))}
        </div>
      )}

      <TxBadge step={txStep} hash={txHash} error={txError} />

      <button
        onClick={() => canTrade && onOpen(coin, side === 'long', margin, leverage)}
        disabled={!canTrade || txStep === 'approving' || txStep === 'sending'}
        className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
          !canTrade || txStep === 'approving' || txStep === 'sending'
            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
            : side === 'long'
              ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white hover:from-emerald-400 hover:to-green-400 shadow-lg shadow-emerald-900/20'
              : 'bg-gradient-to-r from-red-500 to-rose-500 text-white hover:from-red-400 hover:to-rose-400 shadow-lg shadow-red-900/20'
        }`}
      >
        {txStep === 'approving' ? '⏳ Approving USDC…' :
         txStep === 'sending'   ? '⏳ Opening Position…' :
         side === 'long'
           ? `▲ Long ${coin} ${leverage}× — ${fmtUSD(sizeUsd)}`
           : `▼ Short ${coin} ${leverage}× — ${fmtUSD(sizeUsd)}`}
      </button>

      {marginN > balanceUSDC && (
        <p className="text-center text-xs text-red-500">Insufficient USDC balance</p>
      )}

      <div className="pt-1 border-t border-slate-100 text-[10px] text-slate-400 space-y-0.5">
        <p>• 0.1% opening fee · Liquidation at 5% margin ratio</p>
        <p>• Funding accrues every 8h · Prices from Hyperliquid oracle</p>
      </div>
    </div>
  )
}

// ── Position card ─────────────────────────────────────────────────────────────

/** Recalculate unrealised PnL + ROE from a live mark price */
function calcLivePnl(pos: PerpPosition, livePrice: number): { pnl: number; roe: number; nearLiq: boolean } {
  const price = livePrice > 0 ? livePrice : pos.entryPrice
  const priceDelta = pos.isLong ? price - pos.entryPrice : pos.entryPrice - price
  const pnl  = pos.entryPrice > 0 ? pos.sizeUsd * priceDelta / pos.entryPrice : 0
  const roe  = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0
  // Warn if margin ratio < 10% (approaching 5% liquidation threshold)
  const marginRatio = pos.sizeUsd > 0 ? (pos.margin + pnl) / pos.sizeUsd : 1
  return { pnl, roe, nearLiq: marginRatio < 0.10 }
}

function PositionCard({
  pos, livePrice, onClose, onAddMargin, isClosing,
}: {
  pos:         PerpPosition
  livePrice:   number          // live mark price from Hyperliquid
  onClose:     (id: bigint) => void
  onAddMargin: (id: bigint, amount: string) => void
  isClosing:   boolean
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [addAmt,  setAddAmt]  = useState('')

  const { pnl, roe, nearLiq } = calcLivePnl(pos, livePrice)
  const pnlPos = pnl >= 0
  const currentPrice = livePrice > 0 ? livePrice : pos.entryPrice

  return (
    <div className={`bg-white border rounded-2xl p-4 shadow-sm flex flex-col gap-3 ${nearLiq ? 'border-red-300 bg-red-50/30' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CoinIcon coin={pos.coin} size={8} />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-900 text-sm">{pos.coin}-PERP</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                pos.isLong ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                           : 'bg-red-50 text-red-600 border border-red-200'
              }`}>{pos.isLong ? '▲ LONG' : '▼ SHORT'} {pos.leverage}×</span>
              {nearLiq && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 animate-pulse">⚠ NEAR LIQ</span>
              )}
            </div>
            <p className="text-slate-400 text-[10px] mt-0.5">
              #{pos.id.toString()} · Size {fmtUSD(pos.sizeUsd)} · Entry {fmtPrice(pos.entryPrice)}
            </p>
          </div>
        </div>
        {/* Live PnL — updates every 5s with mark price */}
        <div className="text-right">
          <p className={`font-bold text-base ${pnlPos ? 'text-emerald-600' : 'text-red-500'}`}>{fmtUSD(pnl, true)}</p>
          <p className={`text-[10px] font-semibold ${pnlPos ? 'text-emerald-500' : 'text-red-400'}`}>{fmtPct(roe)}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Margin',       value: fmtUSD(pos.margin),             cls: 'text-slate-700' },
          { label: 'Mark Price',   value: fmtPrice(currentPrice),          cls: pnlPos ? 'text-emerald-600' : 'text-red-500' },
          { label: 'Liq. Price',   value: fmtPrice(pos.liquidationPrice),  cls: 'text-red-600' },
          { label: 'PnL / ROE',    value: `${fmtUSD(pnl, true)} / ${fmtPct(roe)}`, cls: pnlPos ? 'text-emerald-600' : 'text-red-500' },
        ].map(s => (
          <div key={s.label} className="bg-slate-50 rounded-xl p-2 text-center">
            <p className="text-slate-400 text-[10px] mb-0.5">{s.label}</p>
            <p className={`font-bold text-xs ${s.cls}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="flex gap-2">
          <input type="number" min="0" placeholder="USDC to add"
            value={addAmt} onChange={e => setAddAmt(e.target.value)}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400" />
          <button onClick={() => { onAddMargin(pos.id, addAmt); setShowAdd(false); setAddAmt('') }}
            disabled={!addAmt || parseFloat(addAmt) <= 0}
            className="px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold disabled:opacity-40">Add</button>
          <button onClick={() => setShowAdd(false)} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-500 text-xs">✕</button>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => setShowAdd(v => !v)}
          className="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition-colors">
          + Add Margin
        </button>
        <button onClick={() => onClose(pos.id)} disabled={isClosing}
          className="flex-1 py-2 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-bold hover:bg-red-100 transition-colors disabled:opacity-40">
          {isClosing ? '⏳ Closing…' : '✕ Close'}
        </button>
      </div>
    </div>
  )
}

// ── Markets table ─────────────────────────────────────────────────────────────

function MarketsTable({
  markets, updatedAt, onSelect,
}: {
  markets:   HLMarket[]
  updatedAt: number | null
  onSelect:  (c: string) => void
}) {
  const filtered = (PERPS_COINS as readonly string[])
    .map(coin => markets.find(m => m.coin === coin))
    .filter(Boolean) as HLMarket[]

  const age = updatedAt ? Math.floor((Date.now() - updatedAt) / 1000) : null

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <span className="font-bold text-slate-900 text-sm">{filtered.length} Perpetual Markets</span>
        <div className="flex items-center gap-2">
          {age !== null && (
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              Updated {age}s ago
            </span>
          )}
        </div>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] px-5 py-2 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
        <span>Market</span>
        <span className="text-right">Price</span>
        <span className="text-right">24h %</span>
        <span className="text-right">Open Interest</span>
        <span className="text-right">Funding 8h</span>
        <span />
      </div>

      <div className="divide-y divide-slate-50">
        {filtered.map(m => {
          const up = m.change24h >= 0
          const fundingUp = m.funding8h >= 0
          return (
            <div key={m.coin}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] px-5 py-3 items-center hover:bg-slate-50 transition-colors cursor-pointer"
              onClick={() => onSelect(m.coin)}>
              <div className="flex items-center gap-2">
                <CoinIcon coin={m.coin} size={7} />
                <div>
                  <span className="font-bold text-slate-900 text-xs">{m.coin}-PERP</span>
                  <p className="text-[10px] text-slate-400">{m.maxLeverage}× max</p>
                </div>
              </div>
              <p className="text-slate-900 font-mono text-xs text-right font-semibold">{fmtPrice(m.markPx)}</p>
              <p className={`text-xs text-right font-bold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
                {fmtPct(m.change24h)}
              </p>
              <p className="text-slate-600 text-xs text-right font-mono">{fmtUSD(m.openInterest)}</p>
              <p className={`text-xs text-right font-semibold ${fundingUp ? 'text-red-500' : 'text-emerald-600'}`}>
                {fundingUp ? '+' : ''}{(m.funding8h * 100).toFixed(4)}%
              </p>
              <button
                onClick={e => { e.stopPropagation(); onSelect(m.coin) }}
                className="ml-3 px-3 py-1.5 rounded-lg bg-violet-50 border border-violet-200 text-violet-600 text-[11px] font-bold hover:bg-violet-100 transition-colors">
                Trade
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function DerivativesPanel() {
  const [coin,  setCoin]  = useState('BTC')
  const [view,  setView]  = useState<'trade' | 'markets'>('trade')

  // Live data from Hyperliquid (5s)
  const { markets: liveMarkets, updatedAt, error: mktError } = useHLDerivatives()
  const selectedMarket = liveMarkets.find(m => m.coin === coin)

  // On-chain positions + trading
  const { positions, loading: loadingPos, refetch: refetchPos } = usePerpPositions()
  const { openPosition, closePosition, addMargin, txStep, txHash, txError, reset, balanceUSDC, isConnected } = usePerpTrade()

  const openCount = positions.length

  // Helper: get live mark price for a coin (falls back to entry price)
  const getLivePrice = useCallback(
    (positionCoin: string) => liveMarkets.find(m => m.coin === positionCoin)?.markPx ?? 0,
    [liveMarkets],
  )

  // Total PnL recalculated from live prices every 5s
  const totalPnl = useMemo(
    () => positions.reduce((sum, p) => sum + calcLivePnl(p, getLivePrice(p.coin)).pnl, 0),
    [positions, getLivePrice],
  )

  const handleOpen = useCallback(async (c: string, isLong: boolean, margin: string, leverage: number) => {
    await openPosition(c, isLong, margin, leverage)
    setTimeout(refetchPos, 5_000)
  }, [openPosition, refetchPos])

  const handleClose = useCallback(async (id: bigint) => {
    await closePosition(id)
    setTimeout(refetchPos, 5_000)
  }, [closePosition, refetchPos])

  const handleAddMargin = useCallback(async (id: bigint, amount: string) => {
    await addMargin(id, amount)
    setTimeout(refetchPos, 5_000)
  }, [addMargin, refetchPos])

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header ── */}
      <div className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-gradient-to-r from-violet-50 via-blue-50 to-indigo-50 border border-violet-200">
        <span className="text-3xl">⚡</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-slate-900 font-bold text-lg">ArcPerps — On-chain Perpetuals</h2>
            <span className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              Live · Prices refresh every 5s
            </span>
          </div>
          <p className="text-slate-500 text-xs">
            Real-time prices from Hyperliquid · USDC collateral · Up to 20× leverage · 0.1% fee
          </p>
        </div>
        <a href={`https://testnet.arcscan.app/address/${PERPS_ADDRESS}`}
          target="_blank" rel="noreferrer"
          className="text-xs text-violet-600 hover:underline hidden sm:block shrink-0">
          Contract ↗
        </a>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-2 bg-white border border-slate-200 rounded-2xl p-1.5 shadow-sm">
        {([
          { key: 'trade',   label: '⚡ Trade'   },
          { key: 'markets', label: '📊 Markets'  },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setView(t.key)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
              view === t.key
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {mktError && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
          <span>⚠</span> {mktError}
        </div>
      )}

      {/* ══ TRADE TAB ══ */}
      {view === 'trade' && (
        <div className="flex flex-col gap-4">

          {/* Coin selector */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select Market</p>
              {updatedAt && (
                <span className="text-[10px] text-slate-400">
                  Last update: {Math.floor((Date.now() - updatedAt) / 1000)}s ago
                </span>
              )}
            </div>
            <MarketSelector selected={coin} markets={liveMarkets} onSelect={c => { setCoin(c); reset() }} />
          </div>

          {/* Chart + Order form */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5">

            {/* Left: Chart */}
            <div className="flex flex-col gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                <PerpChart coin={coin} livePrice={selectedMarket?.markPx ?? 0} />
              </div>

              {/* Stats row */}
              {selectedMarket && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Mark Price',     value: fmtPrice(selectedMarket.markPx),                             cls: 'text-slate-900' },
                    { label: '24h Change',      value: fmtPct(selectedMarket.change24h),                           cls: selectedMarket.change24h >= 0 ? 'text-emerald-600' : 'text-red-500' },
                    { label: 'Open Interest',  value: fmtUSD(selectedMarket.openInterest),                         cls: 'text-slate-700' },
                    { label: 'Funding 8h',     value: `${selectedMarket.funding8h >= 0 ? '+' : ''}${(selectedMarket.funding8h * 100).toFixed(4)}%`, cls: selectedMarket.funding8h >= 0 ? 'text-red-500' : 'text-emerald-600' },
                  ].map(s => (
                    <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-sm">
                      <p className="text-slate-400 text-[10px] mb-1">{s.label}</p>
                      <p className={`font-bold text-sm ${s.cls}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
              )}

            </div>

            {/* Right: Order form */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-900">Open Position</h3>
                <span className="text-xs text-slate-400">Bal: <strong className="text-slate-700">{balanceUSDC.toFixed(2)} USDC</strong></span>
              </div>

              {!isConnected ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <p className="text-slate-500 text-sm text-center">Connect wallet to trade</p>
                  <ConnectButton label="Connect Wallet" />
                </div>
              ) : (
                <TradeForm
                  coin={coin}
                  market={selectedMarket}
                  balanceUSDC={balanceUSDC}
                  onOpen={handleOpen}
                  txStep={txStep}
                  txHash={txHash}
                  txError={txError}
                  onReset={reset}
                />
              )}
            </div>
          </div>

          {/* ── Your Positions (inline, always visible in Trade tab) ── */}
          {isConnected && (
            <div className="flex flex-col gap-3">
              {/* Section header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="font-bold text-slate-900 text-sm">
                    Your Positions
                    {openCount > 0 && (
                      <span className="ml-2 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[11px] font-bold">
                        {openCount}
                      </span>
                    )}
                  </h3>
                  {openCount > 0 && (
                    <span className={`text-xs font-semibold ${totalPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      Total PnL: {fmtUSD(totalPnl, true)}
                    </span>
                  )}
                </div>
                {openCount > 0 && (
                  <button onClick={refetchPos}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-500 text-xs hover:border-violet-300 transition-colors">
                    🔄 Refresh
                  </button>
                )}
              </div>

              {loadingPos ? (
                <Spinner label="Loading positions…" />
              ) : positions.length === 0 ? (
                <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-8 text-center">
                  <p className="text-slate-400 text-sm">No open positions yet</p>
                  <p className="text-slate-300 text-xs mt-1">Open a position above to get started</p>
                </div>
              ) : (
                <>
                  {positions.map(pos => (
                    <PositionCard key={pos.id.toString()} pos={pos}
                      livePrice={getLivePrice(pos.coin)}
                      onClose={handleClose} onAddMargin={handleAddMargin}
                      isClosing={txStep === 'sending'} />
                  ))}
                  <TxBadge step={txStep} hash={txHash} error={txError} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══ MARKETS TAB ══ */}
      {view === 'markets' && (
        liveMarkets.length === 0
          ? <Spinner label="Loading markets…" />
          : <MarketsTable markets={liveMarkets} updatedAt={updatedAt} onSelect={c => { setCoin(c); setView('trade') }} />
      )}

      <p className="text-center text-xs text-slate-400 pb-2">
        ArcPerps:{' '}
        <a href={`https://testnet.arcscan.app/address/${PERPS_ADDRESS}`}
          target="_blank" rel="noreferrer"
          className="text-violet-600 hover:underline font-mono text-[10px]">
          {PERPS_ADDRESS}
        </a>
        {' '}· Testnet only · Not financial advice
      </p>
    </div>
  )
}
