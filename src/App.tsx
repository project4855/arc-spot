import Navbar from './components/Navbar'
import SwapCard from './components/SwapCard'
import StatsBar from './components/StatsBar'
import NetworkBadge from './components/NetworkBadge'

export default function App() {
  return (
    <div className="min-h-screen bg-[#0a0b0e] flex flex-col">
      <Navbar />

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-start px-4 pt-12 pb-16 gap-8">
        {/* Headline */}
        <div className="text-center max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium mb-4">
            <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
            Live on Arc Testnet
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight">
            Spot Trade on{' '}
            <span className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">
              Arc Network
            </span>
          </h1>
          <p className="mt-3 text-gray-400 text-base sm:text-lg">
            Swap USDC, EURC, and cirBTC instantly with sub-second finality.
            Gas fees paid in USDC.
          </p>
        </div>

        {/* Network badge (shows only when connected) */}
        <NetworkBadge />

        {/* Faucet banner */}
        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 w-full max-w-md px-4 py-3 rounded-2xl bg-green-500/10 border border-green-500/25 hover:border-green-500/50 hover:bg-green-500/15 transition-all group"
        >
          <span className="text-2xl">💧</span>
          <div className="flex-1 text-left">
            <p className="text-green-400 font-semibold text-sm">Get Free Testnet USDC</p>
            <p className="text-green-500/70 text-xs mt-0.5">faucet.circle.com → select Arc Testnet</p>
          </div>
          <span className="text-green-500 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
        </a>

        {/* Swap card */}
        <div id="swap" className="w-full max-w-md">
          <SwapCard />
        </div>

        {/* Stats */}
        <StatsBar />

        {/* How it works */}
        <div className="w-full max-w-3xl mt-4">
          <h2 className="text-center text-white font-semibold text-xl mb-6">
            How it works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                step: '01',
                title: 'Connect Wallet',
                desc: 'Connect MetaMask or any EVM wallet. Arc Testnet is added automatically.',
              },
              {
                step: '02',
                title: 'Get Testnet USDC',
                desc: 'Visit the Circle faucet to get free USDC on Arc Testnet for testing.',
              },
              {
                step: '03',
                title: 'Swap Tokens',
                desc: 'Choose your tokens, enter an amount, and swap instantly with ~0 gas.',
              },
            ].map((item) => (
              <div
                key={item.step}
                className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-5 hover:border-violet-500/40 transition-colors"
              >
                <div className="text-violet-500 font-mono text-xs font-bold mb-3">
                  {item.step}
                </div>
                <h3 className="text-white font-semibold mb-2">{item.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-6 px-4 text-center text-xs text-gray-600">
        <p>
          Built on{' '}
          <a href="https://arc.network" target="_blank" rel="noreferrer" className="text-violet-500 hover:text-violet-400">
            Arc Network
          </a>{' '}
          · Powered by{' '}
          <a href="https://docs.arc.io/app-kit" target="_blank" rel="noreferrer" className="text-violet-500 hover:text-violet-400">
            Circle App Kit
          </a>{' '}
          · For testnet use only
        </p>
      </footer>
    </div>
  )
}
