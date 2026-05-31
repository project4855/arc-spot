import { useAccount, useChainId } from 'wagmi'
import WalletConnector from './WalletConnector'

const TABS = [
  { key: 'trade',     label: 'Trade'     },
  { key: 'agent',     label: '🤖 AI Agent', highlight: true },
  { key: 'bridge',    label: 'Bridge'    },
  { key: 'lending',   label: 'Earn'      },
  { key: 'perps',     label: 'Perps'     },
  { key: 'traders',   label: 'Agents'    },
  { key: 'payments',  label: 'Pay'       },
  { key: 'predict',   label: 'Predict'   },
  { key: 'portfolio', label: 'Treasury'  },
  { key: 'airdrops',  label: 'Community' },
  { key: 'wallet',    label: 'Wallet'    },
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
    <nav className="sticky top-0 z-50 bg-white border-b border-[#EAECEF] h-[56px] flex items-stretch shadow-none">
      <div className="max-w-[1800px] mx-auto w-full px-4 flex items-stretch">

        {/* ── Logo ── */}
        <button
          onClick={() => onTabChange('trade')}
          className="flex items-center gap-2.5 shrink-0 mr-5 hover:opacity-80 transition-opacity"
        >
          <div className="w-7 h-7 bg-[#F0B90B] rounded-sm flex items-center justify-center font-black text-[#1E2329] text-[13px] select-none">
            A
          </div>
          <div className="hidden md:flex flex-col leading-none gap-0.5">
            <span className="font-bold text-[#1E2329] text-[15px] tracking-tight">
              Arc<span style={{ color: '#F0B90B' }}>Ecosystem</span>
            </span>
            <span className="text-[9px] text-[#B7BDC6] font-medium tracking-widest uppercase">
              Arc Testnet
            </span>
          </div>
        </button>

        {/* ── Divider ── */}
        <div className="w-px bg-[#EAECEF] my-3 mr-4 shrink-0" />

        {/* ── Nav tabs ── */}
        <div className="flex items-stretch flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map(t => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => onTabChange(t.key)}
                style={{ paddingLeft: '2.5rem', paddingRight: '2.5rem' }}
                className={[
                  'h-full shrink-0 text-[13px] font-medium whitespace-nowrap tracking-wider',
                  'border-b-2 transition-colors',
                  active
                    ? 'border-[#F0B90B] text-[#1E2329] font-semibold'
                    : (t as { highlight?: boolean }).highlight
                      ? 'border-transparent text-violet-600 hover:text-violet-700 hover:bg-violet-50'
                      : 'border-transparent text-[#707A8A] hover:text-[#1E2329]',
                ].join(' ')}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* ── Right side ── */}
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {wrongNet && (
            <span className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-sm bg-[#FFF8E1] border border-[#F0B90B]/40 text-[#B8860B] text-[12px] font-medium">
              ⚠ Wrong Network
            </span>
          )}
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="hidden lg:flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium text-[#707A8A] hover:text-[#1E2329] hover:bg-[#F5F5F5] rounded transition-colors"
          >
            💧 Faucet
          </a>
          <WalletConnector onNavigateToWallet={() => onTabChange('wallet')} />
        </div>

      </div>
    </nav>
  )
}
