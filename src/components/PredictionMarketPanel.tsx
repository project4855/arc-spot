// ── PredictionMarketPanel.tsx ────────────────────────────────────────────────
// Prediction markets on Arc Testnet · USDC settlement · real on-chain bets

import { useState, useMemo, useCallback, useEffect } from 'react'
import { parseUnits, maxUint256 } from 'viem'
import WalletGate from './WalletGate'
import { useWallet } from '../hooks/useWallet'
import { usePerpTrade } from '../hooks/usePerpsContract'
import { TOKEN_ADDRESSES, LENDING_ADDRESS, LENDING_ABI, ERC20_ABI } from '../config/contracts'

// ── Poll for receipt (copied verbatim from useLendingContract.waitForTx) ──────
async function waitForTx(hash: `0x${string}`, maxWait = 60_000) {
  const { createPublicClient, http } = await import('viem')
  const { arcTestnet } = await import('../config/wagmi')
  const client = createPublicClient({ chain: arcTestnet, transport: http() })
  const deadline = Date.now() + maxWait
  while (Date.now() < deadline) {
    const r = await client.getTransactionReceipt({ hash }).catch(() => null)
    if (r) return r
    await new Promise(res => setTimeout(res, 1500))
  }
  throw new Error('Tx timeout')
}

// ── Bet step type ─────────────────────────────────────────────────────────────
type BetStep = 'idle' | 'approving' | 'sending' | 'confirming' | 'done' | 'error'

// ── Single hook for all on-chain bet logic (one instance per panel) ───────────
function usePredictBet() {
  const { isReady: isConnected, writeContract: writeContractAsync } = useWallet()

  const [betStep,   setBetStep]   = useState<BetStep>('idle')
  const [betTxHash, setBetTxHash] = useState<string | null>(null)
  const [betError,  setBetError]  = useState<string | null>(null)
  const [betTarget, setBetTarget] = useState<string | null>(null) // which market card is active

  const placeBet = useCallback(async (
    marketId: string,
    amountUsdc: number,
  ) => {
    if (!isConnected || amountUsdc <= 0) return
    setBetStep('approving')
    setBetError(null)
    setBetTxHash(null)
    setBetTarget(marketId)

    try {
      const raw = parseUnits(amountUsdc.toFixed(6), 6)

      // ── Step 1: Approve USDC ─────────────────────────────────────────────
      // (first await in the function → MetaMask fires immediately, no async before it)
      const aHash = await writeContractAsync({
        address:      TOKEN_ADDRESSES.USDC,
        abi:          ERC20_ABI,
        functionName: 'approve',
        args:         [LENDING_ADDRESS, maxUint256],
      })
      setBetTxHash(aHash)
      setBetStep('confirming')
      await waitForTx(aHash)

      // ── Step 2: Supply USDC (the actual bet escrow) ──────────────────────
      setBetStep('sending')
      const hash = await writeContractAsync({
        address:      LENDING_ADDRESS,
        abi:          LENDING_ABI,
        functionName: 'supply',
        args:         [TOKEN_ADDRESSES.USDC, raw],
      })
      setBetTxHash(hash)
      setBetStep('confirming')
      await waitForTx(hash)

      setBetStep('done')
      return hash as `0x${string}`

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : 'Transaction failed'
      setBetError(msg.includes('rejected') ? 'Rejected in wallet' : msg.slice(0, 140))
      setBetStep('error')
      console.error('[predict:placeBet]', e)
      return null
    }
  }, [isConnected, writeContractAsync])


  const reset = useCallback(() => {
    setBetStep('idle'); setBetError(null); setBetTxHash(null); setBetTarget(null)
  }, [])

  return { placeBet, betStep, betTxHash, betError, betTarget, reset, isConnected }
}

// ── localStorage key ──────────────────────────────────────────────────────────
const LS_BETS_KEY = 'arc_predict_bets_5042002'

function loadBets(address?: string): MyBet[] {
  try {
    const all: MyBet[] = JSON.parse(localStorage.getItem(LS_BETS_KEY) ?? '[]')
    if (!address) return all
    // Show bets for this wallet, plus legacy bets that have no walletAddress
    return all.filter(b => !b.walletAddress || b.walletAddress.toLowerCase() === address.toLowerCase())
  } catch { return [] }
}

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
  marketId:      string
  side:          'yes' | 'no'
  amount:        number
  odds:          number   // % at time of bet
  time:          number
  txHash?:       string
  walletAddress?: string
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
  market, myBet, hook, onBet,
}: {
  market:  Market
  myBet:   MyBet | undefined
  hook:    ReturnType<typeof usePredictBet>
  onBet:   (id: string, side: 'yes' | 'no', amount: number, txHash: string) => void
}) {
  const [open,   setOpen]   = useState(false)
  const [side,   setSide]   = useState<'yes' | 'no'>('yes')
  const [amount, setAmount] = useState('')

  // This card is "active" when the hook is targeting this market
  const isActive   = hook.betTarget === market.id
  const betStep    = isActive ? hook.betStep   : 'idle'
  const txHash     = isActive ? hook.betTxHash : null
  const betError   = isActive ? hook.betError  : null
  const isConnected = hook.isConnected

  const odds       = getOdds(market.yesPool, market.noPool)
  const cat        = CAT_META[market.category]
  const amountN    = parseFloat(amount) || 0
  const returnOdds = side === 'yes' ? odds.yes : odds.no
  const payout     = amountN > 0 && returnOdds > 0 ? (amountN / returnOdds) * 100 : 0

  async function handleConfirm() {
    if (amountN <= 0 || !isConnected) return
    const hash = await hook.placeBet(market.id, amountN)
    if (hash) {
      onBet(market.id, side, amountN, hash)
      setAmount('')
      setTimeout(() => { hook.reset(); setOpen(false) }, 3000)
    }
  }

  return (
    <div className={`bg-white border rounded-2xl overflow-hidden shadow-sm flex flex-col transition-all hover:shadow-md ${
      open ? 'border-violet-400 shadow-md ring-1 ring-violet-200/60' :
      market.featured ? 'border-violet-300 ring-1 ring-violet-200/60' : 'border-slate-200'
    }`}>
      {market.featured && !open && (
        <div className="h-1 bg-gradient-to-r from-violet-500 to-blue-500" />
      )}
      {open && <div className="h-1 bg-gradient-to-r from-emerald-500 to-violet-500" />}

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

        {/* Volume + my bet badge */}
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

        {/* ── Bet UI ── */}
        {!open ? (
          /* Place Bet button */
          <button
            onClick={() => { setOpen(true); hook.reset() }}
            className="mt-auto w-full py-2.5 rounded-xl text-xs font-bold transition-all bg-violet-600 text-white hover:bg-violet-500 active:scale-95 shadow-sm"
          >
            🎯 Place Bet
          </button>
        ) : betStep === 'done' ? (
          /* ── Success state ── */
          <div className="mt-auto flex flex-col items-center gap-2 py-3 bg-emerald-50 border border-emerald-200 rounded-xl px-3">
            <span className="text-2xl">🎉</span>
            <p className="text-emerald-700 font-bold text-sm">Bet confirmed on-chain!</p>
            <p className="text-emerald-600 text-[11px]">{side.toUpperCase()} · ${amountN > 0 ? amountN.toFixed(2) : '—'} USDC</p>
            {txHash && (
              <a
                href={`https://testnet.arcscan.app/tx/${txHash}`}
                target="_blank" rel="noreferrer"
                className="text-[11px] text-violet-600 hover:text-violet-700 underline"
              >
                View on ArcScan ↗
              </a>
            )}
          </div>
        ) : betStep === 'sending' || betStep === 'confirming' ? (
          /* ── Pending state ── */
          <div className="mt-auto flex flex-col items-center gap-2 py-3 bg-violet-50 border border-violet-200 rounded-xl px-3">
            <svg className="animate-spin h-5 w-5 text-violet-600 mt-1" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <p className="text-violet-700 font-semibold text-sm text-center">
              {betStep === 'sending' ? '🦊 Confirm in MetaMask…' : '⏳ Waiting for confirmation…'}
            </p>
            {txHash && betStep === 'confirming' && (
              <p className="text-[10px] text-violet-500 text-center">
                Tx: {txHash.slice(0, 8)}…{txHash.slice(-6)}
              </p>
            )}
            <p className="text-[10px] text-slate-400 text-center">
              2 wallet confirmations: Approve USDC → Lock bet
            </p>
          </div>
        ) : (
          /* ── Expanded bet form ── */
          <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-3 mt-auto">

            {/* YES / NO toggle */}
            <div className="grid grid-cols-2 gap-1.5">
              {(['yes', 'no'] as const).map(s => (
                <button key={s} onClick={() => setSide(s)}
                  className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
                    side === s
                      ? s === 'yes' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-red-500 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {s === 'yes' ? `✓ YES ${odds.yes}%` : `✗ NO ${odds.no}%`}
                </button>
              ))}
            </div>

            {/* Amount input */}
            <div className="flex items-center gap-2 bg-slate-50 border-2 border-violet-300 rounded-xl px-3 py-2 focus-within:border-violet-500 transition-colors">
              <span className="text-slate-500 text-xs font-semibold shrink-0">USDC</span>
              <input
                autoFocus
                type="number" min="0" placeholder="0.00" value={amount}
                onChange={e => setAmount(e.target.value)}
                className="flex-1 bg-transparent text-slate-900 font-bold text-base outline-none min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>

            {/* Quick amounts */}
            <div className="flex gap-1">
              {[1, 5, 10, 25].map(v => (
                <button key={v} onClick={() => setAmount(String(v))}
                  className="flex-1 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-violet-100 hover:text-violet-700 text-[11px] font-semibold transition-colors">
                  ${v}
                </button>
              ))}
            </div>

            {/* Payout preview */}
            {amountN > 0 && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex justify-between text-[11px]">
                <span className="text-emerald-700">Potential payout</span>
                <span className="font-bold text-emerald-700">${payout.toFixed(2)} USDC</span>
              </div>
            )}

            {/* Error */}
            {betStep === 'error' && betError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                <p className="text-red-600 text-[11px]">{betError}</p>
              </div>
            )}

            {/* Connect wall OR confirm button */}
            {!isConnected ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-1">
                <WalletGate label="Connect wallet to place bet on-chain" variant="inline" />
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  disabled={amountN <= 0}
                  onClick={handleConfirm}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                    side === 'yes'
                      ? 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-sm'
                      : 'bg-red-500 text-white hover:bg-red-400 shadow-sm'
                  }`}>
                  ⛓ Confirm {side.toUpperCase()} {amountN > 0 ? `$${amountN}` : ''}
                </button>
                <button onClick={() => { setOpen(false); setAmount(''); hook.reset() }}
                  className="px-3 py-2 rounded-xl bg-slate-100 text-slate-500 text-sm hover:bg-slate-200 transition-colors">
                  ✕
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000)     return 'just now'
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// ── My Bets & History Section ─────────────────────────────────────────────────

function MyBetsSection({
  myBets, markets, totalBetAmount, onClear, onClose,
}: {
  myBets:          MyBet[]
  markets:         Market[]
  totalBetAmount:  number
  onClear:         () => void
  onClose:         (marketId: string) => void
}) {
  const [tab, setTab] = useState<'positions' | 'history'>('positions')
  const [confirmClose, setConfirmClose] = useState<string | null>(null)  // marketId pending close

  // Portfolio metrics
  const rows = myBets.map(bet => {
    const market    = markets.find(m => m.id === bet.marketId)
    const odds      = market ? getOdds(market.yesPool, market.noPool) : { yes: bet.odds, no: 100 - bet.odds }
    const curOdds   = bet.side === 'yes' ? odds.yes : odds.no
    const curValue  = bet.odds > 0 ? (bet.amount / bet.odds) * curOdds : 0
    const payout    = bet.odds > 0 ? (bet.amount / bet.odds) * 100 : 0
    const pnl       = curValue - bet.amount
    const pnlPct    = bet.amount > 0 ? (pnl / bet.amount) * 100 : 0
    return { bet, market, curOdds, curValue, payout, pnl, pnlPct }
  })

  const totalCurValue = rows.reduce((s, r) => s + r.curValue, 0)
  const totalPnl      = totalCurValue - totalBetAmount
  const totalPayout   = rows.reduce((s, r) => s + r.payout, 0)

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">

      {/* ── Portfolio summary bar ── */}
      <div className="bg-gradient-to-r from-slate-900 to-violet-900 px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-white text-sm">🎯 My Portfolio</h3>
          <button onClick={onClear}
            className="text-[10px] text-white/50 hover:text-white/80 transition-colors px-2 py-0.5 rounded border border-white/20 hover:border-white/40">
            Clear all
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Wagered',    value: `$${totalBetAmount.toFixed(2)}`,  sub: `${myBets.length} position${myBets.length > 1 ? 's' : ''}`,          color: 'text-white' },
            { label: 'Current Value',    value: `$${totalCurValue.toFixed(2)}`,   sub: 'mark-to-market',                                                     color: 'text-white' },
            { label: 'Unrealized P&L',   value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, sub: `${totalPnl >= 0 ? '+' : ''}${totalBetAmount > 0 ? ((totalPnl / totalBetAmount) * 100).toFixed(1) : '0'}%`, color: totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Max Payout',       value: `$${totalPayout.toFixed(2)}`,     sub: 'if all win',                                                          color: 'text-amber-400' },
          ].map(s => (
            <div key={s.label} className="bg-white/10 rounded-xl px-3 py-2.5">
              <p className={`font-extrabold text-base ${s.color}`}>{s.value}</p>
              <p className="text-white/50 text-[10px]">{s.label}</p>
              <p className="text-white/35 text-[10px]">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-slate-100">
        {(['positions', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs font-bold transition-colors capitalize ${
              tab === t
                ? 'text-violet-700 border-b-2 border-violet-600 bg-violet-50/50'
                : 'text-slate-500 hover:text-slate-700'
            }`}>
            {t === 'positions' ? `📊 Positions (${myBets.length})` : `📋 Tx History`}
          </button>
        ))}
      </div>

      {tab === 'positions' ? (
        /* ── Positions tab ── */
        <div className="divide-y divide-slate-50">
          {/* Header */}
          <div className="grid grid-cols-[1fr_60px_80px_80px_80px_56px] gap-2 px-5 py-2 bg-slate-50">
            {['Market', 'Side', 'Wagered', 'Cur. Value', 'Max Pay', ''].map(h => (
              <p key={h} className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">{h}</p>
            ))}
          </div>
          {rows.map(({ bet, market, curOdds, curValue, payout, pnl, pnlPct }) => {
            if (!market) return null
            const oddsChanged = curOdds !== bet.odds
            return (
              <div key={bet.marketId}
                className="grid grid-cols-[1fr_60px_80px_80px_80px_56px] gap-2 items-center px-5 py-3.5 hover:bg-slate-50/70 transition-colors">
                {/* Market */}
                <div className="min-w-0">
                  <p className="text-slate-900 text-xs font-semibold truncate">{market.title}</p>
                  <p className="text-slate-400 text-[10px] mt-0.5">{getCountdown(market.endDate)}</p>
                </div>
                {/* Side */}
                <div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    bet.side === 'yes'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {bet.side.toUpperCase()}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {bet.odds}% <span className={oddsChanged ? (curOdds > bet.odds ? 'text-emerald-500' : 'text-red-500') : 'text-slate-300'}>
                      →{curOdds}%
                    </span>
                  </p>
                </div>
                {/* Wagered */}
                <div className="text-right">
                  <p className="text-slate-900 font-bold text-sm">${bet.amount.toFixed(2)}</p>
                  <p className="text-slate-400 text-[10px]">{fmtRelative(bet.time)}</p>
                </div>
                {/* Current value */}
                <div className="text-right">
                  <p className="font-bold text-sm text-slate-900">${curValue.toFixed(2)}</p>
                  <p className={`text-[10px] font-semibold ${pnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                  </p>
                </div>
                {/* Max payout */}
                <div className="text-right">
                  <p className="font-bold text-sm text-amber-600">${payout.toFixed(2)}</p>
                  <p className="text-slate-400 text-[10px]">if wins</p>
                </div>
                {/* Actions: tx link + close button */}
                <div className="flex items-center justify-end gap-1.5">
                  {bet.txHash && (
                    <a href={`https://testnet.arcscan.app/tx/${bet.txHash}`}
                      target="_blank" rel="noreferrer"
                      title="View on ArcScan"
                      className="text-slate-300 hover:text-violet-600 text-sm transition-colors">
                      ↗
                    </a>
                  )}
                  <button
                    onClick={() => setConfirmClose(bet.marketId)}
                    title="Close position"
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold border border-red-200 text-red-400 hover:bg-red-50 hover:border-red-400 hover:text-red-600 transition-colors">
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ── History tab ── */
        <div className="divide-y divide-slate-50">
          {/* Header */}
          <div className="grid grid-cols-[1fr_60px_70px_120px_24px] gap-2 px-5 py-2 bg-slate-50">
            {['Market', 'Side', 'Amount', 'Time', ''].map(h => (
              <p key={h} className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">{h}</p>
            ))}
          </div>
          {[...myBets].reverse().map(bet => {
            const market = markets.find(m => m.id === bet.marketId)
            return (
              <div key={bet.marketId + bet.time}
                className="grid grid-cols-[1fr_60px_70px_120px_24px] gap-2 items-center px-5 py-3 hover:bg-slate-50/70 transition-colors">
                {/* Market */}
                <div className="min-w-0">
                  <p className="text-slate-900 text-xs font-semibold truncate">{market?.title ?? bet.marketId}</p>
                  <p className="text-slate-400 text-[10px] mt-0.5">Market #{bet.marketId}</p>
                </div>
                {/* Side */}
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold w-fit ${
                  bet.side === 'yes'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {bet.side.toUpperCase()} @{bet.odds}%
                </span>
                {/* Amount */}
                <p className="text-slate-900 font-bold text-sm text-right">${bet.amount.toFixed(2)}</p>
                {/* Time */}
                <div>
                  <p className="text-slate-600 text-[10px] font-medium">{fmtTime(bet.time)}</p>
                  <p className="text-slate-400 text-[10px]">{fmtRelative(bet.time)}</p>
                </div>
                {/* Tx hash */}
                <div className="flex justify-end">
                  {bet.txHash ? (
                    <a href={`https://testnet.arcscan.app/tx/${bet.txHash}`}
                      target="_blank" rel="noreferrer"
                      title={`Tx: ${bet.txHash.slice(0,10)}…`}
                      className="text-slate-300 hover:text-violet-600 text-sm transition-colors">
                      ↗
                    </a>
                  ) : (
                    <span className="text-slate-200 text-[10px]">—</span>
                  )}
                </div>
              </div>
            )
          })}
          {myBets.length === 0 && (
            <div className="py-10 text-center">
              <p className="text-slate-400 text-sm">No transactions yet</p>
            </div>
          )}
        </div>
      )}

      {/* ── Close position confirm modal ── */}
      {confirmClose && (() => {
        const closingBet = myBets.find(b => b.marketId === confirmClose)
        const closingMarket = markets.find(m => m.id === confirmClose)
        const closingRow = rows.find(r => r.bet.marketId === confirmClose)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
            onClick={() => setConfirmClose(null)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm flex flex-col gap-4"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <p className="font-extrabold text-slate-900 text-base">Close Position?</p>
                  <p className="text-slate-500 text-xs mt-0.5">This will remove the position from your portfolio.</p>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl px-4 py-3 flex flex-col gap-1.5 text-sm">
                <p className="text-slate-700 font-semibold truncate">{closingMarket?.title ?? `Market #${confirmClose}`}</p>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Side: <span className={`font-bold ${closingBet?.side === 'yes' ? 'text-emerald-600' : 'text-red-500'}`}>{closingBet?.side?.toUpperCase()}</span></span>
                  <span>Wagered: <span className="font-bold text-slate-800">${closingBet?.amount.toFixed(2)}</span></span>
                  {closingRow && (
                    <span>P&L: <span className={`font-bold ${closingRow.pnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {closingRow.pnl >= 0 ? '+' : ''}${closingRow.pnl.toFixed(2)}
                    </span></span>
                  )}
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setConfirmClose(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button onClick={() => { onClose(confirmClose); setConfirmClose(null) }}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors shadow-sm">
                  Close Position
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function PredictionMarketPanel() {
  const { isReady: isConnected, address } = useWallet()
  const { balanceUSDC } = usePerpTrade()
  const betHook = usePredictBet()

  const [markets,  setMarkets]  = useState<Market[]>(INITIAL_MARKETS)
  const [myBets,   setMyBets]   = useState<MyBet[]>(() => loadBets(address))
  const [category, setCategory] = useState<Category>('all')
  const [sortBy,   setSortBy]   = useState<'volume' | 'ending' | 'newest'>('volume')

  // Reload bets whenever the connected wallet changes
  useEffect(() => {
    setMyBets(loadBets(address))
  }, [address])

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

  const handleClose = (marketId: string) => {
    setMyBets(prev => {
      const next = prev.filter(b => b.marketId !== marketId)
      // Persist: remove from full storage (all wallets), keep other wallets' bets
      try {
        const allBets: MyBet[] = JSON.parse(localStorage.getItem(LS_BETS_KEY) ?? '[]')
        const remaining = allBets.filter(b =>
          b.marketId !== marketId ||
          (b.walletAddress && b.walletAddress.toLowerCase() !== (address ?? '').toLowerCase())
        )
        if (remaining.length === 0) localStorage.removeItem(LS_BETS_KEY)
        else localStorage.setItem(LS_BETS_KEY, JSON.stringify(remaining))
      } catch { /* ignore */ }
      return next
    })
  }

  const handleBet = (marketId: string, side: 'yes' | 'no', amount: number, txHash: string) => {
    // Update pool sizes optimistically
    setMarkets(prev => prev.map(m =>
      m.id !== marketId ? m : {
        ...m,
        yesPool: side === 'yes' ? m.yesPool + amount : m.yesPool,
        noPool:  side === 'no'  ? m.noPool  + amount : m.noPool,
      }
    ))
    // Record the bet and persist to localStorage
    const market = markets.find(m => m.id === marketId)!
    const odds   = getOdds(market.yesPool, market.noPool)
    setMyBets(_prev => {
      // Work on all bets (all wallets) for storage, but display is filtered
      const allBets: MyBet[] = (() => {
        try { return JSON.parse(localStorage.getItem(LS_BETS_KEY) ?? '[]') } catch { return [] }
      })()
      const idx = allBets.findIndex(b => b.marketId === marketId && (!b.walletAddress || b.walletAddress.toLowerCase() === (address ?? '').toLowerCase()))
      let nextAll: MyBet[]
      if (idx >= 0) {
        nextAll = [...allBets]
        nextAll[idx] = { ...nextAll[idx], amount: nextAll[idx].amount + amount, txHash }
      } else {
        nextAll = [...allBets, { marketId, side, amount, odds: side === 'yes' ? odds.yes : odds.no, time: Date.now(), txHash, walletAddress: address ?? undefined }]
      }
      localStorage.setItem(LS_BETS_KEY, JSON.stringify(nextAll))
      // Return only this wallet's bets for display
      return nextAll.filter(b => !b.walletAddress || b.walletAddress.toLowerCase() === (address ?? '').toLowerCase())
    })
  }

  return (
    <div className="flex flex-col gap-5">

      {/* ── My Portfolio (top, shown when user has bets) ── */}
      {myBets.length > 0 && (
        <MyBetsSection
          myBets={myBets}
          markets={markets}
          totalBetAmount={totalBetAmount}
          onClose={handleClose}
          onClear={() => {
            setMyBets([])
            // Remove only this wallet's bets; keep other wallets' bets intact
            try {
              const allBets: MyBet[] = JSON.parse(localStorage.getItem(LS_BETS_KEY) ?? '[]')
              const remaining = allBets.filter(b => b.walletAddress && b.walletAddress.toLowerCase() !== (address ?? '').toLowerCase())
              if (remaining.length === 0) localStorage.removeItem(LS_BETS_KEY)
              else localStorage.setItem(LS_BETS_KEY, JSON.stringify(remaining))
            } catch { localStorage.removeItem(LS_BETS_KEY) }
          }}
        />
      )}

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
              <WalletGate label="Connect to bet" variant="button-only" />
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
            hook={betHook}
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

      {/* Disclaimer */}
      <p className="text-center text-[11px] text-slate-400 pb-1">
        ⛓ Bets are real USDC transfers on Arc Testnet · Testnet only · No real money
      </p>
    </div>
  )
}
