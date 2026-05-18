import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useChainId } from 'wagmi'

const TABS = [
  { key: 'trade',    label: 'Trade',    icon: '📊' },
  { key: 'bridge',   label: 'Bridge',   icon: '🌉' },
  { key: 'lending',  label: 'Lending',  icon: '🏦' },
  { key: 'perps',    label: 'Perps',    icon: '⚡' },
  { key: 'traders',  label: 'Traders',  icon: '🏆' },
  { key: 'airdrops', label: 'Airdrops', icon: '🪂' },
  { key: 'wallet',   label: 'Wallet',   icon: '👛' },
] as const

interface NavbarProps {
  tab: string
  onTabChange: (t: string) => void
}

export default function Navbar({ tab, onTabChange }: NavbarProps) {
  const chainId    = useChainId()
  const { isConnected } = useAccount()
  const wrongNet   = isConnected && chainId !== 5042002

  return (
    <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-200 shadow-sm">
      <div className="max-w-[1440px] mx-auto px-4 xl:px-6 h-14 flex items-center gap-2">

        {/* ── Logo ── */}
        <button
          onClick={() => onTabChange('trade')}
          className="flex items-center gap-2 shrink-0 mr-3 group"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center font-extrabold text-white text-sm shadow-sm group-hover:shadow-md transition-shadow">
            A
          </div>
          <span className="text-slate-900 font-bold text-base tracking-tight hidden sm:block">
            Arc<span className="text-violet-600">Trade</span>
          </span>
        </button>

        {/* ── Tab navigation (scrollable, no scrollbar) ── */}
        <div className="flex-1 flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map(t => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => onTabChange(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all shrink-0 ${
                  active
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <span className="text-base leading-none">{t.icon}</span>
                <span className="hidden lg:inline">{t.label}</span>
              </button>
            )
          })}
        </div>

        {/* ── Right: wrong-network warning + faucet + wallet ── */}
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {wrongNet && (
            <span className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
              ⚠ Wrong Network
            </span>
          )}
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="hidden xl:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 transition-colors"
          >
            💧 Faucet
          </a>
          <ConnectButton chainStatus="icon" showBalance={false} accountStatus="avatar" />
        </div>
      </div>
    </nav>
  )
}
