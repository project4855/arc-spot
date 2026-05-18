import { useState, useCallback, useEffect } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { parseUnits, formatUnits, maxUint256 } from 'viem'
import {
  PERPS_ADDRESS,
  PERPS_ABI,
  TOKEN_ADDRESSES,
  ERC20_ABI,
} from '../config/contracts'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PerpMarket {
  coin:         string
  price:        number   // USD
  openInterest: number   // USD
  fundingRate:  number   // 8h bps
  active:       boolean
}

export interface PerpPosition {
  id:               bigint
  coin:             string
  isLong:           boolean
  sizeUsd:          number
  margin:           number
  entryPrice:       number
  leverage:         number
  isOpen:           boolean
  unrealisedPnl:    number
  liquidationPrice: number
  liquidatable:     boolean
  roe:              number   // return on equity %
}

export type TxStep = 'idle' | 'approving' | 'sending' | 'done' | 'error'

// ── Market data hook (no wallet needed) ──────────────────────────────────────

export function usePerpMarkets() {
  const { data: raw, refetch } = useReadContract({
    address:      PERPS_ADDRESS,
    abi:          PERPS_ABI,
    functionName: 'getAllMarkets',
    query:        { refetchInterval: 15_000 },
  })

  const markets: PerpMarket[] = raw
    ? (raw[0] as string[]).map((coin, i) => ({
        coin,
        price:        Number((raw[1] as bigint[])[i]) / 1e6,
        openInterest: Number((raw[2] as bigint[])[i]) / 1e6,
        fundingRate:  Number((raw[3] as bigint[])[i]),
        active:       true,
      }))
    : []

  return { markets, refetch }
}

// ── Single market price (fast) ────────────────────────────────────────────────

export function usePerpPrice(coin: string) {
  const { data } = useReadContract({
    address:      PERPS_ADDRESS,
    abi:          PERPS_ABI,
    functionName: 'getMarket',
    args:         [coin],
    query:        { refetchInterval: 10_000 },
  })
  return data ? Number((data as readonly [boolean, bigint, bigint, bigint, boolean, bigint])[1]) / 1e6 : 0
}

// ── User positions hook ───────────────────────────────────────────────────────

export function usePerpPositions() {
  const { address } = useAccount()
  const [positions, setPositions] = useState<PerpPosition[]>([])
  const [loading,   setLoading]   = useState(false)

  const { data: ids, refetch: refetchIds } = useReadContract({
    address:      PERPS_ADDRESS,
    abi:          PERPS_ABI,
    functionName: 'getUserPositions',
    args:         address ? [address] : undefined,
    query:        { enabled: !!address, refetchInterval: 15_000 },
  })

  // We need to call getPositionInfo for each id
  // Since wagmi doesn't support dynamic batching easily, use fetch directly
  const loadPositions = useCallback(async (posIds: bigint[]) => {
    if (posIds.length === 0) { setPositions([]); return }
    setLoading(true)
    try {
      // Batch read via multicall-like approach using wagmi public client
      const { createPublicClient, http } = await import('viem')
      const chain = {
        id:   5042002,
        name: 'Arc Testnet',
        nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
        rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
      }
      const client = createPublicClient({ chain, transport: http() })

      const results = await Promise.all(
        posIds.map(id =>
          client.readContract({
            address:      PERPS_ADDRESS,
            abi:          PERPS_ABI,
            functionName: 'getPositionInfo',
            args:         [id],
          })
        )
      )

      const parsed: PerpPosition[] = results.map((r, idx) => {
        const raw = r as readonly [string, string, boolean, bigint, bigint, bigint, bigint, boolean, bigint, bigint, boolean]
        const margin   = Number(raw[4]) / 1e6
        const upnl     = Number(raw[8]) / 1e6
        const roe      = margin > 0 ? (upnl / margin) * 100 : 0
        return {
          id:               posIds[idx],
          coin:             raw[1],
          isLong:           raw[2],
          sizeUsd:          Number(raw[3]) / 1e6,
          margin,
          entryPrice:       Number(raw[5]) / 1e6,
          leverage:         Number(raw[6]),
          isOpen:           raw[7],
          unrealisedPnl:    upnl,
          liquidationPrice: Number(raw[9]) / 1e6,
          liquidatable:     raw[10],
          roe,
        }
      }).filter(p => p.isOpen)

      setPositions(parsed)
    } catch (e) {
      console.error('usePerpPositions:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (ids) loadPositions([...(ids as bigint[])])
  }, [ids, loadPositions])

  const refetch = useCallback(() => {
    refetchIds()
    if (ids) loadPositions([...(ids as bigint[])])
  }, [ids, refetchIds, loadPositions])

  return { positions, loading, refetch }
}

// ── Trading hook ──────────────────────────────────────────────────────────────

export function usePerpTrade() {
  const { address, isConnected } = useAccount()
  const [txStep,  setTxStep]  = useState<TxStep>('idle')
  const [txHash,  setTxHash]  = useState<`0x${string}` | null>(null)
  const [txError, setTxError] = useState<string | null>(null)

  const { writeContractAsync } = useWriteContract()
  const { data: receipt } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  })

  useEffect(() => {
    if (receipt) setTxStep('done')
  }, [receipt])

  // ── Open position ──────────────────────────────────────────────────────────
  const openPosition = useCallback(async (
    coin:     string,
    isLong:   boolean,
    marginUSDC: string,   // e.g. "10.50"
    leverage: number,
  ) => {
    if (!isConnected || !address) return
    setTxStep('idle'); setTxError(null); setTxHash(null)

    const marginWei = parseUnits(marginUSDC, 6)

    try {
      // Step 1: approve USDC
      setTxStep('approving')
      const approveTx = await writeContractAsync({
        address:      TOKEN_ADDRESSES.USDC,
        abi:          ERC20_ABI,
        functionName: 'approve',
        args:         [PERPS_ADDRESS, maxUint256],
      })
      // wait for approve
      const { createPublicClient, http } = await import('viem')
      const client = createPublicClient({
        chain: { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } },
        transport: http(),
      })
      await client.waitForTransactionReceipt({ hash: approveTx })

      // Step 2: open position
      setTxStep('sending')
      const hash = await writeContractAsync({
        address:      PERPS_ADDRESS,
        abi:          PERPS_ABI,
        functionName: 'openPosition',
        args:         [coin, isLong, marginWei, BigInt(leverage)],
      })
      setTxHash(hash)

    } catch (e: unknown) {
      setTxStep('error')
      setTxError(e instanceof Error ? e.message.split('\n')[0] : 'Transaction failed')
    }
  }, [isConnected, address, writeContractAsync])

  // ── Close position ─────────────────────────────────────────────────────────
  const closePosition = useCallback(async (positionId: bigint) => {
    if (!isConnected) return
    setTxStep('sending'); setTxError(null); setTxHash(null)
    try {
      const hash = await writeContractAsync({
        address:      PERPS_ADDRESS,
        abi:          PERPS_ABI,
        functionName: 'closePosition',
        args:         [positionId],
      })
      setTxHash(hash)
    } catch (e: unknown) {
      setTxStep('error')
      setTxError(e instanceof Error ? e.message.split('\n')[0] : 'Transaction failed')
    }
  }, [isConnected, writeContractAsync])

  // ── Add margin ─────────────────────────────────────────────────────────────
  const addMargin = useCallback(async (positionId: bigint, amount: string) => {
    if (!isConnected || !address) return
    setTxStep('approving'); setTxError(null); setTxHash(null)
    try {
      const amountWei = parseUnits(amount, 6)
      const approveTx = await writeContractAsync({
        address:      TOKEN_ADDRESSES.USDC,
        abi:          ERC20_ABI,
        functionName: 'approve',
        args:         [PERPS_ADDRESS, maxUint256],
      })
      const { createPublicClient, http } = await import('viem')
      const client = createPublicClient({
        chain: { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } } },
        transport: http(),
      })
      await client.waitForTransactionReceipt({ hash: approveTx })

      setTxStep('sending')
      const hash = await writeContractAsync({
        address:      PERPS_ADDRESS,
        abi:          PERPS_ABI,
        functionName: 'addMargin',
        args:         [positionId, amountWei],
      })
      setTxHash(hash)
    } catch (e: unknown) {
      setTxStep('error')
      setTxError(e instanceof Error ? e.message.split('\n')[0] : 'Transaction failed')
    }
  }, [isConnected, address, writeContractAsync])

  const reset = useCallback(() => {
    setTxStep('idle'); setTxError(null); setTxHash(null)
  }, [])

  const usdcBalance = useReadContract({
    address:      TOKEN_ADDRESSES.USDC,
    abi:          ERC20_ABI,
    functionName: 'balanceOf',
    args:         address ? [address] : undefined,
    query:        { enabled: !!address, refetchInterval: 10_000 },
  })

  const balanceUSDC = usdcBalance.data
    ? parseFloat(formatUnits(usdcBalance.data as bigint, 6))
    : 0

  return {
    openPosition,
    closePosition,
    addMargin,
    reset,
    txStep,
    txHash,
    txError,
    setTxError,
    balanceUSDC,
    isConnected,
  }
}
