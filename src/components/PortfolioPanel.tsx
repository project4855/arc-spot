// ── PortfolioPanel.tsx ───────────────────────────────────────────────────────
// Portfolio tracker — real balances + tx history + perps PnL

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAccount, useBalance } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from 'recharts'
import { TOKEN_ADDRESSES } from '../config/contracts'
import { usePerpPositions } from '../hooks/usePerpsContract'
import { useHLDerivatives } from '../hooks/useHyperliquid'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ArcTx {
  hash:      string
  from:      string
  to:        string | null
  value:     string   // wei / raw
  timestamp: number
  status:    'ok' | 'error' | 'pending'
  method:    string | null
  fee:       string
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtUSD(n: number, sign = false): string {
  const s = sign && n > 0 ? '+' : ''
  if (Math.abs(n) >= 1_000_000) return `${s}$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000)     return `${s}$${(n / 1_000).toFixed(2)}K`
  return `${s}$${n.toFixed(2)}`
}

function fmtAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function fmtAge(ts: number): string {
  const diff = Date.now() - ts * 1000
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (days > 0)  return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0)  return `${mins}m ago`
  return 'just now'
}

// ── Live PnL calc (same as DerivativesPanel) ──────────────────────────────────

function calcLivePnl(pos: {
  isLong: boolean; sizeUsd: number; entryPrice: number; margin: number
}, livePrice: number) {
  const price = livePrice > 0 ? livePrice : pos.entryPrice
  const delta = pos.isLong ? price - pos.entryPrice : pos.entryPrice - price
  const pnl   = pos.entryPrice > 0 ? pos.sizeUsd * delta / pos.entryPrice : 0
  const roe   = pos.margin > 0 ? (pnl / pos.margin) * 100 : 0
  return { pnl, roe }
}

// ── Sparkline chart ───────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const points = data.map((v, i) => ({ i, v }))
  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={points} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#spark-${color})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Token balance card ────────────────────────────────────────────────────────

function BalanceCard({
  symbol, icon, balance, usdValue, change24h, sparkData,
}: {
  symbol:    string
  icon:      string
  balance:   number
  usdValue:  number
  change24h: number
  sparkData: number[]
}) {
  const isUp = change24h >= 0
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col gap-2 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-100 flex items-center justify-center text-lg">
            {icon}
          </div>
          <div>
            <p className="font-bold text-slate-900 text-sm">{symbol}</p>
            <p className="text-slate-400 text-[10px]">{balance.toLocaleString('en-US', { maximumFractionDigits: 4 })} {symbol}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-bold text-slate-900 text-sm">{fmtUSD(usdValue)}</p>
          <p className={`text-[11px] font-semibold ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
            {isUp ? '▲' : '▼'} {Math.abs(change24h).toFixed(2)}%
          </p>
        </div>
      </div>
      <Sparkline data={sparkData} color={isUp ? '#10b981' : '#ef4444'} />
    </div>
  )
}

// ── Transaction row ───────────────────────────────────────────────────────────

function TxRow({ tx, myAddress }: { tx: ArcTx; myAddress: string }) {
  const isSend = tx.from?.toLowerCase() === myAddress?.toLowerCase()
  const other  = isSend ? tx.to : tx.from
  const valueUsdc = parseFloat(tx.value || '0') / 1e6  // USDC has 6 decimals on Arc

  return (
    <a
      href={`https://testnet.arcscan.app/tx/${tx.hash}`}
      target="_blank" rel="noreferrer"
      className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
    >
      {/* Direction icon */}
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 ${
        tx.status === 'error' ? 'bg-red-100 text-red-600' :
        isSend ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
      }`}>
        {tx.status === 'error' ? '⚠' : isSend ? '↑' : '↓'}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-900 text-xs font-semibold">
            {tx.status === 'error' ? 'Failed' : isSend ? 'Sent' : 'Received'}
            {tx.method && tx.method !== 'transfer' && (
              <span className="ml-1.5 text-violet-600 font-mono text-[10px] px-1.5 py-0.5 bg-violet-50 rounded">{tx.method}</span>
            )}
          </span>
        </div>
        <p className="text-slate-400 text-[10px] truncate">
          {isSend ? 'To: ' : 'From: '}{fmtAddr(other ?? '—')} · {fmtAge(tx.timestamp)}
        </p>
      </div>

      {/* Value + hash */}
      <div className="text-right shrink-0">
        {valueUsdc > 0 && (
          <p className={`text-sm font-bold ${isSend ? 'text-red-500' : 'text-emerald-600'}`}>
            {isSend ? '-' : '+'}{fmtUSD(valueUsdc)}
          </p>
        )}
        <p className="text-slate-300 text-[10px] font-mono">{tx.hash.slice(0, 10)}…</p>
      </div>
    </a>
  )
}

// ── Fetch tx history from ArcScan ─────────────────────────────────────────────

async function fetchTxHistory(address: string): Promise<ArcTx[]> {
  try {
    // Blockscout v2 API
    const res = await fetch(
      `https://testnet.arcscan.app/api/v2/addresses/${address}/transactions?limit=30&sort=desc`,
    )
    if (!res.ok) throw new Error('API error')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = data?.items ?? data?.result ?? []
    return items.map(t => ({
      hash:      t.hash,
      from:      t.from?.hash ?? t.from ?? '',
      to:        t.to?.hash ?? t.to ?? null,
      value:     t.value ?? '0',
      timestamp: t.timestamp
        ? typeof t.timestamp === 'string'
          ? Math.floor(new Date(t.timestamp).getTime() / 1000)
          : t.timestamp
        : (t.timeStamp ? parseInt(t.timeStamp) : 0),
      status:    t.status === 'ok' || t.isError === '0' ? 'ok' : 'error',
      method:    t.method ?? t.functionName?.split('(')[0] ?? null,
      fee:       t.fee?.value ?? '0',
    }))
  } catch {
    // Fallback to Etherscan-compatible API
    try {
      const res = await fetch(
        `https://testnet.arcscan.app/api?module=account&action=txlist&address=${address}&sort=desc&offset=30`,
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = Array.isArray(data?.result) ? data.result : []
      return items.map(t => ({
        hash:      t.hash,
        from:      t.from,
        to:        t.to || null,
        value:     t.value,
        timestamp: parseInt(t.timeStamp ?? '0'),
        status:    t.isError === '0' ? 'ok' : 'error',
        method:    t.functionName?.split('(')[0] || null,
        fee:       String(parseInt(t.gasUsed ?? '0') * parseInt(t.gasPrice ?? '0')),
      }))
    } catch {
      return []
    }
  }
}

// ── Generate sparkline data (based on balance) ────────────────────────────────

function genSparkline(base: number, volatility: number, len = 20): number[] {
  const arr: number[] = []
  let v = base * (1 - volatility * 2)
  for (let i = 0; i < len; i++) {
    v += (Math.random() - 0.45) * base * volatility
    arr.push(Math.max(0, v))
  }
  arr[arr.length - 1] = base  // end at current value
  return arr
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function PortfolioPanel() {
  const { address, isConnected } = useAccount()

  // ── Token balances ─────────────────────────────────────────────────────────
  const { data: usdcBal, refetch: refetchUsdc } = useBalance({
    address,
    token: TOKEN_ADDRESSES.USDC,
  })
  const { data: eurcBal, refetch: refetchEurc } = useBalance({
    address,
    token: TOKEN_ADDRESSES.EURC,
  })
  const { data: nativeBal, refetch: refetchNative } = useBalance({ address })

  const usdcAmount   = usdcBal   ? parseFloat(usdcBal.formatted)   : 0
  const eurcAmount   = eurcBal   ? parseFloat(eurcBal.formatted)   : 0
  const nativeAmount = nativeBal ? parseFloat(nativeBal.formatted) : 0

  // ── Perps positions ────────────────────────────────────────────────────────
  const { positions } = usePerpPositions()
  const { markets: liveMarkets } = useHLDerivatives()

  const perpsPnl = useMemo(() => positions.reduce((sum, pos) => {
    const livePrice = liveMarkets.find(m => m.coin === pos.coin)?.markPx ?? 0
    return sum + calcLivePnl(pos, livePrice).pnl
  }, 0), [positions, liveMarkets])

  const perpsMargin = positions.reduce((s, p) => s + p.margin, 0)

  // ── Transaction history ────────────────────────────────────────────────────
  const [txs,        setTxs]        = useState<ArcTx[]>([])
  const [txLoading,  setTxLoading]  = useState(false)
  const [txError,    setTxError]    = useState<string | null>(null)
  const [lastFetch,  setLastFetch]  = useState<number | null>(null)

  const loadTxs = useCallback(async () => {
    if (!address) return
    setTxLoading(true)
    setTxError(null)
    try {
      const data = await fetchTxHistory(address)
      setTxs(data)
      setLastFetch(Date.now())
    } catch {
      setTxError('Could not load transaction history')
    } finally {
      setTxLoading(false)
    }
  }, [address])

  useEffect(() => {
    if (isConnected && address) loadTxs()
  }, [isConnected, address, loadTxs])

  const refreshAll = useCallback(() => {
    refetchUsdc()
    refetchEurc()
    refetchNative()
    loadTxs()
  }, [refetchUsdc, refetchEurc, refetchNative, loadTxs])

  // ── Portfolio totals ───────────────────────────────────────────────────────
  // EURC ≈ 1.16 USD (approximate)
  const eurcToUsd    = 1.16
  const totalBalance = usdcAmount + eurcAmount * eurcToUsd + perpsMargin + perpsPnl

  // ── Sparkline data (seeded from balance, stable between renders) ───────────
  const usdcSpark  = useMemo(() => genSparkline(Math.max(usdcAmount, 10),  0.01), [usdcAmount])
  const eurcSpark  = useMemo(() => genSparkline(Math.max(eurcAmount, 10),  0.005), [eurcAmount])

  // ── Portfolio chart (simulated 7-day trend) ────────────────────────────────
  const chartData = useMemo(() => {
    const base = totalBalance || 100
    const arr: { day: string; value: number }[] = []
    let v = base * 0.92
    for (let i = 6; i >= 0; i--) {
      v += (Math.random() - 0.45) * base * 0.015
      const d = new Date(Date.now() - i * 86_400_000)
      arr.push({
        day:   d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: Math.max(0, i === 0 ? base : v),
      })
    }
    return arr
  }, [totalBalance])  // eslint-disable-line react-hooks/exhaustive-deps — regenerate only on balance change

  const chartChange = chartData.length > 1
    ? ((chartData[chartData.length - 1].value - chartData[0].value) / chartData[0].value) * 100
    : 0
  const chartUp = chartChange >= 0

  // ── Allocation data ────────────────────────────────────────────────────────
  const alloc = [
    { label: 'USDC',  value: usdcAmount,              color: '#7c3aed' },
    { label: 'EURC',  value: eurcAmount * eurcToUsd,  color: '#2563eb' },
    { label: 'Perps', value: Math.max(0, perpsMargin + perpsPnl), color: '#059669' },
  ].filter(a => a.value > 0)
  const allocTotal = alloc.reduce((s, a) => s + a.value, 0)

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex flex-col gap-5">
        <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 px-6 py-5 shadow-lg">
          <div className="absolute inset-0 opacity-[0.08] pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
          <div className="relative z-10">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">💼 Portfolio Tracker</h1>
            <p className="text-emerald-100 text-sm mt-1">Real balances · Tx history · Live PnL · On Arc Testnet</p>
          </div>
        </div>
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl py-16 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center text-3xl">💼</div>
          <div className="text-center">
            <p className="text-slate-700 font-bold">Connect your wallet</p>
            <p className="text-slate-400 text-sm mt-1">View your balances, transactions, and PnL</p>
          </div>
          <ConnectButton label="Connect Wallet" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header ── */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 px-6 py-5 shadow-lg">
        <div className="absolute inset-0 opacity-[0.08] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">💼 Portfolio</h1>
            <p className="text-emerald-100 text-xs mt-1 font-mono">{fmtAddr(address ?? '')}</p>
          </div>
          <div className="text-right">
            <p className="text-white/60 text-xs mb-0.5">Total Portfolio Value</p>
            <p className="text-3xl font-extrabold text-white">{fmtUSD(totalBalance)}</p>
            <p className={`text-sm font-semibold mt-0.5 ${chartUp ? 'text-emerald-300' : 'text-red-300'}`}>
              {chartUp ? '▲' : '▼'} {Math.abs(chartChange).toFixed(2)}% (7d)
            </p>
          </div>
        </div>
      </div>

      {/* ── Portfolio chart + allocation ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">

        {/* Chart */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Portfolio Value (7d)</h3>
              <p className="text-slate-400 text-[11px] mt-0.5">Simulated trend based on current balances</p>
            </div>
            <button onClick={refreshAll}
              className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500 text-xs hover:bg-slate-200 transition-colors">
              🔄 Refresh
            </button>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={chartUp ? '#10b981' : '#ef4444'} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={chartUp ? '#10b981' : '#ef4444'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis
                tickFormatter={v => `$${(v as number).toFixed(0)}`}
                tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                width={56} orientation="right"
              />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => [fmtUSD(Number(v)), 'Value']}
                contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '12px', fontSize: 11, color: '#fff' }}
                itemStyle={{ color: '#94a3b8' }}
              />
              <Area type="monotone" dataKey="value"
                stroke={chartUp ? '#10b981' : '#ef4444'} strokeWidth={2}
                fill="url(#portGrad)" dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Allocation */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col gap-4">
          <h3 className="font-bold text-slate-900 text-sm">Allocation</h3>
          {allocTotal > 0 ? (
            <>
              {/* Stacked bar */}
              <div className="h-3 rounded-full overflow-hidden flex gap-0.5">
                {alloc.map(a => (
                  <div key={a.label} style={{ width: `${(a.value / allocTotal) * 100}%`, background: a.color }} className="h-full rounded-sm" />
                ))}
              </div>

              {/* Legend */}
              <div className="flex flex-col gap-2">
                {alloc.map(a => (
                  <div key={a.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: a.color }} />
                      <span className="text-xs text-slate-600 font-medium">{a.label}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-900">{fmtUSD(a.value)}</span>
                      <span className="text-[10px] text-slate-400 ml-1.5">{Math.round((a.value / allocTotal) * 100)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-slate-400 text-sm text-center py-4">No assets found</p>
          )}

          {/* Perps summary */}
          {positions.length > 0 && (
            <div className="border-t border-slate-100 pt-3 flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Perps</p>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Open positions</span>
                <span className="font-bold text-slate-900">{positions.length}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Margin locked</span>
                <span className="font-bold text-slate-900">{fmtUSD(perpsMargin)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Unrealised PnL</span>
                <span className={`font-bold ${perpsPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {fmtUSD(perpsPnl, true)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Token balances ── */}
      <div>
        <h3 className="font-bold text-slate-900 text-sm mb-3">Token Balances</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <BalanceCard
            symbol="USDC" icon="💵"
            balance={usdcAmount} usdValue={usdcAmount}
            change24h={0.02} sparkData={usdcSpark}
          />
          <BalanceCard
            symbol="EURC" icon="💶"
            balance={eurcAmount} usdValue={eurcAmount * eurcToUsd}
            change24h={-0.14} sparkData={eurcSpark}
          />
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 border border-slate-200 flex items-center justify-center text-lg">
                  ⛓
                </div>
                <div>
                  <p className="font-bold text-slate-900 text-sm">Native</p>
                  <p className="text-slate-400 text-[10px]">{nativeAmount.toFixed(6)} {nativeBal?.symbol ?? 'ETH'}</p>
                </div>
              </div>
              <p className="text-slate-500 text-xs text-right">Gas token</p>
            </div>
            <div className="h-1 bg-slate-100 rounded-full mt-1" />
            <p className="text-[10px] text-slate-400 text-center">Gas on Arc is paid in USDC</p>
          </div>
        </div>
      </div>

      {/* ── Transaction history ── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-900 text-sm">Transaction History</h3>
            {txs.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold">
                {txs.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lastFetch && (
              <span className="text-[10px] text-slate-400">
                Updated {fmtAge(Math.floor(lastFetch / 1000))}
              </span>
            )}
            <button onClick={loadTxs} disabled={txLoading}
              className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500 text-xs hover:bg-slate-200 transition-colors disabled:opacity-40">
              {txLoading ? '⏳' : '🔄'} Refresh
            </button>
            <a href={`https://testnet.arcscan.app/address/${address}`}
              target="_blank" rel="noreferrer"
              className="px-3 py-1.5 rounded-xl bg-violet-50 border border-violet-200 text-violet-600 text-xs font-semibold hover:bg-violet-100 transition-colors">
              ArcScan ↗
            </a>
          </div>
        </div>

        {txLoading && txs.length === 0 ? (
          <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <span className="text-sm">Loading transactions…</span>
          </div>
        ) : txError ? (
          <div className="px-5 py-8 text-center">
            <p className="text-slate-400 text-sm">{txError}</p>
            <a href={`https://testnet.arcscan.app/address/${address}`}
              target="_blank" rel="noreferrer"
              className="mt-2 inline-block text-violet-600 text-xs hover:underline">
              View on ArcScan ↗
            </a>
          </div>
        ) : txs.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-slate-500 text-sm font-semibold">No transactions yet</p>
            <p className="text-slate-400 text-xs mt-1">Your transaction history will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {txs.map(tx => (
              <TxRow key={tx.hash} tx={tx} myAddress={address ?? ''} />
            ))}
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="text-center text-[11px] text-slate-400 pb-1">
        💼 Portfolio data from Arc Testnet · Prices approximate · 7-day chart is simulated
      </p>
    </div>
  )
}
