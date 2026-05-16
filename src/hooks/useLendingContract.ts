import { useState, useCallback } from 'react'
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { parseUnits, formatUnits, maxUint256 } from 'viem'
import {
  LENDING_ADDRESS,
  LENDING_ABI,
  ERC20_ABI,
  TOKEN_ADDRESSES,
  TOKEN_DECIMALS,
} from '../config/contracts'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PoolAsset {
  symbol:         string
  address:        `0x${string}`
  decimals:       number
  icon:           string
  supplyAPY:      number   // e.g. 5.20
  borrowAPY:      number
  totalSupplied:  number   // in token units
  totalBorrowed:  number
  utilizationPct: number   // 0–100
  priceUSD:       number   // e.g. 1.00
  // user's position
  userSupplied:   number   // in token units
  userBorrowed:   number
  userSuppliedUSD: number
  userBorrowedUSD: number
}

const ASSET_META: Record<string, { icon: string }> = {
  USDC: { icon: '💵' },
  EURC: { icon: '💶' },
}

const SYMBOLS = Object.keys(TOKEN_ADDRESSES) // ['USDC', 'EURC']

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLendingContract() {
  const { address: userAddress, isConnected } = useAccount()
  const isDeployed = LENDING_ADDRESS.length > 2

  // ── Read pool data ──────────────────────────────────────────────────────────
  const poolCalls = SYMBOLS.flatMap((sym) => [
    {
      address: LENDING_ADDRESS,
      abi:     LENDING_ABI,
      functionName: 'getPoolInfo' as const,
      args:    [TOKEN_ADDRESSES[sym]] as [`0x${string}`],
    },
  ])

  const userPositionCalls = userAddress
    ? SYMBOLS.flatMap((sym) => [
        {
          address: LENDING_ADDRESS,
          abi:     LENDING_ABI,
          functionName: 'getUserPosition' as const,
          args:    [userAddress, TOKEN_ADDRESSES[sym]] as [`0x${string}`, `0x${string}`],
        },
      ])
    : []

  const healthCall = userAddress
    ? [{
        address: LENDING_ADDRESS,
        abi:     LENDING_ABI,
        functionName: 'getHealthFactor' as const,
        args:    [userAddress] as [`0x${string}`],
      }]
    : []

  const { data: poolData, refetch: refetchPool } = useReadContracts({
    contracts: poolCalls,
    query: { enabled: isDeployed, refetchInterval: 10_000 },
  })

  const { data: positionData, refetch: refetchPositions } = useReadContracts({
    contracts: userPositionCalls,
    query: { enabled: isDeployed && !!userAddress, refetchInterval: 10_000 },
  })

  const { data: healthData, refetch: refetchHealth } = useReadContracts({
    contracts: healthCall,
    query: { enabled: isDeployed && !!userAddress, refetchInterval: 10_000 },
  })

  // ── Combine data into PoolAsset[] ───────────────────────────────────────────
  const assets: PoolAsset[] = SYMBOLS.map((sym, i) => {
    const pool = poolData?.[i]?.result as
      | [bigint, bigint, bigint, bigint, bigint, bigint]
      | undefined

    const pos = positionData?.[i]?.result as
      | [bigint, bigint, bigint, bigint]
      | undefined

    const dec = TOKEN_DECIMALS[sym]

    const totalSupplied  = pool ? parseFloat(formatUnits(pool[0], dec)) : 0
    const totalBorrowed  = pool ? parseFloat(formatUnits(pool[1], dec)) : 0
    const utilizationPct = pool ? Number(pool[2]) / 100 : 0
    const supplyAPY      = pool ? Number(pool[3]) / 100 : 0
    const borrowAPY      = pool ? Number(pool[4]) / 100 : 0
    const priceUSD       = pool ? Number(pool[5]) / 1e6 : 1

    const userSupplied    = pos ? parseFloat(formatUnits(pos[0], dec)) : 0
    const userBorrowed    = pos ? parseFloat(formatUnits(pos[1], dec)) : 0
    const userSuppliedUSD = pos ? Number(pos[2]) / 1e6 : 0
    const userBorrowedUSD = pos ? Number(pos[3]) / 1e6 : 0

    return {
      symbol:         sym,
      address:        TOKEN_ADDRESSES[sym],
      decimals:       dec,
      icon:           ASSET_META[sym]?.icon ?? '🪙',
      supplyAPY,
      borrowAPY,
      totalSupplied,
      totalBorrowed,
      utilizationPct,
      priceUSD,
      userSupplied,
      userBorrowed,
      userSuppliedUSD,
      userBorrowedUSD,
    }
  })

  // ── Health factor ───────────────────────────────────────────────────────────
  const rawHealth = healthData?.[0]?.result as bigint | undefined
  const healthFactor: number = rawHealth === undefined
    ? Infinity
    : rawHealth === maxUint256
      ? Infinity
      : parseFloat(formatUnits(rawHealth, 18))

  // ── Summary ─────────────────────────────────────────────────────────────────
  const totalSuppliedUSD = assets.reduce((s, a) => s + a.userSuppliedUSD, 0)
  const totalBorrowedUSD = assets.reduce((s, a) => s + a.userBorrowedUSD, 0)
  const netAPY = totalSuppliedUSD > 0
    ? assets.reduce((s, a) => {
        const income = a.userSuppliedUSD * (a.supplyAPY / 100)
        const cost   = a.userBorrowedUSD * (a.borrowAPY / 100)
        return s + income - cost
      }, 0) / totalSuppliedUSD * 100
    : 0

  // ── Allowance reads ─────────────────────────────────────────────────────────
  const { data: allowanceUSDC } = useReadContract({
    address:      TOKEN_ADDRESSES.USDC,
    abi:          ERC20_ABI,
    functionName: 'allowance',
    args:         userAddress ? [userAddress, LENDING_ADDRESS] : undefined,
    query:        { enabled: isDeployed && !!userAddress, refetchInterval: 8_000 },
  })

  const { data: allowanceEURC } = useReadContract({
    address:      TOKEN_ADDRESSES.EURC,
    abi:          ERC20_ABI,
    functionName: 'allowance',
    args:         userAddress ? [userAddress, LENDING_ADDRESS] : undefined,
    query:        { enabled: isDeployed && !!userAddress, refetchInterval: 8_000 },
  })

  const allowances: Record<string, bigint> = {
    USDC: (allowanceUSDC as bigint | undefined) ?? 0n,
    EURC: (allowanceEURC as bigint | undefined) ?? 0n,
  }

  // ── Write ────────────────────────────────────────────────────────────────────
  const { writeContractAsync } = useWriteContract()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [txError, setTxError] = useState<string | null>(null)
  const [txStep, setTxStep] = useState<'idle' | 'approving' | 'sending' | 'done'>('idle')

  const { isLoading: isTxPending } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  })

  const refetchAll = useCallback(() => {
    refetchPool()
    refetchPositions()
    refetchHealth()
  }, [refetchPool, refetchPositions, refetchHealth])

  /**
   * Execute supply or repay (requires ERC-20 approval first)
   */
  const executeWithApprove = useCallback(async (
    action:  'supply' | 'repay',
    symbol:  string,
    amount:  string,
  ) => {
    if (!isConnected || !userAddress) return
    setTxError(null)
    setTxHash(undefined)
    setTxStep('idle')

    try {
      const dec       = TOKEN_DECIMALS[symbol]
      const tokenAddr = TOKEN_ADDRESSES[symbol]
      const amountBN  = parseUnits(amount, dec)
      const current   = allowances[symbol] ?? 0n

      // Step 1: approve if needed
      if (current < amountBN) {
        setTxStep('approving')
        const approveHash = await writeContractAsync({
          address:      tokenAddr,
          abi:          ERC20_ABI,
          functionName: 'approve',
          args:         [LENDING_ADDRESS, maxUint256],
        })
        setTxHash(approveHash)
        // Wait for approval confirmation before continuing
        await waitForTx(approveHash)
      }

      // Step 2: execute action
      setTxStep('sending')
      const hash = await writeContractAsync({
        address:      LENDING_ADDRESS,
        abi:          LENDING_ABI,
        functionName: action,
        args:         [tokenAddr, amountBN],
      })
      setTxHash(hash)
      await waitForTx(hash)
      setTxStep('done')
      setTimeout(() => { setTxStep('idle'); setTxHash(undefined); refetchAll() }, 2000)

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      setTxError(msg.includes('User rejected') ? 'Transaction rejected' : msg.slice(0, 120))
      setTxStep('idle')
    }
  }, [isConnected, userAddress, allowances, writeContractAsync, refetchAll])

  /**
   * Execute withdraw or borrow (no approval needed)
   */
  const executeDirectly = useCallback(async (
    action:  'withdraw' | 'borrow',
    symbol:  string,
    amount:  string,
  ) => {
    if (!isConnected || !userAddress) return
    setTxError(null)
    setTxHash(undefined)
    setTxStep('sending')

    try {
      const dec       = TOKEN_DECIMALS[symbol]
      const tokenAddr = TOKEN_ADDRESSES[symbol]
      const amountBN  = parseUnits(amount, dec)

      const hash = await writeContractAsync({
        address:      LENDING_ADDRESS,
        abi:          LENDING_ABI,
        functionName: action,
        args:         [tokenAddr, amountBN],
      })
      setTxHash(hash)
      await waitForTx(hash)
      setTxStep('done')
      setTimeout(() => { setTxStep('idle'); setTxHash(undefined); refetchAll() }, 2000)

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      setTxError(msg.includes('User rejected') ? 'Transaction rejected' : msg.slice(0, 120))
      setTxStep('idle')
    }
  }, [isConnected, userAddress, writeContractAsync, refetchAll])

  return {
    isDeployed,
    assets,
    healthFactor,
    totalSuppliedUSD,
    totalBorrowedUSD,
    netAPY,
    txHash,
    txError,
    txStep,
    isTxPending,
    executeWithApprove,
    executeDirectly,
    setTxError,
  }
}

// ── Helper: poll for receipt ──────────────────────────────────────────────────
async function waitForTx(hash: `0x${string}`, maxWait = 60_000) {
  const { createPublicClient, http } = await import('viem')
  const { arcTestnet } = await import('./useMarketData') // reuse chain def
    .then(() => import('../config/wagmi'))

  const client = createPublicClient({
    chain:     arcTestnet,
    transport: http(),
  })

  const deadline = Date.now() + maxWait
  while (Date.now() < deadline) {
    const receipt = await client.getTransactionReceipt({ hash }).catch(() => null)
    if (receipt) return receipt
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error('Transaction timeout')
}
