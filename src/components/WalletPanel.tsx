// ── WalletPanel.tsx ──────────────────────────────────────────────────────────
// Layout: 2 wallet types — Wallet Infrastructure (Turnkey HSM) | MetaMask
// Each type has its own Receive / Send / extra features

import { useState, useCallback, useEffect } from 'react'
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi'
import { initTurnkeySigner, clearTurnkeySigner } from '../lib/turnkeySigner'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { parseUnits, formatUnits, isAddress } from 'viem'
import { TOKEN_ADDRESSES, TOKEN_DECIMALS, ERC20_ABI } from '../config/contracts'
import { TurnkeyProvider, useTurnkey, ClientState } from '@turnkey/react-wallet-kit'
import { useWallet } from '../hooks/useWallet'
import { arcTestnet } from '../config/wagmi'
import {
  loadCircleWallet, clearCircleWallet, createCircleWallet,
  getCircleBalance, sendCircleUSDC, reconnectCircleWallet, type CircleWalletInfo,
} from '../lib/circleWalletClient'

// ─── Types ────────────────────────────────────────────────────────────────────

type WalletKind = 'infra' | 'circle' | 'metamask'
type InfraSubTab = 'receive' | 'send' | 'sign' | 'policy' | 'ops'
type MetaSubTab  = 'receive' | 'send'

function CopyBtnLight({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(value).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors shrink-0">
      {copied ? '✓ Copied' : `📋 ${label}`}
    </button>
  )
}

// ─── Token balance hook ───────────────────────────────────────────────────────

function useTokenBalance(sym: 'USDC' | 'EURC', addr: `0x${string}` | undefined) {
  const { data } = useReadContract({
    address: TOKEN_ADDRESSES[sym], abi: ERC20_ABI, functionName: 'balanceOf',
    args: addr ? [addr] : undefined,
    query: { enabled: !!addr, refetchInterval: 8_000 },
  })
  return data ? parseFloat(formatUnits(data as bigint, TOKEN_DECIMALS[sym])) : 0
}

// ─── ERC-20 transfer ABI ──────────────────────────────────────────────────────

const TRANSFER_ABI = [{
  name: 'transfer', type: 'function', stateMutability: 'nonpayable',
  inputs:  [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const

// ─── Receive content (shared, used by both wallet types) ──────────────────────

function ReceiveContent({ address, accent }: { address: `0x${string}`; accent: 'indigo' | 'violet' }) {
  const usdcBal = useTokenBalance('USDC', address)
  const eurcBal = useTokenBalance('EURC', address)
  const qrUrl   = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&format=svg&data=${encodeURIComponent(address)}`

  const ring  = accent === 'indigo' ? 'border-indigo-300'  : 'border-violet-300'
  const bal1  = accent === 'indigo' ? 'bg-indigo-50 border-indigo-200 text-indigo-700'  : 'bg-blue-50 border-blue-200 text-blue-700'
  const bal2  = accent === 'indigo' ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-violet-50 border-violet-200 text-violet-700'
  const addrBg = accent === 'indigo' ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-slate-50 border-slate-200 text-slate-700'

  return (
    <div className="flex flex-col gap-4">
      {/* Balances */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`${bal1} border rounded-2xl p-4`}>
          <div className="flex items-center gap-1.5 mb-1"><span className="text-lg">💵</span><span className="text-xs font-bold uppercase tracking-wider">USDC</span></div>
          <p className="font-extrabold text-2xl">{usdcBal.toFixed(4)}</p>
          <p className="text-[10px] opacity-60 mt-0.5">Arc Testnet</p>
        </div>
        <div className={`${bal2} border rounded-2xl p-4`}>
          <div className="flex items-center gap-1.5 mb-1"><span className="text-lg">💶</span><span className="text-xs font-bold uppercase tracking-wider">EURC</span></div>
          <p className="font-extrabold text-2xl">{eurcBal.toFixed(4)}</p>
          <p className="text-[10px] opacity-60 mt-0.5">Arc Testnet</p>
        </div>
      </div>

      {/* Address + QR */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Your Address</p>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className={`shrink-0 p-2.5 bg-white border-2 ${ring} rounded-xl`}>
            <img src={qrUrl} alt="QR" width={120} height={120} className="rounded-lg" />
          </div>
          <div className="flex-1 w-full flex flex-col gap-2.5">
            <div className={`flex items-center gap-2 ${addrBg} border rounded-xl px-3 py-2.5`}>
              <p className="font-mono text-xs flex-1 break-all">{address}</p>
              <CopyBtnLight value={address} />
            </div>
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-bold hover:from-emerald-400 hover:to-teal-400 transition-all">
              💧 Get Testnet USDC — faucet.circle.com
            </a>
            <a href={`https://testnet.arcscan.app/address/${address}`} target="_blank" rel="noreferrer"
              className="text-center py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-xs hover:text-slate-700 transition-colors">
              🔍 View on ArcScan ↗
            </a>
          </div>
        </div>
      </div>

      {/* Token contract addresses */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Token Contracts · Arc Testnet</p>
        <div className="flex flex-col gap-2">
          {Object.entries(TOKEN_ADDRESSES).map(([sym, addr]) => (
            <div key={sym} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-base">{sym === 'USDC' ? '💵' : '💶'}</span>
              <span className="font-bold text-slate-700 text-xs w-10">{sym}</span>
              <span className="font-mono text-[11px] text-slate-500 flex-1 truncate">{addr}</span>
              <CopyBtnLight value={addr} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Send content (shared, accepts writeContract fn) ─────────────────────────

function SendContent({
  address, writeContractFn, signerLabel, accent,
}: {
  address: `0x${string}`
  writeContractFn: (params: { address: `0x${string}`; abi: typeof TRANSFER_ABI; functionName: 'transfer'; args: readonly [`0x${string}`, bigint] }) => Promise<`0x${string}`>
  signerLabel: string
  accent: 'indigo' | 'violet'
}) {
  const [token,    setToken]    = useState<'USDC' | 'EURC'>('USDC')
  const [toAddr,   setToAddr]   = useState('')
  const [amount,   setAmount]   = useState('')
  const [step,     setStep]     = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [txHash,   setTxHash]   = useState<`0x${string}` | null>(null)

  const usdcBal = useTokenBalance('USDC', address)
  const eurcBal = useTokenBalance('EURC', address)
  const balance = token === 'USDC' ? usdcBal : eurcBal
  const publicClient = usePublicClient({ chainId: arcTestnet.id })

  const validAddress = isAddress(toAddr)
  const amountN      = parseFloat(amount) || 0
  const canSend      = validAddress && amountN > 0 && amountN <= balance && step === 'idle'

  const btnActive = accent === 'indigo'
    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-900/20'
    : 'bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 shadow-lg shadow-violet-900/20'

  const focusBorder = accent === 'indigo' ? 'focus-within:border-indigo-400' : 'focus-within:border-violet-400'
  const maxBtn      = accent === 'indigo' ? 'bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-100' : 'bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100'
  const previewBg   = accent === 'indigo' ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'

  const handleSend = async () => {
    if (!canSend) return
    setStep('sending'); setErrorMsg(''); setTxHash(null)
    try {
      const hash = await writeContractFn({
        address: TOKEN_ADDRESSES[token],
        abi: TRANSFER_ABI,
        functionName: 'transfer',
        args: [toAddr as `0x${string}`, parseUnits(amount, TOKEN_DECIMALS[token])],
      })
      setTxHash(hash)
      await publicClient?.waitForTransactionReceipt({ hash, confirmations: 1 })
      setStep('done')
    } catch (e: unknown) {
      setStep('error')
      setErrorMsg(e instanceof Error ? e.message.split('\n')[0] : 'Transaction failed')
    }
  }

  const reset = () => { setStep('idle'); setErrorMsg(''); setTxHash(null); setToAddr(''); setAmount('') }

  return (
    <div className="flex flex-col gap-4">
      {/* Signer badge */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${
        accent === 'indigo' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-violet-50 border-violet-200 text-violet-700'
      }`}>
        <span className="w-2 h-2 rounded-full bg-current animate-pulse shrink-0" />
        {signerLabel}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">
        {/* Token */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Token</label>
          <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
            {(['USDC', 'EURC'] as const).map(t => (
              <button key={t} onClick={() => { setToken(t); setAmount(''); setStep('idle') }}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  token === t ? 'bg-white text-slate-900 shadow-md' : 'text-slate-500 hover:text-slate-700'
                }`}>
                <span>{t === 'USDC' ? '💵' : '💶'}</span>{t}
              </button>
            ))}
          </div>
          <div className="flex justify-between mt-2 px-1">
            <span className="text-xs text-slate-400">Available</span>
            <span className="text-xs font-bold text-slate-700">{balance.toFixed(4)} {token}</span>
          </div>
        </div>

        {/* Recipient */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Recipient</label>
          <div className={`flex items-center gap-2 bg-slate-50 border rounded-xl px-3 py-2.5 transition-colors ${focusBorder} ${toAddr && !validAddress ? 'border-red-300' : 'border-slate-200'}`}>
            <span className="text-slate-400 text-sm">👤</span>
            <input type="text" placeholder="0x…" value={toAddr} onChange={e => { setToAddr(e.target.value); setStep('idle') }}
              className="flex-1 bg-transparent text-slate-900 text-sm font-mono outline-none placeholder:text-slate-300" />
            {validAddress && <span className="text-emerald-500">✓</span>}
          </div>
          {toAddr && !validAddress && <p className="text-red-500 text-xs mt-1">Invalid address</p>}
        </div>

        {/* Amount */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Amount</label>
          <div className={`flex items-center gap-2 bg-slate-50 border rounded-xl px-3 py-2.5 transition-colors ${focusBorder} ${amountN > balance ? 'border-red-300' : 'border-slate-200'}`}>
            <span className="text-slate-400">{token === 'USDC' ? '💵' : '💶'}</span>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={e => { setAmount(e.target.value); setStep('idle') }}
              className="flex-1 bg-transparent text-slate-900 font-bold text-xl outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            <span className="text-slate-500 font-semibold text-sm">{token}</span>
            <button onClick={() => setAmount(balance.toFixed(6))}
              className={`px-2 py-1 rounded-lg border text-xs font-semibold transition-colors ${maxBtn}`}>Max</button>
          </div>
          {amountN > balance && <p className="text-red-500 text-xs mt-1">Insufficient {token}</p>}
        </div>

        {/* Preview */}
        {validAddress && amountN > 0 && amountN <= balance && (
          <div className={`${previewBg} border rounded-xl p-3 text-xs flex flex-col gap-1.5`}>
            <div className="flex justify-between"><span className="text-slate-500">Send</span><span className="font-bold text-slate-900">{amount} {token}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">To</span><span className="font-mono text-slate-600">{toAddr.slice(0,10)}…{toAddr.slice(-8)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Via</span><span className="font-semibold text-slate-700">{signerLabel}</span></div>
          </div>
        )}

        {/* Status */}
        {step !== 'idle' && (
          <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-xs ${
            step === 'done'  ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
            step === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
            accent === 'indigo' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-violet-50 border-violet-200 text-violet-700'
          }`}>
            <span className="mt-0.5 shrink-0">{step === 'done' ? '✅' : step === 'error' ? '⚠' : '⏳'}</span>
            <div className="flex-1">
              <p className="font-semibold">
                {step === 'sending' ? 'Signing & broadcasting…' :
                 step === 'done'    ? `Sent ${amount} ${token}!` : errorMsg}
              </p>
              {txHash && step !== 'error' && (
                <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer"
                  className="text-[10px] font-mono underline opacity-70 hover:opacity-100 block mt-0.5">
                  {txHash.slice(0,18)}… ↗ ArcScan
                </a>
              )}
            </div>
          </div>
        )}

        {/* Button */}
        {step === 'done' ? (
          <button onClick={reset} className="w-full py-3.5 rounded-2xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 transition-colors">↩ Send Another</button>
        ) : (
          <button onClick={handleSend} disabled={!canSend}
            className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${canSend ? btnActive : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
            {step === 'sending' ? '⏳ Sending…' : `Send ${amount || '0'} ${token}${validAddress ? ` → ${toAddr.slice(0,6)}…` : ''}`}
          </button>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── WALLET INFRASTRUCTURE (Turnkey HSM) ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const DEMO_POLICIES = [
  { name: 'Max per transaction',   rule: '≤ 1,000 USDC',                  type: 'Amount',    on: true  },
  { name: 'Allowed chains',        rule: 'Arc, Base, Arbitrum',            type: 'Chain',     on: true  },
  { name: 'Daily rate limit',      rule: '10,000 USDC / 24 h',            type: 'Rate',      on: true  },
  { name: 'Approval threshold',    rule: 'Require 2/3 signers > 5k USDC', type: 'Multisig',  on: true  },
  { name: 'Address allowlist',     rule: '3 whitelisted addresses',        type: 'Whitelist', on: false },
]

const TK_STORAGE_KEY = 'turnkey_wallet'
const SUBORG_KEY     = 'turnkey_suborg_id'
const PARENT_ORG     = '4b3cc4a1-ed21-4ea9-b913-f0751fc41678'

function TurnkeyWalletSection() {
  const tk          = useTurnkey()
  const clientReady = tk.clientState === ClientState.Ready
  const { writeContract: tkWrite } = useWallet()

  const [subTab,    setSubTab]    = useState<InfraSubTab>('receive')
  const [email,     setEmail]     = useState('')
  const [otp,       setOtp]       = useState('')
  const [otpSent,   setOtpSent]   = useState(false)
  const [otpId,     setOtpId]     = useState('')
  const [otpBundle, setOtpBundle] = useState('')
  const [msg,       setMsg]       = useState('Hello from Arc Testnet! Signed via Turnkey.')
  const [sig,       setSig]       = useState('')
  const [busy,      setBusy]      = useState(false)
  const [err,       setErr]       = useState('')
  const [policies,  setPolicies]  = useState(DEMO_POLICIES.map(p => ({ ...p })))

  // Init Turnkey signer on login
  useEffect(() => {
    const wallet = tk.wallets?.[0]; const acct = wallet?.accounts?.[0]
    if (!acct?.address || !tk.httpClient) { clearTurnkeySigner(); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionOrgId = (tk as any).session?.organizationId ?? ''
    const cachedOrgId  = localStorage.getItem(SUBORG_KEY) ?? ''
    const orgId        = sessionOrgId || cachedOrgId || PARENT_ORG
    if (orgId && orgId !== PARENT_ORG) localStorage.setItem(SUBORG_KEY, orgId)
    localStorage.setItem(TK_STORAGE_KEY, JSON.stringify({ address: acct.address, orgId, walletId: wallet?.walletId ?? '' }))
    window.dispatchEvent(new Event('turnkey_wallet_updated'))
    void initTurnkeySigner(tk.httpClient, orgId, acct.address as `0x${string}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tk.wallets, tk.httpClient, tk.clientState, (tk as any).session?.organizationId])

  const handleEmailLogin = async () => {
    if (!email.includes('@') || busy) return
    setBusy(true); setErr('')
    try {
      const r = await tk.initOtp({ otpType: 'OTP_TYPE_EMAIL' as never, contact: email })
      setOtpId(r.otpId); setOtpBundle(r.otpEncryptionTargetBundle); setOtpSent(true)
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  const handleOtpVerify = async () => {
    if (!otp || busy) return; setBusy(true); setErr('')
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tkAny = tk as any
      if (typeof tkAny.completeOtp === 'function') {
        await tkAny.completeOtp({ otpId, otpCode: otp, otpEncryptionTargetBundle: otpBundle, contact: email, otpType: 'OTP_TYPE_EMAIL' })
      } else {
        const { verificationToken } = await tk.verifyOtp({ otpId, otpCode: otp, otpEncryptionTargetBundle: otpBundle })
        await tkAny.loginWithOtp?.({ verificationToken })
      }
      await tk.refreshWallets?.()
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  const handleCreateWallet = async () => {
    if (busy) return; setBusy(true); setErr('')
    try { await tk.createWallet({ walletName: 'Arc Wallet', accounts: ['ADDRESS_FORMAT_ETHEREUM'] }); await tk.refreshWallets?.() }
    catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  const handleSign = async () => {
    const acct = tk.wallets?.[0]?.accounts?.[0]; if (!acct || busy) return
    setBusy(true); setErr('')
    try { const s = await tk.signMessage({ walletAccount: acct, message: msg, addEthereumPrefix: true }); setSig(String(s)) }
    catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  const walletAddress = tk.wallets?.[0]?.accounts?.[0]?.address as `0x${string}` | undefined
  const isLoggedIn    = !!walletAddress

  const SUBTABS: { key: InfraSubTab; icon: string; label: string }[] = [
    { key: 'receive', icon: '📥', label: 'Receive' },
    { key: 'send',    icon: '📤', label: 'Send'    },
    { key: 'sign',    icon: '✍️', label: 'Sign'    },
    { key: 'policy',  icon: '🛡',  label: 'Policy'  },
    { key: 'ops',     icon: '⚙️', label: 'Ops'     },
  ]

  return (
    <div className="flex flex-col gap-0 rounded-3xl overflow-hidden border border-indigo-200 shadow-lg">

      {/* Header strip */}
      <div className="bg-gradient-to-br from-indigo-900 via-indigo-800 to-violet-900 px-5 pt-5 pb-4">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-xl shrink-0">🏛</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-extrabold text-sm">Wallet Infrastructure</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/50 text-indigo-200 font-bold uppercase tracking-wider">Turnkey HSM</span>
            </div>
            {isLoggedIn ? (
              <p className="text-indigo-300 text-[11px] font-mono mt-0.5 truncate">{walletAddress!.slice(0,14)}…{walletAddress!.slice(-8)}</p>
            ) : (
              <p className="text-indigo-400 text-[11px] mt-0.5">Email OTP · Passkey · No seed phrase</p>
            )}
          </div>
          {isLoggedIn && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-emerald-300 text-[10px] font-semibold">Active</span>
            </div>
          )}
        </div>

        {/* Sub-tab bar (inside header) */}
        {isLoggedIn && (
          <div className="flex gap-1 bg-white/10 p-1 rounded-xl">
            {SUBTABS.map(t => (
              <button key={t.key} onClick={() => setSubTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-semibold transition-all ${
                  subTab === t.key ? 'bg-white text-indigo-700 shadow' : 'text-indigo-300 hover:text-white hover:bg-white/10'
                }`}>
                <span>{t.icon}</span><span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="bg-slate-50 p-4 flex flex-col gap-4">
        {err && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">⚠ {err}</div>}
        {!clientReady && (
          <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-xs flex items-center gap-2">
            <span className="animate-spin">⏳</span> Connecting to Turnkey…
          </div>
        )}

        {/* ── Not logged in: login panel ── */}
        {!isLoggedIn && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
              {[{ icon: '🔒', l: 'HSM Secured' }, { icon: '📧', l: 'Email OTP' }, { icon: '🔑', l: 'Passkey' }].map(c => (
                <div key={c.l} className="bg-white border border-slate-200 rounded-xl p-2.5">
                  <p className="text-xl mb-0.5">{c.icon}</p><p className="font-semibold text-slate-700">{c.l}</p>
                </div>
              ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-3">
              <p className="text-xs font-bold text-slate-700 text-center">Login to your Turnkey Wallet</p>
              {!otpSent ? (
                <>
                  <div className="flex gap-2">
                    <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleEmailLogin()}
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="you@example.com" />
                    <button onClick={handleEmailLogin} disabled={busy || !email.includes('@')}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:bg-indigo-500 whitespace-nowrap">
                      {busy ? '⏳' : '→ OTP'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2"><div className="flex-1 h-px bg-slate-100"/><span className="text-[10px] text-slate-400">or</span><div className="flex-1 h-px bg-slate-100"/></div>
                  <button onClick={async () => { try { await (tk as any).loginWithPasskey?.({}); await tk.refreshWallets?.() } catch(e) { setErr(String(e)) } }}
                    className="py-2.5 border-2 border-dashed border-indigo-300 text-indigo-600 rounded-xl text-sm font-bold hover:bg-indigo-50">
                    🔑 Login with Passkey
                  </button>
                  <button onClick={handleCreateWallet} disabled={busy}
                    className="py-2 bg-slate-100 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-200 disabled:opacity-50">
                    {busy ? '⏳ Creating…' : '+ Create New Wallet'}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">✅ OTP sent to {email}</p>
                  <div className="flex gap-2">
                    <input value={otp} onChange={e => setOtp(e.target.value.toUpperCase())} maxLength={8} autoComplete="one-time-code"
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Enter OTP" />
                    <button onClick={handleOtpVerify} disabled={busy || otp.length < 4}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">
                      {busy ? '⏳' : 'Verify'}
                    </button>
                  </div>
                  <button onClick={() => { setOtpSent(false); setOtp(''); setErr('') }} className="text-xs text-slate-400 hover:text-slate-600">← Back</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Logged in: sub-tab content ── */}
        {isLoggedIn && subTab === 'receive' && (
          <ReceiveContent address={walletAddress!} accent="indigo" />
        )}

        {isLoggedIn && subTab === 'send' && (
          <SendContent address={walletAddress!} writeContractFn={tkWrite} signerLabel="Turnkey HSM · SGX enclave" accent="indigo" />
        )}

        {isLoggedIn && subTab === 'sign' && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-3">
            <p className="font-bold text-slate-900 text-sm flex items-center gap-2">✍️ Sign Message <span className="text-[9px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded font-bold">HSM</span></p>
            <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={3}
              className="w-full border border-slate-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button onClick={handleSign} disabled={busy}
              className="py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-500 disabled:opacity-50">
              {busy ? '⏳ Signing…' : '✍️ Sign with Turnkey HSM'}
            </button>
            {sig && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <p className="text-emerald-700 text-[10px] font-bold mb-1">✅ Signature</p>
                <code className="text-[10px] break-all text-emerald-800">{sig}</code>
              </div>
            )}
          </div>
        )}

        {isLoggedIn && subTab === 'policy' && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-3">
            <p className="font-bold text-slate-900 text-sm">🛡 Policy-Based Access Controls</p>
            <p className="text-slate-500 text-xs">Rules enforced at the Turnkey infrastructure layer — before any transaction reaches the chain.</p>
            <div className="flex flex-col divide-y divide-slate-50 border border-slate-200 rounded-xl overflow-hidden">
              {policies.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${p.on ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <div className="flex-1 min-w-0"><p className="font-semibold text-slate-900 text-xs">{p.name}</p><p className="text-slate-400 text-[10px] truncate">{p.rule}</p></div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${p.type === 'Multisig' ? 'bg-violet-100 text-violet-700' : p.type === 'Rate' ? 'bg-amber-100 text-amber-700' : p.type === 'Chain' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{p.type}</span>
                  <button onClick={() => setPolicies(prev => prev.map((r, j) => j === i ? { ...r, on: !r.on } : r))}
                    className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${p.on ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${p.on ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isLoggedIn && subTab === 'ops' && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-3">
            <p className="font-bold text-slate-900 text-sm">⚙️ Operational Wallets</p>
            <div className="flex flex-col gap-2">
              {[
                { name: 'Treasury',       balance: '248,500', icon: '🏦', role: 'Read + Sign',          txs: 142 },
                { name: 'Payroll Signer', balance: '12,300',  icon: '💼', role: 'Sign payroll only',    txs: 28  },
                { name: 'Contract Admin', balance: '500',     icon: '⚙️', role: 'Deploy + Admin calls',  txs: 7   },
              ].map(w => (
                <div key={w.name} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                  <span className="text-xl shrink-0">{w.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap"><p className="font-bold text-slate-900 text-xs">{w.name}</p><span className="text-[9px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">{w.role}</span></div>
                    <p className="text-slate-400 text-[10px] mt-0.5">{w.txs} txs signed</p>
                  </div>
                  <div className="text-right"><p className="font-extrabold text-slate-900 text-sm">{w.balance}</p><p className="text-slate-400 text-[10px]">USDC</p></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Logout */}
        {isLoggedIn && (
          <button onClick={() => {
            localStorage.removeItem(SUBORG_KEY); localStorage.removeItem(TK_STORAGE_KEY)
            clearTurnkeySigner(); window.location.reload()
          }} className="text-[11px] text-slate-400 hover:text-slate-600 text-center py-1">
            ⚙️ Logout / Reconfigure Turnkey
          </button>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CIRCLE DEVELOPER-CONTROLLED WALLET SECTION ──────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function CircleWalletSection() {
  const [wallet,   setWallet]   = useState<CircleWalletInfo | null>(loadCircleWallet())
  const [subTab,   setSubTab]   = useState<'receive' | 'send'>('receive')
  const [busy,     setBusy]     = useState(false)
  const [err,      setErr]      = useState('')
  const [info,     setInfo]     = useState('')
  const [balances, setBalances] = useState<{ symbol: string; amount: string }[]>([])
  const [loadingBal, setLoadingBal] = useState(false)

  // Send state
  const [toAddr,   setToAddr]   = useState('')
  const [amount,   setAmount]   = useState('')
  const [sendStep, setSendStep] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [txHash,   setTxHash]   = useState('')
  const [sendErr,  setSendErr]  = useState('')

  // Disconnect confirmation + reconnect
  const [showConfirm,    setShowConfirm]    = useState(false)
  const [reconnectId,    setReconnectId]    = useState('')
  const [reconnectBusy,  setReconnectBusy]  = useState(false)
  const [reconnectErr,   setReconnectErr]   = useState('')
  const [showReconnect,  setShowReconnect]  = useState(false)

  // Listen for wallet updates (created/cleared from another tab)
  useEffect(() => {
    const handler = () => setWallet(loadCircleWallet())
    window.addEventListener('circle_wallet_updated', handler)
    return () => window.removeEventListener('circle_wallet_updated', handler)
  }, [])

  // Load balances when wallet is connected
  const loadBalances = useCallback(async () => {
    if (!wallet) return
    setLoadingBal(true)
    try {
      const bals = await getCircleBalance(wallet.walletId)
      setBalances(bals)
    } catch (e) {
      // Balance fetch fails silently — fall back to on-chain display
    } finally {
      setLoadingBal(false)
    }
  }, [wallet])

  useEffect(() => { loadBalances() }, [loadBalances])

  const handleCreate = async () => {
    setBusy(true); setErr(''); setInfo('')
    try {
      const w = await createCircleWallet()
      setWallet(w)
      setInfo('✅ Circle wallet created!')
    } catch (e: unknown) {
      const ex = e as Error & { setup_required?: boolean; env?: string }
      if (ex.setup_required) {
        setInfo(`⚙️ One-time setup needed:\n\n${ex.env}\n\nAdd this to Vercel → Settings → Environment Variables, then redeploy and click Create again.`)
      } else {
        setErr(ex.message ?? String(e))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = () => setShowConfirm(true)

  const confirmDisconnect = () => {
    clearCircleWallet()
    setWallet(null)
    setBalances([])
    setErr('')
    setInfo('')
    setShowConfirm(false)
  }

  const handleReconnect = async () => {
    const id = reconnectId.trim()
    if (!id) return
    setReconnectBusy(true); setReconnectErr('')
    try {
      const w = await reconnectCircleWallet(id)
      setWallet(w)
      setShowReconnect(false)
      setReconnectId('')
      setInfo('✅ Đã kết nối lại ví Circle!')
    } catch (e) {
      setReconnectErr(e instanceof Error ? e.message.slice(0, 150) : 'Không tìm thấy ví. Kiểm tra lại Wallet ID.')
    } finally {
      setReconnectBusy(false)
    }
  }

  const handleSend = async () => {
    if (!wallet || !toAddr || !amount) return
    setSendStep('sending'); setSendErr(''); setTxHash('')
    try {
      const hash = await sendCircleUSDC(wallet.walletId, toAddr, amount)
      setTxHash(hash)
      setSendStep('done')
      await loadBalances()
    } catch (e) {
      setSendErr(e instanceof Error ? e.message.slice(0, 200) : String(e))
      setSendStep('error')
    }
  }

  const usdcBal = balances.find(b => b.symbol === 'USDC')?.amount ?? '—'
  const eurcBal = balances.find(b => b.symbol === 'EURC')?.amount ?? '—'
  const amountN = parseFloat(amount) || 0
  const usdcNum = parseFloat(usdcBal) || 0
  const canSend = isAddress(toAddr) && amountN > 0 && amountN <= usdcNum && sendStep === 'idle'

  const SUBTABS = [
    { key: 'receive' as const, icon: '📥', label: 'Receive' },
    { key: 'send'    as const, icon: '📤', label: 'Send'    },
  ]

  return (
    <div className="flex flex-col gap-0 rounded-3xl overflow-hidden border border-emerald-200 shadow-lg">

      {/* Header strip */}
      <div className="bg-gradient-to-br from-emerald-700 via-teal-600 to-cyan-700 px-5 pt-5 pb-4">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-xl shrink-0">⭕</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-extrabold text-sm">Circle Wallet</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/50 text-emerald-100 font-bold uppercase tracking-wider">Developer-Controlled · No Quota</span>
            </div>
            {wallet ? (
              <p className="text-emerald-200 text-[11px] font-mono mt-0.5 truncate">
                {wallet.address.slice(0, 14)}…{wallet.address.slice(-8)}
              </p>
            ) : (
              <p className="text-emerald-300 text-[11px] mt-0.5">Circle HSM · No seed phrase · No signing quota</p>
            )}
          </div>
          {wallet && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="w-2 h-2 bg-emerald-300 rounded-full animate-pulse" />
              <span className="text-emerald-200 text-[10px] font-semibold">Active</span>
            </div>
          )}
        </div>

        {/* Sub-tabs (only when wallet exists) */}
        {wallet && (
          <div className="flex gap-1 bg-white/10 p-1 rounded-xl">
            {SUBTABS.map(t => (
              <button key={t.key} onClick={() => setSubTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-semibold transition-all ${
                  subTab === t.key ? 'bg-white text-emerald-700 shadow' : 'text-emerald-200 hover:text-white hover:bg-white/10'
                }`}>
                <span>{t.icon}</span><span>{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="bg-slate-50 p-4 flex flex-col gap-4">
        {err  && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">❌ {err}</div>}
        {info && (
          <div className="px-3 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs whitespace-pre-wrap font-mono leading-relaxed">
            {info}
          </div>
        )}

        {/* ── No wallet: create / setup panel ── */}
        {!wallet && (
          <div className="flex flex-col gap-4">
            {/* Feature cards */}
            <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
              {[
                { icon: '⭕', label: 'Circle HSM' },
                { icon: '🚫', label: 'No Quota'   },
                { icon: '🔑', label: 'No Seed Phrase' },
              ].map(c => (
                <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-2.5">
                  <p className="text-xl mb-0.5">{c.icon}</p>
                  <p className="font-semibold text-slate-700">{c.label}</p>
                </div>
              ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-3">
              <p className="text-xs font-bold text-slate-700 text-center">Create a Circle Developer Wallet</p>
              <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                Server-signed on Arc Testnet via Circle API.<br/>
                No Turnkey quota limits. No MetaMask needed.
              </p>

              <button onClick={handleCreate} disabled={busy}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-sm hover:from-emerald-500 hover:to-teal-500 transition-all disabled:opacity-50">
                {busy ? '⏳ Creating wallet…' : '⭕ Create Circle Wallet'}
              </button>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[10px] text-slate-500 leading-relaxed">
                <p className="font-bold text-slate-700 mb-1">Requirements (Vercel env):</p>
                <p>• <code className="text-emerald-700">CIRCLE_API_KEY</code> — from console.circle.com → API Keys</p>
                <p>• <code className="text-emerald-700">CIRCLE_ENTITY_SECRET</code> — already generated</p>
                <p>• <code className="text-emerald-700">CIRCLE_WALLET_SET_ID</code> — returned on first create</p>
              </div>
            </div>

            {/* Reconnect existing wallet */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-3">
              <button
                onClick={() => { setShowReconnect(v => !v); setReconnectErr('') }}
                className="text-xs text-slate-500 hover:text-emerald-600 font-semibold text-left flex items-center gap-1 transition-colors"
              >
                🔁 Đã có ví trước? Kết nối lại bằng Wallet ID {showReconnect ? '▴' : '▾'}
              </button>

              {showReconnect && (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Nhập Wallet ID đã lưu để kết nối lại ví cũ mà không cần tạo mới.
                  </p>
                  <input
                    type="text"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={reconnectId}
                    onChange={e => { setReconnectId(e.target.value); setReconnectErr('') }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono text-xs text-slate-800 outline-none focus:border-emerald-400 transition-colors"
                  />
                  {reconnectErr && <p className="text-red-500 text-[11px]">{reconnectErr}</p>}
                  <button
                    onClick={handleReconnect}
                    disabled={reconnectBusy || !reconnectId.trim()}
                    className="w-full py-2.5 rounded-xl bg-emerald-500 text-white font-bold text-sm hover:bg-emerald-400 transition-colors disabled:opacity-50"
                  >
                    {reconnectBusy ? '⏳ Đang kết nối…' : '🔌 Kết nối lại'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Wallet active: Receive tab ── */}
        {wallet && subTab === 'receive' && (
          <div className="flex flex-col gap-4">
            {/* Balances */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: '💵', sym: 'USDC', bal: usdcBal, color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                { icon: '💶', sym: 'EURC', bal: eurcBal, color: 'bg-teal-50 border-teal-200 text-teal-700' },
              ].map(b => (
                <div key={b.sym} className={`${b.color} border rounded-2xl p-4`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-lg">{b.icon}</span>
                    <span className="text-xs font-bold uppercase tracking-wider">{b.sym}</span>
                    {loadingBal && <span className="text-[10px] animate-pulse">…</span>}
                  </div>
                  <p className="font-extrabold text-2xl">{b.bal}</p>
                  <p className="text-[10px] opacity-60 mt-0.5">Arc Testnet · Circle</p>
                </div>
              ))}
            </div>

            {/* Address + QR */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Your Circle Wallet Address</p>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="shrink-0 p-2.5 bg-white border-2 border-emerald-300 rounded-xl">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&format=svg&data=${encodeURIComponent(wallet.address)}`}
                    alt="QR" width={120} height={120} className="rounded-lg"
                  />
                </div>
                <div className="flex-1 w-full flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                    <p className="font-mono text-xs flex-1 break-all text-emerald-800">{wallet.address}</p>
                    <CopyBtnLight value={wallet.address} />
                  </div>
                  <button onClick={loadBalances} disabled={loadingBal}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50">
                    {loadingBal ? '⏳ Loading…' : '🔄 Refresh Balance'}
                  </button>
                  <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-bold hover:opacity-90 transition-all">
                    💧 Get Testnet USDC — faucet.circle.com
                  </a>
                  <a href={`https://testnet.arcscan.app/address/${wallet.address}`} target="_blank" rel="noreferrer"
                    className="text-center py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-xs hover:text-slate-700 transition-colors">
                    🔍 View on ArcScan ↗
                  </a>
                </div>
              </div>
            </div>

            {/* Wallet info + disconnect */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Wallet Info</p>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <span className="text-[10px] text-slate-400 w-20 shrink-0">Wallet ID</span>
                <span className="font-mono text-[10px] text-slate-600 flex-1 truncate">{wallet.walletId}</span>
                <CopyBtnLight value={wallet.walletId} />
              </div>
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                <span className="text-[10px] text-emerald-700 font-semibold">⭕ Circle Developer-Controlled</span>
                <span className="text-[10px] text-emerald-600">Arc Testnet</span>
              </div>
              <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠️ Hãy sao chép Wallet ID ở trên trước khi ngắt kết nối để có thể kết nối lại sau.
              </p>
              <button onClick={handleDisconnect}
                className="py-2.5 rounded-xl border border-red-200 bg-white text-red-500 text-sm font-bold hover:bg-red-50 hover:border-red-300 transition-colors flex items-center justify-center gap-2">
                🔌 Ngắt kết nối Circle Wallet
              </button>
            </div>

            {/* Confirm disconnect dialog */}
            {showConfirm && (
              <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowConfirm(false)} />
                <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm flex flex-col gap-4">
                  <h3 className="text-slate-900 font-extrabold text-lg">⚠️ Xác nhận ngắt kết nối</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">
                    Ngắt kết nối sẽ <strong>xóa ví khỏi thiết bị này</strong>. Ví vẫn tồn tại trên blockchain, nhưng bạn cần <strong>Wallet ID</strong> để kết nối lại.
                  </p>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 shrink-0">Wallet ID</span>
                    <span className="font-mono text-[11px] text-slate-700 flex-1 truncate">{wallet.walletId}</span>
                    <CopyBtnLight value={wallet.walletId} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowConfirm(false)}
                      className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition-colors">
                      Huỷ
                    </button>
                    <button onClick={confirmDisconnect}
                      className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors">
                      Ngắt kết nối
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Wallet active: Send tab ── */}
        {wallet && subTab === 'send' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-700 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              Signed by Circle API · Arc Testnet · No Turnkey quota
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">
              {/* Only USDC for Circle wallet (most common) */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Send USDC</span>
                <span className="text-xs text-slate-500 font-semibold">
                  Balance: <span className="text-emerald-600 font-bold">{usdcBal} USDC</span>
                </span>
              </div>

              {/* Recipient */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Recipient</label>
                <div className={`flex items-center gap-2 bg-slate-50 border rounded-xl px-3 py-2.5 focus-within:border-emerald-400 transition-colors ${toAddr && !isAddress(toAddr) ? 'border-red-300' : 'border-slate-200'}`}>
                  <span className="text-slate-400 text-sm">👤</span>
                  <input type="text" placeholder="0x…" value={toAddr}
                    onChange={e => { setToAddr(e.target.value); setSendStep('idle') }}
                    className="flex-1 bg-transparent text-slate-900 text-sm font-mono outline-none placeholder:text-slate-300" />
                  {isAddress(toAddr) && <span className="text-emerald-500">✓</span>}
                </div>
                {toAddr && !isAddress(toAddr) && <p className="text-red-500 text-xs mt-1">Invalid address</p>}
              </div>

              {/* Amount */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Amount (USDC)</label>
                <div className={`flex items-center gap-2 bg-slate-50 border rounded-xl px-3 py-2.5 focus-within:border-emerald-400 transition-colors ${amountN > usdcNum && usdcNum > 0 ? 'border-red-300' : 'border-slate-200'}`}>
                  <span className="text-slate-400">💵</span>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={amount}
                    onChange={e => { setAmount(e.target.value); setSendStep('idle') }}
                    className="flex-1 bg-transparent text-slate-900 font-bold text-xl outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  <span className="text-slate-500 font-semibold text-sm">USDC</span>
                  <button onClick={() => setAmount(usdcNum.toString())}
                    className="px-2 py-1 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100 text-xs font-semibold transition-colors">
                    Max
                  </button>
                </div>
                {amountN > usdcNum && usdcNum > 0 && <p className="text-red-500 text-xs mt-1">Insufficient USDC</p>}
              </div>

              {/* Preview */}
              {isAddress(toAddr) && amountN > 0 && amountN <= usdcNum && sendStep === 'idle' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs flex flex-col gap-1.5">
                  <div className="flex justify-between"><span className="text-slate-500">Send</span><span className="font-bold text-slate-900">{amount} USDC</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">To</span><span className="font-mono text-slate-600">{toAddr.slice(0,10)}…{toAddr.slice(-8)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Via</span><span className="font-semibold text-emerald-700">Circle API · Arc Testnet</span></div>
                </div>
              )}

              {/* Status */}
              {sendStep === 'sending' && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-xs font-semibold">
                  <span className="animate-spin">⏳</span> Signing via Circle API · waiting ~780ms…
                </div>
              )}
              {sendStep === 'done' && txHash && (
                <div className="px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs">
                  <p className="text-emerald-700 font-bold mb-1">✅ Transaction confirmed!</p>
                  <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer"
                    className="font-mono text-violet-600 hover:underline break-all">{txHash}</a>
                </div>
              )}
              {sendStep === 'error' && (
                <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">❌ {sendErr}</div>
              )}

              {/* Send button */}
              {sendStep !== 'done' ? (
                <button onClick={handleSend} disabled={!canSend || sendStep !== 'idle'}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-sm hover:from-emerald-500 hover:to-teal-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-900/20">
                  {sendStep === 'sending' ? '⏳ Sending…' : `Send ${amount || '0'} USDC via Circle`}
                </button>
              ) : (
                <button onClick={() => { setSendStep('idle'); setToAddr(''); setAmount(''); setTxHash('') }}
                  className="w-full py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition-colors">
                  Send Another
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── METAMASK / EXTERNAL WALLET SECTION ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function MetaMaskWalletSection() {
  const { address, isConnected } = useAccount()
  const [subTab, setSubTab] = useState<MetaSubTab>('receive')

  const { writeContractAsync } = useWriteContract()

  const wagmiWriteFn = useCallback(async (params: {
    address: `0x${string}`; abi: typeof TRANSFER_ABI; functionName: 'transfer'; args: readonly [`0x${string}`, bigint]
  }) => {
    return writeContractAsync(params)
  }, [writeContractAsync])

  const SUBTABS: { key: MetaSubTab; icon: string; label: string }[] = [
    { key: 'receive', icon: '📥', label: 'Receive' },
    { key: 'send',    icon: '📤', label: 'Send'    },
  ]

  return (
    <div className="flex flex-col gap-0 rounded-3xl overflow-hidden border border-violet-200 shadow-lg">

      {/* Header strip */}
      <div className="bg-gradient-to-br from-violet-700 via-violet-600 to-blue-700 px-5 pt-5 pb-4">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-xl shrink-0">🦊</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-extrabold text-sm">External Wallet</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/50 text-violet-200 font-bold uppercase tracking-wider">MetaMask · WalletConnect</span>
            </div>
            {isConnected && address ? (
              <p className="text-violet-300 text-[11px] font-mono mt-0.5 truncate">{address.slice(0,14)}…{address.slice(-8)}</p>
            ) : (
              <p className="text-violet-400 text-[11px] mt-0.5">Connect MetaMask, Coinbase, or any WalletConnect wallet</p>
            )}
          </div>
          {isConnected && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-emerald-300 text-[10px] font-semibold">Connected</span>
            </div>
          )}
        </div>

        {/* Sub-tab bar */}
        {isConnected && address && (
          <div className="flex gap-1 bg-white/10 p-1 rounded-xl">
            {SUBTABS.map(t => (
              <button key={t.key} onClick={() => setSubTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-semibold transition-all ${
                  subTab === t.key ? 'bg-white text-violet-700 shadow' : 'text-violet-300 hover:text-white hover:bg-white/10'
                }`}>
                <span>{t.icon}</span><span>{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="bg-slate-50 p-4 flex flex-col gap-4">
        {!isConnected || !address ? (
          <div className="flex flex-col items-center gap-5 py-8">
            {/* Wallet icons */}
            <div className="flex items-center gap-3">
              {['🦊', '🔵', '🟡', '🔷'].map((icon, i) => (
                <div key={i} className="w-12 h-12 rounded-2xl bg-white border-2 border-violet-200 flex items-center justify-center text-2xl shadow-sm">{icon}</div>
              ))}
            </div>
            <div className="text-center">
              <p className="font-bold text-slate-900 text-sm">Connect Your Wallet</p>
              <p className="text-slate-500 text-xs mt-1">MetaMask · Coinbase Wallet · WalletConnect · and more</p>
            </div>
            <ConnectButton label="Connect Wallet" />
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-700 text-xs text-center max-w-xs">
              Make sure to switch to <strong>Arc Testnet</strong> (Chain ID: 5042002) after connecting.
            </div>

            {/* Add network guide */}
            <div className="w-full bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">Add Arc Testnet to MetaMask</p>
              <div className="flex flex-col gap-1.5">
                {[
                  { label: 'RPC URL',    value: 'https://rpc.testnet.arc.network' },
                  { label: 'Chain ID',   value: '5042002'                          },
                  { label: 'Symbol',     value: 'USDC'                             },
                  { label: 'Explorer',   value: 'https://testnet.arcscan.app'      },
                ].map(r => (
                  <div key={r.label} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                    <span className="text-slate-400 text-[10px] w-16 shrink-0">{r.label}</span>
                    <span className="font-mono text-[11px] text-slate-700 flex-1 truncate">{r.value}</span>
                    <CopyBtnLight value={r.value} label="" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {subTab === 'receive' && <ReceiveContent address={address} accent="violet" />}
            {subTab === 'send'    && (
              <SendContent address={address} writeContractFn={wagmiWriteFn} signerLabel="MetaMask / External Wallet" accent="violet" />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MAIN PANEL ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export default function WalletPanel() {
  const [kind, setKind] = useState<WalletKind>('circle')

  return (
    <div className="flex flex-col gap-5">

      {/* Page header */}
      <div className="flex items-center gap-3 px-1">
        <h2 className="text-slate-900 font-extrabold text-xl">Wallet</h2>
        <span className="text-slate-400 text-sm font-medium">· Arc Testnet</span>
      </div>

      {/* Wallet type selector */}
      <div className="grid grid-cols-3 gap-3">
        {/* Wallet Infra card */}
        <button onClick={() => setKind('infra')}
          className={`relative flex flex-col items-start gap-2 p-4 rounded-2xl border-2 text-left transition-all ${
            kind === 'infra'
              ? 'border-indigo-500 bg-indigo-50 shadow-md shadow-indigo-100'
              : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50'
          }`}>
          {kind === 'infra' && (
            <span className="absolute top-3 right-3 w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-white" />
            </span>
          )}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-xl shadow-sm">🏛</div>
          <div>
            <p className={`font-extrabold text-sm ${kind === 'infra' ? 'text-indigo-900' : 'text-slate-800'}`}>Wallet Infra</p>
            <p className={`text-[11px] mt-0.5 leading-relaxed ${kind === 'infra' ? 'text-indigo-600' : 'text-slate-500'}`}>
              Turnkey HSM · Email OTP
            </p>
          </div>
          <div className="flex gap-1 flex-wrap">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">HSM</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">Quota Limit</span>
          </div>
        </button>

        {/* Circle Wallet card */}
        <button onClick={() => setKind('circle')}
          className={`relative flex flex-col items-start gap-2 p-4 rounded-2xl border-2 text-left transition-all ${
            kind === 'circle'
              ? 'border-emerald-500 bg-emerald-50 shadow-md shadow-emerald-100'
              : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50'
          }`}>
          {kind === 'circle' && (
            <span className="absolute top-3 right-3 w-4 h-4 rounded-full bg-emerald-600 flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-white" />
            </span>
          )}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-xl shadow-sm">⭕</div>
          <div>
            <p className={`font-extrabold text-sm ${kind === 'circle' ? 'text-emerald-900' : 'text-slate-800'}`}>Circle Wallet</p>
            <p className={`text-[11px] mt-0.5 leading-relaxed ${kind === 'circle' ? 'text-emerald-600' : 'text-slate-500'}`}>
              Dev-Controlled · No Quota
            </p>
          </div>
          <div className="flex gap-1 flex-wrap">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">No Quota</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-800 font-bold">Recommended</span>
          </div>
        </button>

        {/* MetaMask card */}
        <button onClick={() => setKind('metamask')}
          className={`relative flex flex-col items-start gap-2 p-4 rounded-2xl border-2 text-left transition-all ${
            kind === 'metamask'
              ? 'border-violet-500 bg-violet-50 shadow-md shadow-violet-100'
              : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/50'
          }`}>
          {kind === 'metamask' && (
            <span className="absolute top-3 right-3 w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-white" />
            </span>
          )}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-xl shadow-sm">🦊</div>
          <div>
            <p className={`font-extrabold text-sm ${kind === 'metamask' ? 'text-violet-900' : 'text-slate-800'}`}>External Wallet</p>
            <p className={`text-[11px] mt-0.5 leading-relaxed ${kind === 'metamask' ? 'text-violet-600' : 'text-slate-500'}`}>
              MetaMask · WalletConnect
            </p>
          </div>
          <div className="flex gap-1 flex-wrap">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-bold">MetaMask</span>
          </div>
        </button>
      </div>

      {/* Divider with label */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-200" />
        <span className={`text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full ${
          kind === 'infra'    ? 'bg-indigo-50 text-indigo-600 border border-indigo-200'   :
          kind === 'circle'   ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                                'bg-violet-50 text-violet-600 border border-violet-200'
        }`}>
          {kind === 'infra' ? '🏛 Wallet Infrastructure' : kind === 'circle' ? '⭕ Circle Wallet' : '🦊 External Wallet'}
        </span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* Content */}
      {kind === 'infra' && (
        <TurnkeyProvider config={{ organizationId: PARENT_ORG, authProxyConfigId: '42a731dd-f14c-497c-b91c-62e90405684c' }}>
          <TurnkeyWalletSection />
        </TurnkeyProvider>
      )}
      {kind === 'circle'   && <CircleWalletSection />}
      {kind === 'metamask' && <MetaMaskWalletSection />}

      {/* Footer */}
      <p className="text-center text-xs text-slate-400 pb-2">
        Arc Testnet · For testing purposes only · Real funds not supported
      </p>
    </div>
  )
}
