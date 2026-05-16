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

const PAIR_MID: Record<string, number> = {
  'USDC/EURC':   0.8592,       // 1 USDC = 0.8592 EURC  (EUR/USD 1.1639)
  'EURC/USDC':   1.1639,       // 1 EURC = 1.1639 USDC
  'USDC/cirBTC': 0.00001279,   // 1 USDC = 1/78200 BTC
  'cirBTC/USDC': 78200,        // BTC ~$78,200
  'EURC/cirBTC': 0.00001489,   // 1 EURC = 1.164/78200 BTC
  'cirBTC/EURC': 67183,        // 1 BTC = 78200/1.164 EURC
  'ETH/USDC':    2293,         // ETH ~$2,293
  'USDC/ETH':    0.000436,     // 1 USDC = 1/2293 ETH
  'ETH/EURC':    1970,         // 1 ETH = 2293/1.164 EURC
  'SOL/USDC':    90.5,         // SOL ~$90.5
  'USDC/SOL':    0.01105,      // 1 USDC = 1/90.5 SOL
  'SOL/EURC':    77.75,        // 1 SOL = 90.5/1.164 EURC
}

export function useMarketData(pair: string) {
  const mid = PAIR_MID[pair] ?? 1
  const [asks, setAsks] = useState<OrderLevel[]>(() => genOrders(mid, 'ask'))
  const [bids, setBids] = useState<OrderLevel[]>(() => genOrders(mid, 'bid'))
  const [candles, setCandles] = useState<Candle[]>(() => genCandles(mid))
  const [lastPrice, setLastPrice] = useState(mid)
  const [priceChange, setPriceChange] = useState(0)
  const tickRef = useRef(0)

  useEffect(() => {
    const mid = PAIR_MID[pair] ?? 1
    setAsks(genOrders(mid, 'ask'))
    setBids(genOrders(mid, 'bid'))
    setCandles(genCandles(mid))
    setLastPrice(mid)
    setPriceChange(0)
    tickRef.current = 0
  }, [pair])

  // Live tick every 1.5s
  useEffect(() => {
    const id = setInterval(() => {
      tickRef.current++
      const drift = (Math.random() - 0.49) * 0.001
      setLastPrice((p) => {
        const next = parseFloat((p * (1 + drift)).toFixed(6))
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
  }, [mid, pair])

  return { asks, bids, candles, lastPrice, priceChange, mid }
}
