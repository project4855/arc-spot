// useLivePrices.ts — real prices from Hyperliquid + forex for EUR/USD
import { useState, useEffect, useRef } from 'react'

export interface LivePrices {
  'USDC/EURC':   number
  'ETH/USDC':    number
  'SOL/USDC':    number
  'cirBTC/USDC': number
  'cirBTC/EURC': number
}

const FALLBACK: LivePrices = {
  'USDC/EURC':   0.9259,       // 1/1.08
  'ETH/USDC':    2064,
  'SOL/USDC':    84.25,
  'cirBTC/USDC': 75500,
  'cirBTC/EURC': parseFloat((75500 / 1.08).toFixed(2)),  // ~69,907
}

async function fetchPrices(): Promise<LivePrices> {
  // 1. Hyperliquid spot mids
  const hlRes = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  })
  const mids: Record<string, string> = await hlRes.json()

  const btc = parseFloat(mids['BTC'] ?? mids['WBTC'] ?? '75500')
  const eth = parseFloat(mids['ETH'] ?? '2064')
  const sol = parseFloat(mids['SOL'] ?? '84.25')

  // 2. EUR/USD rate from free forex API
  let eurUsd = 1.08
  try {
    const fxRes = await fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    )
    const fx = await fxRes.json()
    const usdEur: number = fx?.usd?.eur ?? 0
    if (usdEur > 0) eurUsd = 1 / usdEur   // EUR per USD → USD per EUR
  } catch { /* use fallback */ }

  // EURC is pegged 1:1 to EUR, so USDC/EURC = 1/eurUsd (how many EUR per 1 USD)
  const usdcEurc = 1 / eurUsd   // e.g. 1 USDC ≈ 0.926 EURC

  return {
    'USDC/EURC':   parseFloat(usdcEurc.toFixed(6)),
    'ETH/USDC':    eth,
    'SOL/USDC':    sol,
    'cirBTC/USDC': btc,
    'cirBTC/EURC': parseFloat((btc / eurUsd).toFixed(2)),  // e.g. 75500/1.08 ≈ 69,907
  }
}

export function useLivePrices(intervalMs = 10_000): { prices: LivePrices; loading: boolean } {
  const [prices, setPrices]   = useState<LivePrices>(FALLBACK)
  const [loading, setLoading] = useState(true)
  const prevRef = useRef<LivePrices>(FALLBACK)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const p = await fetchPrices()
        if (!cancelled) {
          prevRef.current = p
          setPrices(p)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const id = setInterval(load, intervalMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [intervalMs])

  return { prices, loading }
}
