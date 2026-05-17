import { useState, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'

// ── Source chains (testnet) ────────────────────────────────────────────────────
// Chain identifiers from Arc App Kit docs (some are exception cases)

interface SourceChain {
  id: string          // AppKit chain identifier
  name: string
  shortName: string
  icon: string
  color: string
  nativeToken: string
  faucetUrl?: string
}

const SOURCE_CHAINS: SourceChain[] = [
  {
    id: 'Ethereum_Sepolia', name: 'Ethereum Sepolia', shortName: 'ETH Sepolia',
    icon: '⟠', color: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
    nativeToken: 'ETH', faucetUrl: 'https://sepoliafaucet.com',
  },
  {
    id: 'Base_Sepolia', name: 'Base Sepolia', shortName: 'Base Sepolia',
    icon: '🔵', color: 'bg-blue-600/10 border-blue-600/30 text-blue-300',
    nativeToken: 'ETH', faucetUrl: 'https://www.alchemy.com/faucets/base-sepolia',
  },
  {
    id: 'Arbitrum_Sepolia', name: 'Arbitrum Sepolia', shortName: 'Arb Sepolia',
    icon: '🔷', color: 'bg-sky-500/10 border-sky-500/30 text-sky-400',
    nativeToken: 'ETH', faucetUrl: 'https://www.alchemy.com/faucets/arbitrum-sepolia',
  },
  {
    id: 'Optimism_Sepolia', name: 'OP Sepolia', shortName: 'OP Sepolia',
    icon: '🔴', color: 'bg-red-500/10 border-red-500/30 text-red-400',
    nativeToken: 'ETH', faucetUrl: 'https://app.optimism.io/faucet',
  },
  {
    id: 'Polygon_Amoy_Testnet', name: 'Polygon Amoy', shortName: 'Polygon Amoy',
    icon: '🟣', color: 'bg-purple-500/10 border-purple-500/30 text-purple-400',
    nativeToken: 'MATIC', faucetUrl: 'https://www.alchemy.com/faucets/polygon-amoy',
  },
  {
    id: 'Avalanche_Fuji', name: 'Avalanche Fuji', shortName: 'Avax Fuji',
    icon: '🔺', color: 'bg-red-600/10 border-red-600/30 text-red-300',
    nativeToken: 'AVAX', faucetUrl: 'https://faucet.avax.network',
  },
  {
    id: 'Unichain_Sepolia', name: 'Unichain Sepolia', shortName: 'Unichain',
    icon: '🦄', color: 'bg-pink-500/10 border-pink-500/30 text-pink-400',
    nativeToken: 'ETH', faucetUrl: 'https://www.alchemy.com/faucets/unichain-sepolia',
  },
]

// ── Types ─────────────────────────────────────────────────────────────────────

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
  amount: string
  txHash: string
  status: 'success' | 'failed'
  steps: BridgeStep[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepIcon(state: BridgeStep['state']) {
  if (state === 'idle')       return <span className="w-4 h-4 rounded-full border border-gray-700 block" />
  if (state === 'processing') return (
    <svg className="animate-spin w-4 h-4 text-violet-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  )
  if (state === 'success')    return <span className="text-green-400 text-sm">✓</span>
  return                             <span className="text-red-400 text-sm">✗</span>
}

function stepLabel(name: string): string {
  switch (name) {
    case 'approve':  return 'Approve USDC'
    case 'burn':     return 'Burn trên nguồn'
    case 'attest':   return 'Xác thực Circle'
    case 'mint':     return 'Mint trên Arc'
    default:         return name
  }
}

function shortHash(h: string) {
  if (!h || h.length < 12) return h
  return `${h.slice(0, 8)}…${h.slice(-6)}`
}

function getExplorerUrl(step: BridgeStep, fromChainId: string): string {
  if (step.explorerUrl) return step.explorerUrl
  if (!step.txHash) return '#'
  // Fallback explorer URLs for source chain steps
  const EXPLORERS: Record<string, string> = {
    Ethereum_Sepolia: 'https://sepolia.etherscan.io/tx/',
    Base_Sepolia:     'https://sepolia.basescan.org/tx/',
    Arbitrum_Sepolia: 'https://sepolia.arbiscan.io/tx/',
    Optimism_Sepolia: 'https://sepolia-optimism.etherscan.io/tx/',
    Polygon_Amoy_Testnet: 'https://amoy.polygonscan.com/tx/',
    Avalanche_Fuji:   'https://testnet.snowtrace.io/tx/',
    Unichain_Sepolia: 'https://sepolia.uniscan.xyz/tx/',
  }
  if (step.name === 'mint') return `https://testnet.arcscan.app/tx/${step.txHash}`
  return `${EXPLORERS[fromChainId] ?? 'https://testnet.arcscan.app/tx/'}${step.txHash}`
}

// ── Initial steps ─────────────────────────────────────────────────────────────

function makeInitialSteps(): BridgeStep[] {
  return [
    { name: 'approve', state: 'idle' },
    { name: 'burn',    state: 'idle' },
    { name: 'attest',  state: 'idle' },
    { name: 'mint',    state: 'idle' },
  ]
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function BridgePanel() {
  const { isConnected, address } = useAccount()

  const [fromChainId, setFromChainId] = useState<string>(SOURCE_CHAINS[0].id)
  const [amount,      setAmount]      = useState('')
  const [speed,       setSpeed]       = useState<BridgeSpeed>('fast')

  const [isBridging,  setIsBridging]  = useState(false)
  const [steps,       setSteps]       = useState<BridgeStep[]>(makeInitialSteps())
  const [error,       setError]       = useState<string | null>(null)
  const [result,      setResult]      = useState<BridgeRecord | null>(null)

  const [history,     setHistory]     = useState<BridgeRecord[]>([])

  const fromChain = SOURCE_CHAINS.find(c => c.id === fromChainId) ?? SOURCE_CHAINS[0]
  const amountNum = parseFloat(amount)
  const canBridge = isConnected && !!amount && amountNum > 0 && !isBridging

  // Simulate step progression while waiting for kit.bridge() to resolve
  const animateSteps = useCallback((stepNames: string[]) => {
    // Mark first step as processing immediately
    setSteps(makeInitialSteps().map((s, i) => ({
      ...s,
      state: i === 0 ? 'processing' : 'idle',
    })))

    // Advance steps over estimated time
    // approve → 15s, burn → 15s, attest → 60s (fast) / 90s, mint → 15s
    const delays = speed === 'fast' ? [0, 15000, 30000, 90000] : [0, 15000, 30000, 150000]
    const timers: ReturnType<typeof setTimeout>[] = []

    stepNames.forEach((_, i) => {
      if (i === 0) return // already set
      timers.push(setTimeout(() => {
        setSteps(prev => prev.map((s, idx) => {
          if (idx < i) return { ...s, state: 'processing' === s.state ? 'processing' : s.state }
          if (idx === i) return { ...s, state: 'processing' }
          return s
        }))
      }, delays[i]))
    })

    return () => timers.forEach(clearTimeout)
  }, [speed])

  const handleBridge = useCallback(async () => {
    if (!canBridge) return
    setIsBridging(true)
    setError(null)
    setResult(null)

    const stepNames = ['approve', 'burn', 'attest', 'mint']
    const cancelAnim = animateSteps(stepNames)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = (window as any).ethereum
      if (!provider) throw new Error('Không tìm thấy ví. Vui lòng cài MetaMask.')

      const adapter = await createViemAdapterFromProvider({ provider })
      const kit = new AppKit()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bridgeResult = await kit.bridge({
        from: { adapter, chain: fromChainId as Parameters<typeof kit.bridge>[0]['from']['chain'] },
        to:   { adapter, chain: 'Arc_Testnet' as Parameters<typeof kit.bridge>[0]['to']['chain'] },
        amount: amountNum.toFixed(2),
        ...(speed === 'standard' ? { speed: 'standard' } : {}),
      })

      cancelAnim()

      // Parse steps from result
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawSteps: any[] = (bridgeResult as any)?.steps ?? []
      const parsedSteps: BridgeStep[] = stepNames.map(name => {
        const raw = rawSteps.find((s: { name: string }) => s.name === name)
        if (!raw) return { name, state: 'idle' as const }
        return {
          name,
          state: raw.state === 'success' ? 'success' : raw.state === 'failed' ? 'failed' : 'success',
          txHash: raw.txHash ?? raw.data?.txHash,
          explorerUrl: raw.data?.explorerUrl,
        }
      })

      // All done → mark remaining idle as success
      const finalSteps: BridgeStep[] = parsedSteps.map(s =>
        s.state === 'idle' ? { ...s, state: 'success' as const } : s
      )
      setSteps(finalSteps)

      const record: BridgeRecord = {
        id: Date.now().toString(),
        time: new Date().toLocaleTimeString('vi-VN'),
        fromChain: fromChain.shortName,
        amount,
        txHash: finalSteps.find(s => s.txHash)?.txHash ?? '—',
        status: 'success',
        steps: finalSteps,
      }
      setResult(record)
      setHistory(prev => [record, ...prev].slice(0, 10))
      setAmount('')

    } catch (err: unknown) {
      cancelAnim()
      const msg = err instanceof Error ? err.message : 'Bridge thất bại. Vui lòng thử lại.'
      setError(msg)
      // Mark current processing step as failed
      setSteps(prev => prev.map(s => s.state === 'processing' ? { ...s, state: 'failed' } : s))
    } finally {
      setIsBridging(false)
    }
  }, [canBridge, fromChainId, amountNum, amount, speed, fromChain, animateSteps])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto">

      {/* CCTP info banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-violet-500/8 border border-violet-500/20">
        <span className="text-xl">🌉</span>
        <div className="flex-1 text-left">
          <p className="text-violet-300 font-semibold text-sm">Powered by Circle CCTP</p>
          <p className="text-gray-500 text-xs mt-0.5">
            Bridge USDC từ bất kỳ chain nào về Arc Testnet · Tốc độ nhanh ~2 phút
          </p>
        </div>
        <a href="https://docs.arc.io/app-kit/bridge" target="_blank" rel="noreferrer"
          className="text-violet-500 text-xs hover:text-violet-400 transition-colors whitespace-nowrap">
          Tài liệu ↗
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">

        {/* ── Left: Bridge Form ── */}
        <div className="flex flex-col gap-4">

          {/* From chain selector */}
          <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-5">
            <p className="text-gray-500 text-xs font-semibold uppercase tracking-widest mb-3">
              Từ Chain
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
              {SOURCE_CHAINS.map(chain => (
                <button
                  key={chain.id}
                  onClick={() => { setFromChainId(chain.id); setError(null) }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all text-left ${
                    fromChainId === chain.id
                      ? 'bg-violet-600/20 border-violet-500/60 ring-1 ring-violet-500/30'
                      : 'bg-gray-900/40 border-gray-800/60 hover:border-gray-700'
                  }`}
                >
                  <span className="text-base leading-none">{chain.icon}</span>
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold truncate ${fromChainId === chain.id ? 'text-violet-300' : 'text-gray-300'}`}>
                      {chain.shortName}
                    </p>
                    <p className="text-[10px] text-gray-600">{chain.nativeToken} gas</p>
                  </div>
                  {fromChainId === chain.id && (
                    <span className="ml-auto text-violet-400 text-xs">✓</span>
                  )}
                </button>
              ))}
            </div>

            {/* Gas reminder */}
            <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/8 border border-amber-500/20">
              <span className="text-amber-400 text-sm mt-px">⚠️</span>
              <p className="text-amber-400/80 text-[11px] leading-relaxed">
                Cần có <strong>{fromChain.nativeToken}</strong> trên {fromChain.shortName} để trả phí gas.{' '}
                {fromChain.faucetUrl && (
                  <a href={fromChain.faucetUrl} target="_blank" rel="noreferrer"
                    className="underline hover:text-amber-300 transition-colors">
                    Lấy {fromChain.nativeToken} testnet ↗
                  </a>
                )}
              </p>
            </div>
          </div>

          {/* Amount + Speed */}
          <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-5">
            {/* Amount input */}
            <div className="mb-4">
              <label className="text-gray-500 text-xs font-semibold uppercase tracking-widest block mb-2">
                Số lượng USDC
              </label>
              <div className="flex items-center gap-3 bg-gray-900/60 border border-gray-700/60 rounded-xl px-4 py-3 focus-within:border-violet-500/60 transition-colors">
                <span className="text-gray-400 text-lg">💵</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={e => { setAmount(e.target.value); setError(null) }}
                  className="flex-1 bg-transparent text-white text-xl font-bold outline-none placeholder:text-gray-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-gray-400 font-semibold text-sm">USDC</span>
              </div>
              {/* Quick amounts */}
              <div className="flex gap-1.5 mt-2">
                {['1', '5', '10', '50'].map(v => (
                  <button key={v} onClick={() => setAmount(v)}
                    className="px-2.5 py-1 rounded-lg bg-gray-800/80 text-gray-500 hover:text-white text-xs transition-colors hover:bg-gray-700/80">
                    ${v}
                  </button>
                ))}
              </div>
            </div>

            {/* Speed selector */}
            <div>
              <label className="text-gray-500 text-xs font-semibold uppercase tracking-widest block mb-2">
                Tốc độ
              </label>
              <div className="grid grid-cols-2 gap-2 bg-gray-900/60 p-1 rounded-xl">
                <button
                  onClick={() => setSpeed('fast')}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    speed === 'fast'
                      ? 'bg-violet-600 text-white shadow-md shadow-violet-900/30'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}>
                  <span>⚡</span> Nhanh <span className="text-xs opacity-70">(~2 phút)</span>
                </button>
                <button
                  onClick={() => setSpeed('standard')}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    speed === 'standard'
                      ? 'bg-violet-600 text-white shadow-md shadow-violet-900/30'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}>
                  <span>🐌</span> Chuẩn <span className="text-xs opacity-70">(~20 phút)</span>
                </button>
              </div>
              {speed === 'fast' && (
                <p className="text-[11px] text-gray-600 mt-1.5 text-center">
                  Phí CCTP Fast Transfer áp dụng · Phí thấp hơn với Standard
                </p>
              )}
            </div>
          </div>

          {/* Route summary */}
          <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl px-5 py-4">
            <div className="flex items-center gap-3">
              {/* From */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-2xl">{fromChain.icon}</span>
                <div className="min-w-0">
                  <p className="text-gray-300 font-semibold text-sm truncate">{fromChain.shortName}</p>
                  <p className="text-gray-600 text-[11px]">{amount ? `${amount} USDC` : '— USDC'}</p>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex flex-col items-center gap-0.5 px-2">
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/25">
                  <span className="text-violet-400 text-[10px] font-bold">CCTP</span>
                </div>
                <span className="text-violet-400 text-lg">→</span>
              </div>

              {/* To */}
              <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                <div className="min-w-0 text-right">
                  <p className="text-gray-300 font-semibold text-sm">Arc Testnet</p>
                  <p className="text-green-400 text-[11px]">{amount ? `${amount} USDC` : '— USDC'}</p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center font-bold text-white text-sm">
                  A
                </div>
              </div>
            </div>

            {address && (
              <p className="text-[11px] text-gray-600 mt-2 text-center">
                Nhận tại: <span className="text-gray-500 font-mono">{address.slice(0, 8)}…{address.slice(-6)}</span>
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
              <span className="text-red-400 text-sm mt-px">⚠</span>
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Bridge button */}
          {!isConnected ? (
            <div className="text-center py-4 text-gray-500 text-sm bg-[#0d0e12] border border-gray-800 rounded-2xl">
              Kết nối ví để bridge
            </div>
          ) : (
            <button
              onClick={handleBridge}
              disabled={!canBridge}
              className={`w-full py-4 rounded-2xl font-bold text-base transition-all ${
                canBridge
                  ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 shadow-lg shadow-violet-900/30 hover:shadow-violet-900/50 active:scale-[0.99]'
                  : 'bg-gray-800/60 text-gray-600 cursor-not-allowed'
              }`}
            >
              {isBridging ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Đang bridge…
                </span>
              ) : `🌉 Bridge ${amount ? `${amount} USDC` : 'USDC'} → Arc Testnet`}
            </button>
          )}
        </div>

        {/* ── Right: Progress + History ── */}
        <div className="flex flex-col gap-4">

          {/* Transaction Steps */}
          <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold text-sm">Tiến trình Bridge</h3>
              {isBridging && (
                <span className="flex items-center gap-1.5 text-[11px] text-violet-400">
                  <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
                  Đang xử lý
                </span>
              )}
              {result && (
                <span className="text-[11px] text-green-400 font-semibold">✓ Hoàn thành</span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              {steps.map((step, i) => {
                const isActive = step.state === 'processing'
                const isDone   = step.state === 'success'
                const isFailed = step.state === 'failed'
                const isIdle   = step.state === 'idle'
                const url      = getExplorerUrl(step, fromChainId)

                return (
                  <div key={step.name} className="relative">
                    {/* Connector line */}
                    {i < steps.length - 1 && (
                      <div className={`absolute left-[11px] top-[28px] w-0.5 h-4 rounded-full transition-colors ${
                        isDone ? 'bg-green-500/40' : 'bg-gray-800'
                      }`} />
                    )}

                    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                      isActive ? 'bg-violet-500/10 border border-violet-500/25' :
                      isDone   ? 'bg-green-500/5  border border-green-500/15'   :
                      isFailed ? 'bg-red-500/10   border border-red-500/20'     :
                      'border border-transparent'
                    }`}>
                      <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                        {stepIcon(step.state)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${
                          isActive ? 'text-violet-300' :
                          isDone   ? 'text-green-400'  :
                          isFailed ? 'text-red-400'    :
                          isIdle   ? 'text-gray-600'   : 'text-gray-400'
                        }`}>
                          {stepLabel(step.name)}
                        </p>
                        {step.txHash && (
                          <p className="text-gray-600 font-mono text-[10px] mt-0.5">
                            {shortHash(step.txHash)}
                          </p>
                        )}
                      </div>

                      {step.txHash && (
                        <a href={url} target="_blank" rel="noreferrer"
                          className="text-gray-600 hover:text-violet-400 transition-colors text-xs ml-auto flex-shrink-0">
                          ↗
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Success message */}
            {result && (
              <div className="mt-4 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20">
                <p className="text-green-400 font-semibold text-sm text-center">
                  🎉 Bridge thành công!
                </p>
                <p className="text-gray-500 text-[11px] text-center mt-1">
                  {result.amount} USDC đã đến Arc Testnet
                </p>
              </div>
            )}

            {/* Idle hint */}
            {!isBridging && !result && (
              <p className="text-gray-700 text-[11px] text-center mt-4">
                Nhập số lượng và nhấn Bridge để bắt đầu
              </p>
            )}
          </div>

          {/* How it works */}
          <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-bold text-sm mb-3">Cách hoạt động</h3>
            <div className="flex flex-col gap-3">
              {[
                { step: '01', title: 'Approve',   desc: 'Ủy quyền cho CCTP contract sử dụng USDC của bạn' },
                { step: '02', title: 'Burn',       desc: 'USDC bị đốt trên chain nguồn (không thể hoàn tác)' },
                { step: '03', title: 'Attest',     desc: 'Circle xác thực giao dịch burn (~2 phút Fast)' },
                { step: '04', title: 'Mint',       desc: 'USDC mới được tạo ra trên Arc Testnet cho bạn' },
              ].map(item => (
                <div key={item.step} className="flex items-start gap-3">
                  <span className="text-violet-600 font-mono text-[10px] font-bold mt-0.5 flex-shrink-0 w-5">
                    {item.step}
                  </span>
                  <div>
                    <span className="text-gray-400 text-xs font-semibold">{item.title} </span>
                    <span className="text-gray-600 text-xs">— {item.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bridge history */}
          {history.length > 0 && (
            <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-5">
              <h3 className="text-white font-bold text-sm mb-3">Lịch sử Bridge</h3>
              <div className="flex flex-col gap-2">
                {history.map(h => (
                  <div key={h.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-900/40 border border-gray-800/60">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${h.status === 'success' ? 'bg-green-400' : 'bg-red-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-300 text-xs font-semibold truncate">
                        {h.fromChain} → Arc · {h.amount} USDC
                      </p>
                      <p className="text-gray-600 text-[10px]">{h.time}</p>
                    </div>
                    {h.txHash && h.txHash !== '—' && (
                      <a href={`https://testnet.arcscan.app/tx/${h.txHash}`}
                        target="_blank" rel="noreferrer"
                        className="text-gray-600 hover:text-violet-400 transition-colors text-xs flex-shrink-0">
                        ↗
                      </a>
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
