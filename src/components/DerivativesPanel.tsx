// ── DerivativesPanel.tsx ─────────────────────────────────────────────────────
// On-chain perpetual futures trading on Arc Testnet via ArcPerps contract

import { useState, useCallback } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  usePerpMarkets,
  usePerpPositions,
  usePerpTrade,
} from '../hooks/usePerpsContract'
import type { PerpMarket, PerpPosition } from '../hooks/usePerpsContract'
import { PERPS_ADDRESS, PERPS_COINS } from '../config/contracts'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  if (n === 0) return '—'
  if (n >= 10_000)  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1_000)   return `$${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}`
  if (n >= 1)       return `$${n.toLocaleString('en-US', { maximumFractionDigits: 3 })}`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 5 })}`
}

function fmtUSD(n: number, sign = false): string {
  const s = sign && n > 0 ? '+' : ''
  if (Math.abs(n) >= 1_000_000) return `${s}$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000)     return `${s}$${(n / 1_000).toFixed(1)}K`
  return `${s}$${n.toFixed(2)}`
}

function fmtPct(n: number): string {
  const s = n > 0 ? '+' : ''
  return `${s}${n.toFixed(2)}%`
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
    approving: { cls: 'bg-amber-50 border-amber-200 text-amber-700',   icon: '⏳', label: 'Approving USDC…' },
    sending:   { cls: 'bg-violet-50 border-violet-200 text-violet-700', icon: '⏳', label: 'Sending transaction…' },
    done:      { cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', icon: '✅', label: 'Transaction confirmed!' },
    error:     { cls: 'bg-red-50 border-red-200 text-red-700',          icon: '⚠',  label: error ?? 'Transaction failed' },
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

// ── Market selector ───────────────────────────────────────────────────────────

function MarketSelector({
  selected, markets, onSelect,
}: {
  selected: string
  markets:  PerpMarket[]
  onSelect: (c: string) => void
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {PERPS_COINS.map(coin => {
        const m   = markets.find(x => x.coin === coin)
        const sel = coin === selected
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
            {m && m.price > 0 && (
              <span className={`${sel ? 'text-violet-200' : 'text-slate-400'} text-[10px]`}>
                {fmtPrice(m.price)}
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
  coin,
  market,
  balanceUSDC,
  onOpen,
  txStep,
  txHash,
  txError,
  onReset,
}: {
  coin:       string
  market:     PerpMarket | undefined
  balanceUSDC: number
  onOpen:     (coin: string, isLong: boolean, margin: string, leverage: number) => void
  txStep:     string
  txHash:     string | null
  txError:    string | null
  onReset:    () => void
}) {
  const [side,     setSide]     = useState<'long' | 'short'>('long')
  const [margin,   setMargin]   = useState('')
  const [leverage, setLeverage] = useState(5)

  const price    = market?.price ?? 0
  const marginN  = parseFloat(margin) || 0
  const sizeUsd  = marginN * leverage
  const fee      = sizeUsd * 0.001   // 0.1%
  const liqMove  = price * marginN * 0.95 / sizeUsd
  const liqPrice = side === 'long' ? price - liqMove : price + liqMove

  const canTrade = marginN > 0 && marginN <= balanceUSDC && price > 0

  const handleSubmit = () => {
    if (!canTrade) return
    onOpen(coin, side === 'long', margin, leverage)
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Long / Short toggle */}
      <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
        <button
          onClick={() => setSide('long')}
          className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
            side === 'long'
              ? 'bg-emerald-500 text-white shadow-md'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          ▲ Long
        </button>
        <button
          onClick={() => setSide('short')}
          className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
            side === 'short'
              ? 'bg-red-500 text-white shadow-md'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          ▼ Short
        </button>
      </div>

      {/* Margin input */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Margin (USDC)</label>
          <span className="text-xs text-slate-400">Balance: {balanceUSDC.toFixed(2)} USDC</span>
        </div>
        <div className={`flex items-center gap-2 bg-slate-50 border rounded-xl px-3 py-2.5 focus-within:border-violet-400 transition-colors ${
          marginN > balanceUSDC ? 'border-red-300' : 'border-slate-200'
        }`}>
          <span className="text-slate-400">💵</span>
          <input
            type="number"
            min="0"
            step="1"
            placeholder="0.00"
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

      {/* Leverage slider */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Leverage</label>
          <span className={`text-sm font-bold px-2 py-0.5 rounded-lg ${
            leverage >= 15 ? 'bg-red-50 text-red-600 border border-red-200' :
            leverage >= 8  ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                             'bg-emerald-50 text-emerald-600 border border-emerald-200'
          }`}>{leverage}×</span>
        </div>
        <input
          type="range" min="1" max="20" value={leverage}
          onChange={e => setLeverage(Number(e.target.value))}
          className="w-full accent-violet-600"
        />
        <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
          <span>1×</span><span>5×</span><span>10×</span><span>15×</span><span>20×</span>
        </div>
      </div>

      {/* Order summary */}
      {marginN > 0 && price > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs flex flex-col gap-2">
          <div className="flex justify-between">
            <span className="text-slate-500">Position size</span>
            <span className="text-slate-900 font-semibold">{fmtUSD(sizeUsd)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Entry price</span>
            <span className="text-slate-900 font-semibold">{fmtPrice(price)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Liq. price (est.)</span>
            <span className="text-red-600 font-semibold">{fmtPrice(liqPrice)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Opening fee (0.1%)</span>
            <span className="text-slate-600">{fmtUSD(fee)}</span>
          </div>
        </div>
      )}

      <TxBadge step={txStep} hash={txHash} error={txError} />

      {/* Submit */}
      <button
        onClick={handleSubmit}
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
    </div>
  )
}

// ── Position card ─────────────────────────────────────────────────────────────

function PositionCard({
  pos,
  onClose,
  onAddMargin,
  isClosing,
}: {
  pos:         PerpPosition
  onClose:     (id: bigint) => void
  onAddMargin: (id: bigint, amount: string) => void
  isClosing:   boolean
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [addAmt,  setAddAmt]  = useState('')
  const pnlPos = pos.unrealisedPnl >= 0

  return (
    <div className={`bg-white border rounded-2xl p-4 shadow-sm flex flex-col gap-3 ${
      pos.liquidatable ? 'border-red-300 bg-red-50/30' : 'border-slate-200'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CoinIcon coin={pos.coin} size={8} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-sm">{pos.coin}-PERP</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                pos.isLong
                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                  : 'bg-red-50 text-red-600 border border-red-200'
              }`}>
                {pos.isLong ? '▲ LONG' : '▼ SHORT'} {pos.leverage}×
              </span>
              {pos.liquidatable && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 animate-pulse">
                  ⚠ NEAR LIQ
                </span>
              )}
            </div>
            <p className="text-slate-400 text-[10px] mt-0.5">
              #{pos.id.toString()} · Size {fmtUSD(pos.sizeUsd)} · Entry {fmtPrice(pos.entryPrice)}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className={`font-bold text-base ${pnlPos ? 'text-emerald-600' : 'text-red-500'}`}>
            {fmtUSD(pos.unrealisedPnl, true)}
          </p>
          <p className={`text-[10px] font-semibold ${pnlPos ? 'text-emerald-500' : 'text-red-400'}`}>
            {fmtPct(pos.roe)}
          </p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Margin', value: fmtUSD(pos.margin) },
          { label: 'Liq. Price', value: fmtPrice(pos.liquidationPrice), red: true },
          { label: 'PnL / ROE', value: `${fmtUSD(pos.unrealisedPnl, true)} / ${fmtPct(pos.roe)}`, green: pnlPos },
        ].map(s => (
          <div key={s.label} className="bg-slate-50 rounded-xl p-2 text-center">
            <p className="text-slate-400 text-[10px] mb-0.5">{s.label}</p>
            <p className={`font-bold text-xs ${s.red ? 'text-red-600' : s.green ? 'text-emerald-600' : !pnlPos && s.label === 'PnL / ROE' ? 'text-red-500' : 'text-slate-700'}`}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Add margin form */}
      {showAdd && (
        <div className="flex gap-2">
          <input
            type="number" min="0" placeholder="USDC amount"
            value={addAmt} onChange={e => setAddAmt(e.target.value)}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
          />
          <button
            onClick={() => { onAddMargin(pos.id, addAmt); setShowAdd(false); setAddAmt('') }}
            disabled={!addAmt || parseFloat(addAmt) <= 0}
            className="px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold disabled:opacity-40"
          >Add</button>
          <button onClick={() => setShowAdd(false)}
            className="px-3 py-2 rounded-xl bg-slate-100 text-slate-500 text-xs">Cancel</button>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition-colors"
        >
          + Add Margin
        </button>
        <button
          onClick={() => onClose(pos.id)}
          disabled={isClosing}
          className="flex-1 py-2 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-bold hover:bg-red-100 transition-colors disabled:opacity-40"
        >
          {isClosing ? '⏳ Closing…' : '✕ Close Position'}
        </button>
      </div>
    </div>
  )
}

// ── Market table ──────────────────────────────────────────────────────────────

function MarketsTable({ markets, onSelect }: { markets: PerpMarket[]; onSelect: (c: string) => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="font-bold text-slate-900 text-sm">Markets</span>
        <span className="text-xs text-slate-400">{markets.length} perpetuals · refreshes every 15s</span>
      </div>
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] px-5 py-2 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
        <span>Market</span>
        <span className="text-right">Mark Price</span>
        <span className="text-right">Open Interest</span>
        <span className="text-right">Funding 8h</span>
        <span />
      </div>
      <div className="divide-y divide-slate-50">
        {markets.map(m => (
          <div key={m.coin} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] px-5 py-3 items-center hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-2">
              <CoinIcon coin={m.coin} size={7} />
              <span className="font-bold text-slate-900 text-xs">{m.coin}-PERP</span>
            </div>
            <p className="text-slate-900 font-mono text-xs text-right">{fmtPrice(m.price)}</p>
            <p className="text-slate-600 text-xs text-right font-mono">{fmtUSD(m.openInterest)}</p>
            <p className={`text-xs text-right font-semibold ${m.fundingRate > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
              {m.fundingRate > 0 ? '+' : ''}{m.fundingRate}bps
            </p>
            <button
              onClick={() => onSelect(m.coin)}
              className="ml-3 px-3 py-1.5 rounded-lg bg-violet-50 border border-violet-200 text-violet-600 text-[11px] font-bold hover:bg-violet-100 transition-colors"
            >
              Trade
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function DerivativesPanel() {
  const [selectedCoin, setSelectedCoin] = useState<string>('BTC')
  const [view, setView] = useState<'trade' | 'markets' | 'positions'>('trade')

  const { markets }     = usePerpMarkets()
  const { positions, loading: loadingPos, refetch: refetchPos } = usePerpPositions()
  const {
    openPosition, closePosition, addMargin,
    txStep, txHash, txError, reset,
    balanceUSDC, isConnected,
  } = usePerpTrade()

  const selectedMarket = markets.find(m => m.coin === selectedCoin)
  const openCount      = positions.length

  const handleOpen = useCallback(async (
    coin: string, isLong: boolean, margin: string, leverage: number
  ) => {
    await openPosition(coin, isLong, margin, leverage)
    setTimeout(refetchPos, 5000)
  }, [openPosition, refetchPos])

  const handleClose = useCallback(async (id: bigint) => {
    await closePosition(id)
    setTimeout(refetchPos, 5000)
  }, [closePosition, refetchPos])

  const handleAddMargin = useCallback(async (id: bigint, amount: string) => {
    await addMargin(id, amount)
    setTimeout(refetchPos, 5000)
  }, [addMargin, refetchPos])

  const totalPnl = positions.reduce((s, p) => s + p.unrealisedPnl, 0)

  return (
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-gradient-to-r from-violet-50 via-blue-50 to-indigo-50 border border-violet-200">
        <span className="text-3xl">⚡</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-slate-900 font-bold text-lg">ArcPerps — On-chain Perpetuals</h2>
            <span className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              Live · Arc Testnet
            </span>
          </div>
          <p className="text-slate-500 text-xs">
            Prices from Hyperliquid oracle · USDC collateral · Up to 20× leverage · 0.1% fee
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <a href={`https://testnet.arcscan.app/address/${PERPS_ADDRESS}`}
            target="_blank" rel="noreferrer"
            className="text-xs text-violet-600 hover:underline hidden sm:block">
            {PERPS_ADDRESS.slice(0, 10)}…↗
          </a>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 bg-white border border-slate-200 rounded-2xl p-1.5 shadow-sm">
        {([
          { key: 'trade',     label: '⚡ Trade'          },
          { key: 'markets',   label: '📊 Markets'         },
          { key: 'positions', label: `📋 Positions${openCount > 0 ? ` (${openCount})` : ''}` },
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

      {/* ── TRADE TAB ── */}
      {view === 'trade' && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5">

          {/* Left: market info */}
          <div className="flex flex-col gap-4">

            {/* Coin selector */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Select Market</p>
              <MarketSelector
                selected={selectedCoin}
                markets={markets}
                onSelect={c => { setSelectedCoin(c); reset() }}
              />
            </div>

            {/* Selected market stats */}
            {selectedMarket && (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                <div className="flex items-center gap-3 mb-4">
                  <CoinIcon coin={selectedCoin} size={10} />
                  <div>
                    <h3 className="font-bold text-slate-900 text-lg">{selectedCoin}-PERP</h3>
                    <p className="text-slate-400 text-xs">Arc Testnet Perpetual</p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="font-bold text-2xl text-slate-900">{fmtPrice(selectedMarket.price)}</p>
                    <p className="text-xs text-slate-400">Mark Price</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Open Interest', value: fmtUSD(selectedMarket.openInterest) },
                    { label: 'Funding 8h',    value: `${selectedMarket.fundingRate > 0 ? '+' : ''}${selectedMarket.fundingRate}bps` },
                    { label: 'Max Leverage',  value: '20×' },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-50 rounded-xl p-3 text-center">
                      <p className="text-slate-400 text-[10px] mb-1">{s.label}</p>
                      <p className="font-bold text-slate-700 text-sm">{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Portfolio summary */}
            {isConnected && positions.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Your Portfolio</p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Open Positions', value: String(positions.length), color: 'text-violet-600' },
                    { label: 'Total PnL',       value: fmtUSD(totalPnl, true), color: totalPnl >= 0 ? 'text-emerald-600' : 'text-red-500' },
                    { label: 'USDC Balance',    value: `${balanceUSDC.toFixed(2)}`, color: 'text-slate-700' },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-50 rounded-xl p-3 text-center">
                      <p className="text-slate-400 text-[10px] mb-1">{s.label}</p>
                      <p className={`font-bold text-sm ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: order form */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900">Open Position</h3>
              <span className="text-xs text-slate-400">Balance: <strong className="text-slate-700">{balanceUSDC.toFixed(2)} USDC</strong></span>
            </div>

            {!isConnected ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <p className="text-slate-500 text-sm text-center">Connect your wallet to trade</p>
                <ConnectButton label="Connect Wallet" />
              </div>
            ) : (
              <TradeForm
                coin={selectedCoin}
                market={selectedMarket}
                balanceUSDC={balanceUSDC}
                onOpen={handleOpen}
                txStep={txStep}
                txHash={txHash}
                txError={txError}
                onReset={reset}
              />
            )}

            {/* Info */}
            <div className="mt-4 pt-4 border-t border-slate-100 text-[10px] text-slate-400 space-y-1">
              <p>• Opening fee: 0.1% of position size (both sides)</p>
              <p>• Liquidation when margin ratio &lt; 5%</p>
              <p>• Funding accrues every 8h based on market imbalance</p>
              <p>• Prices updated every ~5 min by oracle script</p>
            </div>
          </div>
        </div>
      )}

      {/* ── MARKETS TAB ── */}
      {view === 'markets' && (
        markets.length === 0
          ? <Spinner label="Loading markets…" />
          : <MarketsTable markets={markets} onSelect={c => { setSelectedCoin(c); setView('trade') }} />
      )}

      {/* ── POSITIONS TAB ── */}
      {view === 'positions' && (
        <div className="flex flex-col gap-4">
          {!isConnected ? (
            <div className="flex flex-col items-center gap-3 py-12 bg-white border border-slate-200 rounded-2xl shadow-sm">
              <p className="text-slate-500 text-sm">Connect wallet to view positions</p>
              <ConnectButton label="Connect Wallet" />
            </div>
          ) : loadingPos ? (
            <Spinner label="Loading positions…" />
          ) : positions.length === 0 ? (
            <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl shadow-sm">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-slate-500 text-sm font-medium">No open positions</p>
              <p className="text-slate-400 text-xs mt-1">Open a position in the Trade tab</p>
              <button onClick={() => setView('trade')}
                className="mt-4 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition-colors">
                Start Trading →
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-900">{positions.length} Open Position{positions.length > 1 ? 's' : ''}</p>
                  <p className={`text-sm font-semibold ${totalPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    Total PnL: {fmtUSD(totalPnl, true)}
                  </p>
                </div>
                <button onClick={refetchPos}
                  className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-500 text-xs hover:border-violet-300 transition-colors">
                  🔄 Refresh
                </button>
              </div>

              {positions.map(pos => (
                <PositionCard
                  key={pos.id.toString()}
                  pos={pos}
                  onClose={handleClose}
                  onAddMargin={handleAddMargin}
                  isClosing={txStep === 'sending'}
                />
              ))}

              <TxBadge step={txStep} hash={txHash} error={txError} />
            </>
          )}
        </div>
      )}

      {/* Footer */}
      <p className="text-center text-xs text-slate-400 pb-2">
        ArcPerps contract:{' '}
        <a href={`https://testnet.arcscan.app/address/${PERPS_ADDRESS}`}
          target="_blank" rel="noreferrer"
          className="text-violet-600 hover:underline font-mono text-[10px]">
          {PERPS_ADDRESS}
        </a>
        {' '}· For testnet use only · Not financial advice
      </p>
    </div>
  )
}
