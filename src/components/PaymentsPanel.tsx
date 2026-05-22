// ── PaymentsPanel.tsx ────────────────────────────────────────────────────────
// USDC Payments Infrastructure on Arc
//  1. Quick USDC Send — USDC-denominated fees, <1s finality indicator
//  2. Bulk Distribution — multi-recipient batch
//  3. Programmable Flows — scheduled / stream payments (simulated)
//  4. Finality Tracker — live confirmation timing
//  5. Unified Balance  — Arc × Circle cross-chain USDC via App Kit

import { useState, useCallback, useEffect, useRef } from 'react'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'

// Singleton AppKit — no config needed for testnet
const _appKit = new AppKit()
import {
  useBalance,
  usePublicClient,
} from 'wagmi'
import { isAddress, parseUnits, encodeFunctionData, maxUint256 } from 'viem'

import { TOKEN_ADDRESSES } from '../config/contracts'
import { useWallet } from '../hooks/useWallet'
import WalletGate from './WalletGate'

// ── Turnkey wallet bridge ─────────────────────────────────────────────────────
// Reads wallet info saved by WalletPanel's TurnkeyDashboard after OTP login.
const TK_STORAGE_KEY = 'turnkey_wallet'

interface TurnkeyWalletInfo {
  address: `0x${string}`
  orgId:   string
  walletId: string
}

function useTurnkeyWallet() {
  const [tkWallet, setTkWallet] = useState<TurnkeyWalletInfo | null>(() => {
    try {
      const raw = localStorage.getItem(TK_STORAGE_KEY)
      return raw ? JSON.parse(raw) as TurnkeyWalletInfo : null
    } catch { return null }
  })

  useEffect(() => {
    const sync = () => {
      try {
        const raw = localStorage.getItem(TK_STORAGE_KEY)
        setTkWallet(raw ? JSON.parse(raw) as TurnkeyWalletInfo : null)
      } catch { setTkWallet(null) }
    }
    window.addEventListener('turnkey_wallet_updated', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('turnkey_wallet_updated', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const disconnect = () => {
    localStorage.removeItem(TK_STORAGE_KEY)
    setTkWallet(null)
  }

  return { tkWallet, disconnect }
}

// ── Thin wrapper — delegates entirely to the unified useWallet hook ───────────
// Kept for backward compatibility with existing PaymentsPanel call sites.
function useTurnkeyAwareWrite() {
  const { writeContract, sendTransaction, tkReady } = useWallet()
  return { writeContract, sendTransaction, tkReady }
}

// ── Minimal ERC-20 transfer ABI ───────────────────────────────────────────────

const TRANSFER_ABI = [
  {
    name: 'transfer', type: 'function' as const,
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

// ── ERC-20 minimal (approve + allowance + transferFrom) ───────────────────────
const ERC20_MINIMAL = [
  { name: 'approve',     type: 'function' as const, stateMutability: 'nonpayable',
    inputs:  [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }] },
  { name: 'allowance',   type: 'function' as const, stateMutability: 'view',
    inputs:  [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }] },
  { name: 'transferFrom', type: 'function' as const, stateMutability: 'nonpayable',
    inputs:  [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }] },
] as const

// ── Multicall3 (deployed on virtually all EVM chains) ─────────────────────────
// https://github.com/mds1/multicall
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as `0x${string}`
const MULTICALL3_ABI = [
  {
    name: 'aggregate3', type: 'function' as const, stateMutability: 'payable',
    inputs: [{
      name: 'calls', type: 'tuple[]',
      components: [
        { name: 'target',       type: 'address' },
        { name: 'allowFailure', type: 'bool'    },
        { name: 'callData',     type: 'bytes'   },
      ],
    }],
    outputs: [{
      name: 'returnData', type: 'tuple[]',
      components: [
        { name: 'success',    type: 'bool'  },
        { name: 'returnData', type: 'bytes' },
      ],
    }],
  },
] as const

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelTab = 'send' | 'bulk' | 'flows' | 'apps' | 'finality' | 'unified'

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
  const [txErr,       setTxErr]       = useState<string>('')
  const [lastRec,     setLastRec]     = useState<FinalityRecord | null>(null)
  const sentAt = useRef<number>(0)

  const publicClient = usePublicClient()
  const { writeContract: tkWriteContract, isReady: walletReady } = useWallet()

  const amountN      = parseFloat(amount) || 0
  const toValid      = isAddress(to)
  const amountValid  = amountN > 0 && amountN <= balanceUsdc
  const canSend      = toValid && amountValid && txStep === 'idle' && walletReady

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
      const hash = await tkWriteContract({
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
      console.error('[QuickSend] error:', e)
      const errMsg = e instanceof Error ? e.message : String(e)
      setTxErr(errMsg)
      const failed: FinalityRecord = { ...pending, status: 'failed' }
      setLastRec(failed)
      onTxSent(failed)
      setTxStep('error')
      setTimeout(() => { setTxStep('idle'); setTxErr('') }, 6000)
    }
  }, [canSend, address, to, amount, amountN, feeEst, onTxSent, tkWriteContract, publicClient])

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

        {/* Wallet not ready warning */}
        {!walletReady && toValid && amountValid && (
          <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-xs text-center">
            🔐 No signing wallet — visit <button className="underline font-semibold" onClick={() => onNavigate('wallet')}>Wallet tab</button> to activate Turnkey, or connect MetaMask above
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
           !walletReady        ? '🔐 Connect wallet first' :
           `Send ${amountN > 0 ? fmtUSDC(amountN) + ' USDC' : 'USDC'}`}
        </button>

        {/* Error detail */}
        {txStep === 'error' && txErr && (
          <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs break-all">
            ⚠ {txErr}
          </div>
        )}

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

  const publicClient                        = usePublicClient()
  const { writeContract: writeContractAsync, sendTransaction: sendTransactionAsync } = useWallet()

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

const LS_FLOWS   = 'arc_flows_5042002'
const LS_HISTORY = 'arc_flows_history_5042002'

function loadFlows(): PaymentFlow[] {
  try { return JSON.parse(localStorage.getItem(LS_FLOWS) ?? '[]') } catch { return [] }
}
function loadHistory(): Record<string, FlowRun[]> {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) ?? '{}') } catch { return {} }
}

function PaymentFlowsSection() {
  const { address } = useWallet()
  const publicClient           = usePublicClient()
  const { writeContract: writeContractAsync } = useTurnkeyAwareWrite()

  const [flows,        setFlowsRaw]   = useState<PaymentFlow[]>(loadFlows)
  const [showCreate,   setShowCreate] = useState(false)
  const [runningId,    setRunningId]  = useState<string | null>(null)
  const [runHistory,   setHistoryRaw] = useState<Record<string, FlowRun[]>>(loadHistory)
  const [expandedId,   setExpandedId] = useState<string | null>(null)
  const [confirmDel,   setConfirmDel] = useState<string | null>(null)  // id awaiting delete confirm
  const [form,         setForm]       = useState({
    name: '', recipient: '', amount: '', period: 'monthly' as PaymentFlow['period'],
  })

  // Persist whenever flows or history change
  const setFlows = (updater: PaymentFlow[] | ((p: PaymentFlow[]) => PaymentFlow[])) => {
    setFlowsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      localStorage.setItem(LS_FLOWS, JSON.stringify(next))
      return next
    })
  }
  const setRunHistory = (updater: Record<string, FlowRun[]> | ((p: Record<string, FlowRun[]>) => Record<string, FlowRun[]>)) => {
    setHistoryRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      localStorage.setItem(LS_HISTORY, JSON.stringify(next))
      return next
    })
  }

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
    setConfirmDel(null)
    if (expandedId === id) setExpandedId(null)
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
      setRunHistory(prev => ({ ...prev, [flow.id]: [run, ...(prev[flow.id] ?? [])].slice(0, 10) }))
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

                    {/* Cancel / Delete with confirmation */}
                    {confirmDel === flow.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-red-600 font-semibold whitespace-nowrap">Delete?</span>
                        <button onClick={() => deleteFlow(flow.id)}
                          className="px-2 py-1 rounded-lg bg-red-500 text-white text-[10px] font-bold hover:bg-red-400 transition-colors">
                          Yes
                        </button>
                        <button onClick={() => setConfirmDel(null)}
                          className="px-2 py-1 rounded-lg bg-slate-100 text-slate-500 text-[10px] hover:bg-slate-200 transition-colors">
                          No
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDel(flow.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-500 text-[11px] font-semibold hover:bg-red-100 transition-colors shrink-0">
                        🗑 Cancel
                      </button>
                    )}
                  </div>

                  {/* Expanded run history */}
                  {expanded && (
                    <div className="px-5 pb-4 border-t border-slate-100 bg-slate-50/50">
                      <div className="flex items-center justify-between pt-3 mb-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Run History ({history.length})
                        </p>
                        {flow.totalSent > 0 && (
                          <p className="text-[10px] font-semibold text-violet-600">
                            Total sent: ${fmtUSDC(flow.totalSent)} USDC
                          </p>
                        )}
                      </div>
                      {history.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No runs yet — click ▶ Run Now to trigger a payment</p>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {history.map((run, i) => (
                            <div key={i} className="flex items-center justify-between text-xs bg-white border border-slate-100 rounded-lg px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
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
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
        <h3 className="font-bold text-sm mb-1 text-slate-900">⚙️ Advanced: Build with Smart Contracts</h3>
        <p className="text-slate-500 text-xs mb-4">These patterns go beyond simple transfers — deploy on Arc for trustless automation</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CONTRACT_FEATURES.map(c => (
            <div key={c.title} className="bg-white hover:bg-slate-50 border border-slate-200 transition-colors rounded-xl p-3.5 cursor-default group">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-lg">{c.icon}</span>
                <p className="font-bold text-slate-900 text-xs">{c.title}</p>
              </div>
              <p className="text-slate-500 text-[11px] leading-relaxed">{c.desc}</p>
              <div className="flex gap-1.5 mt-2">
                {c.tags.map(t => (
                  <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── USDC Escrow Deep Dive (from Stablecoin 101 videos) ── */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-bold text-slate-900 text-sm">🔐 USDC Smart Contract Escrow</h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-600 font-semibold">Stablecoin 101</span>
            </div>
            <p className="text-slate-400 text-xs">Self-executing agreements — both sides must meet commitments before USDC is released</p>
          </div>
          <a href="https://community.arc.io/home/videos/how-to-use-usdc-in-real-world-payments-application-part-1-2025-12-08"
            target="_blank" rel="noreferrer"
            className="text-violet-600 text-xs font-semibold hover:text-violet-700 shrink-0">Watch Tutorial ↗</a>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* State machine */}
          <div>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider mb-3">Contract State Machine</p>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { state: 'Open',   desc: 'Job created, awaiting deposit',      color: 'bg-blue-50 border-blue-200 text-blue-700'    },
                { state: 'Locked', desc: 'USDC escrowed, work in progress',    color: 'bg-amber-50 border-amber-200 text-amber-700' },
                { state: 'Closed', desc: 'Funds released or refunded',         color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
              ].map((s, i, arr) => (
                <div key={s.state} className="flex items-center gap-2">
                  <div className={`${s.color} border rounded-xl px-4 py-2.5 text-center min-w-[100px]`}>
                    <p className="font-extrabold text-sm">{s.state}</p>
                    <p className="text-[10px] opacity-80 mt-0.5">{s.desc}</p>
                  </div>
                  {i < arr.length - 1 && <span className="text-slate-400 text-lg font-bold">→</span>}
                </div>
              ))}
            </div>
          </div>

          {/* 3 Roles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                role: 'Depositor',
                emoji: '💼',
                alt: 'Employer',
                desc: 'Funds the escrow with the agreed USDC amount. Cannot retrieve funds once locked — only the Agent can release or revert.',
                color: 'bg-blue-50 border-blue-200',
                fn: 'deposit()',
              },
              {
                role: 'Beneficiary',
                emoji: '👩‍💻',
                alt: 'Freelancer',
                desc: 'Delivers the work. Receives USDC only after the Agent validates the deliverable and calls release(). Cannot self-claim.',
                color: 'bg-violet-50 border-violet-200',
                fn: 'receives funds',
              },
              {
                role: 'Agent',
                emoji: '⚖️',
                alt: 'Neutral 3rd party / AI',
                desc: 'Neutral party (human, AI, or oracle) that validates outcomes. Only role that can call release() or revertEscrow(). Enforces fairness.',
                color: 'bg-amber-50 border-amber-200',
                fn: 'release() / revert()',
              },
            ].map(r => (
              <div key={r.role} className={`${r.color} border rounded-xl p-4`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{r.emoji}</span>
                  <div>
                    <p className="font-extrabold text-slate-900 text-sm">{r.role}</p>
                    <p className="text-slate-400 text-[10px]">{r.alt}</p>
                  </div>
                </div>
                <p className="text-slate-600 text-xs leading-relaxed mb-2">{r.desc}</p>
                <code className="text-[10px] font-mono bg-white border border-slate-200 px-2 py-0.5 rounded text-violet-600">{r.fn}</code>
              </div>
            ))}
          </div>

          {/* Core functions + Solidity example */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider mb-3">Core Contract Functions</p>
              <div className="flex flex-col gap-2">
                {[
                  { fn: 'deposit(amount)',     who: 'Depositor', desc: 'Transfers USDC from employer to contract. State: Open → Locked. Includes role check + ERC-20 transferFrom.', color: 'border-blue-200 bg-blue-50' },
                  { fn: 'release()',           who: 'Agent only', desc: 'Transfers locked USDC to Beneficiary. State: Locked → Closed. Validates work was delivered.', color: 'border-emerald-200 bg-emerald-50' },
                  { fn: 'revertEscrow()',      who: 'Agent only', desc: 'Returns USDC to Depositor if work is rejected or deadline expires. State: Locked → Closed.', color: 'border-red-200 bg-red-50' },
                ].map(f => (
                  <div key={f.fn} className={`${f.color} border rounded-xl p-3`}>
                    <div className="flex items-center justify-between mb-1">
                      <code className="font-mono font-bold text-sm text-slate-900">{f.fn}</code>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-500 font-medium">{f.who}</span>
                    </div>
                    <p className="text-slate-500 text-xs leading-relaxed">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider mb-3">Solidity Implementation (Part 2)</p>
              <div className="bg-slate-100 border border-slate-200 rounded-xl p-4">
                <pre className="text-xs text-emerald-700 font-mono leading-relaxed overflow-x-auto">
{`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract USDCEscrow {
  enum Stage { Open, Locked, Closed }

  address public depositor;
  address public beneficiary;
  address public agent;
  IERC20  public usdc;
  uint256 public amount;
  Stage   public stage;

  function deposit(uint256 _amount) external {
    require(msg.sender == depositor);
    require(stage == Stage.Open);
    usdc.transferFrom(msg.sender, address(this), _amount);
    amount = _amount;
    stage  = Stage.Locked;
  }

  function release() external {
    require(msg.sender == agent);
    require(stage == Stage.Locked);
    usdc.transfer(beneficiary, amount);
    stage = Stage.Closed;
  }

  function revertEscrow() external {
    require(msg.sender == agent);
    require(stage == Stage.Locked);
    usdc.transfer(depositor, amount);
    stage = Stage.Closed;
  }
}`}
                </pre>
              </div>
            </div>
          </div>

          {/* Real-world use case */}
          <div className="bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-200 rounded-xl p-4">
            <p className="text-violet-700 text-xs font-bold uppercase tracking-wider mb-2">💡 Real-World Use Case: Freelancer Payment</p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
              {[
                { step: '1', actor: '💼 Employer', action: 'Calls deposit(500 USDC)', note: 'Funds locked in contract', color: 'bg-white border-blue-200' },
                { step: '2', actor: '👩‍💻 Freelancer', action: 'Delivers work output', note: 'Submits deliverable hash', color: 'bg-white border-violet-200' },
                { step: '3', actor: '⚖️ Agent/AI', action: 'Validates quality', note: 'Verifies deliverable meets spec', color: 'bg-white border-amber-200' },
                { step: '4', actor: '⚡ Arc', action: 'release() executes', note: 'USDC → freelancer, ~780ms', color: 'bg-white border-emerald-200' },
              ].map(s => (
                <div key={s.step} className={`${s.color} border rounded-lg p-2.5 text-center`}>
                  <p className="text-slate-400 text-[9px] font-bold mb-1">STEP {s.step}</p>
                  <p className="font-semibold text-slate-800 text-[11px] mb-0.5">{s.actor}</p>
                  <p className="text-violet-700 text-[10px] font-mono">{s.action}</p>
                  <p className="text-slate-400 text-[9px] mt-1">{s.note}</p>
                </div>
              ))}
            </div>
          </div>
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

// ── 5. Use Cases ─────────────────────────────────────────────────────────────

type UseCase = 'remittance' | 'marketplace' | 'payroll' | 'merchant'

const AED_TO_USDC = 0.2720   // 1 AED → 0.272 USDC (approximate)

// FX rates for display
const FX_RATES: Record<string, { rate: number; symbol: string; flag: string }> = {
  AED: { rate: 0.2720, symbol: 'AED', flag: '🇦🇪' },
  USD: { rate: 1.0000, symbol: 'USD', flag: '🇺🇸' },
  EUR: { rate: 1.0850, symbol: 'EUR', flag: '🇪🇺' },
  GBP: { rate: 1.2700, symbol: 'GBP', flag: '🇬🇧' },
  INR: { rate: 0.0120, symbol: 'INR', flag: '🇮🇳' },
  PHP: { rate: 0.0174, symbol: 'PHP', flag: '🇵🇭' },
  MXN: { rate: 0.0510, symbol: 'MXN', flag: '🇲🇽' },
}

interface MarketplaceSeller {
  id: string; name: string; country: string; flag: string
  role: string; usdc: number; address: string
  status: 'pending' | 'settling' | 'settled'
  sendAmt: number    // testnet USDC sent on-chain
  txHash?: string
}

interface PayrollEmployee {
  id: string; name: string; country: string; flag: string
  role: string; usdc: number; address: string; receipt?: string
  sendAmt: number   // testnet USDC amount actually sent on-chain
}

const DEMO_SELLERS: MarketplaceSeller[] = [
  { id: '1', name: 'Ayesha Khalil', country: 'Dubai, UAE',    flag: '🇦🇪', role: 'Seller',  usdc: 890,  sendAmt: 0.09, address: '0xa1b2c3d4e5f6789012345678901234567890abcd', status: 'pending' },
  { id: '2', name: 'Marco Russo',   country: 'Rome, Italy',   flag: '🇮🇹', role: 'Creator', usdc: 1200, sendAmt: 0.12, address: '0xb2c3d4e5f6789012345678901234567890123456', status: 'pending' },
  { id: '3', name: 'Priya Sharma',  country: 'Mumbai, India', flag: '🇮🇳', role: 'Seller',  usdc: 540,  sendAmt: 0.05, address: '0xc3d4e5f6789012345678901234567890abcdef12', status: 'pending' },
  { id: '4', name: 'Ahmed Hassan',  country: 'Cairo, Egypt',  flag: '🇪🇬', role: 'Creator', usdc: 320,  sendAmt: 0.03, address: '0xd4e5f6789012345678901234567890abcdef1234', status: 'pending' },
]

const DEMO_EMPLOYEES: PayrollEmployee[] = [
  { id: '1', name: 'Sarah Chen',       country: 'Singapore',  flag: '🇸🇬', role: 'Senior Engineer',    usdc: 2500, sendAmt: 0.25, address: '0xa1b2c3d4e5f6789012345678901234567890abcd' },
  { id: '2', name: 'Carlos Lima',      country: 'Brazil',     flag: '🇧🇷', role: 'Product Designer',   usdc: 1800, sendAmt: 0.18, address: '0xb2c3d4e5f6789012345678901234567890123456' },
  { id: '3', name: 'Fatima Al-Zaabi', country: 'UAE',        flag: '🇦🇪', role: 'Content Strategist', usdc: 1200, sendAmt: 0.12, address: '0xc3d4e5f6789012345678901234567890123456ab' },
  { id: '4', name: 'Rajesh Kumar',     country: 'India',      flag: '🇮🇳', role: 'Backend Engineer',   usdc: 2200, sendAmt: 0.22, address: '0xd4e5f6789012345678901234567890123456789a' },
  { id: '5', name: 'Emma Thompson',    country: 'UK',         flag: '🇬🇧', role: 'Product Manager',    usdc: 3000, sendAmt: 0.30, address: '0xe5f6789012345678901234567890123456789abc' },
]

function SimSpinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  )
}

// ── Remittance Tab ────────────────────────────────────────────────────────────
function RemittanceTab({ balanceUsdc, address, onTxSent }: {
  balanceUsdc: number
  address: `0x${string}` | undefined
  onTxSent: (rec: FinalityRecord) => void
}) {
  const { writeContract: writeContractAsync } = useTurnkeyAwareWrite()
  const publicClient = usePublicClient()

  const [fromCurrency, setFromCurrency] = useState('AED')
  const [fromAmount,   setFromAmount]   = useState('500')
  const [toAddress,    setToAddress]    = useState('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')
  const [step, setStep] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [finalityMs, setFinalityMs] = useState<number | null>(null)
  const [txHash, setTxHash] = useState('')

  const fx = FX_RATES[fromCurrency] ?? FX_RATES.AED
  const usdcAmount = Math.max(0, (parseFloat(fromAmount) || 0) * fx.rate)
  const canSend = !!address && usdcAmount > 0 && usdcAmount <= balanceUsdc && step === 'idle'

  const traditionalFeeFlat = 25  // USD
  const traditionalFeePct  = 0.045 * usdcAmount  // 4.5%
  const arcFee = 0.001

  const handleSend = async () => {
    if (!canSend || !address) return
    setStep('sending')
    const sentAt = Date.now()
    try {
      const hash = await writeContractAsync({
        address:      TOKEN_ADDRESSES.USDC,
        abi:          TRANSFER_ABI,
        functionName: 'transfer',
        args:         [toAddress as `0x${string}`, parseUnits(usdcAmount.toFixed(6), 6)],
        chainId:      5042002,
      })
      setTxHash(hash)
      const receipt = publicClient
        ? await publicClient.waitForTransactionReceipt({ hash })
        : null
      const ms = Date.now() - sentAt
      setFinalityMs(ms)
      const ok = !receipt || receipt.status === 'success'
      setStep(ok ? 'done' : 'error')
      onTxSent({
        id: newId(), hash, to: toAddress, amount: usdcAmount,
        sentAt, confirmedAt: Date.now(), finalityMs: ms,
        status: ok ? 'confirmed' : 'failed', fee: arcFee,
      })
    } catch {
      setStep('error')
      setTimeout(() => setStep('idle'), 3000)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Blueprint banner */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-900 rounded-2xl p-4 flex items-start gap-3">
        <span className="text-2xl shrink-0">🌍</span>
        <div>
          <p className="text-white font-bold text-sm">Remittance App — Transparent Fees + Real-time Settlement</p>
          <p className="text-blue-200 text-xs mt-0.5 leading-relaxed">
            $857B annual remittance market. Average fee: 5–7%. On Arc: flat ~$0.001 USDC, settled in &lt; 1 second.
          </p>
        </div>
        <a href="https://www.arc.io/blog/payments-arc-blueprints" target="_blank" rel="noreferrer"
          className="shrink-0 px-3 py-1.5 rounded-xl bg-white/15 border border-white/20 text-white text-[11px] font-bold hover:bg-white/20 transition-colors whitespace-nowrap">
          Blueprint ↗
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: send form */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
          <h3 className="font-bold text-slate-900 text-sm">Send Remittance</h3>

          {/* From currency + amount */}
          <div>
            <label className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">Sender pays</label>
            <div className="flex gap-2">
              <select value={fromCurrency} onChange={e => setFromCurrency(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-violet-400 transition-colors shrink-0">
                {Object.entries(FX_RATES).map(([code, { flag }]) => (
                  <option key={code} value={code}>{flag} {code}</option>
                ))}
              </select>
              <input type="number" value={fromAmount} onChange={e => setFromAmount(e.target.value)}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 font-bold text-lg outline-none focus:border-violet-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            </div>
            <div className="flex gap-1.5 mt-1.5">
              {['100', '250', '500', '1000'].map(v => (
                <button key={v} onClick={() => setFromAmount(v)}
                  className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-500 text-xs hover:bg-slate-200 transition-colors">
                  {fx.symbol} {v}
                </button>
              ))}
            </div>
          </div>

          {/* Arrow + USDC amount */}
          <div className="flex items-center gap-3 px-4 py-3 bg-violet-50 border border-violet-200 rounded-xl">
            <span className="text-lg">↓</span>
            <div className="flex-1">
              <p className="text-[10px] text-violet-500 font-bold uppercase tracking-wider">Recipient receives (USDC)</p>
              <p className="text-violet-900 font-extrabold text-2xl leading-none">{usdcAmount.toFixed(2)} USDC</p>
              <p className="text-violet-500 text-[11px] mt-0.5">1 {fromCurrency} = {fx.rate.toFixed(4)} USDC · rate via Circle</p>
            </div>
            <span className="text-3xl">💵</span>
          </div>

          {/* Recipient */}
          <div>
            <label className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">Recipient wallet</label>
            <div className={`flex items-center gap-2 bg-slate-50 border rounded-xl px-3 py-2.5 focus-within:border-violet-400 transition-colors ${
              toAddress && !isAddress(toAddress) ? 'border-red-300' : 'border-slate-200'
            }`}>
              <span className="text-slate-400 text-sm shrink-0">👤</span>
              <input value={toAddress} onChange={e => setToAddress(e.target.value.trim())}
                placeholder="0x..."
                className="flex-1 bg-transparent text-slate-900 text-xs font-mono outline-none min-w-0" />
              {isAddress(toAddress) && <span className="text-emerald-500 text-xs">✓</span>}
            </div>
          </div>

          {/* Send button */}
          <button onClick={handleSend} disabled={!canSend}
            className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
              canSend
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-900/20'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}>
            {step === 'sending' ? <span className="flex items-center justify-center gap-2"><SimSpinner /> Sending…</span> :
             step === 'done'    ? `✅ Confirmed in ${finalityMs ? fmtMs(finalityMs) : '…'}!` :
             step === 'error'   ? '⚠ Failed — try again' :
             `🌍 Send ${usdcAmount.toFixed(2)} USDC`}
          </button>

          {step === 'done' && txHash && (
            <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer"
              className="text-center text-violet-600 text-xs hover:underline font-mono">
              {txHash.slice(0, 24)}… ↗ ArcScan
            </a>
          )}
        </div>

        {/* Right: fee comparison */}
        <div className="flex flex-col gap-3">
          {/* Fee breakdown */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-slate-900 text-sm mb-3">Fee Comparison</h3>
            <div className="grid grid-cols-2 gap-3">
              {/* Traditional */}
              <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-red-700 text-[10px] font-bold uppercase tracking-wider mb-2">🏦 Traditional Wire</p>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-red-600">Flat fee</span>
                    <span className="font-bold text-red-800">${traditionalFeeFlat}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-red-600">FX margin</span>
                    <span className="font-bold text-red-800">${traditionalFeePct.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs border-t border-red-200 pt-1 mt-0.5">
                    <span className="text-red-700 font-semibold">Total fees</span>
                    <span className="font-extrabold text-red-800">${(traditionalFeeFlat + traditionalFeePct).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-red-600">Settlement</span>
                    <span className="font-bold text-red-700">3–5 days</span>
                  </div>
                </div>
              </div>
              {/* Arc */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <p className="text-emerald-700 text-[10px] font-bold uppercase tracking-wider mb-2">⚡ Arc + USDC</p>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-emerald-600">Gas fee</span>
                    <span className="font-bold text-emerald-800">~${arcFee.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-emerald-600">FX margin</span>
                    <span className="font-bold text-emerald-800">$0.00</span>
                  </div>
                  <div className="flex justify-between text-xs border-t border-emerald-200 pt-1 mt-0.5">
                    <span className="text-emerald-700 font-semibold">Total fees</span>
                    <span className="font-extrabold text-emerald-800">~${arcFee.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-emerald-600">Settlement</span>
                    <span className="font-bold text-emerald-700">⚡ &lt; 1 second</span>
                  </div>
                </div>
              </div>
            </div>
            {/* Savings callout */}
            <div className="mt-3 px-3 py-2.5 bg-violet-50 border border-violet-100 rounded-xl flex items-center gap-2">
              <span className="text-lg">💡</span>
              <p className="text-violet-700 text-xs">
                Savings on this transfer:{' '}
                <strong className="text-violet-900">${(traditionalFeeFlat + traditionalFeePct - arcFee).toFixed(2)} USDC</strong>
                {' '}({(((traditionalFeeFlat + traditionalFeePct) / usdcAmount) * 100).toFixed(1)}% → &lt;0.01%)
              </p>
            </div>
          </div>

          {/* Real-time settlement */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-slate-900 text-sm mb-3">Real-time Settlement</h3>
            <div className="flex flex-col gap-2">
              {[
                { label: 'Arc Testnet',  time: '< 1 second',  bar: 1,   color: 'bg-emerald-500', hl: true },
                { label: 'Wise',         time: '~1–2 hours',  bar: 30,  color: 'bg-amber-400',   hl: false },
                { label: 'SWIFT wire',   time: '3–5 days',    bar: 100, color: 'bg-red-400',     hl: false },
                { label: 'Western Union',time: '~1–3 days',   bar: 80,  color: 'bg-orange-400',  hl: false },
              ].map(r => (
                <div key={r.label} className={`flex items-center gap-2 px-3 py-2 rounded-xl ${r.hl ? 'bg-emerald-50' : ''}`}>
                  <span className={`text-[11px] font-semibold w-24 shrink-0 ${r.hl ? 'text-emerald-800' : 'text-slate-500'}`}>{r.label}</span>
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${r.color} rounded-full transition-all`} style={{ width: `${r.bar}%` }} />
                  </div>
                  <span className={`text-[11px] font-bold w-20 text-right shrink-0 ${r.hl ? 'text-emerald-700' : 'text-slate-400'}`}>{r.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Marketplace Settlement Tab ────────────────────────────────────────────────
function MarketplaceTab({ address, onTxSent }: {
  address:  `0x${string}` | undefined
  onTxSent: (rec: FinalityRecord) => void
}) {
  const { writeContract: writeContractAsync } = useTurnkeyAwareWrite()
  const publicClient = usePublicClient()

  const [sellers,   setSellers]  = useState<MarketplaceSeller[]>(DEMO_SELLERS.map(s => ({ ...s })))
  const [settling,  setSettling] = useState(false)
  const [done,      setDone]     = useState(false)
  const [errMsg,    setErrMsg]   = useState('')
  const [batchMode, setBatchMode] = useState(true)
  const [batchHash, setBatchHash] = useState<string | null>(null)

  const pending      = sellers.filter(s => s.status === 'pending')
  const totalPending = sellers.reduce((s, r) => s + r.usdc, 0)
  const _totalSend   = sellers.reduce((s, r) => s + r.sendAmt, 0); void _totalSend
  const platformFee  = totalPending * 0.025
  const gasTotal     = sellers.length * 0.001

  const handleSettle = async () => {
    if (!address || settling || pending.length === 0) return

    const { isAddress: checkAddr } = await import('viem')
    const invalid = pending.filter(s => !checkAddr(s.address.trim(), { strict: false }))
    if (invalid.length > 0) {
      setErrMsg(`Invalid addresses: ${invalid.map(s => s.name).join(', ')}`)
      return
    }

    setSettling(true)
    setErrMsg('')

    // ── MULTICALL3 BATCH (1 approve + 1 tx for all) ───────────────────────────
    if (batchMode && publicClient) {
      try {
        const totalNeeded = pending.reduce(
          (s, sel) => s + parseUnits(sel.sendAmt.toFixed(6), 6), 0n
        )
        const code = await publicClient.getBytecode({ address: MULTICALL3_ADDRESS }).catch(() => null)
        const mc3Available = Boolean(code && code.length > 2)

        if (mc3Available) {
          const allowance = await publicClient.readContract({
            address: TOKEN_ADDRESSES.USDC, abi: ERC20_MINIMAL,
            functionName: 'allowance', args: [address, MULTICALL3_ADDRESS],
          }).catch(() => 0n) as bigint

          if (allowance < totalNeeded) {
            setErrMsg('Step 1/2: Approve batch payer in wallet…')
            const aHash = await writeContractAsync({
              address: TOKEN_ADDRESSES.USDC, abi: ERC20_MINIMAL,
              functionName: 'approve', args: [MULTICALL3_ADDRESS, maxUint256], chainId: 5042002,
            })
            setErrMsg('Step 1/2: Waiting for approval…')
            try { await publicClient.waitForTransactionReceipt({ hash: aHash }) } catch {}
          }

          setErrMsg(`Step 2/2: Sign ONE tx to settle all ${pending.length} sellers…`)
          setSellers(prev => prev.map(s => ({ ...s, status: s.status === 'pending' ? 'settling' : s.status })))

          const calls = pending.map(sel => ({
            target: TOKEN_ADDRESSES.USDC, allowFailure: false,
            callData: encodeFunctionData({
              abi: ERC20_MINIMAL, functionName: 'transferFrom',
              args: [address, sel.address.trim().toLowerCase() as `0x${string}`, parseUnits(sel.sendAmt.toFixed(6), 6)],
            }),
          }))
          const sentAt = Date.now()
          const hash = await writeContractAsync({
            address: MULTICALL3_ADDRESS, abi: MULTICALL3_ABI,
            functionName: 'aggregate3', args: [calls], chainId: 5042002,
          })
          setErrMsg('Mining batch settlement…')
          try { await publicClient.waitForTransactionReceipt({ hash }) } catch {}

          setBatchHash(hash)
          setSellers(prev => prev.map(s =>
            s.status === 'settling' ? { ...s, status: 'settled', txHash: hash } : s
          ))
          pending.forEach(sel => onTxSent({
            id: newId(), hash, to: sel.address, amount: sel.sendAmt,
            sentAt, confirmedAt: Date.now(), finalityMs: Date.now() - sentAt, status: 'confirmed', fee: 0.001,
          }))
          setErrMsg('')
          setSettling(false)
          setDone(true)
          return
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)
        if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('rejected the request')) {
          setErrMsg('Settlement cancelled.')
          setSellers(prev => prev.map(s => s.status === 'settling' ? { ...s, status: 'pending' } : s))
          setSettling(false); return
        }
        setErrMsg(`Batch failed — switching to sequential…`)
        setSellers(prev => prev.map(s => s.status === 'settling' ? { ...s, status: 'pending' } : s))
        setBatchMode(false)
        await new Promise(r => setTimeout(r, 1200))
        setErrMsg('')
      }
    }

    // ── SEQUENTIAL FALLBACK ───────────────────────────────────────────────────
    for (const sel of pending) {
      const toAddr = sel.address.trim().toLowerCase() as `0x${string}`
      setSellers(prev => prev.map(s => s.id === sel.id ? { ...s, status: 'settling' } : s))
      try {
        const sentAt = Date.now()
        const hash = await writeContractAsync({
          address: TOKEN_ADDRESSES.USDC, abi: TRANSFER_ABI,
          functionName: 'transfer', args: [toAddr, parseUnits(sel.sendAmt.toFixed(6), 6)], chainId: 5042002,
        })
        try { if (publicClient) await publicClient.waitForTransactionReceipt({ hash }) } catch {}
        setSellers(prev => prev.map(s => s.id === sel.id ? { ...s, status: 'settled', txHash: hash } : s))
        onTxSent({
          id: newId(), hash, to: toAddr, amount: sel.sendAmt,
          sentAt, confirmedAt: Date.now(), finalityMs: Date.now() - sentAt, status: 'confirmed', fee: 0.001,
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)
        if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('rejected the request')) {
          setSellers(prev => prev.map(s => s.status === 'settling' ? { ...s, status: 'pending' } : s))
          setErrMsg('Settlement cancelled.')
          setSettling(false); return
        }
        setSellers(prev => prev.map(s => s.id === sel.id ? { ...s, status: 'pending' } : s))
        setErrMsg(`Skipped ${sel.name}: ${msg.slice(0, 60)}`)
      }
    }
    setSettling(false)
    setDone(sellers.every(s => s.status === 'settled') || pending.length > 0)
  }

  const handleReset = () => {
    setSellers(DEMO_SELLERS.map(s => ({ ...s })))
    setDone(false); setErrMsg(''); setBatchHash(null); setBatchMode(true)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Banner */}
      <div className="bg-gradient-to-r from-amber-900 to-orange-900 rounded-2xl p-4 flex items-start gap-3">
        <span className="text-2xl shrink-0">🏪</span>
        <div>
          <p className="text-white font-bold text-sm">UAE Marketplace · Global Seller Settlement</p>
          <p className="text-amber-200 text-xs mt-0.5 leading-relaxed">
            Pay international sellers/creators in one batch transaction. No FX delays, no correspondent bank fees.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Seller list */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-sm">Pending Settlements</h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold uppercase tracking-wide">
                  On-chain
                </span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5">{pending.length} sellers · {totalPending.toLocaleString()} USDC total</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!done && (
                <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Use Multicall3 batch (1 signature for all)">
                  <div
                    onClick={() => setBatchMode(v => !v)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${batchMode ? 'bg-violet-500' : 'bg-slate-200'}`}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${batchMode ? 'left-4.5' : 'left-0.5'}`} />
                  </div>
                  <span className="text-[10px] text-slate-500 font-medium">1-sig</span>
                </label>
              )}
              {done ? (
                <button onClick={handleReset}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-colors">
                  ↩ Reset
                </button>
              ) : (
                <button onClick={handleSettle} disabled={settling || pending.length === 0 || !address}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${
                    !settling && pending.length > 0 && address
                      ? 'bg-amber-600 text-white hover:bg-amber-500'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}>
                  {settling ? <span className="flex items-center gap-1.5"><SimSpinner />Settling…</span>
                    : !address ? '🔒 Connect Wallet'
                    : '⚡ Settle All'}
                </button>
              )}
            </div>
          </div>
          {errMsg && (
            <div className="mx-4 mt-3 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
              {errMsg}
            </div>
          )}
          <div className="divide-y divide-slate-50">
            {sellers.map(s => (
              <div key={s.id} className={`flex items-center gap-3 px-5 py-3.5 transition-all ${
                s.status === 'settled' ? 'bg-emerald-50/60' : s.status === 'settling' ? 'bg-amber-50' : ''
              }`}>
                <span className="text-2xl shrink-0">{s.flag}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-slate-900 text-sm">{s.name}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">{s.role}</span>
                  </div>
                  <p className="text-slate-400 text-xs">{s.country}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-900 text-sm">{s.usdc.toLocaleString()} USDC</p>
                  <p className="text-slate-400 text-[10px] font-mono">{s.address.slice(0, 12)}…</p>
                </div>
                <div className="w-24 shrink-0 text-right">
                  {s.status === 'settled' ? (
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="flex items-center gap-1 text-emerald-600 text-xs font-bold">
                        <span>✓</span> Settled
                      </span>
                      {s.txHash && (
                        <a
                          href={`https://explorer.arc.fun/tx/${s.txHash}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-violet-500 hover:text-violet-700 font-mono"
                        >
                          {s.txHash.slice(0, 8)}… ↗
                        </a>
                      )}
                    </span>
                  ) : s.status === 'settling' ? (
                    <span className="flex items-center justify-end gap-1 text-amber-600 text-xs font-semibold">
                      <SimSpinner /> Sending
                    </span>
                  ) : (
                    <span className="text-slate-300 text-xs">Pending</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {done && (
            <div className="px-5 py-4 bg-emerald-50 border-t border-emerald-200 flex items-center gap-3">
              <span className="text-2xl">🎉</span>
              <div>
                <p className="text-emerald-800 font-bold text-sm">All {sellers.length} sellers settled!</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <p className="text-emerald-600 text-xs">
                    {totalPending.toLocaleString()} USDC · {batchHash ? '1 batch tx' : `${sellers.length} txs`} · &lt; 4 sec
                  </p>
                  {batchHash && (
                    <a
                      href={`https://explorer.arc.fun/tx/${batchHash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-violet-600 hover:text-violet-800 font-mono font-bold"
                    >
                      View ↗
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Summary panel */}
        <div className="flex flex-col gap-3">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <p className="text-slate-500 text-[11px] font-bold uppercase tracking-wider mb-3">Settlement Summary</p>
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Sellers</span>
                <span className="font-bold text-slate-900">{sellers.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Countries</span>
                <span className="font-bold text-slate-900">4</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Gross USDC</span>
                <span className="font-bold text-slate-900">{totalPending.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Platform fee (2.5%)</span>
                <span className="font-bold text-violet-700">{platformFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Network gas (all)</span>
                <span className="font-bold text-emerald-700">~${gasTotal.toFixed(3)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2 mt-0.5">
                <span className="text-slate-700 font-semibold">Sellers receive</span>
                <span className="font-extrabold text-slate-900">{(totalPending - platformFee).toFixed(2)} USDC</span>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-amber-800 font-bold text-xs mb-2">vs Traditional</p>
            <div className="flex flex-col gap-1.5 text-xs">
              {[
                { label: 'Wire fees', trad: `~$${(sellers.length * 35).toLocaleString()}`, arc: `~$${gasTotal.toFixed(3)}` },
                { label: 'FX margin', trad: '2–5%', arc: '0%' },
                { label: 'Settlement', trad: '3–5 days', arc: '< 1 sec' },
                { label: 'Reconciliation', trad: 'Manual', arc: 'On-chain ✓' },
              ].map(r => (
                <div key={r.label} className="flex items-center gap-2">
                  <span className="text-amber-600 w-24 shrink-0">{r.label}</span>
                  <span className="line-through text-red-400 flex-1">{r.trad}</span>
                  <span className="text-emerald-700 font-bold shrink-0">{r.arc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Global Payroll Tab ────────────────────────────────────────────────────────
function PayrollTab({ address, onTxSent }: {
  address:  `0x${string}` | undefined
  onTxSent: (rec: FinalityRecord) => void
}) {
  const { writeContract: writeContractAsync } = useTurnkeyAwareWrite()
  const publicClient           = usePublicClient()

  const [employees,    setEmployees]   = useState<PayrollEmployee[]>(DEMO_EMPLOYEES.map(e => ({ ...e })))
  const [running,      setRunning]     = useState(false)
  const [paidIds,      setPaidIds]     = useState<string[]>([])
  const [txHashes,     setTxHashes]    = useState<Record<string, string>>({})
  const [currentId,    setCurrentId]   = useState<string | null>(null)
  const [done,         setDone]        = useState(false)
  const [showReceipt,  setShowReceipt] = useState<string | null>(null)
  const [errMsg,       setErrMsg]      = useState('')
  const [month,        setMonth]       = useState('May 2026')
  const [batchMode,    setBatchMode]   = useState(true)   // prefer 1-sig batch
  const [batchCallsId, setBatchCallsId] = useState<string | null>(null)

  // Month editing
  const [editingMonth, setEditingMonth] = useState(false)
  const [editMonthVal, setEditMonthVal] = useState('')

  // Row inline editing
  const [editingId,   setEditingId]  = useState<string | null>(null)
  const [editName,    setEditName]   = useState('')
  const [editUsdc,    setEditUsdc]   = useState('')
  const [editSend,    setEditSend]   = useState('')
  const [editAddr,    setEditAddr]   = useState('')
  const [editRole,    setEditRole]   = useState('')

  const total      = employees.reduce((s, e) => s + e.usdc, 0)
  const totalSend  = employees.reduce((s, e) => s + e.sendAmt, 0)
  const gasEst     = employees.length * 0.001

  const startEdit = (emp: PayrollEmployee) => {
    setEditingId(emp.id)
    setEditName(emp.name)
    setEditUsdc(String(emp.usdc))
    setEditSend(String(emp.sendAmt))
    setEditAddr(emp.address)
    setEditRole(emp.role)
  }

  const commitEdit = (id: string) => {
    const usdc    = parseFloat(editUsdc)
    const sendAmt = parseFloat(editSend)
    if (!editName.trim() || isNaN(usdc) || isNaN(sendAmt) || sendAmt <= 0) return
    setEmployees(prev => prev.map(e =>
      e.id === id
        ? { ...e, name: editName.trim(), role: editRole.trim() || e.role,
            usdc: Math.max(0, usdc), sendAmt: Math.max(0.000001, sendAmt),
            address: editAddr.trim() ? editAddr.trim().toLowerCase() : e.address }
        : e
    ))
    setEditingId(null)
  }

  const handleAddEmployee = () => {
    const id = String(Date.now())
    setEmployees(prev => [...prev, {
      id, name: 'New Contractor', country: '', flag: '👤',
      role: 'Contractor', usdc: 1000, sendAmt: 0.10,
      address: '0x0000000000000000000000000000000000000000',
    }])
    // Open edit immediately
    setEditingId(id)
    setEditName('New Contractor')
    setEditUsdc('1000')
    setEditSend('0.10')
    setEditAddr('0x0000000000000000000000000000000000000000')
    setEditRole('Contractor')
  }

  const handleDeleteEmployee = (id: string) => {
    setEmployees(prev => prev.filter(e => e.id !== id))
    setPaidIds(prev => prev.filter(p => p !== id))
    if (editingId === id) setEditingId(null)
  }

  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const handleRunPayroll = async () => {
    if (!address || running || done) return

    // ── Pre-validate all addresses ────────────────────────────────────────────
    const { isAddress: checkAddr } = await import('viem')
    const invalid = employees.filter(e => !checkAddr(e.address.trim(), { strict: false }))
    if (invalid.length > 0) {
      setErrMsg(`Invalid addresses: ${invalid.map(e => e.name).join(', ')} — click ✏️ to fix`)
      return
    }

    setRunning(true)
    setErrMsg('')
    setConfirmingId(null)

    // ══════════════════════════════════════════════════════════════════════════
    // MULTICALL3 BATCH — 1 approve (first time) + 1 tx pays everyone
    // msg.sender = Multicall3 contract, so we use transferFrom
    // ══════════════════════════════════════════════════════════════════════════
    if (batchMode && publicClient) {
      try {
        const totalNeeded = employees.reduce(
          (s, e) => s + parseUnits(e.sendAmt.toFixed(6), 6), 0n
        )

        // ── Check if Multicall3 is deployed on this chain ─────────────────────
        const code = await publicClient.getBytecode({ address: MULTICALL3_ADDRESS }).catch(() => null)
        const mc3Available = Boolean(code && code.length > 2)

        if (mc3Available) {
          // ── Check current allowance ──────────────────────────────────────────
          const allowance = await publicClient.readContract({
            address: TOKEN_ADDRESSES.USDC,
            abi:     ERC20_MINIMAL,
            functionName: 'allowance',
            args:    [address, MULTICALL3_ADDRESS],
          }).catch(() => 0n) as bigint

          if (allowance < totalNeeded) {
            // Step 1: Approve Multicall3 (only needed once — uses maxUint256)
            setErrMsg('Step 1/2: Approve batch payer in wallet…')
            const approveHash = await writeContractAsync({
              address:      TOKEN_ADDRESSES.USDC,
              abi:          ERC20_MINIMAL,
              functionName: 'approve',
              args:         [MULTICALL3_ADDRESS, maxUint256],
              chainId:      5042002,
            })
            setErrMsg('Step 1/2: Waiting for approval confirmation…')
            try { await publicClient.waitForTransactionReceipt({ hash: approveHash }) } catch {}
          }

          // Step 2: aggregate3 — ALL transferFrom calls in ONE tx (1 signature)
          setErrMsg(`Step 2/2: Sign ONE transaction to pay all ${employees.length} contractors…`)
          const calls = employees.map(emp => ({
            target:       TOKEN_ADDRESSES.USDC,
            allowFailure: false,
            callData:     encodeFunctionData({
              abi:          ERC20_MINIMAL,
              functionName: 'transferFrom',
              args:         [
                address,
                emp.address.trim().toLowerCase() as `0x${string}`,
                parseUnits(emp.sendAmt.toFixed(6), 6),
              ],
            }),
          }))

          const sentAt = Date.now()
          const batchHash = await writeContractAsync({
            address:      MULTICALL3_ADDRESS,
            abi:          MULTICALL3_ABI,
            functionName: 'aggregate3',
            args:         [calls],
            chainId:      5042002,
          })
          setErrMsg('Mining batch transaction…')
          try { await publicClient.waitForTransactionReceipt({ hash: batchHash }) } catch {}

          // Mark ALL as paid
          setBatchCallsId(batchHash)
          setPaidIds(employees.map(e => e.id))
          setTxHashes(Object.fromEntries(employees.map(e => [e.id, batchHash])))
          employees.forEach(emp => {
            onTxSent({
              id: newId(), hash: batchHash, to: emp.address,
              amount: emp.sendAmt, sentAt, confirmedAt: Date.now(),
              finalityMs: Date.now() - sentAt, status: 'confirmed', fee: 0.001,
            })
          })
          setErrMsg('')
          setRunning(false)
          setDone(true)
          return
        }
        // Multicall3 not deployed — fall through to sequential
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)
        if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('rejected the request')) {
          setErrMsg('Payroll cancelled by user.')
          setRunning(false); setConfirmingId(null)
          return
        }
        // Batch failed for another reason — fall through to sequential
        setErrMsg(`Batch unavailable (${msg.slice(0, 60)}) — switching to sequential…`)
        await new Promise(r => setTimeout(r, 1500))
        setBatchMode(false)
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SEQUENTIAL FALLBACK — one signature per contractor
    // ══════════════════════════════════════════════════════════════════════════
    setErrMsg('')
    const skipped: string[] = []

    for (const emp of employees) {
      if (paidIds.includes(emp.id)) continue
      setCurrentId(emp.id)
      setConfirmingId(null)
      const toAddr = emp.address.trim().toLowerCase() as `0x${string}`
      try {
        const hash = await writeContractAsync({
          address:      TOKEN_ADDRESSES.USDC,
          abi:          TRANSFER_ABI,
          functionName: 'transfer',
          args:         [toAddr, parseUnits(emp.sendAmt.toFixed(6), 6)],
          chainId:      5042002,
        })
        setTxHashes(prev => ({ ...prev, [emp.id]: hash }))
        setConfirmingId(emp.id)
        const txSentAt = Date.now()
        try { if (publicClient) await publicClient.waitForTransactionReceipt({ hash }) } catch {}
        setConfirmingId(null)
        setPaidIds(prev => [...prev, emp.id])
        onTxSent({
          id: newId(), hash, to: toAddr, amount: emp.sendAmt,
          sentAt: txSentAt, confirmedAt: Date.now(),
          finalityMs: Date.now() - txSentAt, status: 'confirmed', fee: 0.001,
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)
        if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('rejected the request')) {
          setErrMsg('Payroll cancelled.')
          setRunning(false); setCurrentId(null); setConfirmingId(null)
          return
        }
        skipped.push(`${emp.name}: ${msg.slice(0, 50)}`)
        setErrMsg(`Skipped ${emp.name} — ${msg.slice(0, 70)}`)
      }
    }

    setCurrentId(null); setConfirmingId(null)
    setRunning(false); setDone(true)
    if (skipped.length > 0) setErrMsg(`⚠ ${skipped.length} skipped: ${skipped.join(' | ')}`)
  }

  const handleReset = () => {
    setPaidIds([])
    setTxHashes({})
    setDone(false)
    setShowReceipt(null)
    setErrMsg('')
    setBatchCallsId(null)
    setBatchMode(true)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Banner */}
      <div className="bg-gradient-to-r from-violet-100 to-purple-50 border border-violet-200 rounded-2xl p-4 flex items-start gap-3">
        <span className="text-2xl shrink-0">💼</span>
        <div className="flex-1">
          <p className="text-slate-900 font-bold text-sm">Global Payroll — Stablecoin Settlement + Receipts</p>
          <p className="text-violet-600 text-xs mt-0.5">
            Real USDC transfers on Arc Testnet. Each contractor gets a signed on-chain payment.
          </p>
        </div>
        <span className="text-[10px] bg-violet-100 border border-violet-200 text-violet-700 font-bold px-2 py-0.5 rounded-full shrink-0">ON-CHAIN ⛓</span>
      </div>

      {/* Wallet prompt */}
      {!address && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <span className="text-xl">👛</span>
          <div className="flex-1">
            <p className="font-bold text-amber-800 text-sm">Connect wallet to run payroll</p>
            <p className="text-amber-600 text-xs mt-0.5">Each contractor receives a real USDC transfer. Testnet amounts: {totalSend.toFixed(2)} USDC total.</p>
          </div>
          <WalletGate variant="button-only" />
        </div>
      )}

      {/* Error msg */}
      {errMsg && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs text-red-700 flex items-center gap-2">
          <span>⚠</span><span>{errMsg}</span>
          <button onClick={() => setErrMsg('')} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Receipt modal */}
      {showReceipt && (() => {
        const emp  = employees.find(e => e.id === showReceipt)
        const hash = txHashes[showReceipt]
        if (!emp) return null
        const sendAmt = emp.sendAmt
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowReceipt(null)}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
              <div className="text-center border-b border-slate-100 pb-4 mb-4">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Payment Receipt</p>
                <p className="text-slate-500 text-xs mt-0.5">{month}</p>
              </div>
              <div className="flex flex-col gap-2 text-sm">
                {[
                  { l: 'Recipient',     v: emp.name },
                  { l: 'Country',       v: `${emp.flag} ${emp.country}` },
                  { l: 'Role',          v: emp.role },
                  { l: 'Salary (ref)',  v: `${emp.usdc.toLocaleString()} USDC` },
                  { l: 'Sent (testnet)',v: `${sendAmt.toFixed(2)} USDC` },
                  { l: 'Network fee',   v: '~$0.001 USDC' },
                  { l: 'Status',        v: '✅ On-chain confirmed' },
                  { l: 'Finality',      v: '⚡ < 1 second' },
                  { l: 'Wallet',        v: emp.address.slice(0, 18) + '…' },
                ].map(r => (
                  <div key={r.l} className="flex justify-between gap-2">
                    <span className="text-slate-400 shrink-0">{r.l}</span>
                    <span className="font-semibold text-slate-900 text-right">{r.v}</span>
                  </div>
                ))}
                {hash && (
                  <div className="flex justify-between items-center pt-2 border-t border-slate-100 mt-1">
                    <span className="text-slate-400 shrink-0">Tx hash</span>
                    <a href={`https://testnet.arcscan.app/tx/${hash}`} target="_blank" rel="noreferrer"
                      className="text-violet-600 underline font-mono text-[10px]">
                      {hash.slice(0, 14)}…{hash.slice(-6)} ↗
                    </a>
                  </div>
                )}
              </div>
              <button onClick={() => setShowReceipt(null)}
                className="mt-4 w-full py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 transition-colors">
                Close
              </button>
            </div>
          </div>
        )
      })()}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Payroll month — click to edit */}
        <button
          disabled={running || done}
          onClick={() => { if (!running && !done) { setEditingMonth(true); setEditMonthVal(month) } }}
          className="bg-white border border-slate-200 rounded-2xl p-3 text-center shadow-sm hover:border-violet-400 hover:shadow-md transition-all group disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:shadow-sm">
          {editingMonth ? (
            <input
              autoFocus
              className="w-full text-center font-extrabold text-base text-slate-900 border-b-2 border-violet-400 outline-none bg-transparent"
              value={editMonthVal}
              onChange={e => setEditMonthVal(e.target.value)}
              onBlur={() => { setMonth(editMonthVal.trim() || month); setEditingMonth(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { setMonth(editMonthVal.trim() || month); setEditingMonth(false) } if (e.key === 'Escape') setEditingMonth(false) }}
            />
          ) : (
            <p className="font-extrabold text-base text-slate-900 group-hover:text-violet-700 transition-colors">Payroll Run</p>
          )}
          <p className="text-slate-400 text-[11px] flex items-center justify-center gap-1">
            {month}
            {!running && !done && <span className="text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity text-[9px]">✏️</span>}
          </p>
        </button>

        {/* Total (auto from salaries) */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3 text-center shadow-sm">
          <p className="font-extrabold text-base text-violet-700">${total.toLocaleString()} USDC</p>
          <p className="text-slate-400 text-[11px]">Total (ref) · edit per row ✏️</p>
        </div>

        {/* Contractors count */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3 text-center shadow-sm">
          <p className="font-extrabold text-base text-blue-700">{employees.length} people</p>
          <p className="text-slate-400 text-[11px]">
            Contractors ·{' '}
            {!running && !done && (
              <button onClick={handleAddEmployee} className="text-violet-500 hover:text-violet-700 font-bold">+ Add</button>
            )}
          </p>
        </div>

        {/* Gas */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3 text-center shadow-sm">
          <p className="font-extrabold text-base text-emerald-700">~${gasEst.toFixed(3)} USDC</p>
          <p className="text-slate-400 text-[11px]">Gas (all) · {totalSend.toFixed(4)} sent</p>
        </div>
      </div>

      {/* Employee list */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Contractor Payroll — {month}</h3>
            <p className="text-slate-400 text-xs">{employees.length} contractors · {employees.length} countries · {paidIds.length}/{employees.length} sent</p>
          </div>
          <div className="flex gap-2">
            {!running && !done && (
              <button onClick={handleAddEmployee}
                className="px-3 py-1.5 rounded-xl bg-violet-50 text-violet-600 border border-violet-200 text-xs font-bold hover:bg-violet-100 transition-colors">
                ➕ Add
              </button>
            )}
            {done && (
              <button onClick={handleReset}
                className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-colors">
                ↩ Reset
              </button>
            )}
            <div className="flex flex-col items-end gap-1">
              {!running && !done && (
                <button onClick={() => setBatchMode(b => !b)}
                  className="text-[10px] text-slate-400 hover:text-violet-600 transition-colors">
                  {batchMode ? '⚡ 1 signature (batch)' : '🔄 Sequential (1 per person)'}
                </button>
              )}
              <button onClick={handleRunPayroll} disabled={!address || running || done || employees.length === 0}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  address && !running && !done
                    ? 'bg-violet-600 text-white hover:bg-violet-500 shadow-sm'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}>
                {running
                  ? <span className="flex items-center gap-1.5"><SimSpinner />{confirmingId ? 'Mining…' : batchMode ? '⚡ Batch signing…' : 'Signing…'}</span>
                  : done ? '✅ Paid' : batchMode ? '⚡ Run Payroll (1 sig)' : '▶ Run Payroll'}
              </button>
            </div>
          </div>
        </div>

        <div className="divide-y divide-slate-50">
          {employees.map(emp => {
            const isPaid       = paidIds.includes(emp.id)
            const isPaying     = currentId === emp.id && confirmingId !== emp.id
            const isConfirming = confirmingId === emp.id
            const isEditing    = editingId === emp.id
            const canEdit      = !running && !done && !isPaid
            return (
              <div key={emp.id} className={`px-5 py-3 transition-all ${
                isPaid ? 'bg-emerald-50/60' : isPaying ? 'bg-violet-50' : ''
              }`}>
                {isEditing ? (
                  /* ── Inline edit row ───────────────────── */
                  <div className="flex flex-col gap-2.5 py-1">
                    {/* Row 1: name + role */}
                    <div className="flex items-center gap-2">
                      <span className="text-xl shrink-0">{emp.flag}</span>
                      <input
                        className="flex-1 border border-violet-300 rounded-lg px-2.5 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-violet-400"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        placeholder="Contractor name"
                        onKeyDown={e => { if (e.key === 'Escape') setEditingId(null) }}
                        autoFocus
                      />
                      <input
                        className="w-36 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300"
                        value={editRole}
                        onChange={e => setEditRole(e.target.value)}
                        placeholder="Role / title"
                      />
                    </div>
                    {/* Row 2: amounts */}
                    <div className="flex items-center gap-2 pl-8">
                      <div className="flex-1 flex items-center gap-1.5">
                        <label className="text-xs text-slate-500 shrink-0 w-24">Display salary</label>
                        <input
                          type="number" min="0" step="1"
                          className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                          value={editUsdc}
                          onChange={e => setEditUsdc(e.target.value)}
                        />
                        <span className="text-xs text-slate-400">USDC</span>
                      </div>
                      <div className="flex-1 flex items-center gap-1.5">
                        <label className="text-xs text-slate-500 shrink-0 w-20">Send (testnet)</label>
                        <input
                          type="number" min="0.000001" step="0.01"
                          className="flex-1 border border-violet-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                          value={editSend}
                          onChange={e => setEditSend(e.target.value)}
                        />
                        <span className="text-xs text-slate-400">USDC</span>
                      </div>
                    </div>
                    {/* Row 3: wallet address */}
                    <div className="flex items-center gap-2 pl-8">
                      <label className="text-xs text-slate-500 shrink-0 w-24">Wallet address</label>
                      <input
                        className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-300"
                        value={editAddr}
                        onChange={e => setEditAddr(e.target.value)}
                        placeholder="0x..."
                        spellCheck={false}
                      />
                    </div>
                    {/* Row 4: actions */}
                    <div className="flex gap-2 justify-between pl-8">
                      <button onClick={() => handleDeleteEmployee(emp.id)}
                        className="px-3 py-1.5 rounded-lg text-xs text-red-500 border border-red-200 hover:bg-red-50 transition-colors">
                        🗑 Remove
                      </button>
                      <div className="flex gap-2">
                        <button onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 rounded-lg text-xs text-slate-500 border border-slate-200 hover:bg-slate-50">
                          Cancel
                        </button>
                        <button onClick={() => commitEdit(emp.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-600 text-white hover:bg-violet-500">
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Display row ───────────────────────── */
                  <div className="flex items-center gap-3">
                    <span className="text-2xl shrink-0">{emp.flag}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-slate-900 text-sm">{emp.name}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{emp.role}</span>
                      </div>
                      <p className="text-slate-400 text-xs">{emp.country} · {emp.address.slice(0, 14)}…</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-slate-900 text-sm">{emp.usdc.toLocaleString()} USDC</p>
                      <p className="text-slate-400 text-[10px]">sends {emp.sendAmt.toFixed(4)} testnet</p>
                    </div>
                    <div className="w-28 text-right shrink-0 flex items-center justify-end gap-1">
                      {canEdit && (
                        <>
                          <button onClick={() => handleDeleteEmployee(emp.id)}
                            title="Remove contractor"
                            className="text-slate-300 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-50 text-xs">
                            🗑
                          </button>
                          <button onClick={() => startEdit(emp)}
                            title="Edit contractor"
                            className="text-slate-300 hover:text-violet-500 transition-colors p-1 rounded-lg hover:bg-violet-50">
                            ✏️
                          </button>
                        </>
                      )}
                      {isPaid ? (
                        <button onClick={() => setShowReceipt(emp.id)}
                          className="text-[11px] text-violet-600 hover:underline font-semibold">
                          ✓ Receipt ↗
                        </button>
                      ) : isConfirming ? (
                        <span className="flex items-center justify-end gap-1 text-emerald-600 text-xs">
                          <SimSpinner /> Mining…
                        </span>
                      ) : isPaying ? (
                        <span className="flex items-center justify-end gap-1 text-violet-600 text-xs">
                          <SimSpinner /> Sign…
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">Queued</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {done && (
          <div className="px-5 py-4 bg-emerald-50 border-t border-emerald-200">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎉</span>
              <div className="flex-1">
                <p className="text-emerald-800 font-bold text-sm">
                  Payroll complete — {paidIds.length}/{employees.length} contractors paid on-chain!
                  {batchCallsId && <span className="ml-2 text-[10px] bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded-full font-bold">⚡ 1 signature</span>}
                </p>
                <p className="text-emerald-600 text-xs">
                  {totalSend.toFixed(4)} USDC sent · Gas: ~${gasEst.toFixed(3)} USDC
                  {batchCallsId
                    ? ` · Batch ID: ${String(batchCallsId).slice(0, 16)}…`
                    : ' · Click "Receipt ↗" for tx hash'}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              {[
                { l: 'Traditional payroll', v: '$150+ fees + 3–5 days', red: true },
                { l: 'Arc USDC payroll',    v: `~$${gasEst.toFixed(3)} + < 5 sec`, red: false },
                { l: 'Savings',             v: `$${(150 - gasEst).toFixed(0)}+ per run`, red: false },
              ].map(c => (
                <div key={c.l} className={`rounded-xl p-2.5 text-center border ${c.red ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
                  <p className={`font-bold ${c.red ? 'text-red-700' : 'text-emerald-700'}`}>{c.v}</p>
                  <p className="text-slate-500 mt-0.5">{c.l}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── AED → USDC Merchant Tab ───────────────────────────────────────────────────
// Demo merchant wallet — receives USDC from the connected wallet (acting as customer)
const MERCHANT_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' as `0x${string}`
const MERCHANT_NAME    = 'Al-Baraka Spices LLC'

function MerchantTab({ address, onTxSent }: {
  address:     `0x${string}` | undefined
  balanceUsdc: number   // kept for API compat
  onTxSent:    (rec: FinalityRecord) => void
}) {
  // Exact same pattern as RemittanceTab (proven to work)
  const { writeContract: writeContractAsync } = useTurnkeyAwareWrite()
  const publicClient = usePublicClient()

  // Fetch USDC balance same way as PaymentsPanel parent
  const { data: usdcBal } = useBalance({ address, token: TOKEN_ADDRESSES.USDC })
  const myUsdc = usdcBal ? parseFloat(usdcBal.formatted) : 0

  const [aedAmount,  setAedAmount]  = useState('5')
  const [step,       setStep]       = useState<'idle' | 'invoice' | 'sending' | 'confirmed' | 'error'>('idle')
  const [refId,      setRefId]      = useState('')
  const [txHash,     setTxHash]     = useState<`0x${string}` | ''>('')
  const [finalityMs, setFinalityMs] = useState<number | null>(null)
  const [errMsg,     setErrMsg]     = useState('')

  const usdcAmount = (parseFloat(aedAmount) || 0) * AED_TO_USDC
  const posFee     = usdcAmount * 0.029
  const arcFee     = 0.001

  // Only gate on wallet connected — let tx fail naturally if low balance
  const canGenerate = !!address && usdcAmount > 0
  const hasBalance  = myUsdc >= usdcAmount

  const handleGenerateInvoice = () => {
    setRefId('ARC-' + Math.random().toString(36).slice(2, 8).toUpperCase())
    setStep('invoice')
  }

  // Wallet popup + on-chain USDC transfer
  const handlePay = async () => {
    if (!address) return          // only real prerequisite
    setStep('sending')
    const sentAt = Date.now()
    try {
      const hash = await writeContractAsync({
        address:      TOKEN_ADDRESSES.USDC,
        abi:          TRANSFER_ABI,
        functionName: 'transfer',
        args:         [MERCHANT_ADDRESS, parseUnits(usdcAmount.toFixed(6), 6)],
        chainId:      5042002,    // force Arc Testnet
      })
      setTxHash(hash)
      const ms = Date.now() - sentAt

      // Wait for receipt if publicClient available; assume success if not
      const receipt = publicClient
        ? await publicClient.waitForTransactionReceipt({ hash })
        : null

      setFinalityMs(Date.now() - sentAt)

      if (!receipt || receipt.status === 'success') {
        setStep('confirmed')
        onTxSent({
          id: newId(), hash, to: MERCHANT_ADDRESS, amount: usdcAmount,
          sentAt, confirmedAt: Date.now(), finalityMs: ms,
          status: 'confirmed', fee: arcFee,
        })
      } else {
        setErrMsg('Transaction reverted on-chain.')
        setStep('error')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrMsg(
        msg.includes('User rejected') || msg.includes('user rejected')
          ? 'Transaction cancelled.'
          : 'Transaction failed: ' + msg.slice(0, 100)
      )
      setStep('error')
    }
  }

  const handleReset = () => {
    setStep('idle'); setRefId(''); setTxHash(''); setFinalityMs(null); setErrMsg('')
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Banner */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-4 flex items-start gap-3">
        <span className="text-2xl shrink-0">🏦</span>
        <div>
          <p className="text-slate-900 font-bold text-sm">"Pay-in AED, Settle in USDC" — Merchant Prototype</p>
          <p className="text-emerald-600 text-xs mt-0.5 leading-relaxed">
            Customer pays in AED → real USDC transfer on Arc Testnet to merchant wallet.
            No correspondent banks, no 2-3 day settlement float.
          </p>
        </div>
      </div>

      {/* Wallet connect prompt */}
      {!address && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <span className="text-xl">👛</span>
          <div className="flex-1">
            <p className="font-bold text-amber-800 text-sm">Connect wallet to pay on-chain</p>
            <p className="text-amber-600 text-xs mt-0.5">Your wallet acts as the customer sending USDC to the merchant.</p>
          </div>
          <WalletGate variant="button-only" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Payment terminal */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏪</span>
            <div className="flex-1">
              <h3 className="font-bold text-slate-900 text-sm">{MERCHANT_NAME}</h3>
              <p className="text-slate-400 text-xs">Payment Terminal · Dubai, UAE</p>
            </div>
            <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">ON-CHAIN ⛓</span>
          </div>

          {/* ── STEP: idle ── */}
          {step === 'idle' && (
            <>
              <div>
                <label className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">Customer Pays (AED)</label>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus-within:border-emerald-400 transition-colors">
                  <span className="text-slate-500 font-bold text-sm shrink-0">🇦🇪 AED</span>
                  <input type="number" value={aedAmount} onChange={e => setAedAmount(e.target.value)}
                    className="flex-1 bg-transparent text-slate-900 font-extrabold text-2xl outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  {['5', '10', '25', '50', '100'].map(v => (
                    <button key={v} onClick={() => setAedAmount(v)}
                      className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-500 text-xs hover:bg-slate-200 transition-colors">
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 text-center">
                    <p className="text-emerald-600 text-[10px] font-bold uppercase tracking-wider">Customer pays</p>
                    <p className="text-emerald-900 font-extrabold text-xl">{(parseFloat(aedAmount)||0).toLocaleString()} AED</p>
                  </div>
                  <div className="text-emerald-500 text-xl">→</div>
                  <div className="flex-1 text-center">
                    <p className="text-emerald-600 text-[10px] font-bold uppercase tracking-wider">Merchant receives</p>
                    <p className="text-emerald-900 font-extrabold text-xl">{usdcAmount.toFixed(2)} USDC</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="bg-white/70 rounded-lg py-1.5 px-2">
                    <p className="font-bold text-slate-700">1 AED</p>
                    <p className="text-slate-400">= {AED_TO_USDC.toFixed(4)} USDC</p>
                  </div>
                  <div className="bg-white/70 rounded-lg py-1.5 px-2">
                    <p className="font-bold text-emerald-700">~${arcFee.toFixed(3)}</p>
                    <p className="text-slate-400">Arc gas fee</p>
                  </div>
                  <div className="bg-white/70 rounded-lg py-1.5 px-2">
                    <p className="font-bold text-blue-700">&lt; 1 sec</p>
                    <p className="text-slate-400">settlement</p>
                  </div>
                </div>
              </div>

              {/* Balance row */}
              {address && (
                <div className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg border ${
                  hasBalance
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}>
                  <span>Your USDC balance (Arc Testnet)</span>
                  <span className="font-bold">{myUsdc.toFixed(2)} USDC {hasBalance ? '✓' : '— get from faucet'}</span>
                </div>
              )}

              <button onClick={handleGenerateInvoice} disabled={!canGenerate}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-sm hover:from-emerald-500 hover:to-teal-500 shadow-lg shadow-emerald-900/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                🏦 Generate Payment Invoice
              </button>
            </>
          )}

          {/* ── STEP: invoice (QR shown, waiting for customer to tap "Pay") ── */}
          {step === 'invoice' && (
            <div className="flex flex-col items-center gap-4 py-4">
              {/* Visual QR */}
              <div className="border-4 border-slate-900 rounded-2xl p-4 bg-white">
                <div className="grid grid-cols-7 gap-0.5">
                  {Array.from({ length: 49 }, (_, i) => (
                    <div key={i} className={`w-5 h-5 rounded-sm ${
                      [0,1,2,3,4,5,6,7,13,14,20,21,27,28,34,35,41,42,43,44,45,46,47,48,
                       8,15,22,29,36,10,17,24,31,38,12,19,26,33,40].includes(i)
                        ? 'bg-slate-900' : 'bg-white'
                    }`} />
                  ))}
                </div>
              </div>
              <div className="text-center">
                <p className="text-slate-700 font-bold text-sm">Invoice: {(parseFloat(aedAmount)||0).toLocaleString()} AED</p>
                <p className="text-slate-400 text-xs mt-0.5">= {usdcAmount.toFixed(2)} USDC · Ref: {refId}</p>
                <p className="text-slate-400 text-[10px] mt-1 font-mono break-all">Merchant: {MERCHANT_ADDRESS.slice(0,10)}…{MERCHANT_ADDRESS.slice(-6)}</p>
              </div>
              <div className="flex gap-2 w-full">
                <button onClick={handleReset}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button onClick={handlePay} disabled={!address}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-bold hover:from-emerald-500 hover:to-teal-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md">
                  ⚡ Pay {usdcAmount.toFixed(2)} USDC on Arc
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: sending ── */}
          {step === 'sending' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <SimSpinner />
              <div className="text-center">
                <p className="font-bold text-slate-700 text-sm">Sending {usdcAmount.toFixed(2)} USDC on Arc…</p>
                {txHash && (
                  <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer"
                    className="text-violet-600 text-xs underline mt-1 inline-block break-all">
                    {txHash.slice(0, 20)}… ↗
                  </a>
                )}
                <p className="text-slate-400 text-xs mt-1">Waiting for on-chain confirmation…</p>
              </div>
            </div>
          )}

          {/* ── STEP: confirmed ── */}
          {step === 'confirmed' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-3xl">✅</div>
              <div className="text-center">
                <p className="text-emerald-800 font-extrabold text-xl">Payment Received!</p>
                <p className="text-emerald-600 text-sm mt-1">{usdcAmount.toFixed(2)} USDC → {MERCHANT_NAME}</p>
                <p className="text-slate-400 text-xs mt-0.5">
                  ⚡ Settled in {finalityMs != null ? `${(finalityMs / 1000).toFixed(1)}s` : '< 1s'} · Ref: {refId}
                </p>
              </div>
              <div className="w-full bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs flex flex-col gap-1">
                {[
                  { l: 'Customer paid',     v: `${(parseFloat(aedAmount)||0).toLocaleString()} AED` },
                  { l: 'Merchant received', v: `${usdcAmount.toFixed(2)} USDC` },
                  { l: 'Arc gas fee',       v: `~$${arcFee.toFixed(4)} USDC` },
                  { l: 'Settlement time',   v: finalityMs != null ? `⚡ ${(finalityMs/1000).toFixed(1)}s` : '⚡ < 1 second' },
                  { l: 'Reference',         v: refId },
                ].map(r => (
                  <div key={r.l} className="flex justify-between">
                    <span className="text-emerald-600">{r.l}</span>
                    <span className="font-semibold text-emerald-900">{r.v}</span>
                  </div>
                ))}
                {txHash && (
                  <div className="flex justify-between items-center pt-1 border-t border-emerald-200 mt-1">
                    <span className="text-emerald-600">Tx hash</span>
                    <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer"
                      className="text-violet-600 underline font-mono text-[10px]">
                      {txHash.slice(0,14)}…{txHash.slice(-6)} ↗
                    </a>
                  </div>
                )}
              </div>
              <button onClick={handleReset}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition-colors">
                New Transaction
              </button>
            </div>
          )}

          {/* ── STEP: error ── */}
          {step === 'error' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center text-2xl">❌</div>
              <div className="text-center">
                <p className="font-bold text-red-700 text-sm">Payment Failed</p>
                <p className="text-red-500 text-xs mt-1">{errMsg}</p>
              </div>
              <button onClick={handleReset}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Right: comparison */}
        <div className="flex flex-col gap-3">
          {/* Fee comparison */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-slate-900 text-sm mb-3">vs Traditional POS Terminal</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-red-700 text-[10px] font-bold uppercase tracking-wider mb-2">💳 POS Terminal</p>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-red-600">Processing</span>
                    <span className="font-bold text-red-800">2.9% + $0.30</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-red-600">This tx</span>
                    <span className="font-bold text-red-800">${(posFee + 0.30).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-red-600">Settlement</span>
                    <span className="font-bold text-red-700">2–3 days</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-red-600">Currency</span>
                    <span className="font-bold text-red-700">AED → Bank</span>
                  </div>
                </div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <p className="text-emerald-700 text-[10px] font-bold uppercase tracking-wider mb-2">⚡ Arc USDC</p>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-emerald-600">Processing</span>
                    <span className="font-bold text-emerald-800">~$0.001</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-emerald-600">This tx</span>
                    <span className="font-bold text-emerald-800">${arcFee.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-emerald-600">Settlement</span>
                    <span className="font-bold text-emerald-700">⚡ &lt; 1 sec</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-emerald-600">Currency</span>
                    <span className="font-bold text-emerald-700">AED → USDC</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center gap-2">
              <span>💡</span>
              <span className="text-slate-600">
                Save <strong className="text-emerald-700">${(posFee + 0.30 - arcFee).toFixed(2)}</strong> on this transaction alone
                <span className="text-slate-400 ml-1">({(((posFee + 0.30 - arcFee) / usdcAmount) * 100).toFixed(1)}% of amount)</span>
              </span>
            </div>
          </div>

          {/* Rails diagram */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-slate-900 text-sm mb-3">Payment Rails</h3>
            <div className="flex flex-col gap-2 text-xs">
              {[
                { emoji: '👤', label: 'Customer',   sub: 'Pays AED via phone/card',   color: 'bg-blue-50 border-blue-100' },
                { emoji: '🔄', label: 'FX Convert', sub: '1 AED = 0.2720 USDC · Circle rates', color: 'bg-violet-50 border-violet-100' },
                { emoji: '🔮', label: 'Arc Network', sub: 'USDC transfer · < 1s finality', color: 'bg-emerald-50 border-emerald-200' },
                { emoji: '🏪', label: 'Merchant',   sub: 'Receives USDC instantly',   color: 'bg-teal-50 border-teal-100' },
              ].map((r, i) => (
                <div key={r.label}>
                  <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${r.color}`}>
                    <span className="text-lg shrink-0">{r.emoji}</span>
                    <div>
                      <p className="font-bold text-slate-900">{r.label}</p>
                      <p className="text-slate-500 text-[10px]">{r.sub}</p>
                    </div>
                  </div>
                  {i < 3 && <div className="w-0.5 h-2 bg-slate-200 mx-auto" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Use Cases Section ─────────────────────────────────────────────────────────
function UseCasesSection({ address, balanceUsdc, onTxSent }: {
  address:     `0x${string}` | undefined
  balanceUsdc: number
  onTxSent:    (rec: FinalityRecord) => void
}) {
  const [uc, setUc] = useState<UseCase>('remittance')

  const USE_CASE_TABS: { key: UseCase; label: string; icon: string; sub: string }[] = [
    { key: 'remittance',  label: 'Remittance',   icon: '🌍', sub: '$857B market' },
    { key: 'marketplace', label: 'Marketplace',  icon: '🏪', sub: 'Global sellers' },
    { key: 'payroll',     label: 'Payroll',       icon: '💼', sub: 'Contractor pay' },
    { key: 'merchant',    label: 'Merchant',      icon: '🏦', sub: 'AED → USDC' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-tab bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {USE_CASE_TABS.map(t => (
          <button key={t.key} onClick={() => setUc(t.key)}
            className={`flex flex-col items-center gap-0.5 py-3 px-2 rounded-2xl border transition-all text-center ${
              uc === t.key
                ? 'bg-violet-600 border-violet-600 text-white shadow-lg'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400 hover:bg-slate-50'
            }`}>
            <span className="text-xl">{t.icon}</span>
            <p className="text-xs font-bold">{t.label}</p>
            <p className={`text-[10px] ${uc === t.key ? 'text-slate-400' : 'text-slate-400'}`}>{t.sub}</p>
          </button>
        ))}
      </div>

      {uc === 'remittance'  && <RemittanceTab  balanceUsdc={balanceUsdc} address={address} onTxSent={onTxSent} />}
      {uc === 'marketplace' && <MarketplaceTab address={address} onTxSent={onTxSent} />}
      {uc === 'payroll'     && <PayrollTab address={address} onTxSent={onTxSent} />}
      {uc === 'merchant'    && <MerchantTab address={address} balanceUsdc={balanceUsdc} onTxSent={onTxSent} />}
    </div>
  )
}

// ── Unified Balance Section ───────────────────────────────────────────────────

type UBChain = 'Base_Sepolia' | 'Arbitrum_Sepolia' | 'Ethereum_Sepolia'

const UB_SOURCE_CHAINS: { id: UBChain; label: string; flag: string }[] = [
  { id: 'Base_Sepolia',     label: 'Base Sepolia',     flag: '🔵' },
  { id: 'Arbitrum_Sepolia', label: 'Arbitrum Sepolia', flag: '🔷' },
  { id: 'Ethereum_Sepolia', label: 'Ethereum Sepolia', flag: '⟠'  },
]

interface UBBalance { chain: string; flag: string; available: string; pending: string }

function UnifiedBalanceSection({ address, onTxSent }: {
  address:  `0x${string}` | undefined
  onTxSent: (rec: FinalityRecord) => void
}) {
  const [balances,     setBalances]    = useState<UBBalance[]>([])
  const [loadingBal,   setLoadingBal]  = useState(false)

  const [srcChain,     setSrcChain]    = useState<UBChain>('Base_Sepolia')
  const [depositAmt,   setDepositAmt]  = useState('1.00')
  const [depositing,   setDepositing]  = useState(false)
  const [depositMsg,   setDepositMsg]  = useState('')
  const [depositOk,    setDepositOk]   = useState(false)

  const [spendAmt,     setSpendAmt]    = useState('1.00')
  const [spendTo,      setSpendTo]     = useState(address ?? '')
  const [spending,     setSpending]    = useState(false)
  const [spendMsg,     setSpendMsg]    = useState('')
  const [spendOk,      setSpendOk]     = useState(false)

  const [estimating,   setEstimating]  = useState(false)
  const [estimateRes,  setEstimateRes] = useState<string | null>(null)
  const [errMsg,       setErrMsg]      = useState('')

  // Keep spendTo in sync when address changes
  useEffect(() => { if (address && !spendTo) setSpendTo(address) }, [address])

  const getProvider = () => {
    const p = (window as unknown as { ethereum?: unknown }).ethereum
    if (!p) throw new Error('MetaMask (or any EIP-1193 wallet) not found.')
    return p
  }

  const getAdapter = async () => {
    const provider = getProvider()
    return createViemAdapterFromProvider({ provider } as Parameters<typeof createViemAdapterFromProvider>[0])
  }

  const handleLoadBalances = async () => {
    setLoadingBal(true); setErrMsg('')
    try {
      const adapter = await getAdapter()
      const res = await _appKit.unifiedBalance.getBalances({
        sources: [{ adapter }],
        networkType: 'testnet',
        includePending: true,
      }) as unknown as {
        totalConfirmedBalance: string
        totalPendingBalance?: string
        breakdown: Array<{ chain: string; confirmedBalance: string; pendingBalance?: string }>
      }
      const mapped: UBBalance[] = (res.breakdown ?? []).map(b => {
          const flag = b.chain === 'Arc_Testnet' ? '🟣'
            : b.chain.startsWith('Base') ? '🔵'
            : b.chain.startsWith('Arbitrum') ? '🔷'
            : b.chain.startsWith('Ethereum') ? '⟠'
            : '🌐'
          return { chain: b.chain.replace(/_/g, ' '), flag, available: b.confirmedBalance, pending: b.pendingBalance ?? '0' }
        })
      setBalances(mapped)
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message.slice(0, 120) : String(e))
    } finally {
      setLoadingBal(false)
    }
  }

  const handleDeposit = async () => {
    if (!address || depositing) return
    setDepositing(true); setDepositMsg(''); setDepositOk(false); setErrMsg('')
    try {
      setDepositMsg(`Depositing ${depositAmt} USDC from ${srcChain.replace(/_/g, ' ')}…`)
      const adapter = await getAdapter()
      await _appKit.unifiedBalance.deposit({
        from: { adapter, chain: srcChain },
        amount: depositAmt,
        token: 'USDC',
      })
      setDepositMsg(`✅ ${depositAmt} USDC deposited from ${srcChain.replace(/_/g, ' ')} into Unified Balance!`)
      setDepositOk(true)
      onTxSent({
        id: newId(), hash: '0xdeposit', to: 'Unified Balance',
        amount: parseFloat(depositAmt), sentAt: Date.now(), confirmedAt: Date.now(),
        finalityMs: 0, status: 'confirmed', fee: 0,
      })
      await handleLoadBalances()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)
      setDepositMsg('')
      setErrMsg(`Deposit failed: ${msg.slice(0, 100)}`)
    } finally {
      setDepositing(false)
    }
  }

  const handleSpend = async () => {
    if (!address || spending) return
    setSpending(true); setSpendMsg(''); setSpendOk(false); setErrMsg('')
    try {
      setSpendMsg(`Spending ${spendAmt} USDC → Arc Testnet…`)
      const adapter = await getAdapter()
      const sentAt = Date.now()
      const result = await _appKit.unifiedBalance.spend({
        amount: spendAmt,
        token: 'USDC',
        from: [{ adapter }],
        to: {
          adapter,
          chain: 'Arc_Testnet',
          recipientAddress: spendTo || address,
        },
      }) as { txHash?: string } | undefined
      const hash = result?.txHash ?? '0xspend'
      setSpendMsg(`✅ ${spendAmt} USDC sent to Arc Testnet!`)
      setSpendOk(true)
      onTxSent({
        id: newId(), hash, to: spendTo || address,
        amount: parseFloat(spendAmt), sentAt, confirmedAt: Date.now(),
        finalityMs: Date.now() - sentAt, status: 'confirmed', fee: 0,
      })
      await handleLoadBalances()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)
      setSpendMsg('')
      setErrMsg(`Spend failed: ${msg.slice(0, 100)}`)
    } finally {
      setSpending(false)
    }
  }

  const handleEstimate = async () => {
    if (!address || estimating) return
    setEstimating(true); setEstimateRes(null); setErrMsg('')
    try {
      const adapter = await getAdapter()
      const res = await _appKit.unifiedBalance.estimateSpend({
        amount: spendAmt,
        token: 'USDC',
        from: [{ adapter }],
        to: { adapter, chain: 'Arc_Testnet', recipientAddress: spendTo || address },
      }) as { gatewayFee?: string; gasFee?: string; totalFee?: string } | undefined
      if (res) {
        const lines = [
          res.gatewayFee  ? `Gateway fee: ${res.gatewayFee} USDC`  : null,
          res.gasFee      ? `Gas fee: ${res.gasFee}`               : null,
          res.totalFee    ? `Total fee: ${res.totalFee} USDC`      : null,
        ].filter(Boolean).join(' · ')
        setEstimateRes(lines || 'Fee: ~0 USDC (within testnet limits)')
      } else {
        setEstimateRes('Fee: ~0 USDC')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.slice(0, 80) : String(e)
      setErrMsg(`Estimate failed: ${msg}`)
    } finally {
      setEstimating(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Banner */}
      <div className="bg-gradient-to-r from-violet-100 via-purple-50 to-indigo-50 border border-violet-200 rounded-2xl p-4 flex items-start gap-3">
        <span className="text-2xl shrink-0">⚡</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-slate-900 font-bold text-sm">Unified Balance Kit</p>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 font-bold uppercase tracking-wider">Arc × Circle</span>
          </div>
          <p className="text-violet-600 text-xs mt-1 leading-relaxed">
            One interface to deposit USDC from any chain (Base, Arbitrum, Ethereum…) into a chain-agnostic Unified Balance, then spend instantly on Arc Testnet. Powered by Circle Gateway.
          </p>
        </div>
      </div>

      {!address && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-amber-800 text-sm font-medium">
          🔗 Connect your wallet to use Unified Balance
        </div>
      )}

      {errMsg && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-red-700 text-xs font-medium">
          ⚠ {errMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── LEFT: Balances ── */}
        <div className="flex flex-col gap-3">
          {/* Balance card */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Unified Balance</h3>
                <p className="text-slate-400 text-xs mt-0.5">USDC across all chains</p>
              </div>
              <button onClick={handleLoadBalances} disabled={loadingBal || !address}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  !loadingBal && address ? 'bg-violet-600 text-white hover:bg-violet-500' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}>
                {loadingBal ? <span className="flex items-center gap-1"><SimSpinner />Loading…</span> : '↻ Refresh'}
              </button>
            </div>

            {balances.length === 0 ? (
              <div className="px-5 py-8 text-center text-slate-400 text-sm">
                <p className="text-2xl mb-2">💰</p>
                <p>Click Refresh to load your balance across chains</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {balances.map(b => (
                  <div key={b.chain} className="flex items-center gap-3 px-5 py-3">
                    <span className="text-xl shrink-0">{b.flag}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm">{b.chain}</p>
                      {parseFloat(b.pending) > 0 && (
                        <p className="text-amber-500 text-[10px] font-mono">+{b.pending} pending</p>
                      )}
                    </div>
                    <p className="font-bold text-slate-900 text-sm font-mono">{parseFloat(b.available).toFixed(4)} <span className="text-slate-400 font-normal">USDC</span></p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* How it works */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <p className="text-slate-600 font-bold text-xs uppercase tracking-wider mb-3">How it works</p>
            <div className="flex flex-col gap-2">
              {[
                { step: '1', icon: '🏦', text: 'Deposit USDC from Base, Arbitrum, or Ethereum Sepolia into your Unified Balance' },
                { step: '2', icon: '💡', text: 'Circle Gateway pools your USDC cross-chain — no bridges, no wrapping' },
                { step: '3', icon: '⚡', text: 'Spend your Unified Balance instantly on Arc Testnet in < 1 second' },
              ].map(r => (
                <div key={r.step} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-extrabold flex items-center justify-center shrink-0 mt-0.5">{r.step}</span>
                  <p className="text-slate-600 text-xs leading-relaxed">{r.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Deposit + Spend ── */}
        <div className="flex flex-col gap-3">
          {/* Deposit card */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">⬇️</span>
              <h3 className="font-bold text-slate-900 text-sm">Deposit to Unified Balance</h3>
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">No fee</span>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-slate-500 text-xs font-semibold mb-1.5 block">Source chain</label>
                <div className="flex gap-2">
                  {UB_SOURCE_CHAINS.map(c => (
                    <button key={c.id} onClick={() => setSrcChain(c.id)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                        srcChain === c.id
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-violet-300'
                      }`}>
                      {c.flag} {c.label.replace(' Sepolia', '')}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-slate-500 text-xs font-semibold mb-1.5 block">Amount (USDC)</label>
                <div className="flex gap-2">
                  <input value={depositAmt} onChange={e => setDepositAmt(e.target.value)}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
                    placeholder="1.00" type="number" min="0.01" step="0.01" />
                  <div className="flex gap-1">
                    {['0.5', '1', '5'].map(v => (
                      <button key={v} onClick={() => setDepositAmt(v)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-violet-100 text-slate-600 hover:text-violet-700 rounded-lg text-xs font-bold transition-colors">
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {depositMsg && (
                <div className={`px-3 py-2 rounded-xl text-xs font-medium ${depositOk ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                  {depositMsg}
                </div>
              )}

              <button onClick={handleDeposit} disabled={depositing || !address}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all ${
                  !depositing && address ? 'bg-violet-600 text-white hover:bg-violet-500 shadow-sm' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}>
                {depositing ? <span className="flex items-center justify-center gap-2"><SimSpinner />Depositing…</span> : `⬇️ Deposit ${depositAmt} USDC`}
              </button>
            </div>
          </div>

          {/* Spend card */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">⚡</span>
              <h3 className="font-bold text-slate-900 text-sm">Spend on Arc Testnet</h3>
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-bold">~0.005% fee</span>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-slate-500 text-xs font-semibold mb-1.5 block">Recipient address</label>
                <input value={spendTo} onChange={e => setSpendTo(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="0x…" />
                {address && (
                  <button onClick={() => setSpendTo(address)} className="mt-1 text-[10px] text-violet-500 hover:text-violet-700 font-medium">
                    ← use my address
                  </button>
                )}
              </div>

              <div>
                <label className="text-slate-500 text-xs font-semibold mb-1.5 block">Amount (USDC)</label>
                <div className="flex gap-2">
                  <input value={spendAmt} onChange={e => setSpendAmt(e.target.value)}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
                    placeholder="1.00" type="number" min="0.01" step="0.01" />
                  <div className="flex gap-1">
                    {['0.5', '1', '5'].map(v => (
                      <button key={v} onClick={() => setSpendAmt(v)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-violet-100 text-slate-600 hover:text-violet-700 rounded-lg text-xs font-bold transition-colors">
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {estimateRes && (
                <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-[11px] font-mono">
                  📊 {estimateRes}
                </div>
              )}

              {spendMsg && (
                <div className={`px-3 py-2 rounded-xl text-xs font-medium ${spendOk ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                  {spendMsg}
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={handleEstimate} disabled={estimating || !address}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                    !estimating && address ? 'border-violet-300 text-violet-600 hover:bg-violet-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'
                  }`}>
                  {estimating ? <span className="flex items-center justify-center gap-1"><SimSpinner />…</span> : '📊 Estimate Fee'}
                </button>
                <button onClick={handleSpend} disabled={spending || !address}
                  className={`flex-[2] py-2.5 rounded-xl text-sm font-bold transition-all ${
                    !spending && address ? 'bg-violet-600 text-white hover:bg-violet-500 shadow-sm' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}>
                  {spending ? <span className="flex items-center justify-center gap-2"><SimSpinner />Spending…</span> : `⚡ Spend ${spendAmt} USDC → Arc`}
                </button>
              </div>
            </div>
          </div>

          {/* Contract info */}
          <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-2xl p-4">
            <p className="text-violet-700 font-bold text-xs mb-2">Arc Testnet Contracts</p>
            <div className="flex flex-col gap-1.5 text-[10px] font-mono">
              {[
                { label: 'GatewayWallet',  addr: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' },
                { label: 'GatewayMinter',  addr: '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B' },
                { label: 'TokenMessenger', addr: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' },
              ].map(c => (
                <div key={c.label} className="flex items-center gap-2">
                  <span className="text-violet-600 w-28 shrink-0 font-sans font-semibold text-[10px]">{c.label}</span>
                  <span className="text-slate-500 truncate">{c.addr.slice(0, 12)}…{c.addr.slice(-6)}</span>
                  <a href={`https://explorer.arc.fun/address/${c.addr}`} target="_blank" rel="noopener noreferrer"
                    className="text-violet-400 hover:text-violet-600 ml-auto shrink-0">↗</a>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

const SECTION_TABS: { key: PanelTab; label: string; icon: string }[] = [
  { key: 'send',     label: 'Quick Send',     icon: '💸' },
  { key: 'bulk',     label: 'Bulk Send',      icon: '📋' },
  { key: 'flows',    label: 'Flows',          icon: '⚙️' },
  { key: 'apps',     label: 'Use Cases',      icon: '🌍' },
  { key: 'unified',  label: 'Unified Bal.',   icon: '⚡' },
  { key: 'finality', label: 'Finality',       icon: '📊' },
]

export default function PaymentsPanel({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { address, isReady: isConnected, walletType } = useWallet()
  const { tkWallet, disconnect: disconnectTurnkey } = useTurnkeyWallet()

  const isTurnkeyActive = walletType === 'turnkey'

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
                {isTurnkeyActive && (
                  <div className="flex items-center justify-end gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-pulse" />
                    <span className="text-indigo-200 text-[10px] font-semibold">Turnkey HSM</span>
                    <button onClick={disconnectTurnkey}
                      className="text-[10px] text-white/40 hover:text-white/70 ml-1">✕</button>
                  </div>
                )}
                <p className="text-white/60 text-xs mb-0.5">USDC Balance</p>
                <p className="text-3xl font-extrabold text-white">${fmtUSDC(balanceUsdc)}</p>
                <p className="text-emerald-200 text-xs mt-0.5 font-mono truncate max-w-[180px]">
                  {address?.slice(0,6)}…{address?.slice(-4)}
                </p>
              </>
            ) : (
              <div className="flex flex-col gap-2 items-end">
                <WalletGate label="Connect to send USDC" variant="button-only" onNavigateToWallet={() => onNavigate('wallet')} />
                <p className="text-white/50 text-[10px]">🔐 Turnkey HSM or 🦊 MetaMask</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Turnkey active banner */}
      {isTurnkeyActive && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-indigo-50 border border-indigo-200 rounded-2xl">
          <span className="text-lg">🏛</span>
          <div className="flex-1 min-w-0">
            <p className="text-indigo-800 font-semibold text-xs">Turnkey Embedded Wallet active</p>
            <p className="text-indigo-500 text-[10px] font-mono truncate">{tkWallet?.address}</p>
          </div>
          <span className="text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-bold">HSM Signing</span>
        </div>
      )}

      {/* Connect wall */}
      {!isConnected && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">🔗</span>
          <WalletGate label="Connect wallet to send payments" variant="inline" onNavigateToWallet={() => onNavigate('wallet')} />
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
      {activeTab === 'send'     && <QuickSendSection      address={address} balanceUsdc={balanceUsdc} onTxSent={handleTxSent} onSwitchTab={setActiveTab} onNavigate={onNavigate} />}
      {activeTab === 'bulk'     && <BulkSendSection       address={address} balanceUsdc={balanceUsdc} onTxSent={handleTxSent} />}
      {activeTab === 'flows'    && <PaymentFlowsSection />}
      {activeTab === 'apps'     && <UseCasesSection       address={address} balanceUsdc={balanceUsdc} onTxSent={handleTxSent} />}
      {activeTab === 'unified'  && <UnifiedBalanceSection address={address} onTxSent={handleTxSent} />}
      {activeTab === 'finality' && <FinalitySection records={txRecords} />}

    </div>
  )
}
