// ── PaymentsPanel.tsx ────────────────────────────────────────────────────────
// USDC Payments Infrastructure on Arc
//  1. Quick USDC Send — USDC-denominated fees, <1s finality indicator
//  2. Bulk Distribution — multi-recipient batch
//  3. Programmable Flows — scheduled / stream payments (simulated)
//  4. Finality Tracker — live confirmation timing

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  useAccount, useBalance, useWriteContract,
  usePublicClient,
} from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { isAddress, parseUnits, encodeFunctionData } from 'viem'
import { TOKEN_ADDRESSES } from '../config/contracts'

// ── Minimal ERC-20 transfer ABI ───────────────────────────────────────────────

const TRANSFER_ABI = [
  {
    name: 'transfer', type: 'function' as const,
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelTab = 'send' | 'bulk' | 'flows' | 'finality'

interface FinalityRecord {
  id:          string
  hash:        string
  to:          string
  amount:      number
  sentAt:      number          // Date.now()
  confirmedAt: number | null
  finalityMs:  number | null
  status:      'pending' | 'confirmed' | 'failed'
  fee:         number | null   // USDC
}

interface BulkRow {
  id:      string
  address: string
  amount:  string
  valid:   boolean
}

interface PaymentFlow {
  id:        string
  name:      string
  recipient: string
  amount:    number        // USDC per period
  period:    'hourly' | 'daily' | 'weekly' | 'monthly'
  active:    boolean
  nextRun:   number        // unix ms
  totalSent: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUSDC(n: number): string {
  if (n === 0) return '0.00'
  if (Math.abs(n) < 0.001) return n.toFixed(6)
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function fmtAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}

function fmtMs(ms: number): string {
  if (ms < 1000)  return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtNextRun(ms: number): string {
  const diff = ms - Date.now()
  if (diff < 0) return 'Due now'
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (days > 0)  return `in ${days}d ${hours % 24}h`
  if (hours > 0) return `in ${hours}h ${mins % 60}m`
  return `in ${mins}m`
}

function newId() { return Math.random().toString(36).slice(2, 9) }

function periodMs(p: PaymentFlow['period']): number {
  return { hourly: 3_600_000, daily: 86_400_000, weekly: 604_800_000, monthly: 2_592_000_000 }[p]
}

// ── TxStatus badge ────────────────────────────────────────────────────────────

function TxStatus({ rec }: { rec: FinalityRecord }) {
  if (rec.status === 'pending') {
    return (
      <span className="flex items-center gap-1 text-amber-600 text-[11px] font-semibold">
        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        Pending…
      </span>
    )
  }
  if (rec.status === 'failed') {
    return <span className="text-red-500 text-[11px] font-semibold">⚠ Failed</span>
  }
  return (
    <span className="flex items-center gap-1 text-emerald-600 text-[11px] font-bold">
      ⚡ {rec.finalityMs !== null ? fmtMs(rec.finalityMs) : '✓'}
    </span>
  )
}

// ── 1. Quick USDC Send ────────────────────────────────────────────────────────

function QuickSendSection({
  address, balanceUsdc, onTxSent,
}: {
  address:     `0x${string}` | undefined
  balanceUsdc: number
  onTxSent:    (rec: FinalityRecord) => void
}) {
  const [to,      setTo]      = useState('')
  const [amount,  setAmount]  = useState('')
  const [feeEst,  setFeeEst]  = useState<number | null>(null)
  const [txStep,  setTxStep]  = useState<'idle' | 'estimating' | 'sending' | 'done' | 'error'>('idle')
  const [lastRec, setLastRec] = useState<FinalityRecord | null>(null)
  const sentAt = useRef<number>(0)

  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const amountN      = parseFloat(amount) || 0
  const toValid      = isAddress(to)
  const amountValid  = amountN > 0 && amountN <= balanceUsdc
  const canSend      = toValid && amountValid && txStep === 'idle'

  // Estimate fee when inputs change
  useEffect(() => {
    if (!toValid || !amountValid || !publicClient || !address) { setFeeEst(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const data = encodeFunctionData({
          abi:          TRANSFER_ABI,
          functionName: 'transfer',
          args:         [to as `0x${string}`, parseUnits(amount, 6)],
        })
        const [gasEst, gasPrice] = await Promise.all([
          publicClient.estimateGas({ account: address, to: TOKEN_ADDRESSES.USDC, data }),
          publicClient.getGasPrice(),
        ])
        const feeWei  = gasEst * gasPrice
        // Arc native currency has 18 decimals, valued 1:1 with USDC
        const feeUsdc = Number(feeWei) / 1e18
        if (!cancelled) setFeeEst(feeUsdc > 0 ? feeUsdc : 0.0001)
      } catch {
        if (!cancelled) setFeeEst(0.0001)  // fallback estimate
      }
    })()
    return () => { cancelled = true }
  }, [to, amount, toValid, amountValid, address, publicClient])

  const handleSend = useCallback(async () => {
    if (!canSend || !address) return
    setTxStep('sending')
    sentAt.current = Date.now()
    const recId = newId()

    const pending: FinalityRecord = {
      id: recId, hash: '', to, amount: amountN,
      sentAt: sentAt.current, confirmedAt: null, finalityMs: null,
      status: 'pending', fee: feeEst,
    }
    onTxSent(pending)
    setLastRec(pending)

    try {
      const hash = await writeContractAsync({
        address:      TOKEN_ADDRESSES.USDC,
        abi:          TRANSFER_ABI,
        functionName: 'transfer',
        args:         [to as `0x${string}`, parseUnits(amount, 6)],
      })

      const updated = { ...pending, hash }
      setLastRec(updated)
      onTxSent(updated)

      // Wait for confirmation
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        const confirmedAt  = Date.now()
        const finalityMs   = confirmedAt - sentAt.current
        const confirmed: FinalityRecord = {
          ...updated,
          confirmedAt, finalityMs,
          status: receipt.status === 'success' ? 'confirmed' : 'failed',
        }
        setLastRec(confirmed)
        onTxSent(confirmed)
      }

      setTxStep('done')
      setTo('')
      setAmount('')
      setTimeout(() => setTxStep('idle'), 4000)
    } catch (e) {
      console.error(e)
      const failed: FinalityRecord = { ...pending, status: 'failed' }
      setLastRec(failed)
      onTxSent(failed)
      setTxStep('error')
      setTimeout(() => setTxStep('idle'), 4000)
    }
  }, [canSend, address, to, amount, amountN, feeEst, onTxSent, writeContractAsync, publicClient])

  return (
    <div className="flex flex-col gap-4">

      {/* ── Fee comparison banner ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Fee (this tx)',     value: feeEst !== null ? `~$${fmtUSDC(feeEst)}` : '…',  sub: 'in USDC',          color: 'text-violet-700 bg-violet-50 border-violet-200' },
          { label: 'Finality',          value: '< 1 second',                                      sub: 'deterministic',    color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
          { label: 'vs Ethereum',       value: '~100× cheaper',                                   sub: 'avg $2–5 ETH gas', color: 'text-blue-700 bg-blue-50 border-blue-200' },
        ].map(s => (
          <div key={s.label} className={`border rounded-2xl p-3 text-center ${s.color}`}>
            <p className="font-extrabold text-base">{s.value}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider mt-0.5 opacity-70">{s.sub}</p>
            <p className="text-[11px] mt-1 opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Send form ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
        <h3 className="font-bold text-slate-900 text-sm">Send USDC</h3>

        {/* To address */}
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
            Recipient Address
          </label>
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 focus-within:border-violet-400 transition-colors ${
            to && !toValid ? 'border-red-300 bg-red-50/30' : 'border-slate-200 bg-slate-50'
          }`}>
            <span className="text-slate-400 text-sm shrink-0">👤</span>
            <input
              value={to} onChange={e => setTo(e.target.value.trim())}
              placeholder="0x..."
              className="flex-1 bg-transparent text-slate-900 text-sm outline-none font-mono min-w-0"
            />
            {toValid && <span className="text-emerald-500 text-xs font-bold shrink-0">✓</span>}
          </div>
          {to && !toValid && <p className="text-red-500 text-[11px] mt-1">Invalid address</p>}
        </div>

        {/* Amount */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount (USDC)</label>
            <span className="text-xs text-slate-400">
              Bal: <button onClick={() => setAmount(Math.floor(balanceUsdc).toString())}
                className="font-bold text-violet-600 hover:text-violet-700 transition-colors">
                ${fmtUSDC(balanceUsdc)}
              </button>
            </span>
          </div>
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 focus-within:border-violet-400 transition-colors ${
            amountN > balanceUsdc ? 'border-red-300 bg-red-50/30' : 'border-slate-200 bg-slate-50'
          }`}>
            <span className="text-slate-400 text-sm shrink-0">💵</span>
            <input
              type="number" min="0" placeholder="0.00" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="flex-1 bg-transparent text-slate-900 font-bold text-lg outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-slate-500 font-semibold text-sm shrink-0">USDC</span>
          </div>
          <div className="flex gap-1.5 mt-2">
            {[10, 25, 50, 100].map(v => (
              <button key={v} onClick={() => setAmount(String(v))}
                className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 text-xs transition-colors">
                ${v}
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        {amountN > 0 && toValid && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs flex flex-col gap-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Send amount</span>
              <span className="font-bold text-slate-900">{fmtUSDC(amountN)} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Network fee</span>
              <span className="font-bold text-violet-700">
                {feeEst !== null ? `~${fmtUSDC(feeEst)} USDC` : 'Estimating…'}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5 mt-0.5">
              <span className="text-slate-600 font-semibold">Total deducted</span>
              <span className="font-bold text-slate-900">
                {fmtUSDC(amountN + (feeEst ?? 0))} USDC
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Expected finality</span>
              <span className="font-bold text-emerald-600">⚡ &lt; 1 second</span>
            </div>
          </div>
        )}

        {/* Send button */}
        <button onClick={handleSend} disabled={!canSend}
          className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
            canSend
              ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 shadow-lg shadow-violet-900/20'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}>
          {txStep === 'sending' ? '⏳ Sending…' :
           txStep === 'done'    ? '✅ Sent!' :
           txStep === 'error'   ? '⚠ Failed' :
           `Send ${amountN > 0 ? fmtUSDC(amountN) + ' USDC' : 'USDC'}`}
        </button>

        {/* Last confirmation */}
        {lastRec && lastRec.status === 'confirmed' && lastRec.finalityMs !== null && (
          <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
            <span className="text-xl">⚡</span>
            <div className="flex-1">
              <p className="text-emerald-800 font-bold text-sm">
                Confirmed in {fmtMs(lastRec.finalityMs)}!
              </p>
              <a href={`https://testnet.arcscan.app/tx/${lastRec.hash}`}
                target="_blank" rel="noreferrer"
                className="text-emerald-600 text-[11px] hover:underline font-mono">
                {lastRec.hash.slice(0, 22)}… ↗ ArcScan
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Arc advantages callout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { icon: '💵', title: 'Dollar-denominated fees', desc: 'Pay gas in USDC — no exposure to volatile ETH prices. Predictable costs for every transaction.' },
          { icon: '⚡', title: 'Deterministic finality', desc: 'Sub-second block confirmation. No waiting for multiple block confirmations. Build real-time financial apps.' },
          { icon: '🔗', title: 'Programmable payments', desc: 'EVM-compatible smart contracts for conditional payments, escrow, multi-sig and automated flows.' },
          { icon: '🌉', title: 'Cross-chain USDC (CCTP)', desc: 'Circle\'s native CCTP integration. Move USDC between Arc, Ethereum, Base, Solana and more.' },
        ].map(c => (
          <div key={c.title} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex gap-3">
            <span className="text-2xl shrink-0">{c.icon}</span>
            <div>
              <p className="font-bold text-slate-900 text-sm">{c.title}</p>
              <p className="text-slate-500 text-xs mt-1 leading-relaxed">{c.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 2. Bulk Distribution ──────────────────────────────────────────────────────

function BulkSendSection({
  address, balanceUsdc, onTxSent,
}: {
  address:     `0x${string}` | undefined
  balanceUsdc: number
  onTxSent:    (rec: FinalityRecord) => void
}) {
  const [rows,     setRows]     = useState<BulkRow[]>([
    { id: newId(), address: '', amount: '', valid: false },
  ])
  const [sending,  setSending]  = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [results,  setResults]  = useState<{ addr: string; ok: boolean; hash?: string }[]>([])

  const publicClient     = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const totalAmount = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const validRows   = rows.filter(r => isAddress(r.address) && parseFloat(r.amount) > 0)

  const addRow = () => setRows(prev => [...prev, { id: newId(), address: '', amount: '', valid: false }])
  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id))
  const updateRow = (id: string, field: 'address' | 'amount', val: string) =>
    setRows(prev => prev.map(r =>
      r.id !== id ? r : {
        ...r, [field]: val,
        valid: field === 'address' ? isAddress(val) && r.amount !== '' : isAddress(r.address) && val !== '',
      }
    ))

  const handleSendAll = async () => {
    if (!address || validRows.length === 0) return
    setSending(true)
    setProgress({ done: 0, total: validRows.length })
    setResults([])

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]
      try {
        const hash = await writeContractAsync({
          address:      TOKEN_ADDRESSES.USDC,
          abi:          TRANSFER_ABI,
          functionName: 'transfer',
          args:         [row.address as `0x${string}`, parseUnits(row.amount, 6)],
        })
        const sentAt = Date.now()
        const rec: FinalityRecord = {
          id: newId(), hash, to: row.address,
          amount: parseFloat(row.amount),
          sentAt, confirmedAt: null, finalityMs: null,
          status: 'pending', fee: null,
        }
        onTxSent(rec)

        if (publicClient) {
          const receipt     = await publicClient.waitForTransactionReceipt({ hash })
          const confirmedAt = Date.now()
          onTxSent({ ...rec, confirmedAt, finalityMs: confirmedAt - sentAt,
            status: receipt.status === 'success' ? 'confirmed' : 'failed' })
        }
        setResults(prev => [...prev, { addr: row.address, ok: true, hash }])
      } catch {
        setResults(prev => [...prev, { addr: row.address, ok: false }])
      }
      setProgress({ done: i + 1, total: validRows.length })
    }
    setSending(false)
    setProgress(null)
  }

  return (
    <div className="flex flex-col gap-4">

      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Bulk USDC Distribution</h3>
            <p className="text-slate-400 text-xs mt-0.5">Pay multiple addresses in one go</p>
          </div>
          <button onClick={addRow}
            className="px-3 py-1.5 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-xs font-bold hover:bg-violet-100 transition-colors">
            + Add Row
          </button>
        </div>

        {/* Header */}
        <div className="grid grid-cols-[1fr_120px_36px] gap-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
          <span>Recipient Address</span>
          <span>Amount (USDC)</span>
          <span />
        </div>

        {/* Rows */}
        <div className="flex flex-col gap-2">
          {rows.map((row, idx) => (
            <div key={row.id} className="grid grid-cols-[1fr_120px_36px] gap-2 items-center">
              <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 focus-within:border-violet-400 transition-colors ${
                row.address && !isAddress(row.address) ? 'border-red-300 bg-red-50/30' : 'border-slate-200 bg-slate-50'
              }`}>
                <span className="text-slate-400 text-xs shrink-0">#{idx + 1}</span>
                <input
                  value={row.address}
                  onChange={e => updateRow(row.id, 'address', e.target.value.trim())}
                  placeholder="0x..."
                  className="flex-1 bg-transparent text-slate-900 text-xs font-mono outline-none min-w-0"
                />
                {isAddress(row.address) && <span className="text-emerald-500 text-xs shrink-0">✓</span>}
              </div>
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 focus-within:border-violet-400 transition-colors">
                <input
                  type="number" min="0" placeholder="0.00" value={row.amount}
                  onChange={e => updateRow(row.id, 'amount', e.target.value)}
                  className="flex-1 bg-transparent text-slate-900 font-bold text-sm outline-none min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-slate-400 text-[10px] shrink-0">USDC</span>
              </div>
              <button onClick={() => removeRow(row.id)} disabled={rows.length === 1}
                className="w-9 h-9 rounded-xl bg-red-50 border border-red-200 text-red-500 text-sm hover:bg-red-100 transition-colors disabled:opacity-30 flex items-center justify-center">
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Summary + send */}
        <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-slate-500">
              Recipients: <strong className="text-slate-900">{validRows.length}</strong>
            </span>
            <span className="text-slate-500">
              Total: <strong className="text-violet-700">{fmtUSDC(totalAmount)} USDC</strong>
            </span>
            {totalAmount > balanceUsdc && (
              <span className="text-red-500 text-xs font-semibold">⚠ Insufficient balance</span>
            )}
          </div>

          {/* Progress */}
          {sending && progress && (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Sending… {progress.done}/{progress.total}</span>
                <span>{Math.round((progress.done / progress.total) * 100)}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-violet-500 rounded-full transition-all"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </div>
          )}

          {/* Results */}
          {results.length > 0 && !sending && (
            <div className="flex flex-col gap-1">
              {results.map((r, i) => (
                <div key={i} className={`flex items-center justify-between text-xs px-3 py-1.5 rounded-lg ${
                  r.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                }`}>
                  <span className="font-mono">{fmtAddr(r.addr)}</span>
                  {r.ok
                    ? <a href={`https://testnet.arcscan.app/tx/${r.hash}`} target="_blank" rel="noreferrer"
                        className="text-emerald-600 hover:underline">✓ {r.hash?.slice(0, 12)}… ↗</a>
                    : <span>✗ Failed</span>
                  }
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleSendAll}
            disabled={sending || validRows.length === 0 || totalAmount > balanceUsdc}
            className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
              !sending && validRows.length > 0 && totalAmount <= balanceUsdc
                ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 shadow-lg shadow-violet-900/20'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}>
            {sending
              ? `⏳ Sending ${progress?.done ?? 0}/${progress?.total ?? validRows.length}…`
              : `💸 Send to ${validRows.length} recipients — ${fmtUSDC(totalAmount)} USDC`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 3. Programmable Payment Flows ─────────────────────────────────────────────

const PERIOD_LABELS: Record<PaymentFlow['period'], string> = {
  hourly: 'Every hour', daily: 'Every day',
  weekly: 'Every week', monthly: 'Every month',
}

function PaymentFlowsSection() {
  const [flows,      setFlows]      = useState<PaymentFlow[]>([
    {
      id: 'demo1', name: 'Team Payroll', recipient: '0x1234…abcd',
      amount: 500, period: 'monthly', active: true,
      nextRun: Date.now() + 12 * 86_400_000, totalSent: 1500,
    },
  ])
  const [showCreate, setShowCreate] = useState(false)
  const [form,       setForm]       = useState({
    name: '', recipient: '', amount: '', period: 'monthly' as PaymentFlow['period'],
  })

  const handleCreate = () => {
    if (!form.name || !isAddress(form.recipient) || !parseFloat(form.amount)) return
    const flow: PaymentFlow = {
      id: newId(),
      name:      form.name,
      recipient: form.recipient,
      amount:    parseFloat(form.amount),
      period:    form.period,
      active:    true,
      nextRun:   Date.now() + periodMs(form.period),
      totalSent: 0,
    }
    setFlows(prev => [flow, ...prev])
    setForm({ name: '', recipient: '', amount: '', period: 'monthly' })
    setShowCreate(false)
  }

  const toggleFlow = (id: string) =>
    setFlows(prev => prev.map(f => f.id === id ? { ...f, active: !f.active } : f))

  const deleteFlow = (id: string) =>
    setFlows(prev => prev.filter(f => f.id !== id))

  return (
    <div className="flex flex-col gap-4">

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Programmable Payment Flows</h3>
            <p className="text-slate-400 text-xs mt-0.5">Automate recurring USDC distributions</p>
          </div>
          <button onClick={() => setShowCreate(v => !v)}
            className="px-3 py-1.5 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-500 transition-colors shadow-sm">
            + New Flow
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="px-5 py-4 bg-violet-50/50 border-b border-violet-100 flex flex-col gap-3">
            <p className="text-xs font-bold text-violet-700 uppercase tracking-wider">New Payment Flow</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-500 font-semibold mb-1 block">Flow Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Team Payroll"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 transition-colors" />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-semibold mb-1 block">Recipient</label>
                <input value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value.trim() }))}
                  placeholder="0x..."
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono outline-none focus:border-violet-400 transition-colors" />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-semibold mb-1 block">Amount (USDC)</label>
                <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-semibold mb-1 block">Frequency</label>
                <select value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value as PaymentFlow['period'] }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 transition-colors">
                  <option value="hourly">Every hour</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                  <option value="monthly">Every month</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreate}
                className="px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-500 transition-colors shadow-sm">
                Create Flow
              </button>
              <button onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-500 text-xs hover:bg-slate-200 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Flows list */}
        {flows.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <p className="text-3xl mb-2">⚙️</p>
            <p className="text-sm font-semibold">No payment flows</p>
            <p className="text-xs mt-1">Create your first automated USDC flow</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {flows.map(flow => (
              <div key={flow.id} className="px-5 py-4 flex items-center gap-3">
                {/* Toggle */}
                <button onClick={() => toggleFlow(flow.id)}
                  className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${flow.active ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${flow.active ? 'left-5' : 'left-0.5'}`} />
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-900 text-sm">{flow.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      flow.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {flow.active ? '● Active' : '○ Paused'}
                    </span>
                  </div>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    {fmtAddr(flow.recipient)} · {PERIOD_LABELS[flow.period]}
                  </p>
                </div>

                {/* Amount + next run */}
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-900 text-sm">{fmtUSDC(flow.amount)} USDC</p>
                  <p className="text-slate-400 text-[10px]">
                    {flow.active ? fmtNextRun(flow.nextRun) : 'Paused'}
                  </p>
                  <p className="text-violet-600 text-[10px]">Sent: ${fmtUSDC(flow.totalSent)}</p>
                </div>

                {/* Delete */}
                <button onClick={() => deleteFlow(flow.id)}
                  className="w-7 h-7 rounded-lg bg-red-50 text-red-400 text-xs hover:bg-red-100 transition-colors flex items-center justify-center shrink-0">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Smart contract info */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl p-5 text-white">
        <h3 className="font-bold text-base mb-3">⚙️ Build with Smart Contracts</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {[
            { title: 'Payment Escrow',     desc: 'Lock USDC, release on condition met (deadline, signature, oracle)' },
            { title: 'Streaming Payments', desc: 'Drip USDC per second. Ideal for salaries, subscriptions, rentals' },
            { title: 'Multi-sig Treasury', desc: 'Require N-of-M signatures before disbursing funds' },
            { title: 'Conditional Routing', desc: 'Route USDC to different addresses based on on-chain state' },
          ].map(c => (
            <div key={c.title} className="bg-white/10 rounded-xl p-3">
              <p className="font-semibold text-white text-xs">{c.title}</p>
              <p className="text-slate-400 text-[11px] mt-1 leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 4. Finality Tracker ───────────────────────────────────────────────────────

function FinalitySection({ records }: { records: FinalityRecord[] }) {
  const confirmed    = records.filter(r => r.status === 'confirmed' && r.finalityMs !== null)
  const avgFinality  = confirmed.length
    ? confirmed.reduce((s, r) => s + (r.finalityMs ?? 0), 0) / confirmed.length
    : null
  const minFinality  = confirmed.length ? Math.min(...confirmed.map(r => r.finalityMs ?? 0)) : null
  const pending      = records.filter(r => r.status === 'pending').length

  return (
    <div className="flex flex-col gap-4">

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Transactions', value: records.length,                                   color: 'text-slate-900' },
          { label: 'Confirmed',    value: confirmed.length,                                 color: 'text-emerald-700' },
          { label: 'Avg Finality', value: avgFinality !== null ? fmtMs(avgFinality) : '—',  color: 'text-violet-700' },
          { label: 'Fastest',      value: minFinality !== null ? fmtMs(minFinality) : '—',  color: 'text-blue-700' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-2xl p-3 text-center shadow-sm">
            <p className={`font-extrabold text-lg ${s.color}`}>{s.value}</p>
            <p className="text-slate-400 text-[11px]">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Arc finality info */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-4 flex gap-4 items-start">
        <span className="text-3xl">⚡</span>
        <div>
          <p className="font-bold text-emerald-900">Arc Deterministic Finality</p>
          <p className="text-emerald-700 text-xs mt-1 leading-relaxed">
            Arc uses a Proof-of-Authority consensus where each block is immediately final.
            Unlike Ethereum (probabilistic, ~3 min) or Bitcoin (~60 min), Arc transactions
            are irreversibly settled within 1 block — typically under 1 second.
            This enables real-time financial workflows, instant payouts, and live settlement.
          </p>
        </div>
      </div>

      {/* Comparison table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="font-bold text-slate-900 text-sm">Finality Comparison</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[480px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {['Network', 'Finality', 'Gas Token', 'Predictability'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left font-semibold text-slate-500 uppercase tracking-wider text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {[
                { net: '⚡ Arc',      fin: '< 1 second',  gas: 'USDC',   pred: 'Deterministic',  hl: true },
                { net: '🔵 Ethereum', fin: '~3 minutes',  gas: 'ETH',    pred: 'Probabilistic',  hl: false },
                { net: '🔴 Bitcoin',  fin: '~60 minutes', gas: 'BTC',    pred: 'Probabilistic',  hl: false },
                { net: '🟣 Solana',   fin: '~400ms',      gas: 'SOL',    pred: 'Probabilistic',  hl: false },
                { net: '🔵 Base',     fin: '~2 seconds',  gas: 'ETH',    pred: 'Soft finality',  hl: false },
              ].map(row => (
                <tr key={row.net} className={row.hl ? 'bg-emerald-50' : 'hover:bg-slate-50 transition-colors'}>
                  <td className={`px-5 py-3 font-bold ${row.hl ? 'text-emerald-800' : 'text-slate-700'}`}>{row.net}</td>
                  <td className={`px-5 py-3 font-semibold ${row.hl ? 'text-emerald-700' : 'text-slate-600'}`}>{row.fin}</td>
                  <td className={`px-5 py-3 font-mono text-[11px] ${row.hl ? 'text-emerald-700 font-bold' : 'text-slate-500'}`}>{row.gas}</td>
                  <td className={`px-5 py-3 ${row.hl ? 'text-emerald-700 font-bold' : 'text-slate-500'}`}>{row.pred}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live tx list */}
      {records.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm">Live Transactions ({records.length})</h3>
            {pending > 0 && (
              <span className="flex items-center gap-1.5 text-amber-600 text-xs font-semibold">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                {pending} pending
              </span>
            )}
          </div>
          <div className="divide-y divide-slate-50">
            {records.slice(0, 20).map(rec => (
              <div key={rec.id} className="flex items-center gap-3 px-5 py-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 ${
                  rec.status === 'confirmed' ? 'bg-emerald-50 text-emerald-600' :
                  rec.status === 'failed'    ? 'bg-red-50 text-red-600' :
                                              'bg-amber-50 text-amber-600'
                }`}>
                  {rec.status === 'confirmed' ? '✓' : rec.status === 'failed' ? '✗' : '⏳'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-slate-900 text-xs font-semibold">
                    {fmtUSDC(rec.amount)} USDC → {fmtAddr(rec.to)}
                  </p>
                  {rec.hash ? (
                    <a href={`https://testnet.arcscan.app/tx/${rec.hash}`}
                      target="_blank" rel="noreferrer"
                      className="text-violet-600 text-[10px] hover:underline font-mono">
                      {rec.hash.slice(0, 18)}… ↗
                    </a>
                  ) : (
                    <p className="text-slate-400 text-[10px]">Waiting for hash…</p>
                  )}
                </div>
                <TxStatus rec={rec} />
              </div>
            ))}
          </div>
        </div>
      )}

      {records.length === 0 && (
        <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-14 flex flex-col items-center gap-3 text-slate-400">
          <p className="text-4xl">⚡</p>
          <p className="font-semibold text-sm">No transactions yet</p>
          <p className="text-xs">Send some USDC to see live finality tracking</p>
        </div>
      )}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

const SECTION_TABS: { key: PanelTab; label: string; icon: string }[] = [
  { key: 'send',     label: 'Quick Send',  icon: '💸' },
  { key: 'bulk',     label: 'Bulk Send',   icon: '📋' },
  { key: 'flows',    label: 'Flows',       icon: '⚙️' },
  { key: 'finality', label: 'Finality',    icon: '⚡' },
]

export default function PaymentsPanel() {
  const { address, isConnected } = useAccount()
  const { data: usdcBal } = useBalance({ address, token: TOKEN_ADDRESSES.USDC })
  const balanceUsdc = usdcBal ? parseFloat(usdcBal.formatted) : 0

  const [activeTab, setActiveTab] = useState<PanelTab>('send')
  const [txRecords, setTxRecords] = useState<FinalityRecord[]>([])

  const handleTxSent = useCallback((rec: FinalityRecord) => {
    setTxRecords(prev => {
      const idx = prev.findIndex(r => r.id === rec.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = rec
        return next
      }
      return [rec, ...prev].slice(0, 50)
    })
  }, [])

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header ── */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 px-6 py-5 shadow-lg">
        <div className="absolute inset-0 opacity-[0.08] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/30 text-white text-[11px] font-semibold">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                Arc Testnet · Chain 5042002
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/30 text-white text-[11px] font-semibold">
                ⚡ Sub-second finality
              </span>
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">💸 USDC Payments</h1>
            <p className="text-emerald-100 text-sm mt-1">
              Predictable fees · Instant finality · Programmable flows · Cross-chain CCTP
            </p>
          </div>
          <div className="shrink-0 text-right">
            {isConnected ? (
              <>
                <p className="text-white/60 text-xs mb-0.5">USDC Balance</p>
                <p className="text-3xl font-extrabold text-white">${fmtUSDC(balanceUsdc)}</p>
                <p className="text-emerald-200 text-xs mt-0.5">{txRecords.filter(r => r.status === 'confirmed').length} confirmed txs</p>
              </>
            ) : (
              <ConnectButton label="Connect Wallet" />
            )}
          </div>
        </div>
      </div>

      {/* Connect wall */}
      {!isConnected && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">🔗</span>
          <div className="flex-1">
            <p className="text-amber-800 font-semibold text-sm">Connect wallet to send payments</p>
            <p className="text-amber-600 text-xs mt-0.5">You can still explore the UI without connecting</p>
          </div>
          <ConnectButton label="Connect" />
        </div>
      )}

      {/* ── Section tabs ── */}
      <div className="flex gap-1 bg-white border border-slate-200 p-1 rounded-2xl shadow-sm">
        {SECTION_TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-all ${
              activeTab === t.key
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}>
            <span className="text-base">{t.icon}</span>
            <span className="hidden sm:inline text-xs">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── Sections ── */}
      {activeTab === 'send'     && <QuickSendSection  address={address} balanceUsdc={balanceUsdc} onTxSent={handleTxSent} />}
      {activeTab === 'bulk'     && <BulkSendSection   address={address} balanceUsdc={balanceUsdc} onTxSent={handleTxSent} />}
      {activeTab === 'flows'    && <PaymentFlowsSection />}
      {activeTab === 'finality' && <FinalitySection records={txRecords} />}

    </div>
  )
}
