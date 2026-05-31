import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useBalance, useReadContract, usePublicClient } from 'wagmi'
import { formatUnits } from 'viem'

import TokenInput from './TokenInput'
import WalletGate from './WalletGate'
import { useWallet } from '../hooks/useWallet'
import { arcTestnet } from '../config/wagmi'
import { ARC_SWAP_ADDRESS, ARC_SWAP_ABI } from '../config/contracts'

const TOKENS = [
  { symbol: 'USDC',   name: 'USD Coin',              icon: '💵', decimals: 6 },
  { symbol: 'EURC',   name: 'Euro Coin',             icon: '💶', decimals: 6 },
  { symbol: 'QCAD',   name: 'Canadian Dollar (QCAD)', icon: '🍁', decimals: 6 },
  { symbol: 'cirBTC', name: 'Circle Bitcoin',         icon: '₿',  decimals: 8 },
  { symbol: 'ARC',    name: 'Arc Test Token',         icon: '🔵', decimals: 6 },
  { symbol: 'ETH',    name: 'Ethereum',               icon: 'Ξ',  decimals: 18 },
  { symbol: 'SOL',    name: 'Solana',                 icon: '◎',  decimals: 9 },
]

// Fallback display rates — updated 2026-05-27
// BTC $78,200 · ETH $2,293 · SOL $90.5 · EURC $1.1639 · ARC $0.10 · CAD/USD 0.73
const DISPLAY_RATES: Record<string, Record<string, number>> = {
  USDC:   { EURC: 0.8592, QCAD: 1.37,   cirBTC: 0.00001279, ARC: 10,       ETH: 0.000436,   SOL: 0.01105 },
  EURC:   { USDC: 1.1639, QCAD: 1.48,   cirBTC: 0.00001489, ARC: 11.639,   ETH: 0.000508,   SOL: 0.01287 },
  QCAD:   { USDC: 0.73,   EURC: 0.6757, cirBTC: 0.00000934, ARC: 7.3,      ETH: 0.000318,   SOL: 0.00806 },
  cirBTC: { USDC: 78200,  EURC: 67183,  QCAD: 107134,       ARC: 782000,   ETH: 34.12,      SOL: 864.4 },
  ARC:    { USDC: 0.10,   EURC: 0.08592, QCAD: 0.137,       cirBTC: 0.00000128, ETH: 0.0000436, SOL: 0.001105 },
  ETH:    { USDC: 2293,   EURC: 1970,   QCAD: 3141,         cirBTC: 0.02931, ARC: 22930,     SOL: 25.34 },
  SOL:    { USDC: 90.5,   EURC: 77.75,  QCAD: 124,          cirBTC: 0.001157, ARC: 905,      ETH: 0.03947 },
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
  route?: 'arcswap' | 'circle'
}

const HISTORY_KEY = 'arc_swap_history'
const MAX_HISTORY = 50

function loadHistory(): SwapRecord[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as SwapRecord[]
  } catch { return [] }
}
function saveHistory(recs: SwapRecord[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(recs.slice(0, MAX_HISTORY)))
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
    setDexOrderId(undefined)
    setError(null)
  }, [fromTokenProp, toTokenProp])
  const [fromAmount, setFromAmount] = useState('')
  const [isSwapping, setIsSwapping] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [dexOrderId, setDexOrderId] = useState<bigint | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [steps, setSteps] = useState<{ msg: string; status: 'pending' | 'ok' | 'err' }[]>([])
  const [showSteps, setShowSteps] = useState(false)
  const [history, setHistory] = useState<SwapRecord[]>(loadHistory)
  const [showHistory, setShowHistory] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)

  const { data: balance, refetch: refetchUSDC } = useBalance({
    address,
    chainId: arcTestnet.id,
    query: { refetchInterval: 8_000 },
  })

  const EURC_ADDRESS   = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const
  const CIRBTC_ADDRESS = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' as const
  const ARC_ADDR       = '0x55e1a127e33C4Ccca470Ea9eE8F15683DEf2dCc1' as const
  const QCAD_ADDR      = '0xf546Bc238F0893eD08586c892f3a111cBFf0d19a' as const
  const ERC20_BALANCE_ABI = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as const

  const { data: eurcRaw, refetch: refetchEURC } = useReadContract({
    address:      EURC_ADDRESS,
    abi:          ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args:         [address ?? ZERO_ADDR],
    chainId:      arcTestnet.id,
    query:        { enabled: !!address, refetchInterval: 8_000 },
  })

  const { data: cirBtcRaw, refetch: refetchCirBtc } = useReadContract({
    address:      CIRBTC_ADDRESS,
    abi:          ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args:         [address ?? ZERO_ADDR],
    chainId:      arcTestnet.id,
    query:        { enabled: !!address, refetchInterval: 8_000 },
  })

  const { data: arcRaw, refetch: refetchArc } = useReadContract({
    address:      ARC_ADDR,
    abi:          ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args:         [address ?? ZERO_ADDR],
    chainId:      arcTestnet.id,
    query:        { enabled: !!address, refetchInterval: 8_000 },
  })

  const { data: qcadRaw, refetch: refetchQcad } = useReadContract({
    address:      QCAD_ADDR,
    abi:          ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args:         [address ?? ZERO_ADDR],
    chainId:      arcTestnet.id,
    query:        { enabled: !!address, refetchInterval: 8_000 },
  })

  // helper: format balance string for any token
  const getBalanceStr = (token: string): string | undefined => {
    if (!address) return undefined
    if (token === 'USDC' && balance)
      return `${parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)} USDC`
    if (token === 'EURC')
      return `${parseFloat(formatUnits((eurcRaw as bigint) ?? 0n, 6)).toFixed(4)} EURC`
    if (token === 'cirBTC')
      return `${parseFloat(formatUnits((cirBtcRaw as bigint) ?? 0n, 8)).toFixed(8)} cirBTC`
    if (token === 'ARC')
      return `${parseFloat(formatUnits((arcRaw as bigint) ?? 0n, 6)).toFixed(4)} ARC`
    if (token === 'QCAD')
      return `${parseFloat(formatUnits((qcadRaw as bigint) ?? 0n, 6)).toFixed(4)} QCAD`
    return undefined
  }

  // ArcDEX handles any swap NOT between USDC and EURC
  const CIRCLE_PAIRS = new Set(['USDC', 'EURC'])
  const isDexRoute = !CIRCLE_PAIRS.has(fromToken) || !CIRCLE_PAIRS.has(toToken)

  // ── Live ArcSwap liquidity for output token (only for DEX route) ────────────
  const LIQUIDITY_ABI = useMemo(() => [{
    name: 'liquidity', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  }] as const, [])
  const toTokenAddr = useMemo(() => {
    const map: Record<string, `0x${string}`> = {
      USDC: '0x3600000000000000000000000000000000000000',
      EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
      cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
      ARC: '0x55e1a127e33C4Ccca470Ea9eE8F15683DEf2dCc1',
      QCAD: '0xf546Bc238F0893eD08586c892f3a111cBFf0d19a',
    }
    return map[toToken] ?? '0x0000000000000000000000000000000000000000' as `0x${string}`
  }, [toToken])
  const { data: arcswapLiqRaw } = useReadContract({
    address: ARC_SWAP_ADDRESS,
    abi: LIQUIDITY_ABI,
    functionName: 'liquidity',
    args: [toTokenAddr],
    chainId: arcTestnet.id,
    query: { enabled: isDexRoute, refetchInterval: 15_000 },
  })
  const arcswapLiq = arcswapLiqRaw != null
    ? parseFloat(formatUnits(arcswapLiqRaw as bigint, toToken === 'cirBTC' ? 8 : 6))
    : null

  const toAmountDec = toToken === 'cirBTC' ? 8 : 6
  const toAmount = fromAmount
    ? (parseFloat(fromAmount) * getRate(fromToken, toToken)).toFixed(toAmountDec)
    : ''

  const exceedsLiquidity = isDexRoute && arcswapLiq != null && fromAmount
    ? parseFloat(toAmount || '0') > arcswapLiq
    : false

  const handleFlip = useCallback(() => {
    setFromToken(toToken)
    setToToken(fromToken)
    setFromAmount(toAmount)
    setTxHash(null)
    setDexOrderId(undefined)
    setError(null)
  }, [fromToken, toToken, toAmount])

  const handleFromTokenChange = (token: string) => {
    if (token === toToken) setToToken(fromToken)
    setFromToken(token)
    setTxHash(null)
    setDexOrderId(undefined)
    setError(null)
  }

  const handleToTokenChange = (token: string) => {
    if (token === fromToken) setFromToken(toToken)
    setToToken(token)
    setTxHash(null)
    setDexOrderId(undefined)
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

    const buildRecord = (hash: string, route: 'arcswap' | 'circle' = 'circle'): SwapRecord => {
      const now = new Date()
      const fa = parseFloat(fromAmount)
      const r = getRate(fromToken, toToken)
      const outDec = toToken === 'cirBTC' ? 8 : (fromToken === 'cirBTC' ? 6 : 6)
      return {
        id: Date.now().toString(),
        time: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`,
        type: 'buy',
        fromToken,
        toToken,
        fromAmount: fa,
        toAmount: parseFloat((fa * r).toFixed(outDec)),
        price: r,
        wallet: address ? `${address.slice(0,6)}...${address.slice(-4)}` : '0x????',
        txHash: hash,
        status: 'confirmed',
        route,
      }
    }

    const pushHistory = (rec: SwapRecord) => {
      setHistory(prev => {
        const next = [rec, ...prev].slice(0, MAX_HISTORY)
        saveHistory(next)
        return next
      })
      setShowHistory(true)
    }

    try {
      if (!address) throw new Error('No wallet connected.')

      // ── Token addresses on Arc Testnet ────────────────────────────────────
      const TOKEN_ADDR: Record<string, `0x${string}`> = {
        USDC:   '0x3600000000000000000000000000000000000000',
        EURC:   '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
        cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
        ARC:    '0x55e1a127e33C4Ccca470Ea9eE8F15683DEf2dCc1',
        QCAD:   '0xf546Bc238F0893eD08586c892f3a111cBFf0d19a',
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

      // ── ArcSwap route: instant swap for any non-Circle pair ──────────────
      if (isDexRoute) {
        const getDecimals = (t: string) => t === 'cirBTC' ? 8 : 6
        const fromDec = getDecimals(fromToken)
        const sellAmt = BigInt(Math.round(parseFloat(fromAmount) * 10 ** fromDec))

        // Pre-check: verify rate AND liquidity before wasting gas on approve
        addStep(`🔍 Checking ArcSwap liquidity…`)
        try {
          const PREVIEW_ABI = [
            { name: 'getAmountOut', type: 'function', stateMutability: 'view',
              inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }],
              outputs: [{ name: '', type: 'uint256' }] },
            { name: 'liquidity', type: 'function', stateMutability: 'view',
              inputs: [{ name: 'token', type: 'address' }],
              outputs: [{ name: '', type: 'uint256' }] },
          ] as const
          if (publicClient) {
            const [preview, liq] = await Promise.all([
              publicClient.readContract({ address: ARC_SWAP_ADDRESS, abi: PREVIEW_ABI, functionName: 'getAmountOut', args: [tokenInAddr, tokenOutAddr, sellAmt] }) as Promise<bigint>,
              publicClient.readContract({ address: ARC_SWAP_ADDRESS, abi: PREVIEW_ABI, functionName: 'liquidity', args: [tokenOutAddr] }) as Promise<bigint>,
            ])
            if (preview === 0n) {
              markLast('err')
              throw new Error(`ArcSwap: rate chưa set cho ${fromToken}→${toToken}.\nChạy: npx hardhat run scripts/fund-swap.ts --network arc_testnet`)
            }
            if (liq < preview) {
              markLast('err')
              throw new Error(
                `ArcSwap: không đủ ${toToken} liquidity (cần ${preview}, có ${liq}).\n` +
                `Nạp thêm ${toToken} vào ArcSwap: npx hardhat run scripts/fund-swap.ts --network arc_testnet`
              )
            }
          }
          markLast('ok')
        } catch (previewErr) {
          if (previewErr instanceof Error && previewErr.message.startsWith('ArcSwap:')) {
            markLast('err'); throw previewErr
          }
          markLast('ok') // network hiccup — let the tx try anyway
        }

        // Step 1: Approve tokenIn to ArcSwap
        addStep(`🔓 Approving ${fromToken} → ArcSwap…`)
        let approveHash: `0x${string}`
        try {
          approveHash = await writeContract({
            address:      tokenInAddr,
            abi:          ERC20_APPROVE_ABI,
            functionName: 'approve',
            args:         [ARC_SWAP_ADDRESS, sellAmt],
          })
          markLast('ok')
        } catch (e) {
          markLast('err')
          throw new Error(`Approve failed: ${e instanceof Error ? e.message : String(e)}`)
        }

        addStep('⏳ Confirming approve…')
        if (publicClient) {
          const appRcpt = await publicClient.waitForTransactionReceipt({ hash: approveHash, confirmations: 1 })
          if (appRcpt.status === 'reverted') {
            markLast('err')
            throw new Error(`Approve tx reverted — tx: ${approveHash}`)
          }
        }
        markLast('ok')

        // Step 2: swap() — instant, no order book
        addStep(`⚡ Swapping ${fromAmount} ${fromToken} → ${toToken}…`)
        let swapHash: `0x${string}`
        try {
          swapHash = await writeContract({
            address:      ARC_SWAP_ADDRESS,
            abi:          ARC_SWAP_ABI,
            functionName: 'swap',
            args:         [tokenInAddr, tokenOutAddr, sellAmt],
          })
          markLast('ok')
        } catch (e) {
          markLast('err')
          throw new Error(`Swap failed: ${e instanceof Error ? e.message : String(e)}`)
        }

        addStep('⏳ Confirming swap…')
        let actualAmountOut = ''
        if (publicClient) {
          const swapRcpt = await publicClient.waitForTransactionReceipt({ hash: swapHash, confirmations: 1 })
          if (swapRcpt.status === 'reverted') {
            markLast('err')
            throw new Error(
              `Swap tx reverted — tx: ${swapHash}\n` +
              `Có thể ArcSwap chưa đủ liquidity hoặc rate chưa set.`
            )
          }
          // Read actual ARC balance directly (bypass wagmi cache)
          const toDec   = toToken === 'cirBTC' ? 8 : 6
          const balRaw = await publicClient.readContract({
            address:      tokenOutAddr,
            abi:          ERC20_BALANCE_ABI,
            functionName: 'balanceOf',
            args:         [address as `0x${string}`],
          }) as bigint
          actualAmountOut = `${parseFloat(formatUnits(balRaw, toDec)).toFixed(toDec === 8 ? 8 : 4)}`
        }
        markLast('ok')
        addStep(`✓ Swap xong! Số dư ${toToken}: ${actualAmountOut || toAmount}`)
        markLast('ok')

        setTxHash(swapHash)
        setDexOrderId(undefined)
        const rec = buildRecord(swapHash, 'arcswap')
        onSwapComplete?.(rec)
        pushHistory(rec)
        // Force refetch multiple times to bypass wagmi cache
        void refetchArc(); void refetchUSDC(); void refetchQcad()
        setTimeout(() => { void refetchArc(); void refetchUSDC(); void refetchEURC(); void refetchCirBtc(); void refetchQcad() }, 1500)
        setTimeout(() => { void refetchArc(); void refetchUSDC(); void refetchEURC(); void refetchCirBtc(); void refetchQcad() }, 4000)
        setTimeout(() => { void refetchArc(); void refetchUSDC(); void refetchEURC(); void refetchCirBtc(); void refetchQcad() }, 8000)
        return // done — skip Circle flow below
      }

      // ── Circle Stablecoin Kit: USDC ↔ EURC only ───────────────────────────
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
          // Strip KIT_KEY: prefix if present — Circle Bearer token uses only id:secret
          const localKey = VITE_KIT_KEY.startsWith('KIT_KEY:') ? VITE_KIT_KEY.slice('KIT_KEY:'.length) : VITE_KIT_KEY
          resp = await fetch('https://api.circle.com/v1/stablecoinKits/swap', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${localKey}`, 'Content-Type': 'application/json' },
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
      const circleRec = buildRecord(lastHash, 'circle')
      onSwapComplete?.(circleRec)
      pushHistory(circleRec)
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
            <span className="text-slate-500">Route</span>
            {isDexRoute ? (
              <span className="px-1.5 py-0.5 bg-violet-100 border border-violet-200 text-violet-700 text-xs font-semibold rounded-md">
                ⚡ Via ArcSwap
              </span>
            ) : (
              <span className="px-1.5 py-0.5 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-semibold rounded-md">
                ○ Circle Swap Kit
              </span>
            )}
          </div>
          {/* Live liquidity display for ArcSwap pairs */}
          {isDexRoute && arcswapLiq !== null && (
            <div className={`flex items-center justify-between text-sm mt-1 ${exceedsLiquidity ? 'text-red-500' : ''}`}>
              <span className={exceedsLiquidity ? 'text-red-500' : 'text-slate-500'}>Pool {toToken}</span>
              <span className={`font-mono text-xs ${exceedsLiquidity ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                {exceedsLiquidity ? '⚠️ ' : ''}{arcswapLiq.toFixed(toToken === 'cirBTC' ? 8 : 4)} {toToken}
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
            <>
              <button
                onClick={handleSwap}
                disabled={isSwapping || !fromAmount || parseFloat(fromAmount) <= 0 || exceedsLiquidity}
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
                ) : exceedsLiquidity ? (
                  `⚠️ Vượt quá liquidity pool`
                ) : (
                  `Swap ${fromToken} → ${toToken}`
                )}
              </button>
              {exceedsLiquidity && arcswapLiq !== null && (
                <p className="text-xs text-red-500 text-center mt-1">
                  Pool chỉ có {arcswapLiq.toFixed(toToken === 'cirBTC' ? 8 : 4)} {toToken} —
                  giảm số lượng swap xuống.
                </p>
              )}
            </>
          )}
        </div>

        {/* Success */}
        {txHash && txHash !== 'demo' && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
            <p className="text-emerald-600 text-sm font-medium text-center">
              {dexOrderId !== undefined
                ? `✓ ArcDEX Order #${dexOrderId.toString()} placed!`
                : '✓ Swap successful!'}
            </p>
            {dexOrderId !== undefined && (
              <p className="text-emerald-600/70 text-xs text-center mt-0.5">
                Token đã về ví ngay lập tức
              </p>
            )}
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

        {/* ── Swap History ───────────────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="mt-4" ref={historyRef}>
            <button
              onClick={() => setShowHistory(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl hover:border-violet-300 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-600">
                📋 Lịch sử swap ({history.length})
              </span>
              <span className="text-slate-400 text-xs">{showHistory ? '▲' : '▼'}</span>
            </button>

            {showHistory && (
              <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden">
                {/* Header */}
                <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 px-3 py-1.5 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <span>Thời gian</span>
                  <span className="text-center">Cặp</span>
                  <span className="text-right">Số lượng</span>
                  <span className="text-right">Tx</span>
                </div>

                {/* Rows */}
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                  {history.map((rec) => (
                    <div
                      key={rec.id}
                      className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 items-center px-3 py-2 hover:bg-slate-50 transition-colors group text-xs"
                    >
                      {/* Time + route */}
                      <div>
                        <p className="font-mono text-slate-500">{rec.time}</p>
                        <p className={`text-[10px] font-semibold mt-0.5 ${
                          rec.route === 'arcswap' ? 'text-violet-500' : 'text-blue-500'
                        }`}>
                          {rec.route === 'arcswap' ? '⚡ ArcSwap' : '○ Circle'}
                        </p>
                      </div>

                      {/* Pair */}
                      <div className="text-center">
                        <span className="font-bold text-slate-700">
                          {rec.fromToken}
                        </span>
                        <span className="text-slate-400 mx-1">→</span>
                        <span className="font-bold text-slate-700">
                          {rec.toToken}
                        </span>
                      </div>

                      {/* Amounts */}
                      <div className="text-right">
                        <p className="font-mono text-slate-700">
                          {rec.fromAmount.toFixed(rec.fromToken === 'cirBTC' ? 8 : 4)} {rec.fromToken}
                        </p>
                        <p className="font-mono text-emerald-600 text-[10px]">
                          ≈ {rec.toAmount.toFixed(rec.toToken === 'cirBTC' ? 8 : 4)} {rec.toToken}
                        </p>
                      </div>

                      {/* ArcScan link */}
                      <div className="text-right">
                        {rec.txHash && rec.txHash !== 'demo' ? (
                          <a
                            href={`https://testnet.arcscan.app/tx/${rec.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Xem trên ArcScan"
                            className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-slate-100 hover:bg-violet-100 text-slate-400 hover:text-violet-600 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            ↗
                          </a>
                        ) : (
                          <span className="text-[10px] text-amber-500">demo</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-t border-slate-100">
                  <span className="text-[10px] text-slate-400">Lưu trên máy · tối đa {MAX_HISTORY} lệnh</span>
                  <button
                    onClick={() => { setHistory([]); saveHistory([]) }}
                    className="text-[10px] text-slate-400 hover:text-red-500 transition-colors"
                  >
                    Xoá lịch sử
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
