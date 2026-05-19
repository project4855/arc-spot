import { useState, useCallback, useEffect } from 'react'
import Navbar from './components/Navbar'
import SwapCard, { type SwapRecord } from './components/SwapCard'
import OrderBook from './components/OrderBook'
import PriceChart from './components/PriceChart'
import TransactionHistory from './components/TransactionHistory'
import LendingPanel from './components/LendingPanel'
import HyperliquidPanel from './components/HyperliquidPanel'
import AirdropPanel from './components/AirdropPanel'
import BridgePanel from './components/BridgePanel'
import DerivativesPanel from './components/DerivativesPanel'
import WalletPanel from './components/WalletPanel'
import PredictionMarketPanel from './components/PredictionMarketPanel'
import PortfolioPanel from './components/PortfolioPanel'
import PaymentsPanel from './components/PaymentsPanel'

// ── Types ─────────────────────────────────────────────────────────────────────

const PAIRS = ['USDC/EURC', 'ETH/USDC', 'SOL/USDC', 'cirBTC/USDC', 'USDC/cirBTC', 'EURC/cirBTC'] as const
type Pair    = typeof PAIRS[number]
type AppTab  = 'trade' | 'bridge' | 'lending' | 'perps' | 'traders' | 'airdrops' | 'wallet' | 'predict' | 'portfolio' | 'payments'

const VALID_TABS: AppTab[] = ['trade', 'bridge', 'lending', 'perps', 'traders', 'airdrops', 'wallet', 'predict', 'portfolio', 'payments']

// ── Tab persistence via URL hash ─────────────────────────────────────────────

function getTabFromHash(): AppTab {
  const hash = window.location.hash.replace('#', '') as AppTab
  return VALID_TABS.includes(hash) ? hash : 'trade'
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab,  setTab]  = useState<AppTab>(getTabFromHash)
  const [pair, setPair] = useState<Pair>('USDC/EURC')
  const [myTxs, setMyTxs] = useState<SwapRecord[]>([])

  const [fromToken, toToken] = pair.split('/') as [string, string]

  // Keep URL hash in sync (no page-jump, works with back/forward)
  const handleTabChange = useCallback((next: string) => {
    const t = VALID_TABS.includes(next as AppTab) ? (next as AppTab) : 'trade'
    setTab(t)
    history.replaceState(null, '', `#${t}`)
  }, [])

  // Sync when user presses browser back / forward
  useEffect(() => {
    const onHash = () => setTab(getTabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const handleSwapComplete = useCallback((tx: SwapRecord) => {
    setMyTxs(prev => [tx, ...prev].slice(0, 50))
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* ── Sticky Navbar (contains tab navigation) ── */}
      <Navbar tab={tab} onTabChange={handleTabChange} />

      {/* ── Slim network info strip ── */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-[1440px] mx-auto px-4 xl:px-6 py-1.5 flex items-center gap-5 text-[11px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="flex items-center gap-1.5 text-emerald-600 font-semibold shrink-0">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Arc Testnet
          </span>
          <span className="text-slate-400 shrink-0">
            Chain <strong className="text-slate-600">5042002</strong>
          </span>
          <span className="text-slate-400 shrink-0">
            Gas: <strong className="text-slate-600">USDC</strong>
          </span>
          <span className="text-slate-400 shrink-0">
            Finality: <strong className="text-slate-600">&lt; 1 second</strong>
          </span>
          <a
            href="https://testnet.arcscan.app"
            target="_blank" rel="noreferrer"
            className="text-violet-600 hover:text-violet-700 font-medium shrink-0"
          >
            ArcScan ↗
          </a>
          <a
            href="https://faucet.circle.com"
            target="_blank" rel="noreferrer"
            className="hidden sm:block text-violet-600 hover:text-violet-700 font-medium shrink-0 ml-auto"
          >
            💧 Get Testnet USDC ↗
          </a>
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="flex-1 max-w-[1440px] mx-auto w-full px-4 xl:px-6 py-5 flex flex-col gap-5">

        {/* ══════════════════ TRADE ══════════════════ */}
        {tab === 'trade' && (
          <>
            {/* Compact hero banner */}
            <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-violet-600 via-violet-700 to-blue-700 px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
              {/* subtle dot pattern */}
              <div
                className="absolute inset-0 opacity-10 pointer-events-none"
                style={{
                  backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
                  backgroundSize: '32px 32px',
                }}
              />
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/30 text-white text-[11px] font-semibold">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    Live on Arc Testnet
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-tight">
                  DeFi on Arc Network
                </h1>
                <p className="text-violet-200 text-sm mt-1">
                  Stablecoin-native L1 by Circle · Sub-second finality · Gas paid in USDC
                </p>
              </div>
              <div className="relative z-10 flex items-center gap-2 flex-wrap shrink-0">
                {[
                  { icon: '⚡', text: 'Sub-second' },
                  { icon: '💵', text: 'USDC gas'   },
                  { icon: '🔵', text: 'Circle CCTP' },
                  { icon: '🔒', text: 'EVM'         },
                ].map(f => (
                  <span key={f.text} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 border border-white/20 text-white text-xs font-medium">
                    {f.icon} {f.text}
                  </span>
                ))}
              </div>
            </div>

            {/* Pair selector */}
            <div className="flex gap-2 flex-wrap">
              {PAIRS.map(p => (
                <button
                  key={p}
                  onClick={() => setPair(p)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                    pair === p
                      ? 'bg-violet-600 border-violet-500 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300 hover:text-slate-900'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Trading layout — chart | swap card | order book */}
            <div id="swap" className="grid grid-cols-1 xl:grid-cols-[1fr_400px_260px] gap-4">
              <div className="flex flex-col gap-4 min-w-0">
                <PriceChart pair={pair} />
                <TransactionHistory pair={pair} myTxs={myTxs} />
              </div>
              <div className="min-w-0">
                <SwapCard
                  fromTokenProp={fromToken}
                  toTokenProp={toToken}
                  onSwapComplete={handleSwapComplete}
                />
              </div>
              <div className="min-w-0">
                <OrderBook pair={pair} />
              </div>
            </div>

            {/* How it works */}
            <div className="pt-2">
              <h2 className="text-slate-900 font-bold text-lg mb-4 text-center">How it works</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  {
                    step: '01', icon: '🦊',
                    title: 'Connect Wallet',
                    desc: 'Connect MetaMask or any EVM-compatible wallet. Arc Testnet is added automatically.',
                  },
                  {
                    step: '02', icon: '💧',
                    title: 'Get Testnet USDC',
                    desc: 'Visit faucet.circle.com and select Arc Testnet to receive free USDC for testing.',
                  },
                  {
                    step: '03', icon: '🚀',
                    title: 'Trade & Explore',
                    desc: 'Swap tokens, supply to earn yield, bridge across chains, and trade perpetual futures.',
                  },
                ].map(item => (
                  <div
                    key={item.step}
                    className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-violet-300 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center text-lg group-hover:bg-violet-100 transition-colors">
                        {item.icon}
                      </div>
                      <span className="text-violet-400 font-mono text-xs font-bold">{item.step}</span>
                    </div>
                    <h3 className="text-slate-900 font-bold text-sm mb-1.5">{item.title}</h3>
                    <p className="text-slate-500 text-xs leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ══════════════════ BRIDGE ══════════════════ */}
        {tab === 'bridge' && <BridgePanel />}

        {/* ══════════════════ LENDING ══════════════════ */}
        {tab === 'lending' && <LendingPanel />}

        {/* ══════════════════ PERPS ══════════════════ */}
        {tab === 'perps' && <DerivativesPanel />}

        {/* ══════════════════ TRADERS ══════════════════ */}
        {tab === 'traders' && <HyperliquidPanel />}

        {/* ══════════════════ AIRDROPS ══════════════════ */}
        {tab === 'airdrops' && <AirdropPanel />}

        {/* ══════════════════ WALLET ══════════════════ */}
        {tab === 'wallet' && <WalletPanel />}

        {/* ══════════════════ PREDICT ══════════════════ */}
        {tab === 'predict' && <PredictionMarketPanel />}

        {/* ══════════════════ PORTFOLIO ══════════════════ */}
        {tab === 'portfolio' && <PortfolioPanel />}

        {/* ══════════════════ PAYMENTS ══════════════════ */}
        {tab === 'payments' && <PaymentsPanel onNavigate={handleTabChange} />}

      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-200 bg-white py-5 px-4">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center font-bold text-white text-[10px]">
              A
            </div>
            <span className="font-semibold text-slate-600">ArcTrade</span>
            <span className="text-slate-300">·</span>
            <span>Testnet only · Not financial advice</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://arc.io"                                                   target="_blank" rel="noreferrer" className="hover:text-violet-500 transition-colors">Arc Network</a>
            <a href="https://docs.arc.io"                                              target="_blank" rel="noreferrer" className="hover:text-violet-500 transition-colors">Docs</a>
            <a href="https://testnet.arcscan.app"                                      target="_blank" rel="noreferrer" className="hover:text-violet-500 transition-colors">Explorer</a>
            <a href="https://faucet.circle.com"                                        target="_blank" rel="noreferrer" className="hover:text-violet-500 transition-colors">Faucet</a>
            <a href="https://www.circle.com/cross-chain-transfer-protocol"             target="_blank" rel="noreferrer" className="hover:text-violet-500 transition-colors">CCTP</a>
          </div>
        </div>
      </footer>

    </div>
  )
}
