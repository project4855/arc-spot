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
  const chainId      = useChainId()
  const { isConnected } = useAccount()
  const wrongNet     = isConnected && chainId !== 5042002

  return (
    <nav className="sticky top-0 z-50 bg-white/98 backdrop-blur border-b border-slate-200 shadow-sm">
      <div className="max-w-[1600px] mx-auto px-4 xl:px-6 h-16 flex items-center gap-3">

        {/* ── Logo ── */}
        <button
          onClick={() => onTabChange('trade')}
          className="flex items-center gap-2.5 shrink-0 mr-2 group"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center font-black text-white text-base shadow group-hover:shadow-md transition-all">
            A
          </div>
          {/* Full logo — visible md+ */}
          <div className="hidden md:flex flex-col leading-none">
            <span className="font-black text-slate-900 text-[15px] tracking-widest">
              ARC<span className="text-violet-600">_</span><span className="text-violet-600">ECOSYSTEM</span>
            </span>
            <span className="text-[9px] text-slate-400 font-semibold tracking-widest uppercase mt-0.5">Arc Testnet</span>
          </div>
          {/* Short logo — sm only */}
          <span className="md:hidden font-black text-slate-900 text-[15px] tracking-widest">
            ARC<span className="text-violet-600">_</span>
          </span>
        </button>

        {/* ── Tab navigation ── */}
        <div className="flex-1 flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0">

          {/* Icon-only (< lg) */}
          <div className="flex lg:hidden items-center gap-0.5 w-full">
            {TABS.map(t => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => onTabChange(t.key)}
                  title={t.label}
                  className={`flex-1 flex items-center justify-center py-2 rounded-lg text-lg transition-all min-w-[38px] ${
                    active
                      ? 'bg-violet-600 text-white shadow-sm scale-105'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {t.icon}
                </button>
              )
            })}
          </div>

          {/* Icon + label (lg+) */}
          <div className="hidden lg:flex items-center gap-0.5 w-full">
            {TABS.map(t => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => onTabChange(t.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl font-semibold whitespace-nowrap transition-all min-w-[44px] ${
                    active
                      ? 'bg-violet-600 text-white shadow-md scale-[1.03]'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <span className="text-base leading-none">{t.icon}</span>
                  <span className="text-[13px] font-semibold">{t.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Right side ── */}
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {wrongNet && (
            <span className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold">
              ⚠ Wrong Network
            </span>
          )}
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="hidden xl:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold hover:bg-emerald-100 transition-colors"
          >
            💧 Faucet
          </a>
          <WalletConnector onNavigateToWallet={() => onTabChange('wallet')} />
        </div>

      </div>
    </nav>
  )
}
