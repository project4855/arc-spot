import { useState, useEffect, useRef } from 'react'

export interface OrderLevel {
  price: number
  amount: number
  total: number
}

export interface Trade {
  id: string
  time: string
  type: 'buy' | 'sell'
  price: number
  amount: number
  from: string
  to: string
  txHash: string
}

export interface Candle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// Generate realistic-looking order book around a mid price
function genOrders(mid: number, side: 'ask' | 'bid', count = 12): OrderLevel[] {
  const levels: OrderLevel[] = []
  let runningTotal = 0
  const tick = Math.max(0.000001, mid * 0.0002) // relative tick ~0.02% of mid
  for (let i = 0; i < count; i++) {
    const offset = (i + 1) * (tick * (1 + Math.random() * 3))
    const price = side === 'ask' ? mid + offset : mid - offset
    const amount = parseFloat((0.5 + Math.random() * 9.5).toFixed(2))
    runningTotal += amount
    levels.push({ price: parseFloat(price.toFixed(6)), amount, total: parseFloat(runningTotal.toFixed(2)) })
  }
  return levels
}

// Generate candle data for price chart
function genCandles(base: number, count = 60): Candle[] {
  const candles: Candle[] = []
  let price = base
  const now = Date.now()
  for (let i = count; i >= 0; i--) {
    const change = (Math.random() - 0.49) * 0.002
    const open = price
    price = parseFloat((price * (1 + change)).toFixed(6))
    const high = parseFloat((Math.max(open, price) * (1 + Math.random() * 0.001)).toFixed(6))
    const low = parseFloat((Math.min(open, price) * (1 - Math.random() * 0.001)).toFixed(6))
    const d = new Date(now - i * 60_000)
    candles.push({
      time: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`,
      open,
      high,
      low,
      close: price,
      volume: parseFloat((1000 + Math.random() * 9000).toFixed(0)),
    })
  }
  return candles
}

// Fallback mid prices (used only when live prices haven't loaded yet)
const PAIR_MID_FALLBACK: Record<string, number> = {
  'USDC/EURC':   0.9259,
  'EURC/USDC':   1.08,
  'cirBTC/USDC': 75500,
  'cirBTC/EURC': 75500 / 1.08,   // ~69,907
  'ETH/USDC':    2064,
  'USDC/ETH':    1 / 2064,
  'ETH/EURC':    2064 / 1.08,
  'SOL/USDC':    84.25,
  'USDC/SOL':    1 / 84.25,
  'SOL/EURC':    84.25 / 1.08,
}

// basePrice: real live price from Hyperliquid (optional — falls back to PAIR_MID_FALLBACK)
export function useMarketData(pair: string, basePrice?: number) {
  const getEffectiveMid = () =>
    basePrice && basePrice > 0 ? basePrice : (PAIR_MID_FALLBACK[pair] ?? 1)

  const [asks, setAsks]           = useState<OrderLevel[]>(() => genOrders(getEffectiveMid(), 'ask'))
  const [bids, setBids]           = useState<OrderLevel[]>(() => genOrders(getEffectiveMid(), 'bid'))
  const [candles, setCandles]     = useState<Candle[]>(() => genCandles(getEffectiveMid()))
  const [lastPrice, setLastPrice] = useState(() => getEffectiveMid())
  const [priceChange, setPriceChange] = useState(0)
  const tickRef      = useRef(0)
  const lastPriceRef = useRef(getEffectiveMid())   // tracks current sim price for drift-check

  // ── Reset when trading pair changes ──────────────────────────────────────
  useEffect(() => {
    const mid = basePrice && basePrice > 0 ? basePrice : (PAIR_MID_FALLBACK[pair] ?? 1)
    setAsks(genOrders(mid, 'ask'))
    setBids(genOrders(mid, 'bid'))
    setCandles(genCandles(mid))
    setLastPrice(mid)
    setPriceChange(0)
    tickRef.current = 0
    lastPriceRef.current = mid
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair])   // intentionally NOT including basePrice — pair change resets; price updates snap below

  // ── Snap to real price when live data arrives / refreshes ───────────────
  useEffect(() => {
    if (!basePrice || basePrice <= 0) return
    const ratio = Math.abs(lastPriceRef.current - basePrice) / basePrice
    if (ratio > 0.02) {           // >2 % drift → snap chart to real price
      setCandles(genCandles(basePrice))
      setLastPrice(basePrice)
      setPriceChange(0)
      tickRef.current = 0
      setAsks(genOrders(basePrice, 'ask'))
      setBids(genOrders(basePrice, 'bid'))
      lastPriceRef.current = basePrice
    }
  }, [basePrice])

  // ── Live tick every 1.5 s ────────────────────────────────────────────────
  useEffect(() => {
    const mid = basePrice && basePrice > 0 ? basePrice : (PAIR_MID_FALLBACK[pair] ?? 1)
    const id = setInterval(() => {
      tickRef.current++
      const drift = (Math.random() - 0.49) * 0.001
      setLastPrice((p) => {
        const next = parseFloat((p * (1 + drift)).toFixed(6))
        lastPriceRef.current = next
        setPriceChange(parseFloat(((next / mid - 1) * 100).toFixed(4)))
        setAsks(genOrders(next, 'ask'))
        setBids(genOrders(next, 'bid'))
        // Add new candle every 10 ticks
        if (tickRef.current % 10 === 0) {
          setCandles((prev) => {
            const last = prev[prev.length - 1]
            const d = new Date()
            const newCandle: Candle = {
              time: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`,
              open: last.close,
              high: parseFloat((Math.max(last.close, next) * 1.001).toFixed(6)),
              low: parseFloat((Math.min(last.close, next) * 0.999).toFixed(6)),
              close: next,
              volume: parseFloat((1000 + Math.random() * 9000).toFixed(0)),
            }
            return [...prev.slice(-59), newCandle]
          })
        }
        return next
      })
    }, 1500)
    return () => clearInterval(id)
  }, [basePrice, pair])

  return { asks, bids, candles, lastPrice, priceChange, mid: getEffectiveMid() }
}
