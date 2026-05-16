import { useState, useCallback, useEffect } from 'react'
import { useAccount, useBalance } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { formatUnits } from 'viem'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import TokenInput from './TokenInput'
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

const KIT_KEY = import.meta.env.VITE_CIRCLE_KIT_KEY as string | undefined
const isRealMode = !!KIT_KEY

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
  const { address, isConnected, chainId } = useAccount()
  const isArc = chainId === arcTestnet.id

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

  const { data: balance } = useBalance({ address, chainId: arcTestnet.id })

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
      if (isRealMode) {
        // ── Real on-chain swap via Circle App Kit ──
        const provider = (window as unknown as { ethereum: Parameters<typeof createViemAdapterFromProvider>[0]['provider'] }).ethereum
        if (!provider) throw new Error('No wallet found. Please install MetaMask.')

        const adapter = await createViemAdapterFromProvider({ provider })
        const kit = new AppKit()

        const result = await kit.swap({
          from: { adapter, chain: 'Arc_Testnet' },
          tokenIn: fromToken,
          tokenOut: toToken,
          amountIn: fromAmount,
          config: { kitKey: KIT_KEY! },
        })

        // result contains transaction details
        const hash = (result as unknown as { txHash?: string })?.txHash ?? JSON.stringify(result)
        setTxHash(hash)
        onSwapComplete?.(buildRecord(hash))
      } else {
        // ── Demo simulation (no Circle Kit Key set) ──
        await new Promise((r) => setTimeout(r, 1500))
        const demoHash = '0x' + Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10)
        setTxHash('demo')
        onSwapComplete?.(buildRecord(demoHash))
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Swap failed. Please try again.'
      setError(msg)
    } finally {
      setIsSwapping(false)
    }
  }

  const rate = getRate(fromToken, toToken)
  const fromTokens = TOKENS
  const toTokens = TOKENS.filter((t) => t.symbol !== fromToken)

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-[#0d0e12] border border-gray-800 rounded-3xl p-6 shadow-2xl glow-purple">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-white font-bold text-xl">Swap</h2>
            <p className="text-gray-500 text-sm mt-0.5">Arc Testnet · Circle App Kit</p>
          </div>
          {/* Mode badge */}
          <div className={`px-2 py-1 rounded-lg text-xs font-medium ${
            isRealMode
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400'
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
          balance={
            fromToken === 'USDC' && balance
              ? `${parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)} USDC`
              : undefined
          }
        />

        {/* Flip button */}
        <div className="flex justify-center my-2">
          <button
            onClick={handleFlip}
            className="w-10 h-10 rounded-xl bg-[#1a1d24] border border-gray-700 hover:border-violet-500 hover:bg-violet-500/10 flex items-center justify-center text-gray-400 hover:text-violet-400 transition-all duration-200 text-lg"
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
        />

        {/* Rate info — always visible */}
        <div className="mt-3 px-4 py-3 bg-[#111318] rounded-xl border border-gray-800">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Rate</span>
            <span className="text-gray-300 font-mono">
              1 {fromToken} ≈ {rate.toLocaleString(undefined, { maximumSignificantDigits: 6 })} {toToken}
            </span>
          </div>
          {fromAmount && parseFloat(fromAmount) > 0 && (
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-gray-500">You receive</span>
              <span className="text-green-400 font-mono font-semibold">
                ≈ {toAmount} {toToken}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-gray-500">Gas</span>
            <span className="text-green-400 text-xs">~0.001 USDC</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-gray-500">Network</span>
            <span className="text-violet-400 text-xs">Arc Testnet</span>
          </div>
        </div>

        {/* Swap button */}
        <div className="mt-4">
          {!isConnected ? (
            <div className="flex justify-center">
              <ConnectButton label="Connect Wallet to Swap" />
            </div>
          ) : !isArc ? (
            <button
              disabled
              className="w-full py-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 font-semibold text-sm cursor-not-allowed"
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
          <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
            <p className="text-green-400 text-sm font-medium text-center">✓ Swap successful!</p>
            <a
              href={`https://testnet.arcscan.app/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="block text-center text-xs text-green-400/70 hover:text-green-400 mt-1 underline underline-offset-2 truncate"
            >
              View on ArcScan →
            </a>
          </div>
        )}

        {txHash === 'demo' && (
          <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
            <p className="text-yellow-400 text-sm font-medium text-center">🔸 Demo swap completed</p>
            <p className="text-yellow-500/60 text-xs text-center mt-1">
              Add <code className="bg-black/30 px-1 rounded">VITE_CIRCLE_KIT_KEY</code> to enable real swaps
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm text-center">{error}</p>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-gray-600 mt-4">
        Powered by{' '}
        <a href="https://docs.arc.io/app-kit" target="_blank" rel="noreferrer" className="text-violet-500 hover:text-violet-400">
          Circle App Kit
        </a>{' '}
        on Arc Testnet
      </p>
    </div>
  )
}
