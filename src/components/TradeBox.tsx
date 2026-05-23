// TradeBox.tsx — Binance-style trading panel: Market | Limit | Stop-Limit
import { useState, useEffect } from 'react'
import { useBalance, useReadContract, usePublicClient } from 'wagmi'
import { formatUnits } from 'viem'
import { useWallet } from '../hooks/useWallet'
import { arcTestnet } from '../config/wagmi'
import type { SwapRecord } from './SwapCard'

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderType = 'Market' | 'Limit' | 'Stop-Limit'
type Side      = 'Buy' | 'Sell'

export interface LocalOrder {
  id: string; pair: string; type: OrderType; side: Side
  price: number; stopPrice?: number; amount: number; total: number
  time: string; status: 'open' | 'cancelled' | 'filled'
}

const LS_KEY = 'arc_orders_v1'
const loadOrders  = (): LocalOrder[] => { try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') } catch { return [] } }
const saveOrders  = (o: LocalOrder[]) => localStorage.setItem(LS_KEY, JSON.stringify(o))

// Circle-supported token addresses on Arc Testnet
const TOKEN_ADDR: Record<string, `0x${string}`> = {
  USDC: '0x3600000000000000000000000000000000000000',
  EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
}
const CIRCLE_OK = new Set(['USDC', 'EURC'])
const ERC20_APPROVE_ABI = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ type: 'bool' }],
}] as const
const ADAPTER_CONTRACT = '0xBBD70b01a1CAbc96d5b7b129Ae1AAabdf50dd40b' as const
const ADAPTER_ABI = [{
  type: 'function', name: 'execute', stateMutability: 'payable',
  inputs: [
    { name: 'params', type: 'tuple', components: [
      { name: 'instructions', type: 'tuple[]', components: [
        { name: 'target', type: 'address' }, { name: 'data', type: 'bytes' },
        { name: 'value', type: 'uint256' }, { name: 'tokenIn', type: 'address' },
        { name: 'amountToApprove', type: 'uint256' }, { name: 'tokenOut', type: 'address' },
        { name: 'minTokenOut', type: 'uint256' },
      ]},
      { name: 'tokens', type: 'tuple[]', components: [
        { name: 'token', type: 'address' }, { name: 'beneficiary', type: 'address' },
      ]},
      { name: 'execId', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
      { name: 'metadata', type: 'bytes' },
    ]},
    { name: 'tokenInputs', type: 'tuple[]', components: [
      { name: 'permitType', type: 'uint8' }, { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }, { name: 'permitCalldata', type: 'bytes' },
    ]},
    { name: 'signature', type: 'bytes' },
  ],
  outputs: [],
}] as const

function fmtBal(n: number, decimals = 4) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
function fmtPrice(p: number) {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (p >= 1)    return p.toFixed(4)
  return p.toFixed(6)
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  pair: string
  basePrice?: number
  onSwapComplete?: (tx: SwapRecord) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TradeBox({ pair, basePrice = 0, onSwapComplete }: Props) {
  const [base, quote] = pair.split('/')
  const { address, isReady, walletType, chainId, writeContract } = useWallet()
  const isArc       = walletType === 'turnkey' || walletType === 'circle' || chainId === arcTestnet.id
  const publicClient = usePublicClient({ chainId: arcTestnet.id })

  const [orderType, setOrderType] = useState<OrderType>('Market')
  const [side,      setSide]      = useState<Side>('Buy')
  const [price,     setPrice]     = useState('')
  const [stopPrice, setStopPrice] = useState('')
  const [amount,    setAmount]    = useState('')
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [success,   setSuccess]   = useState<string | null>(null)
  const [txHash,    setTxHash]    = useState<string | null>(null)
  const [orders,    setOrders]    = useState<LocalOrder[]>([])

  // Reset when pair changes
  useEffect(() => {
    setAmount(''); setPrice(''); setStopPrice('')
    setError(null); setSuccess(null); setTxHash(null)
    setOrders(loadOrders().filter(o => o.pair === pair && o.status === 'open'))
  }, [pair])

  // Pre-fill limit price from live price
  useEffect(() => {
    if (orderType !== 'Market' && basePrice > 0) {
      setPrice(basePrice >= 100 ? basePrice.toFixed(2) : basePrice.toFixed(6))
    }
  }, [orderType, basePrice])

  // ── Balances ─────────────────────────────────────────────────────────────

  const { data: nativeBal, refetch: refetchNative } = useBalance({
    address, chainId: arcTestnet.id, query: { refetchInterval: 8_000 },
  })
  const EURC_ADDR = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const
  const ERC20_BAL_ABI = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const
  const { data: eurcRaw, refetch: refetchEURC } = useReadContract({
    address: EURC_ADDR, abi: ERC20_BAL_ABI, functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    chainId: arcTestnet.id, query: { enabled: !!address, refetchInterval: 8_000 },
  })
  const getBal = (token: string): number => {
    if (!address) return 0
    if (token === 'USDC' && nativeBal) return parseFloat(formatUnits(nativeBal.value, nativeBal.decimals))
    if (token === 'EURC' && eurcRaw != null) return parseFloat(formatUnits(eurcRaw as bigint, 6))
    return 0
  }

  // side=Buy → spending quote; side=Sell → spending base
  const spendToken   = side === 'Buy' ? quote : base
  const receiveToken = side === 'Buy' ? base  : quote
  const spendBal     = getBal(spendToken)

  const effectivePrice = orderType === 'Market' ? basePrice : (parseFloat(price) || 0)
  const amountNum      = parseFloat(amount) || 0
  const total          = amountNum * (effectivePrice || 0)

  // ── Percent quick-fill ────────────────────────────────────────────────────

  const handlePct = (pct: number) => {
    if (!spendBal || !effectivePrice) return
    if (side === 'Buy') {
      // spending quote → how many base
      setAmount(((spendBal * pct / 100) / effectivePrice).toFixed(6))
    } else {
      setAmount((spendBal * pct / 100).toFixed(6))
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!amount || amountNum <= 0) return
    setError(null); setSuccess(null); setTxHash(null)

    // ── Limit / Stop-Limit: store locally ──────────────────────────────────
    if (orderType !== 'Market') {
      const lp = parseFloat(price)
      const sp = parseFloat(stopPrice)
      if (!lp || lp <= 0) { setError('Please enter a valid limit price.'); return }
      if (orderType === 'Stop-Limit' && (!sp || sp <= 0)) { setError('Please enter a valid stop price.'); return }
      const order: LocalOrder = {
        id: Date.now().toString(), pair, type: orderType, side,
        price: lp, stopPrice: orderType === 'Stop-Limit' ? sp : undefined,
        amount: amountNum, total: amountNum * lp,
        time: new Date().toLocaleTimeString(), status: 'open',
      }
      const all = loadOrders()
      all.push(order)
      saveOrders(all)
      setOrders(all.filter(o => o.pair === pair && o.status === 'open'))
      setAmount('')
      setSuccess(`${orderType} ${side} placed — ${amountNum} ${base} @ ${fmtPrice(lp)} ${quote}`)
      return
    }

    // ── Market: Circle Swap API (USDC ↔ EURC only) ──────────────────────
    if (!address) { setError('Connect your wallet first.'); return }
    if (!CIRCLE_OK.has(spendToken) || !CIRCLE_OK.has(receiveToken)) {
      setError(`Market ${side} for ${pair} is not yet supported.\nCircle Swap Kit currently supports USDC ↔ EURC only on Arc Testnet.`)
      return
    }

    setBusy(true)
    try {
      const inAddr  = TOKEN_ADDR[spendToken]!
      const outAddr = TOKEN_ADDR[receiveToken]!
      const rawAmt  = Math.round(amountNum * 1e6).toString()

      const resp = await fetch('/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenInAddress: inAddr, tokenInChain: 'ARC-TESTNET',
          tokenOutAddress: outAddr, tokenOutChain: 'ARC-TESTNET',
          amount: rawAmt, fromAddress: address, toAddress: address,
        }),
      })
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({})) as Record<string, unknown>
        throw new Error(`Circle API ${resp.status}: ${String(e.message ?? e.error ?? resp.statusText)}`)
      }

      type Ix = { target:`0x${string}`; data:`0x${string}`; value:string; tokenIn?:`0x${string}`; amountToApprove?:string; tokenOut?:`0x${string}`; minTokenOut?:string }
      type Tok = { token:`0x${string}`; beneficiary:`0x${string}` }
      const d = await resp.json() as { transaction?: { signature?:string; executionParams?: { instructions:Ix[]; tokens:Tok[]; execId:string; deadline:string; metadata:string } } }
      const ep  = d?.transaction?.executionParams
      const sig = d?.transaction?.signature
      if (!ep?.instructions?.length) throw new Error('Circle API returned no instructions.')

      const { instructions, tokens, execId, deadline, metadata } = ep
      const ZERO = '0x0000000000000000000000000000000000000000' as const
      const totalApprove = instructions.reduce((s, ix) =>
        ix.tokenIn && ix.tokenIn.toLowerCase() === inAddr.toLowerCase()
          ? s + BigInt(ix.amountToApprove ?? '0') : s, 0n)

      // Approve
      const approveHash = await writeContract({
        address: inAddr, abi: ERC20_APPROVE_ABI, functionName: 'approve',
        args: [ADAPTER_CONTRACT, totalApprove],
      })
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash: approveHash, confirmations: 1 })

      // Execute
      const hash = await writeContract({
        address: ADAPTER_CONTRACT, abi: ADAPTER_ABI, functionName: 'execute',
        args: [
          {
            instructions: instructions.map(ix => ({
              target: ix.target, data: ix.data,
              value: ix.value && ix.value !== '0' ? BigInt(ix.value) : 0n,
              tokenIn: (ix.tokenIn ?? ZERO) as `0x${string}`,
              amountToApprove: BigInt(ix.amountToApprove ?? '0'),
              tokenOut: (ix.tokenOut ?? ZERO) as `0x${string}`,
              minTokenOut: BigInt(ix.minTokenOut ?? '0'),
            })),
            tokens: tokens.map(t => ({ token: t.token, beneficiary: t.beneficiary })),
            execId: BigInt(execId), deadline: BigInt(deadline),
            metadata: (metadata ?? '0x') as `0x${string}`,
          },
          [{ permitType: 0, token: inAddr, amount: totalApprove, permitCalldata: '0x' }],
          (sig ?? '0x') as `0x${string}`,
        ],
        value: 0n,
      })

      setTxHash(hash)
      const now = new Date()
      onSwapComplete?.({
        id: Date.now().toString(),
        time: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`,
        type: side === 'Buy' ? 'buy' : 'sell',
        fromToken: spendToken, toToken: receiveToken,
        fromAmount: amountNum, toAmount: total,
        price: effectivePrice,
        wallet: address ? `${address.slice(0,6)}...${address.slice(-4)}` : '0x????',
        txHash: hash, status: 'confirmed',
      })
      setTimeout(() => { void refetchNative(); void refetchEURC() }, 2000)
      setTimeout(() => { void refetchNative(); void refetchEURC() }, 6000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const cancelOrder = (id: string) => {
    const all = loadOrders().map(o => o.id === id ? { ...o, status: 'cancelled' as const } : o)
    saveOrders(all)
    setOrders(all.filter(o => o.pair === pair && o.status === 'open'))
  }

  const openOrders = orders.filter(o => o.status === 'open')
  const isBuy = side === 'Buy'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">

      {/* ── Order type tabs ───────────────────────────────────────────────── */}
      <div className="flex border-b border-slate-100">
        {(['Market', 'Limit', 'Stop-Limit'] as OrderType[]).map(t => (
          <button key={t} onClick={() => { setOrderType(t); setError(null); setSuccess(null) }}
            className={`flex-1 py-2.5 text-[13px] font-bold transition-colors border-b-2 ${
              orderType === t
                ? 'border-violet-500 text-violet-600'
                : 'border-transparent text-slate-400 hover:text-slate-700'
            }`}>
            {t}
          </button>
        ))}
      </div>

      <div className="p-4 flex flex-col gap-3">

        {/* ── Buy / Sell toggle ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 rounded-xl overflow-hidden border border-slate-200">
          <button onClick={() => { setSide('Buy'); setError(null); setSuccess(null) }}
            className={`py-2.5 text-sm font-bold transition-all ${
              isBuy ? 'bg-emerald-500 text-white shadow-inner' : 'bg-white text-slate-500 hover:bg-emerald-50 hover:text-emerald-600'
            }`}>
            Buy {base}
          </button>
          <button onClick={() => { setSide('Sell'); setError(null); setSuccess(null) }}
            className={`py-2.5 text-sm font-bold transition-all ${
              !isBuy ? 'bg-red-500 text-white shadow-inner' : 'bg-white text-slate-500 hover:bg-red-50 hover:text-red-600'
            }`}>
            Sell {base}
          </button>
        </div>

        {/* ── Available balance ──────────────────────────────────────────── */}
        <div className="flex justify-between text-xs text-slate-500">
          <span>Available</span>
          <span className="font-mono font-semibold text-slate-700">
            {address ? `${fmtBal(spendBal)} ${spendToken}` : '—'}
          </span>
        </div>

        {/* ── Stop Price (Stop-Limit only) ───────────────────────────────── */}
        {orderType === 'Stop-Limit' && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 font-medium">Stop Price ({quote})</label>
            <div className="flex items-center border border-slate-200 rounded-xl px-3 py-2 focus-within:border-violet-400 bg-slate-50">
              <input
                type="number" inputMode="decimal" placeholder="0.00" value={stopPrice}
                onChange={e => setStopPrice(e.target.value)}
                className="flex-1 bg-transparent text-slate-900 font-mono text-sm outline-none"
              />
              <span className="text-slate-400 text-xs ml-2 shrink-0">{quote}</span>
            </div>
          </div>
        )}

        {/* ── Limit Price ───────────────────────────────────────────────── */}
        {orderType !== 'Market' && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 font-medium">
              {orderType === 'Stop-Limit' ? 'Limit' : 'Price'} ({quote})
            </label>
            <div className="flex items-center border border-slate-200 rounded-xl px-3 py-2 focus-within:border-violet-400 bg-slate-50">
              <input
                type="number" inputMode="decimal" placeholder="0.00" value={price}
                onChange={e => setPrice(e.target.value)}
                className="flex-1 bg-transparent text-slate-900 font-mono text-sm outline-none"
              />
              <span className="text-slate-400 text-xs ml-2 shrink-0">{quote}</span>
            </div>
          </div>
        )}

        {/* Market: show live price chip ─────────────────────────────────── */}
        {orderType === 'Market' && basePrice > 0 && (
          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-xs text-slate-400">Market Price</span>
            <span className="text-sm font-mono font-bold text-slate-800">{fmtPrice(basePrice)} {quote}</span>
          </div>
        )}

        {/* ── Amount ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-slate-500 font-medium">Amount ({base})</label>
          <div className={`flex items-center border rounded-xl px-3 py-2 bg-slate-50 focus-within:border-violet-400 ${
            isBuy ? 'border-slate-200' : 'border-slate-200'
          }`}>
            <input
              type="number" inputMode="decimal" placeholder="0.00000" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="flex-1 bg-transparent text-slate-900 font-mono text-sm outline-none"
            />
            <span className="text-slate-400 text-xs ml-2 shrink-0">{base}</span>
          </div>
          {/* Percent quick buttons */}
          <div className="grid grid-cols-4 gap-1">
            {[25, 50, 75, 100].map(pct => (
              <button key={pct} onClick={() => handlePct(pct)}
                className={`py-1 rounded-lg text-xs font-bold transition-colors border ${
                  isBuy
                    ? 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                    : 'border-red-200 text-red-500 hover:bg-red-50'
                } bg-white`}>
                {pct === 100 ? 'Max' : `${pct}%`}
              </button>
            ))}
          </div>
        </div>

        {/* ── Total ────────────────────────────────────────────────────── */}
        <div className="flex items-center border border-slate-200 rounded-xl px-3 py-2 bg-slate-50">
          <span className="text-xs text-slate-400 mr-2 shrink-0">Total</span>
          <span className="flex-1 text-slate-900 font-mono text-sm">
            {total > 0 ? fmtBal(total, 2) : '0.00'}
          </span>
          <span className="text-slate-400 text-xs ml-2 shrink-0">{quote}</span>
        </div>

        {/* ── Submit button ─────────────────────────────────────────────── */}
        {!isReady ? (
          <button disabled className="w-full py-3 rounded-xl bg-slate-100 text-slate-400 text-sm font-bold">
            Connect Wallet
          </button>
        ) : !isArc ? (
          <button disabled className="w-full py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm font-bold cursor-not-allowed">
            Switch to Arc Testnet
          </button>
        ) : (
          <button onClick={handleSubmit}
            disabled={busy || !amount || amountNum <= 0}
            className={`w-full py-3 rounded-xl text-white text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
              isBuy
                ? 'bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600'
                : 'bg-red-500 hover:bg-red-400 active:bg-red-600'
            }`}>
            {busy ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Processing…
              </>
            ) : orderType === 'Market' ? (
              `${side} ${base}`
            ) : (
              `Place ${orderType} ${side}`
            )}
          </button>
        )}

        {/* ── Success / Error ───────────────────────────────────────────── */}
        {success && !txHash && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs font-medium">
            ✓ {success}
          </div>
        )}
        {txHash && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
            <p className="text-emerald-700 text-xs font-bold">✓ Transaction confirmed</p>
            <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer"
              className="text-emerald-600 text-xs underline underline-offset-2 truncate block mt-0.5">
              View on ArcScan →
            </a>
          </div>
        )}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
            {error.split('\n').map((l, i) => (
              <p key={i} className={`text-red-600 ${i === 0 ? 'text-xs font-bold' : 'text-[11px] mt-0.5'}`}>{l}</p>
            ))}
          </div>
        )}
      </div>

      {/* ── Open Orders ──────────────────────────────────────────────────── */}
      {openOrders.length > 0 && (
        <div className="border-t border-slate-100">
          <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">Open Orders ({openOrders.length})</span>
          </div>
          <div className="flex flex-col divide-y divide-slate-50">
            {openOrders.map(o => (
              <div key={o.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      o.side === 'Buy' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                    }`}>{o.side}</span>
                    <span className="text-[10px] text-slate-500 font-medium">{o.type}</span>
                    <span className="text-[10px] text-slate-400">{o.time}</span>
                  </div>
                  <p className="text-xs font-mono text-slate-700 mt-0.5">
                    {o.amount} {base} @ {fmtPrice(o.price)} {quote}
                    {o.stopPrice ? <span className="text-slate-400 ml-1">stop {fmtPrice(o.stopPrice)}</span> : null}
                  </p>
                </div>
                <button onClick={() => cancelOrder(o.id)}
                  className="text-[10px] text-red-400 hover:text-red-600 font-semibold shrink-0 px-2 py-1 rounded hover:bg-red-50 transition-colors">
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
