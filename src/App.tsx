import { useState } from 'react'
import Navbar from './components/Navbar'
import SwapCard from './components/SwapCard'
import StatsBar from './components/StatsBar'
import NetworkBadge from './components/NetworkBadge'
import OrderBook from './components/OrderBook'
import PriceChart from './components/PriceChart'
import TransactionHistory from './components/TransactionHistory'

const PAIRS = ['USDC/EURC', 'USDC/cirBTC', 'EURC/cirBTC'] as const
type Pair = typeof PAIRS[number]

export default function App() {
  const [pair, setPair] = useState<Pair>('USDC/EURC')
  const [fromToken, toToken] = pair.split('/') as [string, string]

  return (
    <div className="min-h-screen bg-[#0a0b0e] flex flex-col">
      <Navbar />

      <main className="flex-1 flex flex-col px-4 pt-6 pb-16 gap-6 max-w-[1400px] mx-auto w-full">

        {/* Hero text */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium mb-3">
            <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
            Live on Arc Testnet
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Spot Trade on{' '}
            <span className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
              Arc Network
            </span>
          </h1>
          <p className="mt-2 text-gray-400 text-sm sm:text-base">
            Sub-second finality · Gas fees in USDC · Circle App Kit
          </p>
        </div>

        <NetworkBadge />

        {/* Pair selector */}
        <div className="flex justify-center gap-2 flex-wrap">
          {PAIRS.map((p) => (
            <button
              key={p}
              onClick={() => setPair(p)}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                pair === p
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'bg-[#0d0e12] border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Faucet banner */}
        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 w-full max-w-xl mx-auto px-4 py-3 rounded-2xl bg-green-500/10 border border-green-500/25 hover:border-green-500/50 hover:bg-green-500/15 transition-all group"
        >
          <span className="text-2xl">💧</span>
          <div className="flex-1 text-left">
            <p className="text-green-400 font-semibold text-sm">Get Free Testnet USDC</p>
            <p className="text-green-500/70 text-xs mt-0.5">faucet.circle.com → select Arc Testnet</p>
          </div>
          <span className="text-green-500 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
        </a>

        {/* Main trading layout */}
        <div id="swap" className="grid grid-cols-1 xl:grid-cols-[1fr_420px_280px] gap-4">

          {/* Left: Chart + Transactions */}
          <div className="flex flex-col gap-4">
            <PriceChart pair={pair} />
            <TransactionHistory pair={pair} />
          </div>

          {/* Center: Swap card */}
          <div>
            <SwapCard fromTokenProp={fromToken} toTokenProp={toToken} />
          </div>

          {/* Right: Order book */}
          <div>
            <OrderBook pair={pair} />
          </div>
        </div>

        {/* Stats bar */}
        <StatsBar />

        {/* How it works */}
        <div className="w-full max-w-3xl mx-auto">
          <h2 className="text-center text-white font-semibold text-xl mb-5">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { step: '01', title: 'Connect Wallet', desc: 'Connect MetaMask or any EVM wallet. Arc Testnet is added automatically.' },
              { step: '02', title: 'Get Testnet USDC', desc: 'Visit the Circle faucet to get free USDC on Arc Testnet for testing.' },
              { step: '03', title: 'Swap Tokens', desc: 'Choose your pair, enter amount, and swap instantly with sub-second finality.' },
            ].map((item) => (
              <div key={item.step} className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-5 hover:border-violet-500/40 transition-colors">
                <div className="text-violet-500 font-mono text-xs font-bold mb-3">{item.step}</div>
                <h3 className="text-white font-semibold mb-2">{item.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-800 py-6 px-4 text-center text-xs text-gray-600">
        Built on{' '}
        <a href="https://arc.network" target="_blank" rel="noreferrer" className="text-violet-500 hover:text-violet-400">Arc Network</a>
        {' '}· Powered by{' '}
        <a href="https://docs.arc.io/app-kit" target="_blank" rel="noreferrer" className="text-violet-500 hover:text-violet-400">Circle App Kit</a>
        {' '}· For testnet use only
      </footer>
    </div>
  )
}
