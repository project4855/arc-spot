import { useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useMarketData } from '../hooks/useMarketData'

function fmtPrice(p: number) {
  if (p >= 1000) return p.toFixed(2)
  if (p >= 1)    return p.toFixed(4)
  return p.toFixed(6)
}

interface Props {
  pair: string
}

const INTERVALS = ['1m', '5m', '15m', '1h'] as const

// Custom tooltip
function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { value: number; payload: { open: number; high: number; low: number; close: number; volume: number } }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-[#1a1d24] border border-gray-700 rounded-xl p-3 text-xs shadow-xl">
      <p className="text-gray-400 mb-2">{label}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-gray-500">Open</span><span className="text-white font-mono">{fmtPrice(d.open)}</span>
        <span className="text-green-400">High</span><span className="text-white font-mono">{fmtPrice(d.high)}</span>
        <span className="text-red-400">Low</span><span className="text-white font-mono">{fmtPrice(d.low)}</span>
        <span className="text-gray-500">Close</span><span className="text-white font-mono">{fmtPrice(d.close)}</span>
        <span className="text-gray-500">Volume</span><span className="text-violet-400 font-mono">{Number(d.volume).toLocaleString()}</span>
      </div>
    </div>
  )
}

export default function PriceChart({ pair }: Props) {
  const [interval, setInterval] = useState<typeof INTERVALS[number]>('1m')
  const { candles, lastPrice, priceChange } = useMarketData(pair)
  const isUp = priceChange >= 0

  // Thin candles for display
  const step = interval === '1m' ? 1 : interval === '5m' ? 5 : interval === '15m' ? 15 : 60
  const displayed = candles.filter((_, i) => i % Math.max(1, Math.floor(step / 1)) === 0).slice(-40)

  const minPrice = Math.min(...displayed.map((c) => c.low))
  const maxPrice = Math.max(...displayed.map((c) => c.high))
  const padding = (maxPrice - minPrice) * 0.15

  return (
    <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-white font-semibold text-sm">{pair}</h3>
          <span className={`text-lg font-bold font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
            {fmtPrice(lastPrice)}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            isUp ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}>
            {isUp ? '+' : ''}{priceChange.toFixed(4)}%
          </span>
        </div>

        {/* Interval selector */}
        <div className="flex gap-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => setInterval(iv)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                interval === iv
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {iv}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={displayed} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0.25} />
              <stop offset="95%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fill: '#4b5563', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minPrice - padding, maxPrice + padding]}
            tick={{ fill: '#4b5563', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={72}
            tickFormatter={(v) => fmtPrice(v)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="close"
            stroke={isUp ? '#22c55e' : '#ef4444'}
            strokeWidth={2}
            fill="url(#priceGrad)"
            dot={false}
            activeDot={{ r: 4, fill: isUp ? '#22c55e' : '#ef4444' }}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Volume bars (mini) */}
      <div className="flex items-end gap-px h-8">
        {displayed.map((c, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm opacity-60"
            style={{
              height: `${(c.volume / Math.max(...displayed.map((d) => d.volume))) * 100}%`,
              backgroundColor: c.close >= c.open ? '#22c55e' : '#ef4444',
            }}
          />
        ))}
      </div>
      <p className="text-xs text-gray-600 -mt-2">Volume</p>
    </div>
  )
}
