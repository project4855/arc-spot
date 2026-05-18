import { useState, useCallback } from 'react'
import Navbar from './components/Navbar'
import SwapCard, { type SwapRecord } from './components/SwapCard'
import StatsBar from './components/StatsBar'
import NetworkBadge from './components/NetworkBadge'
import OrderBook from './components/OrderBook'
import PriceChart from './components/PriceChart'
import TransactionHistory from './components/TransactionHistory'
import LendingPanel from './components/LendingPanel'
import HyperliquidPanel from './components/HyperliquidPanel'
import AirdropPanel from './components/AirdropPanel'
import BridgePanel from './components/BridgePanel'
import DerivativesPanel from './components/DerivativesPanel'

const PAIRS = ['USDC/EURC', 'ETH/USDC', 'SOL/USDC', 'cirBTC/USDC', 'USDC/cirBTC', 'EURC/cirBTC'] as const
type Pair = typeof PAIRS[number]
type AppTab = 'trade' | 'bridge' | 'lending' | 'perps' | 'traders' | 'airdrops'

const FEATURES = [
  { icon: '⚡', text: 'Sub-second finality' },
  { icon: '💵', text: 'Gas paid in USDC' },
  { icon: '🔵', text: 'Circle CCTP bridge' },
  { icon: '🔒', text: 'EVM compatible' },
]

export default function App() {
  const [tab, setTab] = useState<AppTab>('trade')
  const [pair, setPair] = useState<Pair>('USDC/EURC')
  const [fromToken, toToken] = pair.split('/') as [string, string]
  const [myTxs, setMyTxs] = useState<SwapRecord[]>([])
  const handleSwapComplete = useCallback((tx: SwapRecord) => {
    setMyTxs((prev) => [tx, ...prev].slice(0, 50))
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Navbar />

      <main className="flex-1 flex flex-col px-4 pt-8 pb-20 gap-8 max-w-[1400px] mx-auto w-full">

        {/* ── Hero ── */}
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-violet-600 via-violet-700 to-blue-700 px-6 py-10 sm:py-14 text-center shadow-xl">
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/15 border border-white/30 text-white text-xs font-semibold mb-5 backdrop-blur-sm">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              Live on Arc Testnet
            </div>

            <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight mb-3">
              DeFi on Arc Network
            </h1>
            <p className="text-violet-200 text-base sm:text-lg mb-8 max-w-xl mx-auto">
              The first stablecoin-native L1 blockchain by Circle. Trade, lend, bridge and track airdrops — all in one place.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {FEATURES.map(f => (
                <span key={f.text} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white text-xs font-medium backdrop-blur-sm">
                  <span>{f.icon}</span>{f.text}
                </span>
              ))}
            </div>

            {/* CTA */}
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-white text-violet-700 font-bold text-sm hover:bg-violet-50 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
            >
              💧 Get Free Testnet USDC
              <span className="text-violet-400 text-xs font-normal">faucet.circle.com</span>
            </a>
          </div>
        </div>

        <NetworkBadge />

        {/* ── Stats bar ── */}
        <StatsBar />

        {/* ── Tab navigation ── */}
        <div className="flex justify-center">
          <div className="flex bg-white border border-slate-200 shadow-sm rounded-2xl p-1.5 gap-2">
            {([
              { key: 'trade',    label: '📊 Trade'    },
              { key: 'bridge',   label: '🌉 Bridge'   },
              { key: 'lending',  label: '🏦 Lending'  },
              { key: 'perps',    label: '⚡ Perps'    },
              { key: 'traders',  label: '🏆 Traders'  },
              { key: 'airdrops', label: '🪂 Airdrops' },
            ] as { key: AppTab; label: string }[]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-8 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  tab === key
                    ? 'bg-violet-600 text-white shadow-lg'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ══ TRADE TAB ══ */}
        {tab === 'trade' && (
          <>
            {/* Pair selector */}
            <div className="flex justify-center gap-2 flex-wrap">
              {PAIRS.map((p) => (
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

            {/* Trading layout */}
            <div id="swap" className="grid grid-cols-1 xl:grid-cols-[1fr_420px_280px] gap-4">
              <div className="flex flex-col gap-4">
                <PriceChart pair={pair} />
                <TransactionHistory pair={pair} myTxs={myTxs} />
              </div>
              <div>
                <SwapCard fromTokenProp={fromToken} toTokenProp={toToken} onSwapComplete={handleSwapComplete} />
              </div>
              <div>
                <OrderBook pair={pair} />
              </div>
            </div>
          </>
        )}

        {/* ══ BRIDGE TAB ══ */}
        {tab === 'bridge' && (
          <>
            <div className="text-center -mt-2 mb-2">
              <p className="text-slate-500 text-sm">
                Bridge USDC from any chain to Arc Testnet · Powered by Circle CCTP
              </p>
            </div>
            <BridgePanel />
          </>
        )}

        {/* ══ LENDING TAB ══ */}
        {tab === 'lending' && (
          <>
            <div className="text-center -mt-2 mb-2">
              <p className="text-slate-500 text-sm">
                Supply assets to earn yield · Borrow against your collateral
              </p>
            </div>
            <LendingPanel />
          </>
        )}

        {/* ══ PERPS TAB ══ */}
        {tab === 'perps' && (
          <>
            <div className="text-center -mt-2 mb-2">
              <p className="text-slate-500 text-sm">
                Perpetual futures · Mark prices · Funding rates · Open interest · Hyperliquid Mainnet
              </p>
            </div>
            <DerivativesPanel />
          </>
        )}

        {/* ══ TRADERS TAB ══ */}
        {tab === 'traders' && (
          <>
            <div className="text-center -mt-2 mb-2">
              <p className="text-slate-500 text-sm">
                Live data from Hyperliquid Mainnet · Updated in real time
              </p>
            </div>
            <HyperliquidPanel />
          </>
        )}

        {/* ══ AIRDROPS TAB ══ */}
        {tab === 'airdrops' && (
          <>
            <div className="text-center -mt-2 mb-2">
              <p className="text-slate-500 text-sm">
                High-potential airdrop projects · Funding raised · How to qualify
              </p>
            </div>
            <AirdropPanel />
          </>
        )}

        {/* ── How it works ── */}
        <div className="w-full max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-slate-900 font-bold text-2xl mb-2">How it works</h2>
            <p className="text-slate-500 text-sm">Get started in three simple steps</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {[
              {
                step: '01',
                icon: '🦊',
                title: 'Connect Your Wallet',
                desc: 'Connect MetaMask or any EVM-compatible wallet. Arc Testnet is added to your wallet automatically.',
              },
              {
                step: '02',
                icon: '💧',
                title: 'Get Testnet USDC',
                desc: 'Visit faucet.circle.com and select Arc Testnet to receive free USDC for testing all features.',
              },
              {
                step: '03',
                icon: '🚀',
                title: 'Trade, Lend & Explore',
                desc: 'Swap tokens instantly, supply assets to earn yield, bridge across chains, and track airdrop opportunities.',
              },
            ].map((item) => (
              <div key={item.step} className="relative bg-white border border-slate-200 shadow-sm rounded-2xl p-6 hover:border-violet-300 hover:shadow-md transition-all group">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-2xl bg-violet-50 border border-violet-200 flex items-center justify-center text-xl group-hover:bg-violet-100 transition-colors">
                    {item.icon}
                  </div>
                  <span className="text-violet-500 font-mono text-xs font-bold">{item.step}</span>
                </div>
                <h3 className="text-slate-900 font-bold text-base mb-2">{item.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Built with section ── */}
        <div className="w-full max-w-4xl mx-auto">
          <p className="text-center text-slate-400 text-xs mb-4 uppercase tracking-widest font-medium">Powered by</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { name: 'Arc Network', desc: 'Stablecoin-native L1', icon: '⚡', href: 'https://arc.io' },
              { name: 'Circle USDC', desc: 'Native gas token', icon: '🔵', href: 'https://circle.com' },
              { name: 'Circle CCTP', desc: 'Cross-chain bridge', icon: '🌉', href: 'https://www.circle.com/cross-chain-transfer-protocol' },
              { name: 'Hyperliquid', desc: 'Live market data', icon: '📈', href: 'https://hyperliquid.xyz' },
            ].map(t => (
              <a key={t.name} href={t.href} target="_blank" rel="noreferrer"
                className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-violet-300 hover:shadow-sm transition-all text-center group">
                <div className="text-2xl mb-2">{t.icon}</div>
                <div className="text-slate-900 font-semibold text-sm group-hover:text-violet-600 transition-colors">{t.name}</div>
                <div className="text-slate-400 text-xs mt-0.5">{t.desc}</div>
              </a>
            ))}
          </div>
        </div>

      </main>

      <footer className="border-t border-slate-200 py-8 px-4">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center font-bold text-white text-xs">A</div>
            <span className="font-semibold text-slate-600">ArcTrade</span>
            <span>· For testnet use only</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://arc.io" target="_blank" rel="noreferrer" className="hover:text-violet-500 transition-colors">Arc Network</a>
            <a href="https://docs.arc.io/app-kit" target="_blank" rel="noreferrer" className="hover:text-violet-500 transition-colors">Circle App Kit</a>
            <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer" className="hover:text-violet-500 transition-colors">Explorer</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
