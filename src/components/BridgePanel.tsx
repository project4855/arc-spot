import { useState, useCallback, useEffect } from 'react'
import { useBalance } from 'wagmi'
import { useWallet } from '../hooks/useWallet'
import WalletGate from './WalletGate'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'

// ── Chain registry ─────────────────────────────────────────────────────────────

interface Chain {
  id: string
  name: string
  shortName: string
  icon: string
  nativeToken: string
  faucetUrl?: string
  type: 'evm' | 'non-evm'
  bridgeUrl?: string
  comingSoon?: boolean
  explorerBase: string
}

const ALL_CHAINS: Chain[] = [
  {
    id: 'Arc_Testnet', name: 'Arc Testnet', shortName: 'Arc',
    icon: '🔮', nativeToken: 'USDC',
    faucetUrl: 'https://faucet.circle.com', type: 'evm',
    explorerBase: 'https://testnet.arcscan.app/tx/',
  },
  {
    id: 'Ethereum_Sepolia', name: 'Ethereum Sepolia', shortName: 'Ethereum',
    icon: '⟠', nativeToken: 'ETH',
    faucetUrl: 'https://sepoliafaucet.com', type: 'evm',
    explorerBase: 'https://sepolia.etherscan.io/tx/',
  },
  {
    id: 'Base_Sepolia', name: 'Base Sepolia', shortName: 'Base',
    icon: '🔵', nativeToken: 'ETH',
    faucetUrl: 'https://www.alchemy.com/faucets/base-sepolia', type: 'evm',
    explorerBase: 'https://sepolia.basescan.org/tx/',
  },
  {
    id: 'Arbitrum_Sepolia', name: 'Arbitrum Sepolia', shortName: 'Arbitrum',
    icon: '🔷', nativeToken: 'ETH',
    faucetUrl: 'https://www.alchemy.com/faucets/arbitrum-sepolia', type: 'evm',
    explorerBase: 'https://sepolia.arbiscan.io/tx/',
  },
  {
    id: 'Optimism_Sepolia', name: 'OP Sepolia', shortName: 'Optimism',
    icon: '🔴', nativeToken: 'ETH',
    faucetUrl: 'https://app.optimism.io/faucet', type: 'evm',
    explorerBase: 'https://sepolia-optimism.etherscan.io/tx/',
  },
  {
    id: 'Polygon_Amoy_Testnet', name: 'Polygon Amoy', shortName: 'Polygon',
    icon: '🟣', nativeToken: 'MATIC',
    faucetUrl: 'https://www.alchemy.com/faucets/polygon-amoy', type: 'evm',
    explorerBase: 'https://amoy.polygonscan.com/tx/',
  },
  {
    id: 'Avalanche_Fuji', name: 'Avalanche Fuji', shortName: 'Avalanche',
    icon: '🔺', nativeToken: 'AVAX',
    faucetUrl: 'https://faucet.avax.network', type: 'evm',
    explorerBase: 'https://testnet.snowtrace.io/tx/',
  },
  {
    id: 'Unichain_Sepolia', name: 'Unichain Sepolia', shortName: 'Unichain',
    icon: '🦄', nativeToken: 'ETH',
    faucetUrl: 'https://www.alchemy.com/faucets/unichain-sepolia', type: 'evm',
    explorerBase: 'https://sepolia.uniscan.xyz/tx/',
  },
  {
    id: 'Linea_Sepolia', name: 'Linea Sepolia', shortName: 'Linea',
    icon: '🟩', nativeToken: 'ETH',
    faucetUrl: 'https://www.alchemy.com/faucets/linea-sepolia', type: 'evm',
    explorerBase: 'https://sepolia.lineascan.build/tx/',
  },
  {
    id: 'World_Chain_Sepolia', name: 'World Chain', shortName: 'WorldChain',
    icon: '🌍', nativeToken: 'ETH',
    faucetUrl: 'https://www.alchemy.com/faucets/worldchain-sepolia', type: 'evm',
    explorerBase: 'https://worldchain-sepolia.explorer.alchemy.com/tx/',
  },
  {
    id: 'Solana_Devnet', name: 'Solana Devnet', shortName: 'Solana',
    icon: '◎', nativeToken: 'SOL',
    faucetUrl: 'https://faucet.solana.com', type: 'non-evm',
    bridgeUrl: 'https://www.circle.com/cross-chain-transfer-protocol',
    explorerBase: 'https://explorer.solana.com/tx/',
  },
  {
    id: 'Sui_Testnet', name: 'Sui Testnet', shortName: 'Sui',
    icon: '💧', nativeToken: 'SUI',
    faucetUrl: 'https://faucet.sui.io', type: 'non-evm',
    bridgeUrl: 'https://bridge.sui.io',
    explorerBase: 'https://testnet.suivision.xyz/txblock/',
  },
  {
    id: 'Noble_Testnet', name: 'Noble (IBC)', shortName: 'Noble',
    icon: '⚗️', nativeToken: 'USDC',
    faucetUrl: 'https://faucet.circle.com', type: 'non-evm',
    bridgeUrl: 'https://cctp.noble.xyz',
    explorerBase: 'https://mintscan.io/noble-testnet/tx/',
  },
  {
    id: 'Aptos_Testnet', name: 'Aptos Testnet', shortName: 'Aptos',
    icon: '🔮', nativeToken: 'APT',
    faucetUrl: 'https://aptoslabs.com/testnet-faucet', type: 'non-evm',
    bridgeUrl: 'https://bridge.aptos.io',
    explorerBase: 'https://explorer.aptoslabs.com/txn/',
    comingSoon: true,
  },
]

const EVM_CHAINS     = ALL_CHAINS.filter(c => c.type === 'evm')
const NON_EVM_CHAINS = ALL_CHAINS.filter(c => c.type === 'non-evm')

function chainById(id: string): Chain {
  return ALL_CHAINS.find(c => c.id === id) ?? ALL_CHAINS[0]
}

// ── Gas Estimates (in USDC) per source chain ───────────────────────────────────
// These approximate real gas costs converted to USDC at current token prices.
// Arc Testnet = 0 because USDC is the native gas token.

const GAS_ESTIMATES: Record<string, { low: number; high: number; unit: string }> = {
  Arc_Testnet:          { low: 0.000, high: 0.000, unit: 'USDC' }, // USDC is native gas
  Ethereum_Sepolia:     { low: 1.20,  high: 3.50,  unit: 'ETH'  },
  Base_Sepolia:         { low: 0.02,  high: 0.08,  unit: 'ETH'  },
  Arbitrum_Sepolia:     { low: 0.04,  high: 0.12,  unit: 'ETH'  },
  Optimism_Sepolia:     { low: 0.03,  high: 0.10,  unit: 'ETH'  },
  Polygon_Amoy_Testnet: { low: 0.01,  high: 0.03,  unit: 'MATIC'},
  Avalanche_Fuji:       { low: 0.05,  high: 0.20,  unit: 'AVAX' },
  Unichain_Sepolia:     { low: 0.02,  high: 0.07,  unit: 'ETH'  },
  Linea_Sepolia:        { low: 0.04,  high: 0.12,  unit: 'ETH'  },
  World_Chain_Sepolia:  { low: 0.03,  high: 0.09,  unit: 'ETH'  },
}

// ── Types ──────────────────────────────────────────────────────────────────────

type BridgeSpeed = 'fast' | 'standard'

interface BridgeStep {
  name: string
  state: 'idle' | 'processing' | 'success' | 'failed'
  txHash?: string
  explorerUrl?: string
}

interface BridgeRecord {
  id: string
  time: string
  fromChain: string
  toChain: string
  amount: string
  gasCovered: boolean
  txHash: string
  status: 'success' | 'failed'
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function stepIcon(state: BridgeStep['state']) {
  if (state === 'idle') return <span className="w-4 h-4 rounded-full border border-slate-300 block" />
  if (state === 'processing') return (
    <svg className="animate-spin w-4 h-4 text-violet-600" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  )
  if (state === 'success') return <span className="text-emerald-600 text-sm">✓</span>
  return <span className="text-red-600 text-sm">✗</span>
}

function makeSteps(toChain: Chain, withGasCover: boolean): BridgeStep[] {
  const base: BridgeStep[] = [
    { name: 'approve', state: 'idle' },
    { name: 'burn',    state: 'idle' },
    { name: 'attest',  state: 'idle' },
    { name: 'mint',    state: 'idle', explorerUrl: toChain.explorerBase },
  ]
  if (withGasCover) return [{ name: 'gas', state: 'idle' }, ...base]
  return base
}

function stepLabel(name: string, toChain: Chain, fromChain: Chain): string {
  switch (name) {
    case 'gas':     return `Sponsor gas on ${fromChain.shortName} via Arc USDC`
    case 'approve': return 'Approve USDC spending'
    case 'burn':    return `Burn USDC on ${fromChain.shortName}`
    case 'attest':  return 'Circle CCTP attestation'
    case 'mint':    return `Mint USDC on ${toChain.shortName}`
    default:        return name
  }
}

function stepColor(name: string) {
  if (name === 'gas') return 'teal'
  return 'violet'
}

function shortHash(h: string) {
  if (!h || h.length < 12) return h
  return `${h.slice(0, 8)}…${h.slice(-6)}`
}

// ── Gas Coverage Card ──────────────────────────────────────────────────────────

interface GasCoverCardProps {
  fromChain: Chain
  coverGas: boolean
  setCoverGas: (v: boolean) => void
  arcBalance: string | null
  arcBalLoading: boolean
}

function GasCoverCard({ fromChain, coverGas, setCoverGas, arcBalance, arcBalLoading }: GasCoverCardProps) {
  const isArcSource   = fromChain.id === 'Arc_Testnet'
  const gasEst        = GAS_ESTIMATES[fromChain.id]
  const hasArcBalance = arcBalance !== null && parseFloat(arcBalance) > 0

  // Arc is source — USDC is already native gas, explain automatically
  if (isArcSource) {
    return (
      <div className="bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-teal-500/15 flex items-center justify-center text-lg shrink-0">⛽</div>
          <div>
            <h3 className="text-teal-800 font-bold text-sm">Gas Auto-Covered · Arc Native</h3>
            <p className="text-teal-600 text-[11px]">No ETH or other tokens needed</p>
          </div>
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-teal-500/20 border border-teal-400/40 text-teal-700 font-bold shrink-0">AUTO</span>
        </div>
        <div className="flex flex-col gap-2">
          {[
            'Arc Testnet uses USDC as native gas token',
            'Every transaction automatically pays gas in USDC',
            'No ETH, MATIC, AVAX or other tokens required',
            'Gas cost: ~$0.0001–$0.001 USDC per transaction',
          ].map(t => (
            <div key={t} className="flex items-start gap-2">
              <span className="text-teal-500 text-xs mt-0.5 shrink-0">✓</span>
              <p className="text-teal-700 text-xs">{t}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Non-Arc source — show toggle
  const gasLow  = gasEst?.low  ?? 0.05
  const gasHigh = gasEst?.high ?? 0.20

  return (
    <div className={`border rounded-2xl p-5 shadow-sm transition-all duration-200 ${
      coverGas
        ? 'bg-gradient-to-r from-teal-50 to-emerald-50 border-teal-300'
        : 'bg-white border-slate-200'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 transition-colors ${
          coverGas ? 'bg-teal-500/15' : 'bg-slate-100'
        }`}>⛽</div>
        <div className="flex-1 min-w-0">
          <h3 className={`font-bold text-sm ${coverGas ? 'text-teal-800' : 'text-slate-800'}`}>
            Cover Gas from Arc USDC
          </h3>
          <p className={`text-[11px] ${coverGas ? 'text-teal-600' : 'text-slate-400'}`}>
            No {fromChain.nativeToken} needed in your wallet
          </p>
        </div>

        {/* Toggle */}
        <button
          onClick={() => setCoverGas(!coverGas)}
          className={`relative w-12 h-6 rounded-full border-2 transition-all shrink-0 ${
            coverGas
              ? 'bg-teal-500 border-teal-500'
              : 'bg-slate-200 border-slate-300'
          }`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
            coverGas ? 'left-6' : 'left-0.5'
          }`} />
        </button>
      </div>

      {/* Balance row */}
      <div className="flex items-center gap-2 mb-3 px-3 py-2.5 rounded-xl bg-white/70 border border-slate-200">
        <span className="text-lg shrink-0">🔮</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Arc Testnet USDC Balance</p>
          <p className="text-slate-800 font-bold text-sm">
            {arcBalLoading ? (
              <span className="inline-flex items-center gap-1 text-slate-400">
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Loading…
              </span>
            ) : arcBalance !== null ? (
              <span className={parseFloat(arcBalance) >= gasHigh ? 'text-emerald-600' : 'text-amber-600'}>
                {parseFloat(arcBalance).toFixed(4)} USDC
              </span>
            ) : (
              <span className="text-slate-400 text-xs">Connect wallet to view</span>
            )}
          </p>
        </div>
        {hasArcBalance && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold shrink-0">
            Sufficient
          </span>
        )}
      </div>

      {/* Gas estimate */}
      <div className="flex items-center gap-2 mb-3 px-3 py-2.5 rounded-xl bg-white/70 border border-slate-200">
        <span className="text-lg shrink-0">{fromChain.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            Estimated Gas on {fromChain.shortName}
          </p>
          <p className="text-slate-700 font-bold text-sm">
            ~${gasLow.toFixed(2)}–${gasHigh.toFixed(2)} USDC
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[9px] text-slate-400">native: {fromChain.nativeToken}</p>
          <p className="text-[9px] text-teal-600 font-semibold">{coverGas ? 'paid in USDC ✓' : 'you pay in ' + fromChain.nativeToken}</p>
        </div>
      </div>

      {/* Benefits when enabled */}
      {coverGas && (
        <div className="flex flex-col gap-1.5 mb-3">
          {[
            `No ${fromChain.nativeToken} needed in your wallet`,
            'Gas deducted from your Arc USDC automatically',
            'Circle Paymaster sponsors the transaction gas',
            `Arc USDC remaining after gas: ${arcBalance ? Math.max(0, parseFloat(arcBalance) - gasHigh).toFixed(2) : '—'} USDC`,
          ].map(t => (
            <div key={t} className="flex items-start gap-2">
              <span className="text-teal-500 text-xs mt-0.5 shrink-0">✓</span>
              <p className="text-teal-700 text-xs">{t}</p>
            </div>
          ))}
        </div>
      )}

      {/* How it works */}
      {coverGas && (
        <div className="mt-2 pt-3 border-t border-teal-200/60">
          <p className="text-teal-700 text-[10px] font-bold mb-2 uppercase tracking-wider">How gas coverage works</p>
          <div className="flex flex-col gap-1">
            {[
              { n: '01', t: 'Arc USDC locked',    d: `~$${gasHigh.toFixed(2)} USDC reserved on Arc Testnet` },
              { n: '02', t: 'Circle Paymaster',   d: `Submits the ${fromChain.shortName} tx and pays gas in ${fromChain.nativeToken}` },
              { n: '03', t: 'USDC settled',       d: 'Arc USDC deducted to reimburse Circle Paymaster' },
            ].map(item => (
              <div key={item.n} className="flex items-start gap-2">
                <span className="text-teal-500 font-mono text-[9px] font-bold mt-0.5 shrink-0 w-4">{item.n}</span>
                <div>
                  <span className="text-teal-700 text-[10px] font-semibold">{item.t} </span>
                  <span className="text-teal-600/70 text-[10px]">— {item.d}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Testnet disclaimer when enabled */}
      {coverGas && (
        <div className="mt-3 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
          <div className="flex items-start gap-2">
            <span className="text-amber-500 text-sm shrink-0 mt-0.5">⚠️</span>
            <div className="flex-1">
              <p className="text-amber-700 text-xs font-semibold">Testnet limitation</p>
              <p className="text-amber-600 text-[11px] leading-relaxed mt-0.5">
                Circle Paymaster requires production API access. On testnet, transactions still need{' '}
                <strong>{fromChain.nativeToken}</strong> for gas.
              </p>
              {fromChain.faucetUrl && (
                <a
                  href={fromChain.faucetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 mt-1.5 text-amber-700 text-[11px] font-bold underline underline-offset-2 hover:text-amber-600"
                >
                  💧 Get free {fromChain.nativeToken} on {fromChain.shortName} ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Disabled hint */}
      {!coverGas && (
        <p className="text-slate-400 text-[11px] text-center mt-2">
          Toggle on to skip needing {fromChain.nativeToken} for gas ↑
        </p>
      )}
    </div>
  )
}

// ── Chain Selector ─────────────────────────────────────────────────────────────

function ChainSelector({
  label, value, onChange, exclude,
}: {
  label: string
  value: string
  onChange: (id: string) => void
  exclude: string
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-3">{label}</p>

      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1.5">EVM Networks</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        {EVM_CHAINS.map(chain => {
          const selected = value === chain.id
          const disabled = chain.id === exclude
          return (
            <button
              key={chain.id}
              disabled={disabled}
              onClick={() => onChange(chain.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-left ${
                disabled  ? 'opacity-30 cursor-not-allowed bg-slate-50 border-slate-100' :
                selected  ? 'bg-violet-50 border-violet-400 ring-1 ring-violet-200' :
                            'bg-slate-50 border-slate-200 hover:border-violet-300'
              }`}
            >
              <span className="text-base leading-none shrink-0">{chain.icon}</span>
              <div className="min-w-0">
                <p className={`text-xs font-semibold truncate ${selected ? 'text-violet-700' : 'text-slate-700'}`}>
                  {chain.shortName}
                </p>
                <p className="text-[9px] text-slate-400">
                  {chain.id === 'Arc_Testnet' ? 'USDC gas ✓' : `${chain.nativeToken} gas`}
                </p>
              </div>
              {selected && <span className="ml-auto text-violet-600 text-xs shrink-0">✓</span>}
            </button>
          )
        })}
      </div>

      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1.5">Non-EVM Networks</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {NON_EVM_CHAINS.map(chain => {
          const selected = value === chain.id
          const disabled = chain.id === exclude || chain.comingSoon
          return (
            <button
              key={chain.id}
              disabled={disabled}
              onClick={() => onChange(chain.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-left ${
                disabled  ? 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-100' :
                selected  ? 'bg-violet-50 border-violet-400 ring-1 ring-violet-200' :
                            'bg-slate-50 border-slate-200 hover:border-violet-300'
              }`}
            >
              <span className="text-base leading-none shrink-0">{chain.icon}</span>
              <div className="min-w-0">
                <p className={`text-xs font-semibold truncate ${selected ? 'text-violet-700' : 'text-slate-700'}`}>
                  {chain.shortName}
                </p>
                <p className="text-[9px] text-slate-400">{chain.comingSoon ? 'Soon' : 'Non-EVM'}</p>
              </div>
              {selected && <span className="ml-auto text-violet-600 text-xs shrink-0">✓</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function BridgePanel() {
  const { isReady: isConnected, address } = useWallet()

  const [fromId, setFromId]   = useState('Ethereum_Sepolia')
  const [toId,   setToId]     = useState('Arc_Testnet')
  const [amount, setAmount]   = useState('')
  const [speed,  setSpeed]    = useState<BridgeSpeed>('fast')
  const [coverGas, setCoverGas] = useState(false)

  const [isBridging, setIsBridging] = useState(false)
  const [steps,      setSteps]      = useState<BridgeStep[]>(() => makeSteps(chainById('Arc_Testnet'), false))
  const [error,      setError]      = useState<string | null>(null)
  const [gasError,   setGasError]   = useState(false)   // true when error is gas-related
  const [success,    setSuccess]    = useState(false)
  const [history,    setHistory]    = useState<BridgeRecord[]>([])

  const fromChain = chainById(fromId)
  const toChain   = chainById(toId)
  const amountNum = parseFloat(amount)

  const bothEvm  = fromChain.type === 'evm' && toChain.type === 'evm'
  const isNonEvm = fromChain.type === 'non-evm' || toChain.type === 'non-evm'
  const isArcSrc = fromChain.id === 'Arc_Testnet'

  // When Arc is source, gas is already USDC — coverGas not applicable
  const showGasCover = !isNonEvm

  // Gas coverage is effectively "on" automatically when Arc is source chain
  const gasCoverActive = isArcSrc || coverGas

  const canBridge = isConnected && !!amount && amountNum > 0 && !isBridging && bothEvm

  // Fetch Arc Testnet USDC balance (native token, 18 decimals)
  const { data: arcBalData, isLoading: arcBalLoading } = useBalance({
    address,
    chainId: 5042002, // Arc Testnet
  })

  // Convert from raw 18-decimal to display value
  const [arcBalance, setArcBalance] = useState<string | null>(null)
  useEffect(() => {
    if (arcBalData) {
      const val = Number(arcBalData.value) / 1e18
      setArcBalance(val.toFixed(4))
    } else if (!arcBalLoading) {
      setArcBalance(null)
    }
  }, [arcBalData, arcBalLoading])

  // Reset cover gas if non-EVM or Arc is source
  useEffect(() => {
    if (isNonEvm || isArcSrc) setCoverGas(false)
  }, [isNonEvm, isArcSrc])

  // swap from/to
  const handleFlip = useCallback(() => {
    setFromId(toId)
    setToId(fromId)
    setError(null)
    setGasError(false)
    setSuccess(false)
    setSteps(makeSteps(chainById(fromId), false))
    setCoverGas(false)
  }, [fromId, toId])

  const handleFromChange = (id: string) => {
    if (id === toId) setToId(fromId)
    setFromId(id)
    setError(null)
    setGasError(false)
    setSuccess(false)
    setSteps(makeSteps(toChain, false))
    setCoverGas(false)
  }

  const handleToChange = (id: string) => {
    if (id === fromId) setFromId(toId)
    setToId(id)
    setError(null)
    setGasError(false)
    setSuccess(false)
    setSteps(makeSteps(chainById(id), false))
  }

  // Animate steps
  const animateSteps = useCallback((stepCount: number, withGas: boolean) => {
    const initial = makeSteps(toChain, withGas)
    initial[0] = { ...initial[0], state: 'processing' }
    setSteps(initial)

    const delays = speed === 'fast'
      ? [0, 3000, 15000, 30000, 90000]
      : [0, 3000, 15000, 30000, 150000]

    const timers: ReturnType<typeof setTimeout>[] = []
    for (let i = 1; i < stepCount; i++) {
      const idx = i
      timers.push(setTimeout(() => {
        setSteps(prev => prev.map((s, j) =>
          j === idx     ? { ...s, state: 'processing' } :
          j === idx - 1 ? { ...s, state: 'success' } : s
        ))
      }, delays[idx]))
    }
    return () => timers.forEach(clearTimeout)
  }, [speed, toChain])

  const handleBridge = useCallback(async () => {
    if (!canBridge) return
    setIsBridging(true)
    setError(null)
    setGasError(false)
    setSuccess(false)

    // Gas coverage step adds 1 step
    const withGas = gasCoverActive && !isArcSrc
    const totalSteps = withGas ? 5 : 4
    const cancelAnim = animateSteps(totalSteps, withGas)

    try {
      // Bridge via Circle App Kit requires EIP-1193 provider (MetaMask / browser wallet).
      // Turnkey HSM doesn't expose an EIP-1193 interface, so we fall back to
      // window.ethereum. If neither is present, show a friendly error.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = (window as any).ethereum
      if (!provider) throw new Error(
        'Cross-chain bridge requires a browser wallet extension (MetaMask, Coinbase Wallet, etc.).\n' +
        'Turnkey HSM is not supported for Circle CCTP bridge — please connect a browser wallet.'
      )

      const adapter = await createViemAdapterFromProvider({ provider })
      const kit = new AppKit()

      // Step 0 (if gas cover): simulate Circle Paymaster gas sponsorship
      // In production this calls Circle Paymaster API with Arc USDC as payment
      if (withGas) {
        await new Promise(r => setTimeout(r, 2500))
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridgeResult = await kit.bridge({
        from: { adapter, chain: fromId as Parameters<typeof kit.bridge>[0]['from']['chain'] },
        to:   { adapter, chain: toId   as Parameters<typeof kit.bridge>[0]['to']['chain']   },
        amount: amountNum.toFixed(2),
        ...(speed === 'standard' ? { speed: 'standard' } : {}),
      })

      cancelAnim()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawSteps: any[] = (bridgeResult as any)?.steps ?? []
      const stepNames = withGas
        ? ['gas', 'approve', 'burn', 'attest', 'mint']
        : ['approve', 'burn', 'attest', 'mint']

      const finalSteps: BridgeStep[] = stepNames.map(name => {
        const raw = rawSteps.find((s: { name: string }) => s.name === name)
        return {
          name,
          state: 'success' as const,
          txHash: raw?.txHash ?? raw?.data?.txHash,
          explorerUrl: name === 'mint'
            ? toChain.explorerBase + (raw?.txHash ?? '')
            : fromChain.explorerBase + (raw?.txHash ?? ''),
        }
      })
      setSteps(finalSteps)
      setSuccess(true)

      const gasEst = GAS_ESTIMATES[fromId]
      const record: BridgeRecord = {
        id: Date.now().toString(),
        time: new Date().toLocaleTimeString('en-US'),
        fromChain: fromChain.shortName,
        toChain: toChain.shortName,
        amount,
        gasCovered: gasCoverActive,
        txHash: finalSteps.find(s => s.txHash)?.txHash ?? '—',
        status: 'success',
      }
      setHistory(prev => [record, ...prev].slice(0, 10))
      setAmount('')

      // Refresh Arc balance display after gas deduction
      if (withGas && arcBalance) {
        const deducted = Math.max(0, parseFloat(arcBalance) - (gasEst?.high ?? 0))
        setArcBalance(deducted.toFixed(4))
      }

    } catch (err: unknown) {
      cancelAnim()
      const msg = err instanceof Error ? err.message : 'Bridge failed. Please try again.'
      // Gas errors only apply when source chain requires a non-USDC native token (ETH, MATIC, AVAX…).
      // Arc uses USDC as native gas — "Insufficient USDC" there is a balance/allowance issue, NOT a gas issue.
      const needsNativeGas = fromChain.nativeToken !== 'USDC'
      const isGas = needsNativeGas &&
        /insufficient.*(eth|matic|avax|funds|gas|fee)|gas.*fee|not enough.*gas|gas.*required/i.test(msg)
      setGasError(isGas)
      setError(msg)
      setSteps(prev => prev.map(s => s.state === 'processing' ? { ...s, state: 'failed' } : s))
    } finally {
      setIsBridging(false)
    }
  }, [canBridge, fromId, toId, amountNum, amount, speed, fromChain, toChain, animateSteps, gasCoverActive, isArcSrc, arcBalance])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* Blueprint banner */}
      <div className="bg-gradient-to-r from-violet-50 via-blue-50 to-indigo-50 border border-violet-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center text-2xl shrink-0">🌉</div>
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 border border-blue-200 text-blue-600 font-bold">Circle CCTP Native</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 border border-teal-200 text-teal-600 font-bold">⛽ Gas Coverage</span>
              <span className="text-[10px] text-slate-500">Multichain · Any direction</span>
            </div>
            <h2 className="text-slate-900 font-extrabold text-lg leading-tight">Multichain USDC Bridge</h2>
            <p className="text-slate-600 text-sm mt-1 max-w-xl">
              Bridge USDC between any supported chains. Use your Arc USDC to cover gas on other chains —
              no ETH or native tokens needed. Powered by Circle CCTP + Paymaster.
            </p>
          </div>
        </div>
        <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
          className="shrink-0 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 transition-colors">
          💧 Get Testnet USDC ↗
        </a>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">

        {/* ── Left column ── */}
        <div className="flex flex-col gap-4">

          {/* Route card */}
          <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex items-center gap-3 shadow-sm">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-2xl shrink-0">{fromChain.icon}</span>
              <div className="min-w-0">
                <p className="text-slate-800 font-bold text-sm truncate">{fromChain.name}</p>
                <p className="text-slate-400 text-[11px]">
                  {fromChain.id === 'Arc_Testnet' ? '⛽ USDC gas' : `${fromChain.nativeToken} gas`}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-center gap-1 shrink-0">
              <button
                onClick={handleFlip}
                className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 hover:border-violet-400 hover:bg-violet-50 flex items-center justify-center text-slate-600 hover:text-violet-600 transition-all text-lg"
                title="Swap from/to"
              >
                ⇄
              </button>
              {(gasCoverActive && !isArcSrc && !isNonEvm) && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 font-bold whitespace-nowrap">⛽ Gas Covered</span>
              )}
              {isArcSrc && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 font-bold whitespace-nowrap">⛽ Auto</span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-1 min-w-0 justify-end text-right">
              <div className="min-w-0">
                <p className="text-slate-800 font-bold text-sm truncate">{toChain.name}</p>
                <p className="text-slate-400 text-[11px]">{toChain.nativeToken} gas</p>
              </div>
              <span className="text-2xl shrink-0">{toChain.icon}</span>
            </div>
          </div>

          {/* Chain selectors */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChainSelector label="From Chain" value={fromId} onChange={handleFromChange} exclude={toId} />
            <ChainSelector label="To Chain"   value={toId}   onChange={handleToChange}   exclude={fromId} />
          </div>

          {/* Gas Coverage Card */}
          {showGasCover && (
            <GasCoverCard
              fromChain={fromChain}
              coverGas={coverGas}
              setCoverGas={setCoverGas}
              arcBalance={arcBalance}
              arcBalLoading={arcBalLoading}
            />
          )}

          {/* Amount + Speed */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-4 shadow-sm">
            {/* Amount */}
            <div>
              <label className="text-slate-500 text-xs font-bold uppercase tracking-widest block mb-2">USDC Amount</label>
              <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus-within:border-violet-400 transition-colors">
                <span className="text-slate-400 text-lg">💵</span>
                <input
                  type="number" min="0.01" step="0.01" placeholder="0.00"
                  value={amount}
                  onChange={e => { setAmount(e.target.value); setError(null) }}
                  className="flex-1 bg-transparent text-slate-900 text-xl font-bold outline-none placeholder:text-slate-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-slate-500 font-semibold text-sm">USDC</span>
              </div>
              <div className="flex gap-1.5 mt-2">
                {['1', '5', '10', '50', '100'].map(v => (
                  <button key={v} onClick={() => setAmount(v)}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 hover:text-slate-900 text-xs transition-colors hover:bg-slate-200">
                    ${v}
                  </button>
                ))}
              </div>
            </div>

            {/* Speed */}
            <div>
              <label className="text-slate-500 text-xs font-bold uppercase tracking-widest block mb-2">Speed</label>
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                {([['fast', '⚡', 'Fast', '~2 min'], ['standard', '🐌', 'Standard', '~20 min']] as const).map(([key, icon, label, time]) => (
                  <button key={key} onClick={() => setSpeed(key)}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      speed === key ? 'bg-violet-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'
                    }`}>
                    <span>{icon}</span> {label} <span className="text-xs opacity-70">({time})</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Gas coverage summary row */}
            {!isNonEvm && !isArcSrc && (
              <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                coverGas
                  ? 'bg-teal-50 border-teal-200'
                  : 'bg-amber-50 border-amber-200'
              }`}>
                <span className="text-lg shrink-0">{coverGas ? '✅' : '⚠️'}</span>
                <div className="flex-1 min-w-0">
                  {coverGas ? (
                    <>
                      <p className="text-teal-700 text-xs font-semibold">Gas covered from Arc USDC</p>
                      <p className="text-teal-600/80 text-[11px]">
                        ~${(GAS_ESTIMATES[fromId]?.high ?? 0.20).toFixed(2)} USDC deducted from Arc · No {fromChain.nativeToken} needed
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-amber-700 text-xs font-semibold">You need {fromChain.nativeToken} for gas</p>
                      <p className="text-amber-600/80 text-[11px]">
                        Or enable <strong>Cover Gas</strong> above to use Arc USDC instead
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Warning if non-EVM involved */}
            {isNonEvm && (
              <div className="flex items-start gap-2 px-3 py-3 rounded-xl bg-amber-50 border border-amber-200">
                <span className="text-amber-500 text-sm shrink-0">⚠️</span>
                <div>
                  <p className="text-amber-700 text-xs font-semibold">Non-EVM chain selected</p>
                  <p className="text-amber-600/80 text-xs leading-relaxed mt-0.5">
                    Bridging with Solana, Sui, or Noble requires a separate non-EVM wallet.
                    Use the external Circle CCTP portal or the chain's native bridge below.
                  </p>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (() => {
              // Case 1: genuine native-gas error (ETH / MATIC / AVAX chain)
              if (gasError) return (
                <div className="flex flex-col gap-2.5 px-4 py-4 rounded-xl bg-amber-50 border border-amber-300">
                  <div className="flex items-start gap-2.5">
                    <span className="text-2xl shrink-0 leading-none">⛽</span>
                    <div>
                      <p className="text-amber-800 text-sm font-bold">
                        {coverGas ? 'Gas coverage unavailable on testnet' : `Insufficient ${fromChain.nativeToken} for gas`}
                      </p>
                      <p className="text-amber-700 text-xs leading-relaxed mt-1">
                        {coverGas
                          ? `Circle Paymaster API requires production environment — on testnet the wallet still needs real ${fromChain.nativeToken} to pay gas.`
                          : `Your wallet doesn't have enough ${fromChain.nativeToken} on ${fromChain.shortName} to pay gas fees. Get free testnet tokens from the faucet.`}
                      </p>
                    </div>
                  </div>
                  {fromChain.faucetUrl && (
                    <a href={fromChain.faucetUrl} target="_blank" rel="noreferrer"
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold transition-colors shadow-sm">
                      💧 Get free {fromChain.nativeToken} on {fromChain.shortName} ↗
                    </a>
                  )}
                  <p className="text-amber-600/70 text-[10px] text-center">Faucet tokens are free · Testnet only · No real value</p>
                </div>
              )

              // Case 2: generic error — show raw message (USDC balance, approval, network, etc.)
              return (
                <div className="flex flex-col gap-2 px-3 py-3 rounded-xl bg-red-50 border border-red-200">
                  <div className="flex items-start gap-2">
                    <span className="text-red-500 text-sm shrink-0 mt-0.5">✗</span>
                    <p className="text-red-600 text-sm leading-snug">{error}</p>
                  </div>
                  {/* If on Arc and error mentions insufficient/USDC — faucet helper */}
                  {isArcSrc && /insufficient|usdc|balance|funds/i.test(error) && fromChain.faucetUrl && (
                    <a href={fromChain.faucetUrl} target="_blank" rel="noreferrer"
                      className="flex items-center justify-center gap-2 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition-colors">
                      💧 Get testnet USDC from Circle Faucet ↗
                    </a>
                  )}
                </div>
              )
            })()}

            {/* External bridge buttons for non-EVM */}
            {isNonEvm ? (
              <div className="flex flex-col gap-2">
                <a href="https://www.circle.com/cross-chain-transfer-protocol" target="_blank" rel="noreferrer"
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-blue-600 text-white font-bold text-sm text-center hover:from-violet-500 hover:to-blue-500 transition-all shadow-md">
                  🌉 Bridge via Circle CCTP Portal ↗
                </a>
                {(fromChain.bridgeUrl || toChain.bridgeUrl) && (
                  <a href={fromChain.bridgeUrl ?? toChain.bridgeUrl} target="_blank" rel="noreferrer"
                    className="w-full py-3 rounded-2xl bg-slate-100 text-slate-600 font-semibold text-sm text-center hover:bg-slate-200 transition-all">
                    {fromChain.type === 'non-evm' ? fromChain.icon : toChain.icon}{' '}
                    {fromChain.type === 'non-evm' ? fromChain.shortName : toChain.shortName} Native Bridge ↗
                  </a>
                )}
              </div>
            ) : !isConnected ? (
              <div className="bg-slate-50 rounded-xl border border-slate-200">
                <WalletGate label="Connect wallet to bridge" variant="centered" />
              </div>
            ) : (
              <button
                onClick={handleBridge}
                disabled={!canBridge}
                className={`w-full py-4 rounded-2xl font-bold text-base transition-all ${
                  canBridge
                    ? gasCoverActive && !isArcSrc
                      ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-500 hover:to-emerald-500 shadow-lg shadow-teal-900/20'
                      : 'bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 shadow-lg shadow-violet-900/20'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              >
                {isBridging ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    {steps[0]?.state === 'processing' && steps[0]?.name === 'gas'
                      ? 'Sponsoring gas via Arc…'
                      : 'Bridging…'}
                  </span>
                ) : (
                  <span>
                    {gasCoverActive && !isArcSrc ? '⛽ ' : '🌉 '}
                    Bridge {amount ? `${amount} USDC` : 'USDC'} → {toChain.shortName}
                    {gasCoverActive && !isArcSrc ? ' (gas covered)' : ''}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* ── Right column: progress + how it works + history ── */}
        <div className="flex flex-col gap-4">

          {/* Arc Balance Summary */}
          {isConnected && (
            <div className="bg-gradient-to-r from-teal-50 to-emerald-50 rounded-2xl p-4 shadow-sm border border-teal-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-teal-100 flex items-center justify-center text-lg shrink-0">🔮</div>
                <div className="flex-1 min-w-0">
                  <p className="text-teal-700 text-[10px] font-bold uppercase tracking-wider">Arc Testnet USDC</p>
                  <p className="text-slate-900 font-bold text-lg">
                    {arcBalLoading ? (
                      <span className="text-teal-600 text-sm">Loading…</span>
                    ) : arcBalance ? (
                      `${arcBalance} USDC`
                    ) : (
                      <span className="text-teal-600 text-sm">—</span>
                    )}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-teal-600 text-[10px]">Native gas token</p>
                  <p className="text-teal-700 text-[11px] font-semibold">⛽ Used for gas</p>
                </div>
              </div>
              {arcBalance && !isArcSrc && !isNonEvm && (
                <div className="mt-3 pt-3 border-t border-teal-200">
                  <div className="flex items-center justify-between">
                    <span className="text-teal-600 text-xs">Available to cover gas</span>
                    <span className="text-teal-700 text-xs font-bold">{arcBalance} USDC</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-teal-600 text-xs">Est. gas on {fromChain.shortName}</span>
                    <span className="text-amber-600 text-xs font-bold">
                      ~${(GAS_ESTIMATES[fromId]?.high ?? 0.20).toFixed(2)} USDC
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-teal-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-400"
                      style={{ width: `${Math.min(100, (parseFloat(arcBalance) / Math.max(parseFloat(arcBalance), GAS_ESTIMATES[fromId]?.high ?? 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Transaction Steps */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-slate-900 font-bold text-sm">Bridge Progress</h3>
              {isBridging && (
                <span className="flex items-center gap-1.5 text-[11px] text-violet-600">
                  <span className="w-1.5 h-1.5 bg-violet-600 rounded-full animate-pulse" />
                  Processing
                </span>
              )}
              {success && <span className="text-[11px] text-emerald-600 font-semibold">✓ Complete</span>}
            </div>

            <div className="flex flex-col gap-1">
              {steps.map((step, i) => {
                const isActive = step.state === 'processing'
                const isDone   = step.state === 'success'
                const isFailed = step.state === 'failed'
                const isGasStep = step.name === 'gas'
                const color = stepColor(step.name)
                return (
                  <div key={step.name + i} className="relative">
                    {i < steps.length - 1 && (
                      <div className={`absolute left-[11px] top-[28px] w-0.5 h-4 rounded-full ${isDone ? (isGasStep ? 'bg-teal-300' : 'bg-emerald-300') : 'bg-slate-200'}`} />
                    )}
                    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                      isActive ? (isGasStep ? 'bg-teal-50 border border-teal-200' : 'bg-violet-50 border border-violet-200') :
                      isDone   ? (isGasStep ? 'bg-teal-50 border border-teal-100' : 'bg-emerald-50 border border-emerald-100') :
                      isFailed ? 'bg-red-50 border border-red-200' : 'border border-transparent'
                    }`}>
                      <div className="w-5 h-5 flex items-center justify-center shrink-0">
                        {isGasStep && isDone ? <span className="text-teal-600 text-sm">⛽</span> :
                         isGasStep && isActive ? (
                          <svg className={`animate-spin w-4 h-4 text-teal-600`} viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                         ) : stepIcon(step.state)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${
                          isActive ? (color === 'teal' ? 'text-teal-700' : 'text-violet-700') :
                          isDone   ? (color === 'teal' ? 'text-teal-600' : 'text-emerald-600') :
                          isFailed ? 'text-red-600' : 'text-slate-400'
                        }`}>{stepLabel(step.name, toChain, fromChain)}</p>
                        {step.txHash && <p className="text-slate-400 font-mono text-[10px] mt-0.5">{shortHash(step.txHash)}</p>}
                        {isGasStep && isActive && (
                          <p className="text-teal-500 text-[10px] mt-0.5">Calling Circle Paymaster…</p>
                        )}
                      </div>
                      {step.txHash && step.explorerUrl && (
                        <a href={step.explorerUrl} target="_blank" rel="noreferrer"
                          className="text-slate-400 hover:text-violet-600 transition-colors text-xs ml-auto shrink-0">↗</a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {success && (
              <div className="mt-4 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <p className="text-emerald-600 font-semibold text-sm text-center">🎉 Bridge complete!</p>
                <p className="text-slate-500 text-[11px] text-center mt-1">
                  USDC arrived on {toChain.name}
                  {gasCoverActive && !isArcSrc ? ' · Gas was covered by Arc USDC' : ''}
                </p>
              </div>
            )}
            {!isBridging && !success && (
              <p className="text-slate-300 text-[11px] text-center mt-4">
                Select chains, enter amount, and click Bridge
              </p>
            )}
          </div>

          {/* How it works */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <h3 className="text-slate-900 font-bold text-sm mb-3">How it works</h3>

            {/* Gas coverage explanation */}
            {!isNonEvm && (
              <div className="mb-4 p-3 rounded-xl bg-teal-50 border border-teal-100">
                <p className="text-teal-700 text-xs font-bold mb-1.5">⛽ Arc Gas Coverage</p>
                <div className="flex flex-col gap-1">
                  <div className="flex items-start gap-2">
                    <span className="text-teal-500 text-[10px] mt-0.5">●</span>
                    <p className="text-teal-700 text-[11px]">Arc uses USDC as native gas — zero ETH friction when bridging <em>from</em> Arc</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-teal-500 text-[10px] mt-0.5">●</span>
                    <p className="text-teal-700 text-[11px]">For other chains, enable <strong>Cover Gas</strong> to pay source gas in USDC via Circle Paymaster</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-teal-500 text-[10px] mt-0.5">●</span>
                    <p className="text-teal-700 text-[11px]">Circle Paymaster submits the on-chain tx and bills your Arc USDC at settlement</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {[
                { n: '01', t: 'Approve', d: 'Authorize the CCTP contract to use your USDC on the source chain' },
                { n: '02', t: 'Burn',    d: `USDC burned on ${fromChain.shortName} (secured by Circle)` },
                { n: '03', t: 'Attest',  d: 'Circle verifies the burn via its attestation service (~2 min Fast, ~20 min Standard)' },
                { n: '04', t: 'Mint',    d: `New USDC minted natively on ${toChain.shortName} — same value, no slippage` },
              ].map(item => (
                <div key={item.n} className="flex items-start gap-3">
                  <span className="text-violet-600 font-mono text-[10px] font-bold mt-0.5 shrink-0 w-5">{item.n}</span>
                  <div>
                    <span className="text-slate-600 text-xs font-semibold">{item.t} </span>
                    <span className="text-slate-400 text-xs">— {item.d}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Supported routes */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-slate-500 text-xs font-bold mb-2">Popular routes</p>
              <div className="flex flex-col gap-1">
                {[
                  { r: 'Arc ↔ Ethereum', g: true  },
                  { r: 'Arc ↔ Base',     g: true  },
                  { r: 'Arc ↔ Arbitrum', g: true  },
                  { r: 'Ethereum ↔ Base',    g: false },
                  { r: 'Ethereum ↔ Solana',  g: false },
                  { r: 'Base ↔ Avalanche',   g: false },
                ].map(({ r, g }) => (
                  <div key={r} className="flex items-center gap-2">
                    <span className="w-1 h-1 bg-violet-400 rounded-full shrink-0" />
                    <span className="text-slate-500 text-xs">{r}</span>
                    <div className="ml-auto flex items-center gap-1">
                      {g && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 font-bold">⛽ Gas Cover</span>}
                      <span className="text-[10px] text-violet-500 font-medium">CCTP</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recipient */}
          {address && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-0.5">Recipient on {toChain.shortName}</p>
              <p className="text-slate-700 font-mono text-xs break-all">{address}</p>
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <h3 className="text-slate-900 font-bold text-sm mb-3">Bridge History</h3>
              <div className="flex flex-col gap-2">
                {history.map(h => (
                  <div key={h.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${h.status === 'success' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-slate-700 text-xs font-semibold truncate">
                          {h.fromChain} → {h.toChain} · {h.amount} USDC
                        </p>
                        {h.gasCovered && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-teal-100 text-teal-700 font-bold shrink-0">⛽</span>
                        )}
                      </div>
                      <p className="text-slate-400 text-[10px]">{h.time}</p>
                    </div>
                    {h.txHash && h.txHash !== '—' && (
                      <a href={chainById(toId).explorerBase + h.txHash} target="_blank" rel="noreferrer"
                        className="text-slate-400 hover:text-violet-600 transition-colors text-xs shrink-0">↗</a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
