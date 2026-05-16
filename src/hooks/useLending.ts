import { useState, useEffect } from 'react'

export interface LendingAsset {
  symbol: string
  name: string
  icon: string
  price: number
  supplyAPY: number
  borrowAPY: number
  totalSupplied: number   // USD
  totalBorrowed: number   // USD
  utilization: number     // 0-1
  collateralFactor: number // 0-1
}

export interface UserSupply {
  symbol: string
  amount: number
  valueUSD: number
}

export interface UserBorrow {
  symbol: string
  amount: number
  valueUSD: number
}

// Prices updated 2026-05-17: ETH $2,293 · SOL $90.5 · BTC $78,200 · EURC $1.1639
const BASE_ASSETS: LendingAsset[] = [
  { symbol: 'USDC',   name: 'USD Coin',      icon: '💵', price: 1,       supplyAPY: 5.20, borrowAPY: 8.10, totalSupplied: 12_500_000, totalBorrowed: 8_200_000, utilization: 0.656, collateralFactor: 0.90 },
  { symbol: 'EURC',   name: 'Euro Coin',     icon: '💶', price: 1.1639,  supplyAPY: 4.80, borrowAPY: 7.50, totalSupplied:  6_800_000, totalBorrowed: 4_100_000, utilization: 0.603, collateralFactor: 0.88 },
  { symbol: 'cirBTC', name: 'Circle Bitcoin',icon: '₿',  price: 78200,   supplyAPY: 2.10, borrowAPY: 4.30, totalSupplied:  3_200_000, totalBorrowed: 1_500_000, utilization: 0.469, collateralFactor: 0.75 },
  { symbol: 'ETH',    name: 'Ethereum',      icon: 'Ξ',  price: 2293,    supplyAPY: 3.50, borrowAPY: 6.20, totalSupplied:  8_700_000, totalBorrowed: 5_600_000, utilization: 0.644, collateralFactor: 0.82 },
  { symbol: 'SOL',    name: 'Solana',        icon: '◎',  price: 90.5,    supplyAPY: 6.10, borrowAPY: 9.80, totalSupplied:  2_100_000, totalBorrowed: 1_400_000, utilization: 0.667, collateralFactor: 0.70 },
]

export function useLending() {
  const [assets, setAssets] = useState<LendingAsset[]>(BASE_ASSETS)
  const [userSupplies, setUserSupplies] = useState<UserSupply[]>([])
  const [userBorrows, setUserBorrows] = useState<UserBorrow[]>([])

  // Drift APY + utilization every 5s
  useEffect(() => {
    const id = setInterval(() => {
      setAssets((prev) =>
        prev.map((a) => {
          const util = Math.min(0.99, Math.max(0.1, a.utilization + (Math.random() - 0.5) * 0.01))
          return {
            ...a,
            utilization: parseFloat(util.toFixed(3)),
            supplyAPY: parseFloat(Math.max(0.1, a.supplyAPY + (Math.random() - 0.5) * 0.1).toFixed(2)),
            borrowAPY: parseFloat(Math.max(0.5, a.borrowAPY + (Math.random() - 0.5) * 0.1).toFixed(2)),
            totalBorrowed: Math.max(0, a.totalBorrowed + (Math.random() - 0.5) * 20_000),
          }
        })
      )
    }, 5000)
    return () => clearInterval(id)
  }, [])

  const supply = (symbol: string, amount: number) => {
    const asset = assets.find((a) => a.symbol === symbol)
    if (!asset || amount <= 0) return
    setUserSupplies((prev) => {
      const idx = prev.findIndex((s) => s.symbol === symbol)
      if (idx >= 0) {
        return prev.map((s) =>
          s.symbol === symbol
            ? { ...s, amount: s.amount + amount, valueUSD: (s.amount + amount) * asset.price }
            : s
        )
      }
      return [...prev, { symbol, amount, valueUSD: amount * asset.price }]
    })
  }

  const withdraw = (symbol: string, amount: number) => {
    const asset = assets.find((a) => a.symbol === symbol)
    if (!asset || amount <= 0) return
    setUserSupplies((prev) =>
      prev
        .map((s) => {
          if (s.symbol !== symbol) return s
          const next = Math.max(0, s.amount - amount)
          return { ...s, amount: next, valueUSD: next * asset.price }
        })
        .filter((s) => s.amount > 0)
    )
  }

  const borrow = (symbol: string, amount: number) => {
    const asset = assets.find((a) => a.symbol === symbol)
    if (!asset || amount <= 0) return
    setUserBorrows((prev) => {
      const idx = prev.findIndex((b) => b.symbol === symbol)
      if (idx >= 0) {
        return prev.map((b) =>
          b.symbol === symbol
            ? { ...b, amount: b.amount + amount, valueUSD: (b.amount + amount) * asset.price }
            : b
        )
      }
      return [...prev, { symbol, amount, valueUSD: amount * asset.price }]
    })
  }

  const repay = (symbol: string, amount: number) => {
    const asset = assets.find((a) => a.symbol === symbol)
    if (!asset || amount <= 0) return
    setUserBorrows((prev) =>
      prev
        .map((b) => {
          if (b.symbol !== symbol) return b
          const next = Math.max(0, b.amount - amount)
          return { ...b, amount: next, valueUSD: next * asset.price }
        })
        .filter((b) => b.amount > 0)
    )
  }

  const totalSuppliedUSD = userSupplies.reduce((s, u) => s + u.valueUSD, 0)
  const totalBorrowedUSD = userBorrows.reduce((s, u) => s + u.valueUSD, 0)

  const weightedCollateral = userSupplies.reduce((sum, u) => {
    const a = assets.find((x) => x.symbol === u.symbol)
    return sum + u.valueUSD * (a?.collateralFactor ?? 0)
  }, 0)

  const healthFactor = totalBorrowedUSD > 0 ? weightedCollateral / totalBorrowedUSD : Infinity

  const netAPY = (() => {
    if (totalSuppliedUSD === 0) return 0
    const income = userSupplies.reduce((s, u) => {
      const a = assets.find((x) => x.symbol === u.symbol)
      return s + u.valueUSD * ((a?.supplyAPY ?? 0) / 100)
    }, 0)
    const cost = userBorrows.reduce((s, u) => {
      const a = assets.find((x) => x.symbol === u.symbol)
      return s + u.valueUSD * ((a?.borrowAPY ?? 0) / 100)
    }, 0)
    return ((income - cost) / totalSuppliedUSD) * 100
  })()

  return {
    assets,
    userSupplies,
    userBorrows,
    supply,
    withdraw,
    borrow,
    repay,
    totalSuppliedUSD,
    totalBorrowedUSD,
    healthFactor,
    netAPY,
  }
}
