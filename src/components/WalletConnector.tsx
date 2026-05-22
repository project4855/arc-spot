// ── WalletConnector.tsx ───────────────────────────────────────────────────────
// "Connect Wallet" button → popup with 3 clear options:
//   1. Wallet Infrastructure (Turnkey HSM)
//   2. Circle Wallet (Developer-Controlled)
//   3. MetaMask / External Wallet

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useDisconnect, useChainId } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { getTurnkeyAddress, clearTurnkeySigner } from '../lib/turnkeySigner'
import { loadCircleWallet, clearCircleWallet } from '../lib/circleWalletClient'

interface WalletConnectorProps {
  onNavigateToWallet?: () => void
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ── Connect popup (shown when nothing is connected) ───────────────────────────

function ConnectPopup({
  onConnectMetaMask,
  onConnectInfra,
  onConnectCircle,
  onClose,
}: {
  onConnectMetaMask: () => void
  onConnectInfra: () => void
  onConnectCircle: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 pt-6 pb-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-white font-extrabold text-lg">Connect Wallet</h2>
            <button onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white text-lg transition-colors">
              ×
            </button>
          </div>
          <p className="text-slate-400 text-sm">Choose your wallet type to get started on Arc Testnet</p>
        </div>

        {/* Options */}
        <div className="p-4 flex flex-col gap-3">

          {/* Option 1: Circle Wallet */}
          <button
            onClick={onConnectCircle}
            className="group relative flex items-start gap-4 p-4 rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 hover:border-emerald-400 hover:shadow-md hover:shadow-emerald-100 transition-all text-left"
          >
            <span className="absolute top-3 right-3 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">
              Recommended
            </span>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-2xl shadow-md shrink-0">
              ⭕
            </div>
            <div className="flex-1 min-w-0 pr-16">
              <p className="text-slate-900 font-extrabold text-base group-hover:text-emerald-700 transition-colors">
                Circle Wallet
              </p>
              <p className="text-emerald-600 text-xs font-semibold mt-0.5">Developer-Controlled · No Quota</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {['No Quota', 'No Seed Phrase', 'Circle HSM'].map(tag => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">{tag}</span>
                ))}
              </div>
            </div>
          </button>

          {/* Option 2: Wallet Infrastructure */}
          <button
            onClick={onConnectInfra}
            className="group relative flex items-start gap-4 p-4 rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 hover:border-indigo-400 hover:shadow-md hover:shadow-indigo-100 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-2xl shadow-md shrink-0">
              🏛
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-900 font-extrabold text-base group-hover:text-indigo-700 transition-colors">
                Wallet Infrastructure
              </p>
              <p className="text-indigo-600 text-xs font-semibold mt-0.5">Powered by Turnkey HSM</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {['Email OTP', 'Passkey', 'HSM secured'].map(tag => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">{tag}</span>
                ))}
              </div>
            </div>
          </button>

          {/* Option 3: MetaMask */}
          <button
            onClick={onConnectMetaMask}
            className="group flex items-start gap-4 p-4 rounded-2xl border-2 border-slate-200 bg-slate-50 hover:border-orange-300 hover:bg-orange-50 hover:shadow-md hover:shadow-orange-100 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-yellow-400 flex items-center justify-center text-2xl shadow-md shrink-0">
              🦊
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-900 font-extrabold text-base group-hover:text-orange-700 transition-colors">
                MetaMask / External Wallet
              </p>
              <p className="text-slate-500 text-xs font-semibold mt-0.5">WalletConnect · Coinbase · Rainbow · any EVM</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {['MetaMask', 'WalletConnect', 'Coinbase Wallet'].map(tag => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-semibold">{tag}</span>
                ))}
              </div>
            </div>
          </button>

          <p className="text-center text-slate-400 text-xs px-2 pb-1">
            Arc Testnet · Chain ID 5042002 · Gas paid in USDC
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Dropdown menu (shown when already connected) ──────────────────────────────

function ConnectedDropdown({
  tkAddress,
  circleAddress,
  wagmiAddress,
  wrongNet,
  onDisconnectTurnkey,
  onDisconnectCircle,
  onDisconnectWagmi,
  onConnectMetaMask,
  onConnectInfra,
  onConnectCircle,
  onClose,
}: {
  tkAddress: string | null
  circleAddress: string | null
  wagmiAddress: string | undefined
  wrongNet: boolean
  onDisconnectTurnkey: () => void
  onDisconnectCircle: () => void
  onDisconnectWagmi: () => void
  onConnectMetaMask: () => void
  onConnectInfra: () => void
  onConnectCircle: () => void
  onClose: () => void
}) {
  return (
    <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-2xl z-[100] overflow-hidden">

      <div className="bg-slate-50 border-b border-slate-100 px-4 py-3 flex items-center justify-between">
        <p className="text-slate-700 font-bold text-sm">Connected Wallets</p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
      </div>

      <div className="p-3 flex flex-col gap-2">

        {/* Circle wallet row */}
        {circleAddress ? (
          <div className="flex flex-col gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-lg shrink-0">⭕</div>
              <div className="flex-1 min-w-0">
                <p className="text-emerald-700 text-[11px] font-bold uppercase tracking-wide">Circle Wallet · No Quota</p>
                <p className="text-slate-800 text-sm font-mono font-bold mt-0.5">{shortAddr(circleAddress)}</p>
              </div>
              <span className="w-2 h-2 bg-emerald-500 rounded-full shrink-0" />
            </div>
            <button onClick={onDisconnectCircle}
              className="w-full py-1.5 rounded-lg border border-red-200 bg-white text-red-500 text-xs font-bold hover:bg-red-50 hover:border-red-300 transition-colors">
              🔌 Disconnect Circle Wallet
            </button>
          </div>
        ) : (
          <button onClick={onConnectCircle}
            className="flex items-center gap-3 px-3 py-3 rounded-xl border-2 border-dashed border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50 transition-all text-left group">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-lg shrink-0">⭕</div>
            <div>
              <p className="text-slate-700 text-sm font-bold group-hover:text-emerald-700 transition-colors">Connect Circle Wallet</p>
              <p className="text-slate-400 text-[11px]">No quota · No seed phrase · Circle HSM</p>
            </div>
          </button>
        )}

        {/* Turnkey wallet row */}
        {tkAddress ? (
          <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-lg shrink-0">🏛</div>
            <div className="flex-1 min-w-0">
              <p className="text-indigo-700 text-[11px] font-bold uppercase tracking-wide">Wallet Infrastructure</p>
              <p className="text-slate-800 text-sm font-mono font-bold mt-0.5">{shortAddr(tkAddress)}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-2 h-2 bg-emerald-500 rounded-full" />
              <button onClick={onDisconnectTurnkey}
                className="text-[11px] text-red-400 hover:text-red-600 font-semibold transition-colors">
                Logout
              </button>
            </div>
          </div>
        ) : (
          <button onClick={onConnectInfra}
            className="flex items-center gap-3 px-3 py-3 rounded-xl border-2 border-dashed border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50 transition-all text-left group">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center text-lg shrink-0">🏛</div>
            <div>
              <p className="text-slate-700 text-sm font-bold group-hover:text-indigo-700 transition-colors">Connect Wallet Infrastructure</p>
              <p className="text-slate-400 text-[11px]">Turnkey HSM · Email OTP · Passkey</p>
            </div>
          </button>
        )}

        {/* MetaMask wallet row */}
        {wagmiAddress ? (
          <div className={`flex items-center gap-3 border rounded-xl px-3 py-3 ${wrongNet ? 'bg-amber-50 border-amber-200' : 'bg-orange-50 border-orange-200'}`}>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400 to-yellow-400 flex items-center justify-center text-lg shrink-0">🦊</div>
            <div className="flex-1 min-w-0">
              <p className={`text-[11px] font-bold uppercase tracking-wide ${wrongNet ? 'text-amber-700' : 'text-orange-700'}`}>
                {wrongNet ? '⚠ Wrong Network · MetaMask' : 'MetaMask / External Wallet'}
              </p>
              <p className="text-slate-800 text-sm font-mono font-bold mt-0.5">{shortAddr(wagmiAddress)}</p>
              {wrongNet && <p className="text-amber-600 text-[10px] mt-0.5">Switch to Arc Testnet (5042002)</p>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`w-2 h-2 rounded-full ${wrongNet ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <button onClick={onDisconnectWagmi}
                className="text-[11px] text-red-400 hover:text-red-600 font-semibold transition-colors">
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <button onClick={onConnectMetaMask}
            className="flex items-center gap-3 px-3 py-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-orange-300 hover:bg-orange-50 transition-all text-left group">
            <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center text-lg shrink-0">🦊</div>
            <div>
              <p className="text-slate-700 text-sm font-bold group-hover:text-orange-700 transition-colors">Connect MetaMask</p>
              <p className="text-slate-400 text-[11px]">WalletConnect · Coinbase · Rainbow</p>
            </div>
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WalletConnector({ onNavigateToWallet }: WalletConnectorProps) {
  const { address: wagmiAddress, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { openConnectModal } = useConnectModal()

  const [tkAddress,     setTkAddress]     = useState<string | null>(getTurnkeyAddress())
  const [circleAddress, setCircleAddress] = useState<string | null>(loadCircleWallet()?.address ?? null)
  const [showPopup,    setShowPopup]    = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onTk = () => setTkAddress(getTurnkeyAddress())
    window.addEventListener('turnkey_signer_ready', onTk)
    window.addEventListener('turnkey_wallet_updated', onTk)
    return () => {
      window.removeEventListener('turnkey_signer_ready', onTk)
      window.removeEventListener('turnkey_wallet_updated', onTk)
    }
  }, [])

  useEffect(() => {
    const onCircle = () => setCircleAddress(loadCircleWallet()?.address ?? null)
    window.addEventListener('circle_wallet_updated', onCircle)
    return () => window.removeEventListener('circle_wallet_updated', onCircle)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleDisconnectTurnkey = useCallback(() => {
    clearTurnkeySigner(); setTkAddress(null); setShowDropdown(false)
  }, [])

  const handleDisconnectCircle = useCallback(() => {
    clearCircleWallet(); setCircleAddress(null); setShowDropdown(false)
  }, [])

  const handleDisconnectWagmi = useCallback(() => {
    disconnect(); setShowDropdown(false)
  }, [disconnect])

  const handleConnectMetaMask = useCallback(() => {
    setShowPopup(false); setShowDropdown(false)
    openConnectModal?.()
  }, [openConnectModal])

  const handleConnectInfra = useCallback(() => {
    setShowPopup(false); setShowDropdown(false)
    onNavigateToWallet?.()
  }, [onNavigateToWallet])

  const handleConnectCircle = useCallback(() => {
    setShowPopup(false); setShowDropdown(false)
    onNavigateToWallet?.()
  }, [onNavigateToWallet])

  const wrongNet    = isConnected && chainId !== 5042002
  const anyConnected = !!tkAddress || !!circleAddress || isConnected

  // ── Button label ──────────────────────────────────────────────────────────

  let btnContent: React.ReactNode
  let btnClass: string

  const activeAddr = circleAddress ?? tkAddress
  if (activeAddr) {
    const icon = circleAddress ? '⭕' : '🏛'
    btnContent = (
      <>
        <span className="w-2 h-2 bg-emerald-400 rounded-full shrink-0" />
        <span>{icon}</span>
        <span className="font-mono">{shortAddr(activeAddr)}</span>
        {isConnected && wagmiAddress && (
          <>
            <span className="text-slate-300">|</span>
            <span>🦊 {shortAddr(wagmiAddress)}</span>
          </>
        )}
        <span className="opacity-60">▾</span>
      </>
    )
    btnClass = circleAddress
      ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow'
      : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow'
  } else if (isConnected && wagmiAddress) {
    btnContent = (
      <>
        <span className={`w-2 h-2 rounded-full shrink-0 ${wrongNet ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        <span>🦊</span>
        <span className="font-mono">{shortAddr(wagmiAddress)}{wrongNet ? ' ⚠' : ''}</span>
        <span className="opacity-60">▾</span>
      </>
    )
    btnClass = wrongNet
      ? 'bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100'
      : 'bg-orange-50 border border-orange-200 text-orange-800 hover:bg-orange-100'
  } else {
    btnContent = <>🔗 Connect Wallet</>
    btnClass = 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-500 hover:to-indigo-500 shadow-md'
  }

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => {
            if (anyConnected) {
              setShowDropdown(v => !v)
            } else {
              setShowPopup(true)
            }
          }}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${btnClass}`}
        >
          {btnContent}
        </button>

        {showDropdown && anyConnected && (
          <ConnectedDropdown
            tkAddress={tkAddress}
            circleAddress={circleAddress}
            wagmiAddress={wagmiAddress}
            wrongNet={wrongNet}
            onDisconnectTurnkey={handleDisconnectTurnkey}
            onDisconnectCircle={handleDisconnectCircle}
            onDisconnectWagmi={handleDisconnectWagmi}
            onConnectMetaMask={handleConnectMetaMask}
            onConnectInfra={handleConnectInfra}
            onConnectCircle={handleConnectCircle}
            onClose={() => setShowDropdown(false)}
          />
        )}
      </div>

      {showPopup && createPortal(
        <ConnectPopup
          onConnectMetaMask={handleConnectMetaMask}
          onConnectInfra={handleConnectInfra}
          onConnectCircle={handleConnectCircle}
          onClose={() => setShowPopup(false)}
        />,
        document.body
      )}
    </>
  )
}
