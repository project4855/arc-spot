import { useAccount, useChainId } from 'wagmi'
import WalletConnector from './WalletConnector'

const TABS = [
  { key: 'trade',     label: 'Trade',     icon: '💱' },
  { key: 'bridge',    label: 'Bridge',    icon: '🌉' },
  { key: 'lending',   label: 'Lend',      icon: '🏦' },
  { key: 'perps',     label: 'Perps',     icon: '⚡' },
  { key: 'traders',   label: 'Agents',    icon: '🤖' },
  { key: 'payments',  label: 'Pay',       icon: '💸' },
  { key: 'predict',   label: 'Predict',   icon: '🎯' },
  { key: 'portfolio', label: 'Treasury',  icon: '🏛️' },
  { key: 'airdrops',  label: 'Community', icon: '🏠' },
  { key: 'wallet',    label: 'Wallet',    icon: '👛' },
] as const

interface NavbarProps {
  tab: string
  onTabChange: (t: string) => void
}

export default function Navbar({ tab, onTabChange }: NavbarProps) {
  const chainId         = useChainId()
  const { isConnected } = useAccount()
  const wrongNet        = isConnected && chainId !== 5042002

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-[1600px] mx-auto px-6 h-[68px] flex items-center gap-6">

        {/* ── Logo ── */}
        <button
          onClick={() => onTabChange('trade')}
          className="flex items-center gap-3 shrink-0 group"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center font-black text-white text-lg shadow-sm group-hover:shadow-md transition-all">
            A
          </div>
          <div className="hidden md:flex flex-col leading-none">
            <span className="font-black text-slate-900 text-[15px] tracking-widest">
              ARC<span className="text-violet-600">_ECOSYSTEM</span>
            </span>
            <span className="text-[9px] text-slate-400 font-semibold tracking-widest uppercase mt-0.5">Arc Testnet</span>
          </div>
        </button>

        <div className="hidden md:block w-px h-8 bg-slate-200 shrink-0" />

        {/* ── Tabs ── */}
        <div className="flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0">
          <div className="flex items-center gap-2 min-w-max">
            {TABS.map(t => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => onTabChange(t.key)}
                  className={`
                    flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all
                    ${active
                      ? 'bg-violet-600 text-white shadow-md'
                      : 'text-slate-600 hover:bg-violet-50 hover:text-violet-700'
                    }
                  `}
                >
                  <span className="text-[18px] leading-none">{t.icon}</span>
                  <span className="text-[15px]">{t.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Right ── */}
        <div className="flex items-center gap-2 shrink-0">
          {wrongNet && (
            <span className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm font-bold">
              ⚠ Wrong Network
            </span>
          )}
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
            className="hidden xl:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-bold hover:bg-emerald-100 transition-colors">
            💧 Faucet
          </a>
          <WalletConnector onNavigateToWallet={() => onTabChange('wallet')} />
        </div>

      </div>

      {/* Active indicator */}
      <div className="h-[3px] bg-slate-100">
        <div
          className="h-full bg-violet-500 transition-all duration-300"
          style={{
            width: `${100 / TABS.length}%`,
            marginLeft: `${(TABS.findIndex(t => t.key === tab) / TABS.length) * 100}%`,
          }}
        />
      </div>
    </nav>
  )
}
