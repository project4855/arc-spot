import { useAccount, useChainId } from 'wagmi'
import WalletConnector from './WalletConnector'

const TABS = [
  { key: 'trade',     label: 'Trade',     icon: '💱',  color: 'violet' },
  { key: 'bridge',    label: 'Bridge',    icon: '🌉',  color: 'blue'   },
  { key: 'lending',   label: 'Lend',      icon: '🏦',  color: 'teal'   },
  { key: 'perps',     label: 'Perps',     icon: '⚡',  color: 'yellow' },
  { key: 'traders',   label: 'Agents',    icon: '🤖',  color: 'purple' },
  { key: 'payments',  label: 'Pay',       icon: '💸',  color: 'green'  },
  { key: 'predict',   label: 'Predict',   icon: '🎯',  color: 'orange' },
  { key: 'portfolio', label: 'Treasury',  icon: '🏛️',  color: 'slate'  },
  { key: 'airdrops',  label: 'Community', icon: '🏠',  color: 'pink'   },
  { key: 'wallet',    label: 'Wallet',    icon: '👛',  color: 'emerald'},
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
    <nav className="sticky top-0 z-50 bg-white border-b-2 border-slate-100 shadow-sm">
      <div className="max-w-[1600px] mx-auto px-4 xl:px-6 h-[60px] flex items-center gap-4">

        {/* ── Logo ── */}
        <button
          onClick={() => onTabChange('trade')}
          className="flex items-center gap-2.5 shrink-0 group"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center font-black text-white text-base shadow-sm group-hover:shadow-md transition-all">
            A
          </div>
          <div className="hidden md:flex flex-col leading-none">
            <span className="font-black text-slate-900 text-[14px] tracking-widest">
              ARC<span className="text-violet-600">_ECOSYSTEM</span>
            </span>
            <span className="text-[9px] text-slate-400 font-semibold tracking-widest uppercase mt-0.5">Arc Testnet</span>
          </div>
        </button>

        {/* ── Divider ── */}
        <div className="hidden md:block w-px h-8 bg-slate-200 shrink-0" />

        {/* ── Tab navigation ── */}
        <div className="flex-1 flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0">
          <div className="flex items-center gap-1">
            {TABS.map(t => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => onTabChange(t.key)}
                  title={t.label}
                  className={`
                    flex items-center gap-1.5 px-3 py-2 rounded-xl font-semibold whitespace-nowrap transition-all
                    ${active
                      ? 'bg-violet-600 text-white shadow-md scale-[1.04]'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-violet-50 hover:text-violet-700'
                    }
                  `}
                >
                  <span className="text-[16px] leading-none">{t.icon}</span>
                  <span className="hidden lg:inline text-[13px] font-bold">{t.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Right side ── */}
        <div className="flex items-center gap-2 shrink-0">
          {wrongNet && (
            <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold">
              ⚠ Wrong Network
            </span>
          )}
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="hidden xl:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-bold hover:bg-emerald-100 transition-colors"
          >
            💧 Faucet
          </a>
          <WalletConnector onNavigateToWallet={() => onTabChange('wallet')} />
        </div>

      </div>

      {/* ── Active tab indicator bar ── */}
      <div className="flex max-w-[1600px] mx-auto px-4 xl:px-6 h-[3px]">
        {TABS.map(t => (
          <div
            key={t.key}
            className={`flex-1 transition-all duration-200 ${tab === t.key ? 'bg-violet-500' : 'bg-transparent'}`}
          />
        ))}
      </div>
    </nav>
  )
}
