import { useState, useEffect } from 'react'

export interface TxRecord {
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

const WALLETS = [
  '0x1a2b...3c4d', '0x5e6f...7a8b', '0x9c0d...1e2f',
  '0x3a4b...5c6d', '0x7e8f...9a0b',
]

let idCounter = 0

function randomTx(pair: string): TxRecord {
  const [from, to] = pair.split('/')
  const type = Math.random() > 0.5 ? 'buy' : 'sell'
  const fromAmount = parseFloat((1 + Math.random() * 50).toFixed(2))
  const rates: Record<string, number> = {
    'USDC/EURC':   0.8592,    'EURC/USDC':   1.1639,
    'USDC/cirBTC': 0.00001279,'cirBTC/USDC': 78200,
    'EURC/cirBTC': 0.00001489,'cirBTC/EURC': 67183,
    'ETH/USDC':    2293,      'USDC/ETH':    0.000436,
    'SOL/USDC':    90.5,      'USDC/SOL':    0.01105,
  }
  const rate = rates[pair] ?? 1
  const toAmount = parseFloat((fromAmount * rate).toFixed(6))
  const now = new Date()
  idCounter++
  return {
    id: String(idCounter),
    time: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`,
    type,
    fromToken: from,
    toToken: to,
    fromAmount,
    toAmount,
    price: rate,
    wallet: WALLETS[Math.floor(Math.random() * WALLETS.length)],
    txHash: '0x' + Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10),
    status: 'confirmed',
  }
}

// Seed with initial transactions
function seedTxs(pair: string, count = 20): TxRecord[] {
  return Array.from({ length: count }, () => randomTx(pair)).reverse()
}

export function useTransactions(pair: string, myTxs: TxRecord[]) {
  const [txs, setTxs] = useState<TxRecord[]>(() => seedTxs(pair))

  useEffect(() => {
    setTxs(seedTxs(pair))
  }, [pair])

  // New random tx every 3-6 seconds
  useEffect(() => {
    const id = setInterval(() => {
      setTxs((prev) => [randomTx(pair), ...prev.slice(0, 49)])
    }, 3000 + Math.random() * 3000)
    return () => clearInterval(id)
  }, [pair])

  // Prepend user's own txs
  const allTxs = [...myTxs, ...txs].slice(0, 50)

  return { txs: allTxs }
}
