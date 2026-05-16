import { useMarketData } from '../hooks/useMarketData'

interface Props {
  pair: string
}

export default function OrderBook({ pair }: Props) {
  const { asks, bids, lastPrice, priceChange } = useMarketData(pair)
  const isUp = priceChange >= 0
  const maxTotal = Math.max(...bids.map((b) => b.total), ...asks.map((a) => a.total))

  return (
    <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Order Book</h3>
        <span className="text-xs text-gray-500">{pair}</span>
      </div>

      {/* Column labels */}
      <div className="grid grid-cols-3 text-xs text-gray-600 px-1">
        <span>Price (USDC)</span>
        <span className="text-center">Amount</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (sell orders) — reversed so lowest ask is nearest mid */}
      <div className="flex flex-col gap-px">
        {[...asks].reverse().slice(0, 10).map((ask, i) => (
          <div key={i} className="relative grid grid-cols-3 text-xs px-1 py-0.5 rounded overflow-hidden">
            <div
              className="absolute inset-y-0 right-0 bg-red-500/10"
              style={{ width: `${(ask.total / maxTotal) * 100}%` }}
            />
            <span className="text-red-400 font-mono relative z-10">{ask.price.toFixed(6)}</span>
            <span className="text-gray-300 text-center font-mono relative z-10">{ask.amount.toFixed(2)}</span>
            <span className="text-gray-500 text-right font-mono relative z-10">{ask.total.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Mid price */}
      <div className={`flex items-center justify-center gap-2 py-1.5 rounded-lg ${isUp ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
        <span className={`text-base font-bold font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
          {lastPrice.toFixed(6)}
        </span>
        <span className={`text-xs ${isUp ? 'text-green-500' : 'text-red-500'}`}>
          {isUp ? '▲' : '▼'} {Math.abs(priceChange).toFixed(4)}%
        </span>
      </div>

      {/* Bids (buy orders) */}
      <div className="flex flex-col gap-px">
        {bids.slice(0, 10).map((bid, i) => (
          <div key={i} className="relative grid grid-cols-3 text-xs px-1 py-0.5 rounded overflow-hidden">
            <div
              className="absolute inset-y-0 right-0 bg-green-500/10"
              style={{ width: `${(bid.total / maxTotal) * 100}%` }}
            />
            <span className="text-green-400 font-mono relative z-10">{bid.price.toFixed(6)}</span>
            <span className="text-gray-300 text-center font-mono relative z-10">{bid.amount.toFixed(2)}</span>
            <span className="text-gray-500 text-right font-mono relative z-10">{bid.total.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Spread */}
      <div className="flex justify-between text-xs text-gray-600 px-1">
        <span>Spread</span>
        <span className="text-gray-400">
          {asks[0] && bids[0]
            ? (asks[0].price - bids[0].price).toFixed(6)
            : '—'}
        </span>
      </div>
    </div>
  )
}
