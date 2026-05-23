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
type Pair   = typeof PAIRS[number]
type AppTab = 'trade' | 'bridge' | 'lending' | 'perps' | 'traders' | 'airdrops' | 'wallet' | 'predict' | 'portfolio' | 'payments'

const VALID_TABS: AppTab[] = ['trade', 'bridge', 'lending', 'perps', 'traders', 'airdrops', 'wallet', 'predict', 'portfolio', 'payments']

function getTabFromHash(): AppTab {
  const hash = window.location.hash.replace('#', '') as AppTab
  return VALID_TABS.includes(hash) ? hash : 'trade'
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab,   setTab]   = useState<AppTab>(getTabFromHash)
  const [pair,  setPair]  = useState<Pair>('USDC/EURC')
  const [myTxs, setMyTxs] = useState<SwapRecord[]>([])
  const [fromToken, toToken] = pair.split('/') as [string, string]

  const handleTabChange = useCallback((next: string) => {
    const t = VALID_TABS.includes(next as AppTab) ? (next as AppTab) : 'trade'
    setTab(t)
    history.replaceState(null, '', `#${t}`)
  }, [])

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

      {/* ── Navbar ── */}
      <Navbar tab={tab} onTabChange={handleTabChange} />

      {/* ── Network strip ── */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-[1440px] mx-auto px-4 xl:px-6 py-1.5 flex items-center gap-5 text-[11px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="flex items-center gap-1.5 text-emerald-600 font-semibold shrink-0">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Arc Testnet Live
          </span>
          <span className="text-slate-400 shrink-0">Chain <strong className="text-slate-600">5042002</strong></span>
          <span className="text-slate-400 shrink-0">Gas: <strong className="text-slate-600">USDC</strong></span>
          <span className="text-slate-400 shrink-0">Finality: <strong className="text-slate-600">&lt;1 second</strong></span>
          <span className="text-slate-400 shrink-0">Consensus: <strong className="text-slate-600">Malachite BFT</strong></span>
          <span className="text-slate-400 shrink-0">Throughput: <strong className="text-slate-600">~50k TPS</strong></span>
          <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer" className="text-violet-600 hover:text-violet-700 font-medium shrink-0">ArcScan ↗</a>
          <a href="https://faucet.circle.com"  target="_blank" rel="noreferrer" className="hidden sm:block text-violet-600 hover:text-violet-700 font-medium shrink-0 ml-auto">💧 Get Testnet USDC ↗</a>
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="flex-1 max-w-[1440px] mx-auto w-full px-4 xl:px-6 py-6 flex flex-col gap-10">

        {/* ══════════════════ TRADE / HOME ══════════════════ */}
        {tab === 'trade' && (
          <>

            {/* ── TRADING INTERFACE — TOP ────────────────────────────────────── */}
            <div id="swap">
              <div className="mb-4">
                <p className="text-xs text-violet-600 font-bold uppercase tracking-widest mb-0.5">Live Trading</p>
                <h2 className="text-2xl font-extrabold text-slate-900">Stablecoin FX on Arc Testnet</h2>
              </div>

              <div className="flex gap-3">
                {/* Pair selector — vertical left column */}
                <div className="flex flex-col gap-1.5 shrink-0 w-[130px]">
                  {PAIRS.map(p => (
                    <button key={p} onClick={() => setPair(p)}
                      className={`w-full px-3 py-2 rounded-xl text-sm font-semibold border text-left transition-all ${
                        pair === p
                          ? 'bg-violet-600 border-violet-500 text-white shadow-sm'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300 hover:text-slate-900'
                      }`}>
                      {p}
                    </button>
                  ))}
                </div>

                {/* Chart + Swap + OrderBook */}
                <div className="flex-1 min-w-0">
                  <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px_260px] gap-4">
                    <div className="flex flex-col gap-4 min-w-0">
                      <PriceChart pair={pair} />
                      <TransactionHistory pair={pair} myTxs={myTxs} />
                    </div>
                    <div className="min-w-0">
                      <SwapCard fromTokenProp={fromToken} toTokenProp={toToken} onSwapComplete={handleSwapComplete} />
                    </div>
                    <div className="min-w-0">
                      <OrderBook pair={pair} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── HERO ───────────────────────────────────────────────────────── */}
            <div className="relative rounded-3xl overflow-hidden shadow-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-blue-50 to-indigo-50" />
              <div className="absolute inset-0 opacity-[0.05] pointer-events-none"
                style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
              <div className="absolute -top-24 -left-24 w-[500px] h-[500px] bg-violet-600/15 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -right-24 w-[500px] h-[500px] bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-cyan-600/5 rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10 px-6 sm:px-10 py-14 sm:py-18">
                {/* Badges */}
                <div className="flex flex-wrap items-center gap-2 mb-6">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-100 border border-violet-200 text-violet-700 text-[11px] font-semibold backdrop-blur-sm">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                    Live on Arc Testnet
                  </span>
                  <span className="px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-500 text-[11px] backdrop-blur-sm">
                    Built by Circle
                  </span>
                  <span className="px-3 py-1 rounded-full bg-violet-100 border border-violet-200 text-violet-600 text-[11px] backdrop-blur-sm">
                    Post-Quantum Secure
                  </span>
                </div>

                {/* Headline */}
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight leading-[1.1] mb-4 max-w-3xl">
                  Build real-world<br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 via-cyan-600 to-blue-600">
                    finance onchain
                  </span>
                </h1>

                <p className="text-slate-600 text-base sm:text-lg max-w-2xl leading-relaxed mb-3">
                  Arc is the stablecoin-native Layer-1 blockchain — the <strong className="text-slate-900">Economic OS for the internet</strong>.
                  USDC-denominated gas. Sub-second finality. Opt-in privacy. Native Circle stack integration.
                </p>
                <p className="text-slate-500 text-sm max-w-2xl leading-relaxed mb-8">
                  Backed by Goldman Sachs, Mastercard, and Visa. Trusted by BlackRock, Aave, Morpho, Chainlink and 70+ ecosystem partners.
                </p>

                {/* CTAs */}
                <div className="flex flex-wrap gap-3 mb-10">
                  <a href="https://developers.circle.com/arc" target="_blank" rel="noreferrer"
                    className="px-5 py-2.5 rounded-xl bg-white text-slate-900 text-sm font-bold hover:bg-slate-100 transition-colors shadow-sm">
                    Start building ↗
                  </a>
                  <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
                    className="px-5 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-200 transition-colors backdrop-blur-sm">
                    💧 Get testnet USDC
                  </a>
                  <button onClick={() => document.getElementById('swap')?.scrollIntoView({ behavior: 'smooth' })}
                    className="px-5 py-2.5 rounded-xl bg-violet-600/80 border border-violet-500/50 text-white text-sm font-semibold hover:bg-violet-600 transition-colors">
                    🔄 Try the DEX
                  </button>
                  <a href="https://community.arc.io" target="_blank" rel="noreferrer"
                    className="px-5 py-2.5 rounded-xl bg-emerald-100 border border-emerald-200 text-emerald-700 text-sm font-semibold hover:bg-emerald-200 transition-colors">
                    🏠 Join Arc House
                  </a>
                </div>

                {/* Stats chips */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { icon: '⚡', label: 'Finality',     value: '~780ms avg'      },
                    { icon: '💵', label: 'Gas token',    value: 'USDC (stable)'   },
                    { icon: '🚀', label: 'Throughput',   value: '~50k TPS'        },
                    { icon: '🔒', label: 'Consensus',    value: 'Malachite BFT'   },
                    { icon: '🔐', label: 'Security',     value: 'Quantum-Resistant'},
                    { icon: '🌐', label: 'Chain ID',     value: '5042002'         },
                    { icon: '🔵', label: 'Execution',    value: 'Reth (EVM)'      },
                    { icon: '🤝', label: 'Partners',     value: '70+ Ecosystem'   },
                  ].map(s => (
                    <div key={s.label} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 backdrop-blur-sm">
                      <span className="text-sm">{s.icon}</span>
                      <div>
                        <p className="text-slate-400 text-[9px] uppercase tracking-wide leading-none">{s.label}</p>
                        <p className="text-slate-900 text-[11px] font-semibold leading-none mt-0.5">{s.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── ACTIVE PROGRAMS ────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  icon: '🏆',
                  label: 'Active Challenge',
                  title: 'Stablecoins Commerce Stack Challenge',
                  sub: 'Apr 14 – Jul 13, 2026',
                  desc: 'Build the next great app on Arc\'s stablecoin-native infrastructure. Prizes + Circle Builders Fund.',
                  url: 'https://community.arc.io',
                  color: 'from-violet-600 to-blue-600',
                  border: 'border-violet-300',
                  bg: 'bg-violet-50',
                },
                {
                  icon: '💰',
                  label: 'Arc Builders Fund',
                  title: 'Capital + Hands-on Support',
                  sub: 'Circle Ventures initiative',
                  desc: 'Backs early-stage teams building real-world financial apps with capital and access to Arc\'s core teams.',
                  url: 'https://arc.io/builders-fund',
                  color: 'from-emerald-600 to-teal-600',
                  border: 'border-emerald-300',
                  bg: 'bg-emerald-50',
                },
                {
                  icon: '🎟️',
                  label: 'Circle Developer Grants',
                  title: 'Developer Grants Program',
                  sub: 'Relaunched May 2026',
                  desc: 'Grants for builders on Arc and the Circle Developer Platform. Applications open — apply now.',
                  url: 'https://community.arc.io',
                  color: 'from-orange-500 to-amber-500',
                  border: 'border-amber-300',
                  bg: 'bg-amber-50',
                },
              ].map(p => (
                <a key={p.title} href={p.url} target="_blank" rel="noreferrer"
                  className={`${p.bg} border ${p.border} rounded-2xl p-5 hover:shadow-md transition-all group flex flex-col gap-2`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{p.icon}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r ${p.color} text-white font-bold`}>{p.label}</span>
                  </div>
                  <h3 className="text-slate-900 font-bold text-sm group-hover:text-violet-700 transition-colors">{p.title}</h3>
                  <p className="text-slate-500 text-[11px]">{p.sub}</p>
                  <p className="text-slate-500 text-xs leading-relaxed flex-1">{p.desc}</p>
                  <span className="text-violet-600 text-xs font-semibold mt-1">Learn more →</span>
                </a>
              ))}
            </div>

            {/* ── CORE INFRASTRUCTURE FEATURES ──────────────────────────────── */}
            <div>
              <p className="text-xs text-violet-600 font-bold uppercase tracking-widest text-center mb-2">Infrastructure</p>
              <h2 className="text-2xl font-extrabold text-slate-900 text-center mb-2">
                Purpose-built to support real-world financial flows
              </h2>
              <p className="text-slate-500 text-sm text-center mb-6 max-w-xl mx-auto">
                Arc eliminates the friction points that block institutional finance from going onchain.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  {
                    icon: '💵',
                    title: 'Predictable, Dollar-Based Fees',
                    desc: 'USDC is Arc\'s native gas token. Fees are low, stable, and denominated in dollars — giving enterprises forecastable unit economics and cleaner accounting. Whether you send $1 or $1B, costs stay predictable.',
                    stat: '~$0.001/tx average',
                    color: 'from-emerald-50 to-teal-50 border-emerald-200',
                    iconBg: 'bg-emerald-100 text-emerald-700',
                    statColor: 'text-emerald-600',
                  },
                  {
                    icon: '⚡',
                    title: 'Deterministic Sub-Second Finality',
                    desc: 'Arc\'s Malachite BFT consensus achieves ~780ms average finality. Once confirmed, transactions are final — no reorgs, no challenge periods. Enables real-time financial workflows, instant liquidations, atomic settlement.',
                    stat: '~780ms · 50k TPS',
                    color: 'from-violet-50 to-purple-50 border-violet-200',
                    iconBg: 'bg-violet-100 text-violet-700',
                    statColor: 'text-violet-600',
                  },
                  {
                    icon: '🔐',
                    title: 'Privacy When You Need It',
                    desc: 'Opt-in selective transaction shielding lets businesses protect sensitive details (vendor relationships, amounts, entity activity) while maintaining auditability for regulators and auditors. Privacy VM extends to confidential workflows.',
                    stat: 'KYC/AML compatible',
                    color: 'from-blue-50 to-indigo-50 border-blue-200',
                    iconBg: 'bg-blue-100 text-blue-700',
                    statColor: 'text-blue-600',
                  },
                  {
                    icon: '🔵',
                    title: 'Native Circle Stack Integration',
                    desc: 'Deeply integrated with the full Circle platform: USDC, EURC, CCTP cross-chain transfer, Circle Gateway, Circle Paymaster, App Kits SDKs, and institutional on/offramps — reducing integration friction from months to days.',
                    stat: 'USDC + EURC native',
                    color: 'from-cyan-50 to-sky-50 border-cyan-200',
                    iconBg: 'bg-cyan-100 text-cyan-700',
                    statColor: 'text-cyan-600',
                  },
                ].map(f => (
                  <div key={f.title} className={`bg-gradient-to-br ${f.color} border rounded-2xl p-5 flex flex-col gap-3`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${f.iconBg}`}>{f.icon}</div>
                    <h3 className="text-slate-900 font-bold text-sm leading-snug">{f.title}</h3>
                    <p className="text-slate-500 text-xs leading-relaxed flex-1">{f.desc}</p>
                    <span className={`text-xs font-bold ${f.statColor}`}>{f.stat}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── ARC BLUEPRINTS — ALL USE CASES ────────────────────────────── */}
            <div>
              <p className="text-xs text-violet-600 font-bold uppercase tracking-widest text-center mb-2">Arc Blueprints</p>
              <h2 className="text-2xl font-extrabold text-slate-900 text-center mb-2">Real economic activity unleashed on Arc</h2>
              <p className="text-slate-500 text-sm text-center mb-6 max-w-2xl mx-auto">
                10 deep-dive guides covering every major financial use case. Arc provides the stablecoin-native infrastructure.
                You build the application.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                {[
                  {
                    tab: 'trade',
                    icon: '💱',
                    title: '24/7 Onchain FX',
                    desc: 'Atomic PvP settlement. USDC/EURC pairs with sub-second finality — replacing T+2 with instant.',
                    stat: 'Blueprint',
                    url: 'https://www.arc.io/blog/how-arc-can-support-24-7-onchain-fx-arc-blueprints',
                  },
                  {
                    tab: 'lending',
                    icon: '🏦',
                    title: 'Lending & Borrowing',
                    desc: '$52.73B DeFi TVL. Programmable credit lines, dynamic collateralization, tokenized loan pools.',
                    stat: 'Blueprint · 19K views',
                    url: 'https://www.arc.io/blog/how-arc-supports-lending-and-borrowing-arc-blueprints',
                  },
                  {
                    tab: 'predict',
                    icon: '🎯',
                    title: 'Prediction Markets',
                    desc: 'Volumes quadrupled in 2 years. Multi-currency settlement. Compliance-ready architecture.',
                    stat: 'Blueprint · 20.2K views',
                    url: 'https://www.arc.io/blog/build-institutional-grade-prediction-markets-on-arc-arc-blueprints',
                  },
                  {
                    tab: 'payments',
                    icon: '💸',
                    title: 'Cross-Border Payments',
                    desc: '$857B global remittances (2023). Cut 6–7% fees. Replace T+2–T+5 with sub-second settlement.',
                    stat: 'Blueprint',
                    url: 'https://www.arc.io/blog/how-arc-supports-cross-border-payments-arc-blueprints',
                  },
                  {
                    tab: 'traders',
                    icon: '🤖',
                    title: 'Agentic Economy',
                    desc: 'Nanopayments as small as $0.000001. Machine-to-machine value flows at internet scale via ERC-8183.',
                    stat: 'Blueprint · 14K views',
                    url: 'https://www.arc.io/blog/how-arc-supports-the-agentic-economy-arc-blueprints',
                  },
                  {
                    tab: 'portfolio',
                    icon: '🏦',
                    title: 'Treasury Management',
                    desc: '13.9% CAGR market. Automated multi-entity sweeps, idle cash yield, 24/7 cross-jurisdiction.',
                    stat: 'Blueprint',
                    url: 'https://www.arc.io/blog/how-arc-supports-treasury-management-arc-blueprints',
                  },
                  {
                    tab: 'lending',
                    icon: '📈',
                    title: 'Capital Markets Settlement',
                    desc: 'T+0 atomic DvP. Replace T+1/T+2 settlement cycles. Tokenized securities with automated lifecycle.',
                    stat: 'Blueprint',
                    url: 'https://www.arc.io/blog/how-arc-supports-capital-markets-settlement-arc-blueprints',
                  },
                  {
                    tab: 'lending',
                    icon: '🏗️',
                    title: 'Asset Tokenization',
                    desc: '$600T global financial assets. Tokenize treasuries, private credit, commodities, real estate.',
                    stat: 'Blueprint',
                    url: 'https://www.arc.io/blog/how-arc-supports-asset-tokenization-arc-blueprints',
                  },
                  {
                    tab: 'lending',
                    icon: '💳',
                    title: 'Onchain Credit Markets',
                    desc: '1B+ unbanked adults. Cash-flow credit, identity-based lending, hybrid undercollateralized loans.',
                    stat: 'Blueprint',
                    url: 'https://www.arc.io/blog/how-arc-supports-onchain-credit-markets-arc-blueprints',
                  },
                  {
                    tab: 'traders',
                    icon: '🔗',
                    title: 'Agentic Flows (ERC-8183)',
                    desc: 'Open standard for job escrow, deliverable submission, and automated outcome resolution onchain.',
                    stat: 'Developer Guide',
                    url: 'https://www.arc.io/blog/running-an-agentic-economic-flow-on-arc-with-erc-8183',
                  },
                ].map(u => (
                  <div key={u.title + u.tab} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-2 hover:border-violet-300 hover:shadow-md transition-all group">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{u.icon}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-600 font-semibold border border-violet-100 shrink-0 text-right leading-snug max-w-[80px]">
                        {u.stat}
                      </span>
                    </div>
                    <h3 className="text-slate-900 font-bold text-xs leading-snug">{u.title}</h3>
                    <p className="text-slate-400 text-[10px] leading-relaxed flex-1">{u.desc}</p>
                    <div className="flex items-center justify-between mt-auto pt-1">
                      <button onClick={() => handleTabChange(u.tab)} className="text-violet-500 text-[10px] font-semibold hover:text-violet-700">
                        Open app →
                      </button>
                      <a href={u.url} target="_blank" rel="noreferrer" className="text-slate-400 text-[10px] hover:text-slate-600">
                        Blueprint ↗
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── DEVELOPER TOOLS ────────────────────────────────────────────── */}
            <div>
              <p className="text-xs text-violet-600 font-bold uppercase tracking-widest text-center mb-2">Developer Tools</p>
              <h2 className="text-2xl font-extrabold text-slate-900 text-center mb-2">Ship stablecoin apps faster</h2>
              <p className="text-slate-500 text-sm text-center mb-6 max-w-xl mx-auto">
                Circle's App Kits suite reduces integration complexity to fewer than 10 lines of code per operation.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  {
                    icon: '🌉',
                    name: 'Bridge Kit',
                    desc: 'Move USDC across chains via Circle CCTP. Supports Ethereum, Solana, Avalanche, and Arc Testnet. Production-ready crosschain bridge in minutes.',
                    tag: 'App Kit',
                    tagColor: 'bg-blue-50 text-blue-600 border-blue-200',
                    code: 'npm i @circle-fin/bridge-kit',
                  },
                  {
                    icon: '🔄',
                    name: 'Swap SDK',
                    desc: 'Asset routing and liquidity sourcing with built-in revenue sharing. Works with Circle Wallets or any third-party wallet. BYO RPC.',
                    tag: 'App Kit',
                    tagColor: 'bg-violet-50 text-violet-600 border-violet-200',
                    code: 'npm i @circle-fin/swap-sdk',
                  },
                  {
                    icon: '💸',
                    name: 'Send + Unified Balance Kit',
                    desc: 'One integration for USDC transfers across all supported chains. deposit(), spend(), getBalances() — chain-agnostic. Replaces custom multichain orchestration.',
                    tag: 'App Kit',
                    tagColor: 'bg-emerald-50 text-emerald-600 border-emerald-200',
                    code: 'npm i @circle-fin/unified-balance-kit',
                  },
                  {
                    icon: '🤖',
                    name: 'ERC-8183 Agentic Standard',
                    desc: 'Open standard for agentic economic flows: createJob(), fund(), submit(), complete(). Works with Circle Wallets. Paired with ERC-8004 for agent reputation.',
                    tag: 'Open Standard',
                    tagColor: 'bg-orange-50 text-orange-600 border-orange-200',
                    code: 'blockchain: "ARC-TESTNET"',
                  },
                ].map(t => (
                  <div key={t.name} className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-3 hover:border-violet-300 hover:shadow-sm transition-all">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{t.icon}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-lg border font-semibold ${t.tagColor}`}>{t.tag}</span>
                    </div>
                    <h3 className="text-slate-900 font-bold text-sm">{t.name}</h3>
                    <p className="text-slate-500 text-xs leading-relaxed flex-1">{t.desc}</p>
                    <code className="text-[10px] bg-slate-100 text-emerald-700 px-3 py-1.5 rounded-lg font-mono block border border-slate-200">{t.code}</code>
                  </div>
                ))}
              </div>

              {/* USDC dual interface note */}
              <div className="mt-4 bg-slate-50 border border-slate-200 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <p className="text-emerald-700 text-xs font-bold uppercase tracking-widest mb-2">USDC on Arc: Two Interfaces, One Token</p>
                  <p className="text-slate-600 text-sm leading-relaxed mb-3">
                    USDC is Arc's native gas token AND an ERC-20 — both synchronized in real-time by a precompile.
                    Use the native interface for gas, the ERC-20 for application logic.
                  </p>
                  <div className="flex flex-col gap-2">
                    <div className="bg-white border border-slate-200 rounded-xl p-3">
                      <p className="text-slate-500 text-[10px] mb-1">Native gas balance (18 decimals)</p>
                      <code className="text-cyan-700 text-xs font-mono">publicClient.getBalance(address)</code>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-3">
                      <p className="text-slate-500 text-[10px] mb-1">ERC-20 at 0x3600...0000 (6 decimals)</p>
                      <code className="text-cyan-700 text-xs font-mono">balanceOf(address) → uint256</code>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-violet-600 text-xs font-bold uppercase tracking-widest mb-2">Malachite BFT Consensus</p>
                  <p className="text-slate-600 text-sm leading-relaxed mb-3">
                    Arc's bespoke consensus layer built on Malachite — a Rust-based BFT engine by Informal Systems.
                    Two-binary architecture separates consensus from execution (Reth).
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Avg Finality (100 validators)', val: '~780ms' },
                      { label: 'Small Network Latency', val: '330–490ms' },
                      { label: 'Max Throughput', val: '13.5 MB/s' },
                      { label: 'Equivalent TPS', val: '~50k TPS' },
                    ].map(m => (
                      <div key={m.label} className="bg-white border border-slate-200 rounded-xl p-2.5">
                        <p className="text-slate-500 text-[9px] leading-tight mb-0.5">{m.label}</p>
                        <p className="text-slate-900 font-bold text-sm">{m.val}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── ECOSYSTEM PROJECTS ─────────────────────────────────────────── */}
            <div>
              <p className="text-xs text-violet-600 font-bold uppercase tracking-widest text-center mb-2">Builder Spotlights</p>
              <h2 className="text-2xl font-extrabold text-slate-900 text-center mb-2">Projects building on Arc</h2>
              <p className="text-slate-500 text-sm text-center mb-6 max-w-xl mx-auto">
                Teams from the Arc Builders Fund and Architects Program shipping real apps on Arc Testnet.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {[
                  {
                    name: 'Synthra',
                    icon: '🔷',
                    category: 'DEX / Perps',
                    tagline: 'Spot, Concentrated Liquidity & Perpetuals on Arc',
                    desc: 'Advanced trading infrastructure combining spot DEX, concentrated liquidity pools, and perpetual markets in a unified stablecoin-native platform.',
                    tags: ['Spot DEX', 'Concentrated Liquidity', 'Perpetuals'],
                    event: 'Builder Spotlight · May 20',
                    border: 'border-blue-200',
                    badge: 'bg-blue-50 text-blue-700 border-blue-200',
                  },
                  {
                    name: 'Tower Exchange',
                    icon: '🏗️',
                    category: 'DEX Aggregator',
                    tagline: 'Native Stablecoin DEX Aggregation on Arc',
                    desc: 'Next-generation DEX aggregator purpose-built for stablecoin liquidity on Arc — routing trades across pools for optimal rates with sub-second settlement.',
                    tags: ['DEX Aggregator', 'USDC/EURC', 'Best Execution'],
                    event: 'Builder Spotlight · May 21',
                    border: 'border-violet-200',
                    badge: 'bg-violet-50 text-violet-700 border-violet-200',
                  },
                  {
                    name: 'Tradable',
                    icon: '📊',
                    category: 'Institutional Credit',
                    tagline: 'Institutional Private Credit Onchain',
                    desc: 'Onchain private credit market infrastructure backed by the Arc Builders Fund. Tokenized loan pools with automated lifecycle management for institutional investors.',
                    tags: ['Private Credit', 'RWA', 'Institutional'],
                    event: 'Builders Fund · Apr 3',
                    border: 'border-emerald-200',
                    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  },
                  {
                    name: 'Crossmint',
                    icon: '✦',
                    category: 'Web3 Infrastructure',
                    tagline: 'Fast & Predictable Onchain Agentic Commerce',
                    desc: 'Modular crypto infrastructure making agentic commerce fast and predictable on Arc. Smart wallets + crosschain payments in one integration.',
                    tags: ['Agentic Commerce', 'Smart Wallets', 'Web3 Infra'],
                    event: 'Day One Builder · Feb 24',
                    border: 'border-slate-200',
                    badge: 'bg-slate-50 text-slate-700 border-slate-200',
                  },
                  {
                    name: 'Blockradar',
                    icon: '📡',
                    category: 'Payments',
                    tagline: 'Simplifying Stablecoin Transactions',
                    desc: 'Fast, low-cost money transfers for individuals across borders. Simplifying stablecoin transactions with Arc\'s sub-second finality and USDC-native infrastructure.',
                    tags: ['Remittance', 'USDC Payments', 'Cross-border'],
                    event: 'Day One Builder · Feb 25',
                    border: 'border-orange-200',
                    badge: 'bg-orange-50 text-orange-700 border-orange-200',
                  },
                  {
                    name: 'Morpho',
                    icon: '🌀',
                    category: 'DeFi Lending',
                    tagline: 'Open Credit Network on Arc',
                    desc: 'Open credit network connecting lenders and borrowers worldwide. Morpho integrates with Arc\'s stablecoin-native infrastructure for efficient lending markets.',
                    tags: ['Lending', 'Credit Markets', 'DeFi'],
                    event: 'Partner Spotlight · Apr 29',
                    border: 'border-indigo-200',
                    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                  },
                ].map(p => (
                  <div key={p.name} className={`bg-white border-2 ${p.border} rounded-2xl p-5 hover:shadow-md transition-all flex flex-col gap-3`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl shrink-0">{p.icon}</div>
                        <div>
                          <h3 className="text-slate-900 font-extrabold text-base leading-none">{p.name}</h3>
                          <p className="text-slate-400 text-[10px] mt-0.5">{p.category}</p>
                        </div>
                      </div>
                      <span className={`text-[9px] px-2 py-1 rounded-lg border font-semibold shrink-0 ${p.badge}`}>{p.event}</span>
                    </div>
                    <p className="text-slate-600 text-xs font-semibold">{p.tagline}</p>
                    <p className="text-slate-400 text-xs leading-relaxed flex-1">{p.desc}</p>
                    <div className="flex flex-wrap gap-1">
                      {p.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-medium">{tag}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Challenge banner */}
              <div className="mt-4 bg-gradient-to-r from-violet-100 via-blue-50 to-indigo-50 border border-violet-200 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] text-violet-600 font-bold uppercase tracking-widest mb-1">🏆 Active Until Jul 13, 2026</p>
                  <h3 className="text-slate-900 font-bold text-lg">The Stablecoins Commerce Stack Challenge</h3>
                  <p className="text-slate-600 text-sm mt-1">Build the next great commerce app on Arc. Prizes, Arc Builders Fund backing, and Circle developer support.</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <a href="https://community.arc.io" target="_blank" rel="noreferrer"
                    className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 transition-colors">
                    Join Challenge ↗
                  </a>
                </div>
              </div>
            </div>

            {/* ── ECOSYSTEM PARTNERS ─────────────────────────────────────────── */}
            <div>
              <p className="text-xs text-violet-600 font-bold uppercase tracking-widest text-center mb-2">Ecosystem</p>
              <h2 className="text-2xl font-extrabold text-slate-900 text-center mb-2">70+ partners building the internet financial system</h2>
              <p className="text-slate-500 text-sm text-center mb-6 max-w-xl mx-auto">
                From global banks and asset managers to DeFi protocols and fintech startups — the Arc ecosystem spans every financial category.
              </p>

              {/* Partner grid by category */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  {
                    category: '🏛️ Traditional Finance & Banks',
                    color: 'border-slate-200 bg-slate-50',
                    partners: ['Goldman Sachs', 'Mastercard', 'Visa', 'BlackRock', 'Deutsche Bank', 'HSBC', 'State Street', 'BNY', 'Standard Chartered', 'Societe Generale', 'Commerzbank'],
                  },
                  {
                    category: '🔷 DeFi Protocols',
                    color: 'border-violet-200 bg-violet-50',
                    partners: ['Aave', 'Morpho', 'Maple', 'Fluid', 'Curve', 'Across', 'Stargate', 'LayerZero', 'Centrifuge', 'Securitize'],
                  },
                  {
                    category: '🛠️ Infrastructure & Tools',
                    color: 'border-blue-200 bg-blue-50',
                    partners: ['Chainlink', 'Alchemy', 'Axelar', 'QuickNode', 'Blockscout', 'Elliptic', 'Chainalysis', 'TRM Labs', 'RedStone', 'Pimlico'],
                  },
                  {
                    category: '💳 Payments & Wallets',
                    color: 'border-emerald-200 bg-emerald-50',
                    partners: ['MetaMask', 'Ledger', 'Coinbase', 'Fireblocks', 'Bridge', 'Copperx', 'Dynamic', 'Privy', 'Hurupay', 'Blockradar'],
                  },
                ].map(cat => (
                  <div key={cat.category} className={`border rounded-2xl p-4 ${cat.color}`}>
                    <p className="text-slate-700 font-bold text-xs mb-3">{cat.category}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {cat.partners.map(p => (
                        <span key={p} className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[10px] font-medium shadow-sm">{p}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── PARTNER TESTIMONIALS ───────────────────────────────────────── */}
            <div>
              <p className="text-xs text-violet-600 font-bold uppercase tracking-widest text-center mb-2">Trusted By</p>
              <h2 className="text-2xl font-extrabold text-slate-900 text-center mb-6">Global institutions chose Arc</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    org: 'Goldman Sachs',
                    icon: '🏛️',
                    person: 'Mathew McDermott',
                    role: 'Global Head of Digital Assets',
                    quote: 'We\'re excited to be part of an initiative that tests how programmable settlement and interoperable FX workflows can enhance regulated markets.',
                    accent: 'border-l-4 border-slate-400',
                  },
                  {
                    org: 'Mastercard',
                    icon: '🔴🔵',
                    person: 'Raj Dhamodharan',
                    role: 'EVP, Blockchain & Digital Assets',
                    quote: 'Deepening our longstanding work with Circle as an early design partner, Mastercard is exploring how we can help shape Arc\'s foundation to enable secure, simple payment experiences across both fiat and stablecoin rails.',
                    accent: 'border-l-4 border-red-400',
                  },
                  {
                    org: 'Visa',
                    icon: '🔵',
                    person: 'Cuy Sheffield',
                    role: 'Head of Crypto',
                    quote: 'Arc\'s design — integrating stablecoin-based gas fees, deterministic finality, and programmable interoperability — offers a strong environment to explore how trusted payments networks can connect to and help scale emerging onchain infrastructure.',
                    accent: 'border-l-4 border-blue-400',
                  },
                ].map(t => (
                  <div key={t.org} className={`bg-white border border-slate-200 ${t.accent} rounded-r-2xl rounded-tl-2xl p-5 flex flex-col gap-4`}>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{t.icon}</span>
                      <div>
                        <p className="text-slate-900 font-bold text-sm">{t.org}</p>
                        <p className="text-slate-400 text-[10px]">{t.person} · {t.role}</p>
                      </div>
                    </div>
                    <blockquote className="text-slate-600 text-xs leading-relaxed italic flex-1">
                      "{t.quote}"
                    </blockquote>
                  </div>
                ))}
              </div>
            </div>

            {/* ── COMMUNITY — ARC HOUSE & ARCHITECTS ────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Arc House */}
              <div className="bg-gradient-to-br from-violet-100 to-blue-50 border border-violet-200 rounded-2xl p-6 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-violet-200 flex items-center justify-center text-2xl">🏠</div>
                  <div>
                    <h3 className="text-slate-900 font-extrabold text-lg">Arc House</h3>
                    <p className="text-violet-600 text-xs">Central hub for the Arc ecosystem</p>
                  </div>
                </div>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Your home base for everything happening in Arc — tutorials, ArcTalks, ArcShops developer office hours,
                  community meetups, hackathons, builder spotlights, and partner announcements. Join 1000s of builders.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {['ArcTalks', 'ArcShops Dev Hours', 'Builder Spotlights', 'Partner Spotlights', 'Stablecoin 101', 'Arc Blueprints'].map(item => (
                    <div key={item} className="flex items-center gap-1.5">
                      <span className="w-1 h-1 bg-violet-500 rounded-full" />
                      <span className="text-slate-600 text-[11px]">{item}</span>
                    </div>
                  ))}
                </div>
                <a href="https://community.arc.io" target="_blank" rel="noreferrer"
                  className="mt-auto px-4 py-2 rounded-xl bg-violet-600 border border-violet-500 text-white text-sm font-bold hover:bg-violet-700 transition-colors text-center">
                  Join Arc House ↗
                </a>
              </div>

              {/* Architects Program */}
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-6 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-emerald-200 flex items-center justify-center text-2xl">🏛️</div>
                  <div>
                    <h3 className="text-slate-900 font-extrabold text-lg">Architects Program</h3>
                    <p className="text-emerald-600 text-xs">Arc's community ambassador initiative · Launched Apr 2026</p>
                  </div>
                </div>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Merit-based recognition for those who actively contribute to Arc's growth. Earn points, unlock
                  tiers, and gain exclusive access. Not application-driven — earn your way in by building and contributing.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { role: '🎙️ Technical Speaker', desc: 'Share knowledge' },
                    { role: '📍 Meetup Organizer', desc: 'Lead regional events' },
                    { role: '🛡️ Community Moderator', desc: 'Guide the community' },
                    { role: '🌍 Regional Lead', desc: 'Expand Arc globally' },
                  ].map(r => (
                    <div key={r.role} className="bg-white border border-emerald-100 rounded-xl p-2.5">
                      <p className="text-slate-900 text-[11px] font-semibold">{r.role}</p>
                      <p className="text-slate-500 text-[10px]">{r.desc}</p>
                    </div>
                  ))}
                </div>
                <a href="https://community.arc.io" target="_blank" rel="noreferrer"
                  className="mt-auto px-4 py-2 rounded-xl bg-emerald-600 border border-emerald-500 text-white text-sm font-bold hover:bg-emerald-700 transition-colors text-center">
                  Become an Architect ↗
                </a>
              </div>
            </div>

            {/* ── QUICK START ────────────────────────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <h2 className="text-slate-900 font-bold text-lg mb-1 text-center">Get started in 3 steps</h2>
              <p className="text-slate-500 text-sm text-center mb-6">From zero to building on Arc Testnet in minutes.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {[
                  {
                    step: '01', icon: '🦊',
                    title: 'Connect Your Wallet',
                    desc: 'Connect MetaMask, Coinbase Wallet, or any EVM-compatible wallet. Arc Testnet (Chain ID 5042002, RPC: rpc.testnet.arc.network) is added automatically.',
                    link: null,
                  },
                  {
                    step: '02', icon: '💧',
                    title: 'Get Testnet USDC & EURC',
                    desc: 'Visit faucet.circle.com and select Arc Testnet to receive free USDC and EURC for testing. Gas is paid in USDC — no ETH needed.',
                    link: { label: 'faucet.circle.com ↗', url: 'https://faucet.circle.com' },
                  },
                  {
                    step: '03', icon: '🚀',
                    title: 'Explore & Build',
                    desc: 'Swap tokens, earn yield via lending, bridge across chains, trade perpetuals, place prediction market bets, and explore agentic payment flows.',
                    link: { label: 'Arc Blueprints ↗', url: 'https://www.arc.io/blog' },
                  },
                ].map(s => (
                  <div key={s.step} className="flex gap-4 items-start">
                    <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center text-lg shrink-0">{s.icon}</div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-violet-400 font-mono text-[10px] font-bold">{s.step}</span>
                        <h3 className="text-slate-900 font-bold text-sm">{s.title}</h3>
                      </div>
                      <p className="text-slate-500 text-xs leading-relaxed">{s.desc}</p>
                      {s.link && (
                        <a href={s.link.url} target="_blank" rel="noreferrer"
                          className="inline-block mt-2 text-violet-600 text-xs font-semibold hover:text-violet-500">
                          {s.link.label}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </>
        )}

        {/* ══════════════════ OTHER TABS ══════════════════ */}
        {tab === 'bridge'    && <BridgePanel />}
        {tab === 'lending'   && <LendingPanel />}
        {tab === 'perps'     && <DerivativesPanel />}
        {tab === 'traders'   && <HyperliquidPanel />}
        {tab === 'airdrops'  && <AirdropPanel />}
        {tab === 'wallet'    && <WalletPanel />}
        {tab === 'predict'   && <PredictionMarketPanel />}
        {tab === 'portfolio' && <PortfolioPanel />}
        {tab === 'payments'  && <PaymentsPanel onNavigate={handleTabChange} />}

      </main>

      {/* ── FOOTER ── */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-[1440px] mx-auto px-4 xl:px-6 py-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-8 mb-8">
            {/* Brand */}
            <div className="xl:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center font-extrabold text-white text-sm shadow-sm">A</div>
                <span className="text-slate-900 font-bold text-lg">Arc<span className="text-violet-600">Ecosystem</span></span>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed mb-3 max-w-xs">
                A community-built DeFi explorer on Arc Testnet — the stablecoin-native L1 by Circle, the Economic OS for the internet. Built by the Architects community.
              </p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {['Goldman Sachs', 'Mastercard', 'Visa', 'BlackRock'].map(p => (
                  <span key={p} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-medium">{p}</span>
                ))}
                <span className="text-slate-300 text-[10px] self-center">+ design partners of Arc</span>
              </div>
              <p className="text-slate-300 text-[10px]">Testnet only · Not financial advice · Not affiliated with Circle Technology Services, LLC</p>
            </div>

            {/* Arc Network */}
            <div>
              <p className="text-slate-700 font-bold text-xs uppercase tracking-widest mb-3">Arc Network</p>
              <div className="flex flex-col gap-2">
                {[
                  { label: 'Arc Website',    url: 'https://www.arc.io'                    },
                  { label: 'Documentation',  url: 'https://developers.circle.com/arc'      },
                  { label: 'Block Explorer', url: 'https://testnet.arcscan.app'            },
                  { label: 'Faucet',         url: 'https://faucet.circle.com'             },
                  { label: 'Arc Blog',       url: 'https://www.arc.io/blog'               },
                  { label: 'Bug Bounty',     url: 'https://hackerone.com'                 },
                  { label: 'Open Source',    url: 'https://github.com/circlefin'          },
                ].map(l => (
                  <a key={l.label} href={l.url} target="_blank" rel="noreferrer"
                    className="text-slate-400 hover:text-violet-600 text-xs transition-colors">{l.label} ↗</a>
                ))}
              </div>
            </div>

            {/* Community */}
            <div>
              <p className="text-slate-700 font-bold text-xs uppercase tracking-widest mb-3">Community</p>
              <div className="flex flex-col gap-2">
                {[
                  { label: 'Arc House',              url: 'https://community.arc.io'       },
                  { label: 'Discord',                url: 'https://discord.gg/buildonarc' },
                  { label: 'Architects Program',     url: 'https://community.arc.io'       },
                  { label: 'Arc Builders Fund',      url: 'https://arc.io/builders-fund'  },
                  { label: 'Commerce Challenge',     url: 'https://community.arc.io'       },
                  { label: 'Circle Grants',          url: 'https://community.arc.io'       },
                  { label: 'ArcTalks',               url: 'https://community.arc.io'       },
                ].map(l => (
                  <a key={l.label} href={l.url} target="_blank" rel="noreferrer"
                    className="text-slate-400 hover:text-violet-600 text-xs transition-colors">{l.label} ↗</a>
                ))}
              </div>
            </div>

            {/* Circle */}
            <div>
              <p className="text-slate-700 font-bold text-xs uppercase tracking-widest mb-3">Circle</p>
              <div className="flex flex-col gap-2">
                {[
                  { label: 'Circle.com',      url: 'https://www.circle.com'                    },
                  { label: 'USDC',            url: 'https://www.circle.com/usdc'               },
                  { label: 'EURC',            url: 'https://www.circle.com/eurc'               },
                  { label: 'CCTP',            url: 'https://www.circle.com/cross-chain-transfer-protocol' },
                  { label: 'Circle Gateway',  url: 'https://www.circle.com'                    },
                  { label: 'App Kits',        url: 'https://developers.circle.com/arc'         },
                  { label: 'Circle Paymaster',url: 'https://developers.circle.com'             },
                ].map(l => (
                  <a key={l.label} href={l.url} target="_blank" rel="noreferrer"
                    className="text-slate-400 hover:text-violet-600 text-xs transition-colors">{l.label} ↗</a>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="pt-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-400 text-center sm:text-left">
              © 2026 ArcEcosystem · Community project · Not affiliated with Circle Technology Services, LLC · Arc is a product of Circle
            </p>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-xs text-emerald-600 font-medium">Arc Testnet Live</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  )
}
