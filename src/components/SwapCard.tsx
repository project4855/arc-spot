import { useState, useCallback, useEffect } from 'react'
import { useBalance, useReadContract } from 'wagmi'
import { formatUnits } from 'viem'

import TokenInput from './TokenInput'
import WalletGate from './WalletGate'
import { useWallet } from '../hooks/useWallet'
import { arcTestnet } from '../config/wagmi'

const TOKENS = [
  { symbol: 'USDC',   name: 'USD Coin',       icon: '💵', decimals: 6 },
  { symbol: 'EURC',   name: 'Euro Coin',       icon: '💶', decimals: 6 },
  { symbol: 'cirBTC', name: 'Circle Bitcoin',  icon: '₿',  decimals: 8 },
  { symbol: 'ETH',    name: 'Ethereum',        icon: 'Ξ',  decimals: 18 },
  { symbol: 'SOL',    name: 'Solana',          icon: '◎',  decimals: 9 },
]

// Fallback display rates — updated 2026-05-17
// ETH $2,293 · SOL $90.5 · BTC $78,200 · EURC $1.1639
const DISPLAY_RATES: Record<string, Record<string, number>> = {
  USDC:   { EURC: 0.8592,    cirBTC: 0.00001279, ETH: 0.000436, SOL: 0.01105 },
  EURC:   { USDC: 1.1639,    cirBTC: 0.00001489, ETH: 0.000508, SOL: 0.01287 },
  cirBTC: { USDC: 78200,     EURC: 67183,         ETH: 34.12,    SOL: 864.4 },
  ETH:    { USDC: 2293,      EURC: 1970,          cirBTC: 0.02931, SOL: 25.34 },
  SOL:    { USDC: 90.5,      EURC: 77.75,         cirBTC: 0.001157, ETH: 0.03947 },
}

function getRate(from: string, to: string): number {
  if (from === to) return 1
  return DISPLAY_RATES[from]?.[to] ?? 1
}

// VITE_CIRCLE_KIT_KEY is only used as a local-dev fallback when /api/swap is unavailable.
// In production (Vercel), the key lives in CIRCLE_KIT_KEY (server env) and is never sent to the browser.
const VITE_KIT_KEY = import.meta.env.VITE_CIRCLE_KIT_KEY as string | undefined
const isRealMode = true // proxy always available on Vercel; local dev uses VITE key fallback

export interface SwapRecord {
  id: string
  time: string
  type: 'buy' | 'sell'
  fromToken: string
  toToken: string
  fromAmount: number
  toAmount: number
  price: number
  wallet: string
  txHash: string
  status: 'confirmed' | 'pending'
}

interface SwapCardProps {
  fromTokenProp?: string
  toTokenProp?: string
  onSwapComplete?: (tx: SwapRecord) => void
}

export default function SwapCard({ fromTokenProp = 'USDC', toTokenProp = 'EURC', onSwapComplete }: SwapCardProps) {
  const { address, isReady, walletType, chainId, writeContract, sendTransaction } = useWallet()
  const isArc = walletType === 'turnkey' || chainId === arcTestnet.id

  const [fromToken, setFromToken] = useState(fromTokenProp)
  const [toToken, setToToken] = useState(toTokenProp)

  useEffect(() => {
    setFromToken(fromTokenProp)
    setToToken(toTokenProp)
    setFromAmount('')
    setTxHash(null)
    setError(null)
  }, [fromTokenProp, toTokenProp])
  const [fromAmount, setFromAmount] = useState('')
  const [isSwapping, setIsSwapping] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [steps, setSteps] = useState<{ msg: string; status: 'pending' | 'ok' | 'err' }[]>([])
  const [showSteps, setShowSteps] = useState(false)

  const { data: balance, refetch: refetchUSDC } = useBalance({
    address,
    chainId: arcTestnet.id,
    query: { refetchInterval: 8_000 },
  })

  const EURC_ADDRESS = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const
  const ERC20_BALANCE_ABI = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const
  const { data: eurcRaw, refetch: refetchEURC } = useReadContract({
    address:      EURC_ADDRESS,
    abi:          ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args:         [address ?? '0x0000000000000000000000000000000000000000'],
    chainId:      arcTestnet.id,
    query:        { enabled: !!address, refetchInterval: 8_000 },
  })

  // helper: format balance string for any token
  const getBalanceStr = (token: string): string | undefined => {
    if (!address) return undefined
    if (token === 'USDC' && balance)
      return `${parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)} USDC`
    if (token === 'EURC' && eurcRaw !== undefined)
      return `${parseFloat(formatUnits(eurcRaw as bigint, 6)).toFixed(4)} EURC`
    return undefined
  }

  const toAmount = fromAmount
    ? (parseFloat(fromAmount) * getRate(fromToken, toToken)).toFixed(6)
    : ''

  const handleFlip = useCallback(() => {
    setFromToken(toToken)
    setToToken(fromToken)
    setFromAmount(toAmount)
    setTxHash(null)
    setError(null)
  }, [fromToken, toToken, toAmount])

  const handleFromTokenChange = (token: string) => {
    if (token === toToken) setToToken(fromToken)
    setFromToken(token)
    setTxHash(null)
    setError(null)
  }

  const handleToTokenChange = (token: string) => {
    if (token === fromToken) setFromToken(toToken)
    setToToken(token)
    setTxHash(null)
    setError(null)
  }

  const handleSwap = async () => {
    if (!fromAmount || parseFloat(fromAmount) <= 0) return
    setIsSwapping(true)
    setError(null)
    setTxHash(null)
    setSteps([])
    setShowSteps(true)

    // Helper: append a log step
    const addStep = (msg: string, status: 'pending' | 'ok' | 'err' = 'pending') =>
      setSteps(prev => [...prev, { msg, status }])
    const markLast = (status: 'ok' | 'err') =>
      setSteps(prev => prev.map((s, i) => i === prev.length - 1 ? { ...s, status } : s))

    const buildRecord = (hash: string): SwapRecord => {
      const now = new Date()
      const fa = parseFloat(fromAmount)
      const r = getRate(fromToken, toToken)
      return {
        id: Date.now().toString(),
        time: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`,
        type: 'buy',
        fromToken,
        toToken,
        fromAmount: fa,
        toAmount: parseFloat((fa * r).toFixed(6)),
        price: r,
        wallet: address ? `${address.slice(0,6)}...${address.slice(-4)}` : '0x????',
        txHash: hash,
        status: 'confirmed',
      }
    }

    try {
      if (!address) throw new Error('No wallet connected.')

      // ── Token addresses on Arc Testnet ────────────────────────────────────
      const TOKEN_ADDR: Record<string, `0x${string}`> = {
        USDC:   '0x3600000000000000000000000000000000000000',
        EURC:   '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
        cirBTC: '0xa4bc51aF6aA6b5a7A3B24B30B37B7F90C20c0dF3',
      }
      const ERC20_APPROVE_ABI = [{
        name: 'approve', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
        outputs: [{ type: 'bool' }],
      }] as const

      const tokenInAddr  = TOKEN_ADDR[fromToken]
      const tokenOutAddr = TOKEN_ADDR[toToken]
      if (!tokenInAddr || !tokenOutAddr) {
        throw new Error(`Swap only supports USDC, EURC, cirBTC on Arc Testnet.`)
      }

      // Convert human amount to raw integer (6 decimals for USDC/EURC, 8 for cirBTC)
      const inDecimals = fromToken === 'cirBTC' ? 8 : 6
      const rawAmount  = Math.round(parseFloat(fromAmount) * 10 ** inDecimals).toString()

      // ── Step 1: Call /api/swap proxy (server holds CIRCLE_KIT_KEY securely) ─
      addStep('📡 Requesting swap route from Circle API…')
      const swapBody = JSON.stringify({
        tokenInAddress:  tokenInAddr,
        tokenInChain:    'Arc_Testnet',
        tokenOutAddress: tokenOutAddr,
        tokenOutChain:   'Arc_Testnet',
        amount:          rawAmount,
        fromAddress:     address,
        toAddress:       address,
      })

      let resp = await fetch('/api/swap', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    swapBody,
      })

      // Local-dev fallback: /api/swap not available → use VITE key directly
      if (!resp.ok && VITE_KIT_KEY) {
        const body = await resp.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
        const isProxyMissing = resp.status === 404 || (resp.status === 500 && String(body.error ?? '').includes('CIRCLE_KIT_KEY not set'))
        if (isProxyMissing) {
          addStep('⚠️ Proxy unavailable (local dev) — calling Circle API directly…')
          resp = await fetch('https://api.circle.com/v1/stablecoinKits/swap', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${VITE_KIT_KEY}`, 'Content-Type': 'application/json' },
            body:    swapBody,
          })
        }
      }

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
        const msg = String(errBody.message ?? errBody.error ?? resp.statusText)
        markLast('err')
        throw new Error(
          `Circle API ${resp.status}: ${msg}\n` +
          (resp.status === 404
            ? `Kit Key not found or not enabled for Arc Testnet.\n` +
              `→ In Vercel, add env var CIRCLE_KIT_KEY = KIT_KEY:<id>:<secret>\n` +
              `→ Get a key at: https://developers.circle.com/w3s/keys#kit-keys`
            : resp.status === 500 && msg.includes('CIRCLE_KIT_KEY')
              ? `Server env var missing.\n→ Add CIRCLE_KIT_KEY in Vercel → Settings → Environment Variables`
              : '')
        )
      }

      type Instruction = {
        target: `0x${string}`
        data:   `0x${string}`
        value:  string
        tokenIn?: `0x${string}`
        amountToApprove?: string
      }
      const swapData = await resp.json() as {
        transaction?: { executionParams?: { instructions?: Instruction[] } }
        instructions?: Instruction[]
      }

      // Handle both possible response shapes
      const instructions: Instruction[] =
        swapData?.transaction?.executionParams?.instructions ??
        swapData?.instructions ??
        []

      if (instructions.length === 0) {
        markLast('err')
        throw new Error(
          `Circle API returned no instructions.\nFull response: ${JSON.stringify(swapData, null, 2)}`
        )
      }

      markLast('ok')
      addStep(`✓ Got ${instructions.length} instruction(s) — executing on-chain…`)
      markLast('ok')

      // ── Step 2: Execute each instruction ─────────────────────────────────
      let lastHash: `0x${string}` = '0x0'

      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i]
        const shortTarget = `${ix.target.slice(0, 8)}…${ix.target.slice(-4)}`

        // Approve token if needed
        if (ix.tokenIn && ix.amountToApprove && BigInt(ix.amountToApprove) > 0n) {
          const humanAmt = (Number(ix.amountToApprove) / 10 ** inDecimals).toFixed(6)
          addStep(`[${i+1}/${instructions.length}] Approve ${fromToken} → ${shortTarget} (${humanAmt})`)
          try {
            await writeContract({
              address:      ix.tokenIn,
              abi:          ERC20_APPROVE_ABI,
              functionName: 'approve',
              args:         [ix.target, BigInt(ix.amountToApprove)],
            })
            markLast('ok')
          } catch (approveErr) {
            markLast('err')
            throw new Error(
              `Approve failed (instruction ${i+1}): ${approveErr instanceof Error ? approveErr.message : String(approveErr)}`
            )
          }
        }

        // Execute the swap instruction
        const txValue = ix.value && ix.value !== '0' && ix.value !== '0x0' && ix.value !== ''
          ? BigInt(ix.value) : 0n
        addStep(`[${i+1}/${instructions.length}] Send tx → ${shortTarget}`)
        try {
          lastHash = await sendTransaction({ to: ix.target, data: ix.data, value: txValue })
          markLast('ok')
          addStep(`[${i+1}/${instructions.length}] ✓ ${lastHash.slice(0, 12)}…`)
          markLast('ok')
        } catch (txErr) {
          markLast('err')
          throw new Error(
            `Transaction failed (instruction ${i+1}, target ${ix.target}):\n` +
            `${txErr instanceof Error ? txErr.message : String(txErr)}`
          )
        }
      }

      setTxHash(lastHash)
      onSwapComplete?.(buildRecord(lastHash))
      setTimeout(() => { void refetchUSDC(); void refetchEURC() }, 2000)
      setTimeout(() => { void refetchUSDC(); void refetchEURC() }, 6000)

    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err)
      setError(raw)
    } finally {
      setIsSwapping(false)
    }
  }

  const rate = getRate(fromToken, toToken)
  const fromTokens = TOKENS
  const toTokens = TOKENS.filter((t) => t.symbol !== fromToken)

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-slate-900 font-bold text-xl">Swap</h2>
            <p className="text-slate-500 text-sm mt-0.5">Arc Testnet · On-chain swap</p>
          </div>
          {/* Mode badge */}
          <div className={`px-2 py-1 rounded-lg text-xs font-medium ${
            isRealMode
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'bg-amber-50 border border-amber-200 text-amber-700'
          }`}>
            {isRealMode ? '⚡ Live' : '🔸 Demo'}
          </div>
        </div>

        {/* From input */}
        <TokenInput
          label="You pay"
          token={fromToken}
          amount={fromAmount}
          onAmountChange={setFromAmount}
          onTokenChange={handleFromTokenChange}
          tokens={fromTokens}
          balance={getBalanceStr(fromToken)}
        />

        {/* Flip button */}
        <div className="flex justify-center my-2">
          <button
            onClick={handleFlip}
            className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 hover:border-violet-400 hover:bg-violet-50 flex items-center justify-center text-slate-600 hover:text-violet-600 transition-all duration-200 text-lg"
          >
            ⇅
          </button>
        </div>

        {/* To input */}
        <TokenInput
          label="You receive"
          token={toToken}
          amount={toAmount}
          onTokenChange={handleToTokenChange}
          readonly
          tokens={toTokens}
          balance={getBalanceStr(toToken)}
        />

        {/* Rate info — always visible */}
        <div className="mt-3 px-4 py-3 bg-slate-50 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Rate</span>
            <span className="text-slate-700 font-mono">
              1 {fromToken} ≈ {rate.toLocaleString(undefined, { maximumSignificantDigits: 6 })} {toToken}
            </span>
          </div>
          {fromAmount && parseFloat(fromAmount) > 0 && (
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-slate-500">You receive</span>
              <span className="text-emerald-600 font-mono font-semibold">
                ≈ {toAmount} {toToken}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-slate-500">Gas</span>
            <span className="text-emerald-600 text-xs">~0.001 USDC</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-slate-500">Network</span>
            <span className="text-violet-600 text-xs">Arc Testnet</span>
          </div>
        </div>

        {/* Swap button */}
        <div className="mt-4">
          {!isReady ? (
            <WalletGate label="Connect wallet to swap" variant="inline" />
          ) : !isArc ? (
            <button
              disabled
              className="w-full py-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 font-semibold text-sm cursor-not-allowed"
            >
              Switch to Arc Testnet
            </button>
          ) : (
            <button
              onClick={handleSwap}
              disabled={isSwapping || !fromAmount || parseFloat(fromAmount) <= 0}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-blue-500 hover:from-violet-500 hover:to-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-base transition-all duration-200 shadow-lg hover:shadow-violet-500/25"
            >
              {isSwapping ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Swapping on-chain...
                </span>
              ) : (
                `Swap ${fromToken} → ${toToken}`
              )}
            </button>
          )}
        </div>

        {/* Success */}
        {txHash && txHash !== 'demo' && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
            <p className="text-emerald-600 text-sm font-medium text-center">✓ Swap successful!</p>
            <a
              href={`https://testnet.arcscan.app/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="block text-center text-xs text-emerald-600/70 hover:text-emerald-600 mt-1 underline underline-offset-2 truncate"
            >
              View on ArcScan →
            </a>
          </div>
        )}

        {txHash === 'demo' && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-amber-700 text-sm font-medium text-center">🔸 Demo swap completed</p>
            <p className="text-amber-600/60 text-xs text-center mt-1">
              Add <code className="bg-slate-100 px-1 rounded">VITE_CIRCLE_KIT_KEY</code> to enable real swaps
            </p>
          </div>
        )}

        {/* Step debug log */}
        {steps.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setShowSteps(v => !v)}
              className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
            >
              {showSteps ? 'Hide' : 'Show'} swap steps ({steps.length})
            </button>
            {showSteps && (
              <div className="mt-1 p-2 bg-slate-50 border border-slate-200 rounded-xl space-y-0.5 max-h-40 overflow-y-auto">
                {steps.map((s, i) => (
                  <p key={i} className={`text-xs font-mono leading-tight ${
                    s.status === 'ok'  ? 'text-emerald-600' :
                    s.status === 'err' ? 'text-red-500' :
                    'text-slate-500'
                  }`}>
                    {s.status === 'ok' ? '✓' : s.status === 'err' ? '✗' : '…'} {s.msg}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl">
            {error.split('\n').map((line, i) => (
              <p key={i} className={`text-red-600 text-sm ${i === 0 ? 'font-medium' : 'mt-0.5 text-xs'}`}>
                {line.startsWith('http') || line.startsWith('https') || line.startsWith('→ http')
                  ? <a href={line.replace(/^→\s*/, '').trim()} target="_blank" rel="noreferrer" className="underline">{line}</a>
                  : line}
              </p>
            ))}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-slate-400 mt-4">
        Powered by{' '}
        <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer" className="text-violet-500 hover:text-violet-400">
          Arc Testnet
        </a>{' '}
        · USDC on-chain
      </p>
    </div>
  )
}
