// ── PredictionMarketPanel.tsx ────────────────────────────────────────────────
// Simulated prediction markets on Arc Testnet · USDC settlement

import { useState, useMemo } from 'react'
import { useAccount } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { usePerpTrade } from '../hooks/usePerpsContract'

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = 'all' | 'crypto' | 'macro' | 'sports' | 'tech'

interface Market {
  id:          string
  category:    Exclude<Category, 'all'>
  title:       string
  description: string
  endDate:     string   // YYYY-MM-DD
  yesPool:     number   // USDC
  noPool:      number   // USDC
  featured?:   boolean
}

interface MyBet {
  marketId: string
  side:     'yes' | 'no'
  amount:   number
  odds:     number   // % at time of bet
  time:     number
}

// ── Mock markets data ─────────────────────────────────────────────────────────

const INITIAL_MARKETS: Market[] = [
  {
    id: '1', category: 'crypto', featured: true,
    title: 'BTC above $120,000 by July 31, 2026?',
    description: 'Will Bitcoin close above $120,000 USD on any day before August 1, 2026?',
    endDate: '2026-07-31', yesPool: 48200, noPool: 29800,
  },
  {
    id: '2', category: 'tech', featured: true,
    title: 'Arc mainnet launches before Sep 2026?',
    description: "Will Circle's Arc Network go live on mainnet before September 1, 2026?",
    endDate: '2026-08-31', yesPool: 71400, noPool: 18600,
  },
  {
    id: '3', category: 'crypto',
    title: 'ETH above $5,000 in 2026?',
    description: 'Will Ethereum reach $5,000 USD before December 31, 2026?',
    endDate: '2026-12-31', yesPool: 32100, noPool: 41900,
  },
  {
    id: '4', category: 'macro',
    title: 'Fed cuts rates in June 2026?',
    description: 'Will the US Federal Reserve cut interest rates at their June 2026 FOMC meeting?',
    endDate: '2026-06-19', yesPool: 55300, noPool: 44700,
  },
  {
    id: '5', category: 'tech',
    title: 'Circle IPO completes in 2026?',
    description: 'Will Circle complete its Initial Public Offering (IPO) before December 31, 2026?',
    endDate: '2026-12-31', yesPool: 83200, noPool: 16800,
  },
  {
    id: '6', category: 'macro',
    title: 'USDC market cap exceeds $100B in 2026?',
    description: 'Will USDC total market capitalization surpass $100 billion before end of 2026?',
    endDate: '2026-12-31', yesPool: 61700, noPool: 38300,
  },
  {
    id: '7', category: 'crypto',
    title: 'SOL above $300 before Aug 2026?',
    description: 'Will Solana (SOL) exceed $300 USD before August 1, 2026?',
    endDate: '2026-07-31', yesPool: 27600, noPool: 38400,
  },
  {
    id: '8', category: 'macro',
    title: 'US CPI below 3% by Q3 2026?',
    description: 'Will US CPI inflation drop below 3% annualized before October 2026?',
    endDate: '2026-09-30', yesPool: 39800, noPool: 60200,
  },
  {
    id: '9', category: 'sports',
    title: 'Real Madrid wins UCL 2026?',
    description: 'Will Real Madrid win the 2025–26 UEFA Champions League?',
    endDate: '2026-05-30', yesPool: 44100, noPool: 55900,
  },
  {
    id: '10', category: 'tech',
    title: 'Arc ecosystem TVL exceeds $1B?',
    description: 'Will total TVL on Arc Network exceed $1 billion within 6 months of mainnet launch?',
    endDate: '2027-03-01', yesPool: 29300, noPool: 70700,
  },
  {
    id: '11', category: 'crypto',
    title: 'BTC dominance above 60% in 2026?',
    description: 'Will Bitcoin dominance (% of total crypto market cap) exceed 60% any time in 2026?',
    endDate: '2026-12-31', yesPool: 51200, noPool: 48800,
  },
  {
    id: '12', category: 'sports',
    title: 'Golden State Warriors win NBA 2026?',
    description: 'Will the Golden State Warriors win the 2025–26 NBA Championship?',
    endDate: '2026-06-20', yesPool: 18700, noPool: 81300,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOdds(yesPool: number, noPool: number) {
  const total = yesPool + noPool
  if (total === 0) return { yes: 50, no: 50 }
  const yes = Math.round((yesPool / total) * 100)
  return { yes, no: 100 - yes }
}

function getCountdown(endDate: string): string {
  const diff = new Date(endDate).getTime() - Date.now()
  if (diff <= 0) return 'Ended'
  const days  = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  if (days > 30) { const months = Math.floor(days / 30); return `${months}mo ${days % 30}d` }
  if (days > 0)  return `${days}d ${hours}h`
  return `${hours}h left`
}

function fmtVol(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

const CAT_META: Record<Category, { label: string; icon: string; color: string }> = {
  all:    { label: 'All',    icon: '🌐', color: 'bg-slate-100 text-slate-600'  },
  crypto: { label: 'Crypto', icon: '🪙', color: 'bg-amber-50 text-amber-700'   },
  macro:  { label: 'Macro',  icon: '📈', color: 'bg-blue-50 text-blue-700'     },
  sports: { label: 'Sports', icon: '⚽', color: 'bg-emerald-50 text-emerald-700' },
  tech:   { label: 'Tech',   icon: '💻', color: 'bg-violet-50 text-violet-700' },
}

// ── Market Card ───────────────────────────────────────────────────────────────

function MarketCard({
  market, myBet, isConnected, onBet,
}: {
  market:      Market
  myBet:       MyBet | undefined
  isConnected: boolean
  onBet:       (id: string, side: 'yes' | 'no', amount: number) => void
}) {
  const [open,   setOpen]   = useState(false)
  const [side,   setSide]   = useState<'yes' | 'no'>('yes')
  const [amount, setAmount] = useState('')

  const odds    = getOdds(market.yesPool, market.noPool)
  const amountN = parseFloat(amount) || 0
  const returnOdds = side === 'yes' ? odds.yes : odds.no
  const payout  = amountN > 0 && returnOdds > 0 ? (amountN / returnOdds) * 100 : 0
  const cat     = CAT_META[market.category]

  return (
    <div className={`bg-white border rounded-2xl overflow-hidden shadow-sm flex flex-col transition-all hover:shadow-md ${
      market.featured ? 'border-violet-300 ring-1 ring-violet-200/60' : 'border-slate-200'
    }`}>
      {market.featured && (
        <div className="h-1 bg-gradient-to-r from-violet-500 to-blue-500" />
      )}

      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Meta */}
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${cat.color}`}>
            {cat.icon} {cat.label}
          </span>
          <span className="text-[10px] text-slate-400 font-medium">{getCountdown(market.endDate)}</span>
        </div>

        {/* Title */}
        <h3 className="text-slate-900 font-bold text-sm leading-snug">{market.title}</h3>
        <p className="text-slate-400 text-[11px] leading-relaxed -mt-1">{market.description}</p>

        {/* Odds bar */}
        <div>
          <div className="flex justify-between text-xs font-bold mb-1.5">
            <span className="text-emerald-600">YES {odds.yes}%</span>
            <span className="text-red-500">NO {odds.no}%</span>
          </div>
          <div className="h-2 rounded-full bg-red-100 overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full transition-all duration-700"
              style={{ width: `${odds.yes}%` }} />
          </div>
        </div>

        {/* Volume + my bet */}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400">
            Vol: <strong className="text-slate-600">{fmtVol(market.yesPool + market.noPool)}</strong>
          </span>
          {myBet && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
              myBet.side === 'yes'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}>
              {myBet.side.toUpperCase()} ${myBet.amount}
            </span>
          )}
        </div>

        {/* Bet UI */}
        {!open ? (
          <button
            onClick={() => isConnected && setOpen(true)}
            className={`mt-auto w-full py-2 rounded-xl text-xs font-bold transition-all ${
              isConnected
                ? 'bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}>
            {isConnected ? 'Place Bet' : 'Connect wallet to bet'}
          </button>
        ) : (
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 mt-auto">
            {/* YES / NO */}
            <div className="grid grid-cols-2 gap-1.5">
              {(['yes', 'no'] as const).map(s => (
                <button key={s} onClick={() => setSide(s)}
                  className={`py-2 rounded-xl text-xs font-bold transition-all ${
                    side === s
                      ? s === 'yes' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-red-500 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {s === 'yes' ? `✓ YES ${odds.yes}%` : `✗ NO ${odds.no}%`}
                </button>
              ))}
            </div>

            {/* Amount input */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus-within:border-violet-400 transition-colors">
              <span className="text-slate-400 text-xs shrink-0">USDC</span>
              <input
                type="number" min="0" placeholder="0.00" value={amount}
                onChange={e => setAmount(e.target.value)}
                className="flex-1 bg-transparent text-slate-900 font-bold text-sm outline-none min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>

            {/* Quick amounts */}
            <div className="flex gap-1">
              {[5, 10, 25, 50].map(v => (
                <button key={v} onClick={() => setAmount(String(v))}
                  className="flex-1 py-1 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 text-[11px] font-medium transition-colors">
                  ${v}
                </button>
              ))}
            </div>

            {/* Payout preview */}
            {amountN > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex justify-between text-[11px]">
                <span className="text-emerald-700">Potential payout</span>
                <span className="font-bold text-emerald-700">${payout.toFixed(2)}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                disabled={amountN <= 0}
                onClick={() => { if (amountN > 0) { onBet(market.id, side, amountN); setAmount(''); setOpen(false) } }}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  side === 'yes' ? 'bg-emerald-500 text-white hover:bg-emerald-400' : 'bg-red-500 text-white hover:bg-red-400'
                }`}>
                Confirm {side.toUpperCase()}
              </button>
              <button onClick={() => { setOpen(false); setAmount('') }}
                className="px-3 py-2 rounded-xl bg-slate-100 text-slate-500 text-xs hover:bg-slate-200 transition-colors">
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function PredictionMarketPanel() {
  const { isConnected } = useAccount()
  const { balanceUSDC } = usePerpTrade()

  const [markets,  setMarkets]  = useState<Market[]>(INITIAL_MARKETS)
  const [myBets,   setMyBets]   = useState<MyBet[]>([])
  const [category, setCategory] = useState<Category>('all')
  const [sortBy,   setSortBy]   = useState<'volume' | 'ending' | 'newest'>('volume')

  const filtered = useMemo(() => {
    let list = category === 'all' ? [...markets] : markets.filter(m => m.category === category)
    if (sortBy === 'volume')  list.sort((a, b) => (b.yesPool + b.noPool) - (a.yesPool + a.noPool))
    if (sortBy === 'ending')  list.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
    if (sortBy === 'newest')  list.reverse()
    // Featured first in default sort
    if (sortBy === 'volume') {
      const feat = list.filter(m => m.featured)
      const rest = list.filter(m => !m.featured)
      list = [...feat, ...rest]
    }
    return list
  }, [markets, category, sortBy])

  const totalVolume     = markets.reduce((s, m) => s + m.yesPool + m.noPool, 0)
  const totalBetAmount  = myBets.reduce((s, b) => s + b.amount, 0)

  const handleBet = (marketId: string, side: 'yes' | 'no', amount: number) => {
    // Update pool sizes optimistically
    setMarkets(prev => prev.map(m =>
      m.id !== marketId ? m : {
        ...m,
        yesPool: side === 'yes' ? m.yesPool + amount : m.yesPool,
        noPool:  side === 'no'  ? m.noPool  + amount : m.noPool,
      }
    ))
    // Record the bet
    const market = markets.find(m => m.id === marketId)!
    const odds   = getOdds(market.yesPool, market.noPool)
    setMyBets(prev => {
      const idx = prev.findIndex(b => b.marketId === marketId)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], amount: next[idx].amount + amount }
        return next
      }
      return [...prev, { marketId, side, amount, odds: side === 'yes' ? odds.yes : odds.no, time: Date.now() }]
    })
  }

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header banner ── */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-blue-600 via-violet-600 to-purple-700 px-6 py-5 shadow-lg">
        <div className="absolute inset-0 opacity-[0.08] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/30 text-white text-[11px] font-semibold">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                {markets.length} Live Markets
              </span>
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">🎯 Prediction Markets</h1>
            <p className="text-blue-100 text-sm mt-1">Bet on crypto, macro & world events · Settled in USDC</p>
          </div>
          <div className="text-right shrink-0">
            {isConnected ? (
              <>
                <p className="text-white/60 text-xs mb-0.5">Your USDC balance</p>
                <p className="text-2xl font-extrabold text-white">${balanceUSDC.toFixed(2)}</p>
                {myBets.length > 0 && (
                  <p className="text-blue-200 text-[11px] mt-0.5">
                    {myBets.length} bet{myBets.length > 1 ? 's' : ''} · ${totalBetAmount.toFixed(0)} wagered
                  </p>
                )}
              </>
            ) : (
              <ConnectButton label="Connect Wallet" />
            )}
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Open Markets', value: markets.length,      icon: '🌐', color: 'text-slate-900'   },
          { label: 'Total Volume', value: fmtVol(totalVolume), icon: '💰', color: 'text-violet-700'  },
          { label: 'My Bets',      value: myBets.length,       icon: '🎯', color: 'text-emerald-700' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm text-center">
            <p className="text-xl mb-0.5">{s.icon}</p>
            <p className={`font-extrabold text-lg ${s.color}`}>{s.value}</p>
            <p className="text-slate-400 text-[11px]">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        {/* Category pills */}
        <div className="flex gap-1 flex-wrap bg-white border border-slate-200 p-1 rounded-xl shadow-sm">
          {(Object.keys(CAT_META) as Category[]).map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                category === cat
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}>
              {CAT_META[cat].icon} {CAT_META[cat].label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-600 outline-none focus:border-violet-400 shadow-sm shrink-0">
          <option value="volume">Sort: Volume</option>
          <option value="ending">Sort: Ending Soon</option>
          <option value="newest">Sort: Newest</option>
        </select>
      </div>

      {/* ── Markets grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(m => (
          <MarketCard
            key={m.id}
            market={m}
            myBet={myBets.find(b => b.marketId === m.id)}
            isConnected={isConnected}
            onBet={handleBet}
          />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-3 py-16 text-center">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-slate-500 font-semibold">No markets in this category</p>
          </div>
        )}
      </div>

      {/* ── My Bets ── */}
      {myBets.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm">🎯 My Bets ({myBets.length})</h3>
            <span className="text-xs text-slate-400">Total wagered: <strong className="text-slate-700">${totalBetAmount.toFixed(2)}</strong></span>
          </div>
          <div className="divide-y divide-slate-50">
            {myBets.map(bet => {
              const market = markets.find(m => m.id === bet.marketId)
              if (!market) return null
              const odds  = getOdds(market.yesPool, market.noPool)
              const curOdds = bet.side === 'yes' ? odds.yes : odds.no
              const payout  = bet.amount / bet.odds * 100
              return (
                <div key={bet.marketId} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-900 text-xs font-semibold truncate">{market.title}</p>
                    <p className="text-slate-400 text-[10px] mt-0.5">{getCountdown(market.endDate)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                      bet.side === 'yes'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                    }`}>
                      {bet.side.toUpperCase()} @ {bet.odds}%
                    </span>
                    <div className="text-right">
                      <p className="text-slate-900 font-bold text-sm">${bet.amount}</p>
                      <p className="text-[10px] text-slate-400">→ ${payout.toFixed(0)}</p>
                    </div>
                    {curOdds !== bet.odds && (
                      <span className={`text-[10px] font-semibold ${curOdds > bet.odds ? 'text-emerald-600' : 'text-red-500'}`}>
                        {curOdds > bet.odds ? '▲' : '▼'}{Math.abs(curOdds - bet.odds)}%
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-center text-[11px] text-slate-400 pb-1">
        🎯 Prediction markets are simulated on Arc Testnet · No real money · For educational purposes only
      </p>
    </div>
  )
}
