import { useState, useCallback, useEffect } from 'react'
import { useBalance, useReadContract, usePublicClient } from 'wagmi'
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
  const { address, isReady, walletType, chainId, writeContract } = useWallet()
  const isArc = walletType === 'turnkey' || walletType === 'circle' || chainId === arcTestnet.id
  // Public client for waitForTransactionReceipt — ensures approve is on-chain before swap tx
  const publicClient = usePublicClient({ chainId: arcTestnet.id })

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
        cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
      }
      const ERC20_APPROVE_ABI = [{
        name: 'approve', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
        outputs: [{ type: 'bool' }],
      }] as const

      const tokenInAddr  = TOKEN_ADDR[fromToken]
      const tokenOutAddr = TOKEN_ADDR[toToken]
      if (!tokenInAddr || !tokenOutAddr) {
        throw new Error(`Token not supported on Arc Testnet.\nAvailable: USDC, EURC, cirBTC.`)
      }

      // ETH and SOL are not on Arc Testnet as ERC-20 — block only those
      const NOT_SUPPORTED = new Set(['ETH', 'SOL'])
      if (NOT_SUPPORTED.has(fromToken) || NOT_SUPPORTED.has(toToken)) {
        throw new Error(
          `${fromToken} → ${toToken} is not yet supported on Arc Testnet.\n` +
          `Currently available: USDC ↔ EURC ↔ cirBTC swaps.`
        )
      }

      // Circle Swap Kit requires integer base units and chain name 'Arc_Testnet'
      const inDecimals = fromToken === 'cirBTC' ? 8 : 6
      const amountStr  = Math.round(parseFloat(fromAmount) * 10 ** inDecimals).toString()

      // ── Step 1: Call /api/swap proxy (server holds CIRCLE_KIT_KEY securely) ─
      addStep('📡 Requesting swap route from Circle API…')
      const swapPayload = {
        tokenInAddress:  tokenInAddr,
        tokenInChain:    'Arc_Testnet',
        tokenOutAddress: tokenOutAddr,
        tokenOutChain:   'Arc_Testnet',
        amount:          amountStr,
        fromAddress:     address,
        toAddress:       address,
      }
      const swapBody = JSON.stringify(swapPayload)

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
        const msg   = String(errBody.message ?? errBody.error ?? resp.statusText)
        const extra = errBody.errors ?? errBody.details ?? errBody.code
        markLast('err')
        throw new Error(
          `Circle API ${resp.status}: ${msg}` +
          (extra ? `\nDetails: ${JSON.stringify(extra)}` : '') +
          (resp.status === 404
            ? `\nKit Key not found — add CIRCLE_KIT_KEY in Vercel env vars`
            : resp.status === 500 && msg.includes('CIRCLE_KIT_KEY')
              ? `\nServer env var missing — add CIRCLE_KIT_KEY in Vercel`
              : '') +
          `\nPayload sent: ${JSON.stringify(swapPayload)}`
        )
      }

      // Circle Adapter Contract — manages approval, instruction execution, and
      // EURC delivery to the user in one atomic tx.
      const ADAPTER_CONTRACT = '0xBBD70b01a1CAbc96d5b7b129Ae1AAabdf50dd40b' as const
      const ADAPTER_ABI = [{
        type: 'function', name: 'execute', stateMutability: 'payable',
        inputs: [
          { name: 'params', type: 'tuple', components: [
            { name: 'instructions', type: 'tuple[]', components: [
              { name: 'target',          type: 'address' },
              { name: 'data',            type: 'bytes'   },
              { name: 'value',           type: 'uint256' },
              { name: 'tokenIn',         type: 'address' },
              { name: 'amountToApprove', type: 'uint256' },
              { name: 'tokenOut',        type: 'address' },
              { name: 'minTokenOut',     type: 'uint256' },
            ]},
            { name: 'tokens', type: 'tuple[]', components: [
              { name: 'token',       type: 'address' },
              { name: 'beneficiary', type: 'address' },
            ]},
            { name: 'execId',   type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
            { name: 'metadata', type: 'bytes'   },
          ]},
          { name: 'tokenInputs', type: 'tuple[]', components: [
            { name: 'permitType',     type: 'uint8'   },
            { name: 'token',          type: 'address' },
            { name: 'amount',         type: 'uint256' },
            { name: 'permitCalldata', type: 'bytes'   },
          ]},
          { name: 'signature', type: 'bytes' },
        ],
        outputs: [],
      }] as const

      type Instruction = {
        target:          `0x${string}`
        data:            `0x${string}`
        value:           string
        tokenIn?:        `0x${string}`
        amountToApprove?: string
        tokenOut?:       `0x${string}`
        minTokenOut?:    string
      }
      type TokenRecipient = { token: `0x${string}`; beneficiary: `0x${string}` }
      type ExecParams = {
        instructions: Instruction[]
        tokens:       TokenRecipient[]
        execId:       string   // hex or decimal string
        deadline:     string   // decimal string
        metadata:     string
      }
      const swapData = await resp.json() as {
        transaction?: { signature?: string; executionParams?: ExecParams }
      }

      const execParams = swapData?.transaction?.executionParams
      const signature  = swapData?.transaction?.signature

      if (!execParams || !execParams.instructions?.length) {
        markLast('err')
        throw new Error(
          `Circle API returned no instructions.\nResponse: ${JSON.stringify(swapData, null, 2)}`
        )
      }

      const ZERO = '0x0000000000000000000000000000000000000000' as const
      const { instructions, tokens, execId, deadline, metadata } = execParams

      markLast('ok')
      addStep(`✓ Got ${instructions.length} instruction(s) from Circle`)
      markLast('ok')

      // ── Step 2: Approve total tokenIn to Adapter Contract (1 approve tx) ──
      // The adapter contract pulls the total USDC, executes all instructions
      // atomically, then forwards EURC to the beneficiary (user address).
      const totalApprove = instructions.reduce((sum, ix) => {
        if (ix.tokenIn && ix.tokenIn.toLowerCase() === tokenInAddr.toLowerCase()) {
          return sum + BigInt(ix.amountToApprove ?? '0')
        }
        return sum
      }, 0n)

      const humanTotal = (Number(totalApprove) / 10 ** inDecimals).toFixed(inDecimals)
      addStep(`Approve ${fromToken} → Adapter (${humanTotal})`)
      let approveHash: `0x${string}`
      try {
        approveHash = await writeContract({
          address:      tokenInAddr,
          abi:          ERC20_APPROVE_ABI,
          functionName: 'approve',
          args:         [ADAPTER_CONTRACT, totalApprove],
        })
        markLast('ok')
      } catch (approveErr) {
        markLast('err')
        throw new Error(`Approve failed: ${approveErr instanceof Error ? approveErr.message : String(approveErr)}`)
      }

      addStep('Waiting for approve confirmation…')
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: approveHash, confirmations: 1 })
      }
      markLast('ok')

      // ── Step 3: Call adapter.execute() — one atomic tx ───────────────────
      addStep('Calling Adapter execute() — swapping…')
      let lastHash: `0x${string}`
      try {
        lastHash = await writeContract({
          address:      ADAPTER_CONTRACT,
          abi:          ADAPTER_ABI,
          functionName: 'execute',
          args: [
            {
              instructions: instructions.map(ix => ({
                target:          ix.target,
                data:            ix.data,
                value:           ix.value && ix.value !== '0' && ix.value !== '0x0' ? BigInt(ix.value) : 0n,
                tokenIn:         (ix.tokenIn  ?? ZERO) as `0x${string}`,
                amountToApprove: BigInt(ix.amountToApprove ?? '0'),
                tokenOut:        (ix.tokenOut ?? ZERO) as `0x${string}`,
                minTokenOut:     BigInt(ix.minTokenOut ?? '0'),
              })),
              tokens: tokens.map(t => ({ token: t.token, beneficiary: t.beneficiary })),
              execId:   BigInt(execId),           // hex "0x..." → uint256
              deadline: BigInt(deadline),          // decimal string → uint256
              metadata: (metadata ?? '0x') as `0x${string}`,
            },
            [{
              permitType:     0,              // PermitType.NONE = pre-approved allowance
              token:          tokenInAddr,
              amount:         totalApprove,
              permitCalldata: '0x',
            }],
            (signature ?? '0x') as `0x${string}`,
          ],
          value: 0n,
        })
        markLast('ok')
        addStep(`✓ Swap tx: ${lastHash.slice(0, 14)}…`)
        markLast('ok')
      } catch (swapErr) {
        markLast('err')
        throw new Error(
          `adapter.execute() failed:\n${swapErr instanceof Error ? swapErr.message : String(swapErr)}`
        )
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
    <div className="w-full">
      <div className="p-6">

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

    </div>
  )
}
