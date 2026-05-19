// ── PaymentsPanel.tsx ────────────────────────────────────────────────────────
// USDC Payments Infrastructure on Arc
//  1. Quick USDC Send — USDC-denominated fees, <1s finality indicator
//  2. Bulk Distribution — multi-recipient batch
//  3. Programmable Flows — scheduled / stream payments (simulated)
//  4. Finality Tracker — live confirmation timing

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  useAccount, useBalance, useWriteContract, useSendTransaction,
  usePublicClient,
} from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { isAddress, parseUnits, encodeFunctionData, maxUint256 } from 'viem'
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
  address, balanceUsdc, onTxSent, onSwitchTab, onNavigate,
}: {
  address:      `0x${string}` | undefined
  balanceUsdc:  number
  onTxSent:     (rec: FinalityRecord) => void
  onSwitchTab:  (tab: PanelTab) => void
  onNavigate:   (tab: string) => void
}) {
  const [to,          setTo]          = useState('')
  const [amount,      setAmount]      = useState('')
  const [feeEst,      setFeeEst]      = useState<number | null>(null)
  const [defaultFee,  setDefaultFee]  = useState<number | null>(null)
  const [txStep,      setTxStep]      = useState<'idle' | 'estimating' | 'sending' | 'done' | 'error'>('idle')
  const [lastRec,     setLastRec]     = useState<FinalityRecord | null>(null)
  const sentAt = useRef<number>(0)

  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const amountN      = parseFloat(amount) || 0
  const toValid      = isAddress(to)
  const amountValid  = amountN > 0 && amountN <= balanceUsdc
  const canSend      = toValid && amountValid && txStep === 'idle'

  // Estimate default fee on mount (for a typical 10 USDC transfer)
  useEffect(() => {
    if (!publicClient || !address) return
    let cancelled = false
    ;(async () => {
      try {
        const gasPrice = await publicClient.getGasPrice()
        // Arc ERC-20 transfer ~65k gas
        const feeWei  = BigInt(65000) * gasPrice
        const feeUsdc = Number(feeWei) / 1e18
        if (!cancelled) setDefaultFee(feeUsdc > 0 ? feeUsdc : 0.0001)
      } catch {
        if (!cancelled) setDefaultFee(0.0001)
      }
    })()
    return () => { cancelled = true }
  }, [address, publicClient])

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

      {/* ── 4 interactive feature widgets ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* 1. Dollar-denominated fees — live fee meter */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">💵</span>
            <p className="font-bold text-emerald-900 text-sm">Dollar-denominated fees</p>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-emerald-600 text-[10px] font-semibold uppercase tracking-wider">Arc (this tx)</p>
              <p className="font-extrabold text-emerald-800 text-2xl leading-none">
                {feeEst ?? defaultFee
                  ? `$${fmtUSDC(feeEst ?? defaultFee ?? 0)}`
                  : address ? '…' : '~$0.0001'}
              </p>
              <p className="text-emerald-600 text-[10px]">USDC · fixed & predictable</p>
            </div>
            <div className="text-right">
              <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-wider">Ethereum</p>
              <p className="font-bold text-slate-400 text-lg line-through">~$2–5</p>
              <p className="text-slate-400 text-[10px]">ETH gas (volatile)</p>
            </div>
          </div>
          {/* Savings bar */}
          <div className="mt-1">
            <div className="flex justify-between text-[10px] text-emerald-700 font-semibold mb-1">
              <span>Arc fee</span><span>Ethereum fee</span>
            </div>
            <div className="h-2 bg-white/70 rounded-full overflow-hidden flex">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: '2%' }} />
              <div className="h-full bg-red-300 rounded-full ml-auto" style={{ width: '98%' }} />
            </div>
            <p className="text-emerald-700 text-[10px] font-bold mt-1">Up to 100× cheaper ✓</p>
          </div>
        </div>

        {/* 2. Deterministic finality — clickable, goes to tracker */}
        <button
          onClick={() => onSwitchTab('finality')}
          className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-left hover:shadow-md hover:border-blue-400 transition-all group flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚡</span>
              <p className="font-bold text-blue-900 text-sm">Deterministic finality</p>
            </div>
            <span className="text-blue-400 text-lg group-hover:translate-x-1 transition-transform">→</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center bg-blue-100 rounded-xl px-3 py-1.5">
              <p className="font-extrabold text-blue-800 text-lg leading-none">&lt; 1s</p>
              <p className="text-blue-600 text-[10px]">Arc</p>
            </div>
            <div className="flex-1 flex flex-col gap-1">
              {[
                { chain: 'Ethereum', time: '~3 min',  w: '100%', color: 'bg-red-300' },
                { chain: 'Bitcoin',  time: '~60 min', w: '100%', color: 'bg-orange-300' },
                { chain: 'Solana',   time: '~400ms',  w: '40%',  color: 'bg-purple-300' },
              ].map(c => (
                <div key={c.chain} className="flex items-center gap-1.5">
                  <span className="text-[9px] text-slate-400 w-12 shrink-0">{c.chain}</span>
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${c.color} rounded-full`} style={{ width: c.w }} />
                  </div>
                  <span className="text-[9px] text-slate-400 w-10 text-right shrink-0">{c.time}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-blue-600 text-[11px] font-semibold">View Finality Tracker →</p>
        </button>

        {/* 3. Programmable payments — clickable, goes to flows */}
        <button
          onClick={() => onSwitchTab('flows')}
          className="bg-violet-50 border border-violet-200 rounded-2xl p-4 text-left hover:shadow-md hover:border-violet-400 transition-all group flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚙️</span>
              <p className="font-bold text-violet-900 text-sm">Programmable payments</p>
            </div>
            <span className="text-violet-400 text-lg group-hover:translate-x-1 transition-transform">→</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { icon: '🔁', label: 'Payment streams' },
              { icon: '🔐', label: 'Escrow & conditional' },
              { icon: '👥', label: 'Multi-sig treasury' },
              { icon: '📋', label: 'Bulk distribution' },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-1.5 bg-white/70 rounded-lg px-2 py-1.5">
                <span className="text-sm">{f.icon}</span>
                <span className="text-[11px] text-violet-700 font-medium">{f.label}</span>
              </div>
            ))}
          </div>
          <p className="text-violet-600 text-[11px] font-semibold">Create payment flows →</p>
        </button>

        {/* 4. Cross-chain USDC (CCTP) — clickable, goes to Bridge tab */}
        <button
          onClick={() => onNavigate('bridge')}
          className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-left hover:shadow-md hover:border-amber-400 transition-all group flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🌉</span>
              <p className="font-bold text-amber-900 text-sm">Cross-chain USDC (CCTP)</p>
            </div>
            <span className="text-amber-400 text-lg group-hover:translate-x-1 transition-transform">→</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { name: 'Arc',      bg: 'bg-violet-100 text-violet-700 border-violet-200' },
              { name: 'Ethereum', bg: 'bg-blue-100 text-blue-700 border-blue-200' },
              { name: 'Base',     bg: 'bg-blue-100 text-blue-700 border-blue-200' },
              { name: 'Solana',   bg: 'bg-green-100 text-green-700 border-green-200' },
              { name: 'Arbitrum', bg: 'bg-sky-100 text-sky-700 border-sky-200' },
              { name: 'Polygon',  bg: 'bg-purple-100 text-purple-700 border-purple-200' },
            ].map(c => (
              <span key={c.name} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.bg}`}>
                {c.name}
              </span>
            ))}
          </div>
          <p className="text-amber-700 text-[11px] font-semibold">Open Bridge tab →</p>
        </button>

      </div>
    </div>
  )
}

// ── 2. Bulk Distribution ──────────────────────────────────────────────────────
// Strategy: deploy a tiny ArcBatchSend contract once (1 confirmation),
// then each bulk send = approve(total) + disperseToken = exactly 2 confirmations.

const BATCH_BYTECODE = '0x6080604052348015600e575f5ffd5b506102eb8061001c5f395ff3fe608060405234801561000f575f5ffd5b5060043610610029575f3560e01c8063c73a2d601461002d575b5f5ffd5b61004061003b3660046101eb565b610042565b005b5f5b83811015610180575f866001600160a01b03163387878581811061006a5761006a61026b565b905060200201602081019061007f919061027f565b8686868181106100915761009161026b565b6040516001600160a01b0395861660248201529490931660448501525060209091020135606482015260840160408051601f198184030181529181526020820180516001600160e01b03166323b872dd60e01b179052516100f2919061029f565b5f604051808303815f865af19150503d805f811461012b576040519150601f19603f3d011682016040523d82523d5f602084013e610130565b606091505b50509050806101775760405162461bcd60e51b815260206004820152600f60248201526e1d1c985b9cd9995c8819985a5b1959608a1b604482015260640160405180910390fd5b50600101610044565b505050505050565b80356001600160a01b038116811461019e575f5ffd5b919050565b5f5f83601f8401126101b3575f5ffd5b50813567ffffffffffffffff8111156101ca575f5ffd5b6020830191508360208260051b85010111156101e4575f5ffd5b9250929050565b5f5f5f5f5f606086880312156101ff575f5ffd5b61020886610188565b9450602086013567ffffffffffffffff811115610223575f5ffd5b61022f888289016101a3565b909550935050604086013567ffffffffffffffff81111561024e575f5ffd5b61025a888289016101a3565b969995985093965092949392505050565b634e487b7160e01b5f52603260045260245ffd5b5f6020828403121561028f575f5ffd5b61029882610188565b9392505050565b5f82518060208501845e5f92019182525091905056fea2646970667358221220218951501681cb162f4e525d9b1d80253c0ef53a15218a71e6e97d8683ed33f264736f6c63430008230033' as const

const BATCH_ABI = [
  {
    name: 'disperseToken', type: 'function' as const,
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token',      type: 'address'   },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts',    type: 'uint256[]' },
    ],
    outputs: [],
  },
] as const

const APPROVE_ABI = [
  {
    name: 'approve', type: 'function' as const,
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const ALLOWANCE_ABI = [
  {
    name: 'allowance', type: 'function' as const,
    stateMutability: 'view',
    inputs:  [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const LS_KEY       = 'arc_batch_contract_5042002'
const LS_APPROVED  = 'arc_batch_approved_5042002'  // flag: max allowance already set

type BulkStep =
  | 'idle'
  | 'deploying'   // deploying batch contract (first-time setup, once)
  | 'approving'   // approve MAX_UINT256 (once ever — skipped on repeat sends)
  | 'sending'     // disperseToken — THE only confirmation on repeat sends
  | 'done'
  | 'error'

interface BulkResult { addr: string; ok: boolean; hash?: string }

function BulkSendSection({
  address, balanceUsdc, onTxSent,
}: {
  address:     `0x${string}` | undefined
  balanceUsdc: number
  onTxSent:    (rec: FinalityRecord) => void
}) {
  const [rows,        setRows]        = useState<BulkRow[]>([
    { id: newId(), address: '', amount: '', valid: false },
  ])
  const [step,        setStep]        = useState<BulkStep>('idle')
  const [results,     setResults]     = useState<BulkResult[]>([])
  const [errMsg,      setErrMsg]      = useState('')
  const [batchAddr,   setBatchAddr]   = useState<`0x${string}` | null>(() => {
    const saved = localStorage.getItem(LS_KEY)
    return saved ? saved as `0x${string}` : null
  })
  // Track whether MAX allowance has been granted (skips approve on future sends)
  const [maxApproved, setMaxApproved] = useState(() => !!localStorage.getItem(LS_APPROVED))

  const publicClient                  = usePublicClient()
  const { writeContractAsync }        = useWriteContract()
  const { sendTransactionAsync }      = useSendTransaction()

  const totalAmount = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const validRows   = rows.filter(r => isAddress(r.address) && parseFloat(r.amount) > 0)
  const canSend     = !!batchAddr && validRows.length > 0 && totalAmount <= balanceUsdc && step === 'idle'
  const canDeploy   = !batchAddr && step === 'idle' && !!address

  const addRow    = () => setRows(prev => [...prev, { id: newId(), address: '', amount: '', valid: false }])
  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id))
  const updateRow = (id: string, field: 'address' | 'amount', val: string) =>
    setRows(prev => prev.map(r =>
      r.id !== id ? r : {
        ...r, [field]: val,
        valid: field === 'address'
          ? isAddress(val) && r.amount !== ''
          : isAddress(r.address) && val !== '',
      }
    ))

  // ── Step 0: Deploy batch contract via raw tx (no 'to' = contract creation) ──
  const handleDeploy = async () => {
    if (!address || !publicClient) return
    setStep('deploying')
    setErrMsg('')
    try {
      // Sending tx with no `to` and bytecode as `data` is the standard EVM
      // contract deployment — no ABI parsing needed.
      const hash = await sendTransactionAsync({
        data: BATCH_BYTECODE,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      const deployed = receipt.contractAddress
      if (!deployed) throw new Error('No contract address in receipt')
      localStorage.setItem(LS_KEY, deployed)
      setBatchAddr(deployed)
      setStep('idle')
    } catch (e) {
      setStep('error')
      setErrMsg(e instanceof Error ? e.message.slice(0, 140) : 'Deploy failed')
      setTimeout(() => { setStep('idle'); setErrMsg('') }, 5000)
    }
  }

  // ── Allowance check helper ────────────────────────────────────────────────
  const checkAllowance = async (): Promise<bigint> => {
    if (!address || !publicClient || !batchAddr) return 0n
    try {
      return await publicClient.readContract({
        address: TOKEN_ADDRESSES.USDC,
        abi:     ALLOWANCE_ABI,
        functionName: 'allowance',
        args: [address, batchAddr],
      }) as bigint
    } catch { return 0n }
  }

  // ── Main send: approve MAX once, then only 1 confirmation per bulk send ──
  const handleSendAll = async () => {
    if (!address || !canSend || !batchAddr || !publicClient) return
    setResults([])
    setErrMsg('')
    const sentAt     = Date.now()
    const totalUnits = parseUnits(totalAmount.toFixed(6), 6)

    try {
      // Check if allowance is already sufficient (MAX was approved before)
      const allowance = maxApproved ? maxUint256 : await checkAllowance()

      if (allowance < totalUnits) {
        // ── One-time approve MAX_UINT256 — never need to approve again ──
        setStep('approving')
        const approveTx = await writeContractAsync({
          address:      TOKEN_ADDRESSES.USDC,
          abi:          APPROVE_ABI,
          functionName: 'approve',
          args:         [batchAddr, maxUint256],
        })
        await publicClient.waitForTransactionReceipt({ hash: approveTx })
        localStorage.setItem(LS_APPROVED, '1')
        setMaxApproved(true)
      }

      // ── Single confirmation: disperseToken sends to ALL recipients at once ──
      setStep('sending')
      const dispatchTx = await writeContractAsync({
        address:      batchAddr,
        abi:          BATCH_ABI,
        functionName: 'disperseToken',
        args: [
          TOKEN_ADDRESSES.USDC,
          validRows.map(r => r.address as `0x${string}`),
          validRows.map(r => parseUnits(r.amount, 6)),
        ],
      })
      const receipt     = await publicClient.waitForTransactionReceipt({ hash: dispatchTx })
      const confirmedAt = Date.now()
      const finalityMs  = confirmedAt - sentAt
      const ok          = receipt.status === 'success'

      const batchResults = validRows.map(row => {
        const rec: FinalityRecord = {
          id: newId(), hash: dispatchTx, to: row.address,
          amount: parseFloat(row.amount),
          sentAt, confirmedAt, finalityMs,
          status: ok ? 'confirmed' : 'failed', fee: null,
        }
        onTxSent(rec)
        return { addr: row.address, ok, hash: dispatchTx }
      })
      setResults(batchResults)
      setStep('done')

    } catch (e) {
      setStep('error')
      setErrMsg(e instanceof Error ? e.message.slice(0, 140) : 'Transaction failed')
      setTimeout(() => { setStep('idle'); setErrMsg('') }, 5000)
    }
  }

  const reset = () => { setStep('idle'); setResults([]); setErrMsg('') }

  return (
    <div className="flex flex-col gap-4">

      {/* How it works banner */}
      <div className={`flex items-start gap-3 px-4 py-3 border rounded-xl text-xs ${
        maxApproved && batchAddr
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : 'bg-violet-50 border-violet-200 text-violet-700'
      }`}>
        <span className="text-lg shrink-0">{maxApproved && batchAddr ? '✅' : '⚡'}</span>
        <div>
          {maxApproved && batchAddr ? (
            <>
              <p className="font-bold text-emerald-900 mb-0.5">1 confirmation per bulk send</p>
              <p className="text-emerald-600">Max allowance already granted — just click Send and confirm once.</p>
            </>
          ) : (
            <>
              <p className="font-bold text-violet-900 mb-1">
                {batchAddr ? '2 confirmations first time · 1 confirmation every time after' : 'Setup required first'}
              </p>
              <div className="flex gap-2 flex-wrap items-center">
                <span className="flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">1</span>
                  Approve MAX (once ever)
                </span>
                <span className="text-violet-300">→</span>
                <span className="flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">2→1</span>
                  Send to all at once
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* First-time setup: deploy batch contract */}
      {!batchAddr && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="text-xl">🔧</span>
            <div className="flex-1">
              <p className="font-bold text-amber-900 text-sm">One-time setup required</p>
              <p className="text-amber-700 text-xs mt-0.5">
                Deploy the <strong>ArcBatchSend</strong> helper contract to your wallet (1 confirmation, once ever).
                After that, bulk sends only need 2 confirmations for any number of recipients.
              </p>
            </div>
          </div>
          {step === 'deploying' ? (
            <div className="flex items-center gap-2 px-4 py-3 bg-amber-100 rounded-xl text-sm text-amber-800 animate-pulse">
              <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              <span className="font-semibold">👛 Confirm deploy in your wallet…</span>
            </div>
          ) : (
            <button
              onClick={handleDeploy}
              disabled={!canDeploy}
              className="w-full py-3 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
            >
              🚀 Deploy Batch Contract (one-time)
            </button>
          )}
          {errMsg && (
            <p className="text-xs text-red-600 font-medium">⚠ {errMsg}</p>
          )}
        </div>
      )}

      {/* Deployed badge */}
      {batchAddr && (
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700">
          <span>✅</span>
          <span className="font-semibold">Batch contract deployed:</span>
          <a href={`https://testnet.arcscan.app/address/${batchAddr}`}
            target="_blank" rel="noreferrer"
            className="font-mono hover:underline truncate">{batchAddr.slice(0, 20)}…↗</a>
          <button onClick={() => { localStorage.removeItem(LS_KEY); setBatchAddr(null) }}
            className="ml-auto text-emerald-500 hover:text-red-500 transition-colors shrink-0" title="Reset">
            ✕
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Bulk USDC Distribution</h3>
            <p className="text-slate-400 text-xs mt-0.5">Pay multiple addresses in one transaction</p>
          </div>
          <button onClick={addRow} disabled={step !== 'idle'}
            className="px-3 py-1.5 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-xs font-bold hover:bg-violet-100 transition-colors disabled:opacity-40">
            + Add Row
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_120px_36px] gap-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
          <span>Recipient Address</span>
          <span>Amount (USDC)</span>
          <span />
        </div>

        {/* Recipient rows */}
        <div className="flex flex-col gap-2">
          {rows.map((row, idx) => (
            <div key={row.id} className="grid grid-cols-[1fr_120px_36px] gap-2 items-center">
              <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 focus-within:border-violet-400 transition-colors ${
                row.address && !isAddress(row.address)
                  ? 'border-red-300 bg-red-50/30'
                  : 'border-slate-200 bg-slate-50'
              }`}>
                <span className="text-slate-400 text-xs shrink-0">#{idx + 1}</span>
                <input
                  value={row.address}
                  onChange={e => updateRow(row.id, 'address', e.target.value.trim())}
                  placeholder="0x..."
                  disabled={step !== 'idle'}
                  className="flex-1 bg-transparent text-slate-900 text-xs font-mono outline-none min-w-0 disabled:opacity-60"
                />
                {isAddress(row.address) && <span className="text-emerald-500 text-xs shrink-0">✓</span>}
              </div>
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 focus-within:border-violet-400 transition-colors">
                <input
                  type="number" min="0" placeholder="0.00" value={row.amount}
                  onChange={e => updateRow(row.id, 'amount', e.target.value)}
                  disabled={step !== 'idle'}
                  className="flex-1 bg-transparent text-slate-900 font-bold text-sm outline-none min-w-0 disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-slate-400 text-[10px] shrink-0">USDC</span>
              </div>
              <button onClick={() => removeRow(row.id)} disabled={rows.length === 1 || step !== 'idle'}
                className="w-9 h-9 rounded-xl bg-red-50 border border-red-200 text-red-500 text-sm hover:bg-red-100 transition-colors disabled:opacity-30 flex items-center justify-center">
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Summary + actions */}
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

          {/* Step indicators */}
          {(step === 'approving' || step === 'sending') && (
            <div className="flex flex-col gap-2">
              {/* Step 1 */}
              <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border transition-all ${
                step === 'approving'
                  ? 'bg-violet-50 border-violet-300 text-violet-700 animate-pulse'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}>
                {step === 'approving' ? (
                  <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : <span className="shrink-0">✅</span>}
                <span className="font-semibold">
                  {step === 'approving' ? '👛 Approve MAX USDC — one-time, never again' : '✓ Max allowance granted'}
                </span>
              </div>
              {/* Step 2 */}
              <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border transition-all ${
                step === 'sending'
                  ? 'bg-violet-50 border-violet-300 text-violet-700 animate-pulse'
                  : 'bg-slate-50 border-slate-200 text-slate-400'
              }`}>
                {step === 'sending' ? (
                  <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : <span className="shrink-0">⏳</span>}
                <span className="font-semibold">
                  {step === 'sending'
                    ? `👛 Confirm — Send to all ${validRows.length} recipients at once`
                    : `Send to all ${validRows.length} recipients`}
                </span>
              </div>
            </div>
          )}

          {errMsg && (
            <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
              ⚠ {errMsg}
            </div>
          )}

          {/* Results */}
          {results.length > 0 && step === 'done' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                <span className="text-lg">🎉</span>
                <div className="flex-1">
                  <p className="text-emerald-800 font-bold text-sm">
                    All {results.filter(r => r.ok).length} transfers confirmed!
                  </p>
                  <a href={`https://testnet.arcscan.app/tx/${results[0]?.hash}`}
                    target="_blank" rel="noreferrer"
                    className="text-emerald-600 text-xs hover:underline font-mono">
                    {results[0]?.hash?.slice(0, 22)}… ↗ ArcScan
                  </a>
                </div>
              </div>
              {results.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs px-3 py-1 text-slate-500">
                  <span className="font-mono">{fmtAddr(r.addr)}</span>
                  <span className={r.ok ? 'text-emerald-600 font-semibold' : 'text-red-500'}>
                    {r.ok ? '✓ Sent' : '✗ Failed'}
                  </span>
                </div>
              ))}
              <button onClick={reset}
                className="mt-1 text-xs text-violet-600 hover:text-violet-700 font-semibold self-center">
                ↩ Send another batch
              </button>
            </div>
          )}

          {/* Send button */}
          {step !== 'done' && step !== 'approving' && step !== 'sending' && (
            <button
              onClick={handleSendAll}
              disabled={!canSend}
              className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
                canSend
                  ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 shadow-lg shadow-violet-900/20 active:scale-[0.99]'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}>
              💸 Send to {validRows.length} recipients — {fmtUSDC(totalAmount)} USDC
              {validRows.length > 0 && (
                <span className="ml-2 text-[11px] opacity-75 font-normal">
                  ({maxApproved ? '1 confirmation' : '2 first time, 1 after'})
                </span>
              )}
            </button>
          )}
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

interface FlowRun { hash: string; at: number; amount: number }

function PaymentFlowsSection() {
  const { address } = useAccount()
  const publicClient           = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const [flows,      setFlows]      = useState<PaymentFlow[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [runningId,  setRunningId]  = useState<string | null>(null)
  const [runHistory, setRunHistory] = useState<Record<string, FlowRun[]>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [form,       setForm]       = useState({
    name: '', recipient: '', amount: '', period: 'monthly' as PaymentFlow['period'],
  })

  const formValid = form.name.trim() !== '' && isAddress(form.recipient) && parseFloat(form.amount) > 0

  const handleCreate = () => {
    if (!formValid) return
    const flow: PaymentFlow = {
      id: newId(), name: form.name.trim(),
      recipient: form.recipient, amount: parseFloat(form.amount),
      period: form.period, active: true,
      nextRun: Date.now() + periodMs(form.period), totalSent: 0,
    }
    setFlows(prev => [flow, ...prev])
    setForm({ name: '', recipient: '', amount: '', period: 'monthly' })
    setShowCreate(false)
  }

  const toggleFlow = (id: string) =>
    setFlows(prev => prev.map(f => f.id === id ? {
      ...f, active: !f.active,
      nextRun: !f.active ? Date.now() + periodMs(f.period) : f.nextRun,
    } : f))

  const deleteFlow = (id: string) => {
    setFlows(prev => prev.filter(f => f.id !== id))
    setRunHistory(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  // ── Run Now: sends actual USDC transfer ──────────────────────────────────
  const handleRunNow = async (flow: PaymentFlow) => {
    if (!address || runningId) return
    setRunningId(flow.id)
    try {
      const hash = await writeContractAsync({
        address: TOKEN_ADDRESSES.USDC, abi: TRANSFER_ABI,
        functionName: 'transfer',
        args: [flow.recipient as `0x${string}`, parseUnits(flow.amount.toString(), 6)],
      })
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash })
      const run: FlowRun = { hash, at: Date.now(), amount: flow.amount }
      setRunHistory(prev => ({ ...prev, [flow.id]: [run, ...(prev[flow.id] ?? [])].slice(0, 5) }))
      setFlows(prev => prev.map(f => f.id === flow.id ? {
        ...f, totalSent: f.totalSent + flow.amount,
        nextRun: Date.now() + periodMs(f.period),
      } : f))
    } catch { /* user rejected */ }
    setRunningId(null)
  }

  const CONTRACT_FEATURES = [
    {
      icon: '🔐', title: 'Payment Escrow',
      desc: 'Lock USDC in a smart contract. Release only when a deadline passes, a signature is provided, or an oracle condition is met.',
      tags: ['DeFi', 'Trustless'],
    },
    {
      icon: '💧', title: 'Streaming Payments',
      desc: 'Drip USDC per second to a recipient. Ideal for real-time salaries, subscriptions, and rental agreements.',
      tags: ['Salaries', 'Subscriptions'],
    },
    {
      icon: '👥', title: 'Multi-sig Treasury',
      desc: 'Require N-of-M wallet signatures before disbursing funds. Perfect for DAOs, company treasuries, and joint accounts.',
      tags: ['DAO', 'Treasury'],
    },
    {
      icon: '🔀', title: 'Conditional Routing',
      desc: 'Automatically route USDC to different addresses based on on-chain state, oracle price feeds, or custom logic.',
      tags: ['Automation', 'Oracle'],
    },
  ]

  return (
    <div className="flex flex-col gap-4">

      {/* ── Flow list card ── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Programmable Payment Flows</h3>
            <p className="text-slate-400 text-xs mt-0.5">Automate recurring USDC distributions</p>
          </div>
          <button onClick={() => setShowCreate(v => !v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors shadow-sm ${
              showCreate
                ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                : 'bg-violet-600 text-white hover:bg-violet-500'
            }`}>
            {showCreate ? '✕ Cancel' : '+ New Flow'}
          </button>
        </div>

        {/* ── Create form ── */}
        {showCreate && (
          <div className="px-5 py-4 bg-violet-50/60 border-b border-violet-100 flex flex-col gap-3">
            <p className="text-xs font-bold text-violet-700 uppercase tracking-wider">New Payment Flow</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-500 font-semibold mb-1 block">Flow Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Team Payroll"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 transition-colors" />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-semibold mb-1 block">Recipient Address</label>
                <div className={`flex items-center gap-2 bg-white border rounded-xl px-3 py-2 focus-within:border-violet-400 transition-colors ${
                  form.recipient && !isAddress(form.recipient) ? 'border-red-300' : 'border-slate-200'
                }`}>
                  <input value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value.trim() }))}
                    placeholder="0x..."
                    className="flex-1 bg-transparent text-sm font-mono outline-none min-w-0" />
                  {isAddress(form.recipient) && <span className="text-emerald-500 text-xs shrink-0">✓</span>}
                </div>
                {form.recipient && !isAddress(form.recipient) && (
                  <p className="text-red-500 text-[11px] mt-1">Invalid address</p>
                )}
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-semibold mb-1 block">Amount per run (USDC)</label>
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 focus-within:border-violet-400 transition-colors">
                  <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder="0.00"
                    className="flex-1 bg-transparent text-sm font-bold outline-none min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  <span className="text-slate-400 text-xs shrink-0">USDC</span>
                </div>
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
            <div className="flex gap-2 pt-1">
              <button onClick={handleCreate} disabled={!formValid}
                className="px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-500 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                ✓ Create Flow
              </button>
              <button onClick={() => { setShowCreate(false); setForm({ name: '', recipient: '', amount: '', period: 'monthly' }) }}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-500 text-xs hover:bg-slate-200 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Flows list ── */}
        {flows.length === 0 ? (
          <div className="py-14 text-center text-slate-400">
            <p className="text-4xl mb-3">⚙️</p>
            <p className="text-sm font-semibold text-slate-500">No payment flows yet</p>
            <p className="text-xs mt-1">Create your first automated USDC flow above</p>
            <button onClick={() => setShowCreate(true)}
              className="mt-4 px-4 py-2 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-xs font-bold hover:bg-violet-100 transition-colors">
              + Create First Flow
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {flows.map(flow => {
              const history  = runHistory[flow.id] ?? []
              const isRunning = runningId === flow.id
              const expanded  = expandedId === flow.id
              return (
                <div key={flow.id} className="flex flex-col">
                  <div className="px-5 py-4 flex items-center gap-3">
                    {/* Toggle switch */}
                    <button onClick={() => toggleFlow(flow.id)}
                      className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${flow.active ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${flow.active ? 'left-5' : 'left-0.5'}`} />
                    </button>

                    {/* Info — clickable to expand */}
                    <button className="flex-1 min-w-0 text-left" onClick={() => setExpandedId(expanded ? null : flow.id)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm">{flow.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                          flow.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}>
                          {flow.active ? '● Active' : '○ Paused'}
                        </span>
                        {history.length > 0 && (
                          <span className="text-[10px] text-violet-600 font-semibold">{history.length} run{history.length > 1 ? 's' : ''}</span>
                        )}
                      </div>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        {fmtAddr(flow.recipient)} · {PERIOD_LABELS[flow.period]} · {fmtUSDC(flow.amount)} USDC
                      </p>
                    </button>

                    {/* Next run + total */}
                    <div className="text-right shrink-0 hidden sm:block">
                      <p className="text-slate-400 text-[10px]">{flow.active ? fmtNextRun(flow.nextRun) : 'Paused'}</p>
                      {flow.totalSent > 0 && (
                        <p className="text-violet-600 text-[10px] font-semibold">Total: ${fmtUSDC(flow.totalSent)}</p>
                      )}
                    </div>

                    {/* Run Now button */}
                    <button
                      onClick={() => handleRunNow(flow)}
                      disabled={!address || !!runningId || !flow.active}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all shrink-0 ${
                        flow.active && address && !runningId
                          ? 'bg-emerald-500 text-white hover:bg-emerald-400 active:scale-95 shadow-sm'
                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      }`}>
                      {isRunning ? (
                        <span className="flex items-center gap-1">
                          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                          Sending…
                        </span>
                      ) : '▶ Run Now'}
                    </button>

                    {/* Delete */}
                    <button onClick={() => deleteFlow(flow.id)}
                      className="w-7 h-7 rounded-lg bg-red-50 text-red-400 text-xs hover:bg-red-100 transition-colors flex items-center justify-center shrink-0">
                      ✕
                    </button>
                  </div>

                  {/* Expanded run history */}
                  {expanded && (
                    <div className="px-5 pb-4 border-t border-slate-50 bg-slate-50/50">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-3 mb-2">Run History</p>
                      {history.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No runs yet — click ▶ Run Now to trigger a payment</p>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {history.map((run, i) => (
                            <div key={i} className="flex items-center justify-between text-xs bg-white border border-slate-100 rounded-lg px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-emerald-500">✓</span>
                                <span className="text-slate-500">{new Date(run.at).toLocaleString()}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="font-bold text-slate-700">{fmtUSDC(run.amount)} USDC</span>
                                <a href={`https://testnet.arcscan.app/tx/${run.hash}`} target="_blank" rel="noreferrer"
                                  className="text-violet-600 hover:underline font-mono text-[10px]">
                                  {run.hash.slice(0, 12)}… ↗
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Smart Contract features ── */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-5 text-white">
        <h3 className="font-bold text-sm mb-1">⚙️ Advanced: Build with Smart Contracts</h3>
        <p className="text-slate-400 text-xs mb-4">These patterns go beyond simple transfers — deploy on Arc for trustless automation</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CONTRACT_FEATURES.map(c => (
            <div key={c.title} className="bg-white/10 hover:bg-white/15 transition-colors rounded-xl p-3.5 cursor-default group">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-lg">{c.icon}</span>
                <p className="font-bold text-white text-xs">{c.title}</p>
              </div>
              <p className="text-slate-400 text-[11px] leading-relaxed">{c.desc}</p>
              <div className="flex gap-1.5 mt-2">
                {c.tags.map(t => (
                  <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-slate-300 font-semibold">{t}</span>
                ))}
              </div>
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

export default function PaymentsPanel({ onNavigate }: { onNavigate: (tab: string) => void }) {
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
      {activeTab === 'send'     && <QuickSendSection  address={address} balanceUsdc={balanceUsdc} onTxSent={handleTxSent} onSwitchTab={setActiveTab} onNavigate={onNavigate} />}
      {activeTab === 'bulk'     && <BulkSendSection   address={address} balanceUsdc={balanceUsdc} onTxSent={handleTxSent} />}
      {activeTab === 'flows'    && <PaymentFlowsSection />}
      {activeTab === 'finality' && <FinalitySection records={txRecords} />}

    </div>
  )
}
