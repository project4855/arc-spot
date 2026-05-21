// ── WalletPanel.tsx ──────────────────────────────────────────────────────────
// Wallet Infrastructure (Turnkey HSM) is the primary experience.
// Sub-tabs inside Infra: Wallet (receive/QR) · Send · Sign · Policy · Ops
// Secondary tabs: generic Receive, Send (any wallet), Create/Import tools

import { useState, useCallback, useEffect } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { initTurnkeySigner, clearTurnkeySigner } from '../lib/turnkeySigner'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { parseUnits, formatUnits, isAddress } from 'viem'
import { TOKEN_ADDRESSES, TOKEN_DECIMALS, ERC20_ABI } from '../config/contracts'
import { TurnkeyProvider, useTurnkey, ClientState } from '@turnkey/react-wallet-kit'
import { useWallet } from '../hooks/useWallet'
import { arcTestnet } from '../config/wagmi'

// ─── Types ────────────────────────────────────────────────────────────────────

type WTab = 'infra' | 'receive' | 'send' | 'create'
type InfraSubTab = 'wallet' | 'send' | 'sign' | 'policy' | 'ops'

interface GeneratedWallet {
  address:    string
  privateKey: string
  mnemonic:   string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateNewWallet(): Promise<GeneratedWallet> {
  const { generatePrivateKey } = await import('viem/accounts')
  const { english, generateMnemonic, mnemonicToAccount } = await import('viem/accounts')
  const mnemonic = generateMnemonic(english)
  const account  = mnemonicToAccount(mnemonic)
  return { address: account.address, privateKey: generatePrivateKey(), mnemonic }
}

async function deriveFromPK(pk: string): Promise<string | null> {
  try {
    const { privateKeyToAccount } = await import('viem/accounts')
    const hex = pk.startsWith('0x') ? pk as `0x${string}` : `0x${pk}` as `0x${string}`
    return privateKeyToAccount(hex).address
  } catch { return null }
}

// ─── Small reusable components ────────────────────────────────────────────────

function CopyBtn({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors">
      {copied ? '✓ Copied' : `📋 ${label}`}
    </button>
  )
}

function RevealField({ label, value, mono = true, warn }: {
  label: string; value: string; mono?: boolean; warn?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div className={`rounded-xl border p-3 ${warn ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className="flex gap-1.5">
          <button onClick={() => setShow(v => !v)}
            className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-500 text-xs hover:bg-slate-100 transition-colors">
            {show ? '🙈 Hide' : '👁 Show'}
          </button>
          <CopyBtn value={value} />
        </div>
      </div>
      <p className={`text-xs break-all ${mono ? 'font-mono' : ''} ${show ? 'text-slate-800' : 'text-slate-300 select-none'}`}>
        {show ? value : '•'.repeat(Math.min(value.length, 48))}
      </p>
    </div>
  )
}

// ─── Token balance hook ───────────────────────────────────────────────────────

function useTokenBalance(tokenSymbol: 'USDC' | 'EURC', userAddress: `0x${string}` | undefined) {
  const { data } = useReadContract({
    address:      TOKEN_ADDRESSES[tokenSymbol],
    abi:          ERC20_ABI,
    functionName: 'balanceOf',
    args:         userAddress ? [userAddress] : undefined,
    query:        { enabled: !!userAddress, refetchInterval: 8_000 },
  })
  return data ? parseFloat(formatUnits(data as bigint, TOKEN_DECIMALS[tokenSymbol])) : 0
}

// ─── ERC-20 Transfer ABI ──────────────────────────────────────────────────────

const TRANSFER_ABI = [{
  name: 'transfer', type: 'function', stateMutability: 'nonpayable',
  inputs:  [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const

// ═══════════════════════════════════════════════════════════════════════════════
// ─── INFRA: WALLET SUB-TAB (Receive / QR) ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function InfraWalletContent({ address }: { address: `0x${string}` }) {
  const usdcBal = useTokenBalance('USDC', address)
  const eurcBal = useTokenBalance('EURC', address)
  const qrUrl   = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&format=svg&data=${encodeURIComponent(address)}`

  return (
    <div className="flex flex-col gap-4">

      {/* Balance cards */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { symbol: 'USDC', balance: usdcBal, icon: '💵', color: 'from-blue-500 to-cyan-500',   bg: 'bg-blue-50   border-blue-200',   text: 'text-blue-700'   },
          { symbol: 'EURC', balance: eurcBal, icon: '💶', color: 'from-violet-500 to-purple-500', bg: 'bg-violet-50 border-violet-200', text: 'text-violet-700' },
        ].map(t => (
          <div key={t.symbol} className={`${t.bg} border rounded-2xl p-4`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{t.icon}</span>
              <span className={`text-xs font-bold ${t.text} uppercase tracking-wider`}>{t.symbol}</span>
            </div>
            <p className={`font-extrabold text-2xl ${t.text}`}>{t.balance.toFixed(4)}</p>
            <p className="text-slate-400 text-[10px] mt-0.5">Arc Testnet</p>
          </div>
        ))}
      </div>

      {/* Address + QR */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Your Wallet Address</p>
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <div className="shrink-0 p-3 bg-white border-2 border-indigo-200 rounded-2xl shadow-sm">
            <img src={qrUrl} alt="QR" width={140} height={140} className="rounded-lg" />
          </div>
          <div className="flex-1 w-full flex flex-col gap-3">
            <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2.5">
              <p className="font-mono text-xs text-indigo-700 break-all flex-1">{address}</p>
              <CopyBtn value={address} />
            </div>
            <div className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />
              <p className="text-emerald-700 text-xs font-semibold">HSM-secured · Turnkey SGX enclave</p>
            </div>
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-semibold hover:from-emerald-400 hover:to-teal-400 transition-all">
              💧 Get Free Testnet USDC
            </a>
          </div>
        </div>
      </div>

      {/* Token addresses */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Token Addresses · Arc Testnet</p>
        <div className="flex flex-col gap-2">
          {Object.entries(TOKEN_ADDRESSES).map(([sym, addr]) => (
            <div key={sym} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-base">{sym === 'USDC' ? '💵' : '💶'}</span>
              <span className="font-semibold text-slate-700 text-xs w-10">{sym}</span>
              <span className="font-mono text-[11px] text-slate-500 flex-1 truncate">{addr}</span>
              <CopyBtn value={addr} />
            </div>
          ))}
        </div>
      </div>

      {/* Explorer link */}
      <a href={`https://testnet.arcscan.app/address/${address}`} target="_blank" rel="noreferrer"
        className="flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-white border border-slate-200 text-slate-500 text-xs hover:border-indigo-300 hover:text-indigo-600 transition-all">
        🔍 View on ArcScan ↗
      </a>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── INFRA: SEND SUB-TAB ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function InfraSendContent({ address }: { address: `0x${string}` }) {
  const [token,    setToken]    = useState<'USDC' | 'EURC'>('USDC')
  const [toAddr,   setToAddr]   = useState('')
  const [amount,   setAmount]   = useState('')
  const [step,     setStep]     = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [txHash,   setTxHash]   = useState<`0x${string}` | null>(null)

  const usdcBal = useTokenBalance('USDC', address)
  const eurcBal = useTokenBalance('EURC', address)
  const balance = token === 'USDC' ? usdcBal : eurcBal

  const { writeContract } = useWallet()
  const publicClient = usePublicClient({ chainId: arcTestnet.id })

  const validAddress = isAddress(toAddr)
  const amountN      = parseFloat(amount) || 0
  const canSend      = validAddress && amountN > 0 && amountN <= balance && step === 'idle'

  const handleSend = async () => {
    if (!canSend) return
    setStep('sending'); setErrorMsg(''); setTxHash(null)
    try {
      const hash = await writeContract({
        address:      TOKEN_ADDRESSES[token],
        abi:          TRANSFER_ABI,
        functionName: 'transfer',
        args:         [toAddr as `0x${string}`, parseUnits(amount, TOKEN_DECIMALS[token])],
      })
      setTxHash(hash)
      // Wait for confirmation
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

      {/* HSM badge */}
      <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-xl">
        <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse shrink-0" />
        <p className="text-indigo-700 text-xs font-semibold">Signing with Turnkey HSM · {address.slice(0,8)}…{address.slice(-6)}</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">

        {/* Token selector */}
        <div>
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Token</label>
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
            <span className="text-xs text-slate-400">Available balance</span>
            <span className="text-xs font-bold text-slate-700">{balance.toFixed(4)} {token}</span>
          </div>
        </div>

        {/* Recipient */}
        <div>
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Recipient Address</label>
          <div className={`flex items-center gap-2 bg-slate-50 border rounded-xl px-3 py-2.5 focus-within:border-indigo-400 transition-colors ${
            toAddr && !validAddress ? 'border-red-300' : 'border-slate-200'
          }`}>
            <span className="text-slate-400">👤</span>
            <input type="text" placeholder="0x…" value={toAddr}
              onChange={e => { setToAddr(e.target.value); setStep('idle') }}
              className="flex-1 bg-transparent text-slate-900 text-sm font-mono outline-none placeholder:text-slate-300" />
            {validAddress && <span className="text-emerald-500 text-sm">✓</span>}
          </div>
          {toAddr && !validAddress && <p className="text-red-500 text-xs mt-1">Invalid address format</p>}
        </div>

        {/* Amount */}
        <div>
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Amount</label>
          <div className={`flex items-center gap-2 bg-slate-50 border rounded-xl px-3 py-2.5 focus-within:border-indigo-400 transition-colors ${
            amountN > balance ? 'border-red-300' : 'border-slate-200'
          }`}>
            <span className="text-slate-400">{token === 'USDC' ? '💵' : '💶'}</span>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={amount}
              onChange={e => { setAmount(e.target.value); setStep('idle') }}
              className="flex-1 bg-transparent text-slate-900 font-bold text-xl outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            <span className="text-slate-500 font-semibold text-sm">{token}</span>
            <button onClick={() => setAmount(balance.toFixed(6))}
              className="px-2 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 text-xs font-semibold hover:bg-indigo-100 transition-colors">
              Max
            </button>
          </div>
          {amountN > balance && <p className="text-red-500 text-xs mt-1">Insufficient {token} balance</p>}
        </div>

        {/* Preview */}
        {validAddress && amountN > 0 && amountN <= balance && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs flex flex-col gap-1.5">
            <div className="flex justify-between">
              <span className="text-indigo-500">Sending</span>
              <span className="font-bold text-indigo-900">{amount} {token}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-indigo-500">To</span>
              <span className="font-mono text-indigo-700">{toAddr.slice(0, 10)}…{toAddr.slice(-8)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-indigo-500">Signed by</span>
              <span className="text-indigo-700 font-semibold">Turnkey HSM</span>
            </div>
            <div className="flex justify-between">
              <span className="text-indigo-500">Network</span>
              <span className="text-indigo-700 font-medium">Arc Testnet · gas: USDC</span>
            </div>
          </div>
        )}

        {/* Status */}
        {step !== 'idle' && (
          <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-xs ${
            step === 'done'  ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
            step === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                               'bg-indigo-50 border-indigo-200 text-indigo-700'
          }`}>
            <span className="mt-0.5">{step === 'done' ? '✅' : step === 'error' ? '⚠' : '⏳'}</span>
            <div className="flex-1">
              <p className="font-semibold">
                {step === 'sending' ? 'Signing & broadcasting via Turnkey HSM…' :
                 step === 'done'    ? `Sent ${amount} ${token} successfully!` : errorMsg}
              </p>
              {txHash && step !== 'error' && (
                <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer"
                  className="text-[10px] font-mono underline opacity-70 hover:opacity-100 block mt-0.5">
                  {txHash.slice(0, 18)}… ↗ ArcScan
                </a>
              )}
            </div>
          </div>
        )}

        {/* Button */}
        {step === 'done' ? (
          <button onClick={reset}
            className="w-full py-3.5 rounded-2xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 transition-colors">
            ↩ Send Another
          </button>
        ) : (
          <button onClick={handleSend} disabled={!canSend}
            className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
              canSend
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-900/20'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}>
            {step === 'sending' ? '⏳ Signing…'
              : `Send ${amount || '0'} ${token}${validAddress ? ` → ${toAddr.slice(0, 6)}…` : ''}`}
          </button>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── TURNKEY DASHBOARD ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const DEMO_POLICIES = [
  { name: 'Max per transaction',   rule: '≤ 1,000 USDC',                  type: 'Amount',    on: true  },
  { name: 'Allowed chains',        rule: 'Arc, Base, Arbitrum',            type: 'Chain',     on: true  },
  { name: 'Daily rate limit',      rule: '10,000 USDC / 24 h',            type: 'Rate',      on: true  },
  { name: 'Approval threshold',    rule: 'Require 2/3 signers > 5k USDC', type: 'Multisig',  on: true  },
  { name: 'Address allowlist',     rule: '3 whitelisted addresses',        type: 'Whitelist', on: false },
]

const DEMO_OPS_WALLETS = [
  { name: 'Treasury',       balance: '248,500', icon: '🏦', role: 'Read + Sign',         txs: 142 },
  { name: 'Payroll Signer', balance: '12,300',  icon: '💼', role: 'Sign payroll only',   txs: 28  },
  { name: 'Contract Admin', balance: '500',     icon: '⚙️', role: 'Deploy + Admin calls', txs: 7   },
]

const TK_STORAGE_KEY = 'turnkey_wallet'

function TurnkeyDashboard({ onReconfigure }: { onReconfigure: () => void }) {
  const tk = useTurnkey()
  const clientReady = tk.clientState === ClientState.Ready

  const SUBORG_KEY = 'turnkey_suborg_id'
  const PARENT_ORG = '4b3cc4a1-ed21-4ea9-b913-f0751fc41678'

  const [email,     setEmail]     = useState('')
  const [otp,       setOtp]       = useState('')
  const [otpSent,   setOtpSent]   = useState(false)
  const [otpId,     setOtpId]     = useState('')
  const [otpBundle, setOtpBundle] = useState('')
  const [msg,       setMsg]       = useState('Hello from Arc Testnet! Signed via Turnkey.')
  const [sig,       setSig]       = useState('')
  const [busy,      setBusy]      = useState(false)
  const [err,       setErr]       = useState('')
  const [infraTab,  setInfraTab]  = useState<InfraSubTab>('wallet')

  // Persist wallet info & init HSM signer
  useEffect(() => {
    const wallet = tk.wallets?.[0]
    const acct   = wallet?.accounts?.[0]
    if (!acct?.address || !tk.httpClient) { clearTurnkeySigner(); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionOrgId: string = (tk as any).session?.organizationId ?? ''
    const cachedOrgId: string  = localStorage.getItem(SUBORG_KEY) ?? ''
    const orgId = sessionOrgId || cachedOrgId || PARENT_ORG
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
    if (!otp || busy) return
    setBusy(true); setErr('')
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
    if (busy) return
    setBusy(true); setErr('')
    try {
      await tk.createWallet({ walletName: 'Arc Wallet', accounts: ['ADDRESS_FORMAT_ETHEREUM'] })
      await tk.refreshWallets?.()
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  const handleSignMessage = async () => {
    const acct = tk.wallets?.[0]?.accounts?.[0]
    if (!acct || busy) return
    setBusy(true); setErr('')
    try {
      const s = await tk.signMessage({ walletAccount: acct, message: msg, addEthereumPrefix: true })
      setSig(String(s))
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  const walletAddress = tk.wallets?.[0]?.accounts?.[0]?.address as `0x${string}` | undefined
  const isLoggedIn    = !!tk.wallets?.length && !!walletAddress

  const INFRA_TABS: { key: InfraSubTab; label: string; icon: string }[] = [
    { key: 'wallet', label: 'Wallet',     icon: '👛' },
    { key: 'send',   label: 'Send',       icon: '📤' },
    { key: 'sign',   label: 'Sign',       icon: '✍️' },
    { key: 'policy', label: 'Policies',   icon: '🛡' },
    { key: 'ops',    label: 'Ops',        icon: '⚙️' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {err && (
        <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">⚠ {err}</div>
      )}
      {!clientReady && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-xs font-medium flex items-center gap-2">
          <span className="animate-spin">⏳</span> Connecting to Turnkey…
        </div>
      )}

      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-white border border-slate-200 p-1 rounded-2xl shadow-sm">
        {INFRA_TABS.map(t => (
          <button key={t.key} onClick={() => setInfraTab(t.key)}
            className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              infraTab === t.key
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}>
            <span>{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── WALLET (Receive) ── */}
      {infraTab === 'wallet' && (
        <div className="flex flex-col gap-4">
          {!isLoggedIn ? (
            <LoginPanel
              email={email} setEmail={setEmail}
              otp={otp} setOtp={setOtp}
              otpSent={otpSent} setOtpSent={setOtpSent}
              busy={busy}
              onEmailLogin={handleEmailLogin}
              onOtpVerify={handleOtpVerify}
              onPasskey={async () => {
                try { await (tk as any).loginWithPasskey?.({}); await tk.refreshWallets?.() } catch (e) { setErr(String(e)) }
              }}
              onCreateWallet={handleCreateWallet}
            />
          ) : (
            <InfraWalletContent address={walletAddress!} />
          )}
        </div>
      )}

      {/* ── SEND ── */}
      {infraTab === 'send' && (
        <div className="flex flex-col gap-4">
          {!isLoggedIn ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center flex flex-col items-center gap-3">
              <span className="text-4xl">🔐</span>
              <p className="font-bold text-slate-900">Sign in to Send</p>
              <p className="text-slate-500 text-sm">Log in with your Turnkey wallet to send USDC or EURC.</p>
              <button onClick={() => setInfraTab('wallet')}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-500 transition-colors">
                Go to Wallet Login
              </button>
            </div>
          ) : (
            <InfraSendContent address={walletAddress!} />
          )}
        </div>
      )}

      {/* ── SIGN ── */}
      {infraTab === 'sign' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            ✍️ Sign Message
            {isLoggedIn && <span className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded font-bold">Live · HSM</span>}
          </h3>
          {!isLoggedIn ? (
            <p className="text-slate-400 text-xs">Log in first in the Wallet tab.</p>
          ) : (
            <>
              <textarea value={msg} onChange={e => setMsg(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                rows={3} />
              <button onClick={handleSignMessage} disabled={busy}
                className="py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-500 disabled:opacity-50">
                {busy ? '⏳ Signing…' : '✍️ Sign with HSM'}
              </button>
              {sig && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  <p className="text-emerald-700 text-[10px] font-bold mb-1">✅ Signature</p>
                  <code className="text-[10px] break-all text-emerald-800">{sig}</code>
                </div>
              )}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-slate-600 font-bold text-xs mb-2">Supported signing types</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {['Sign message (EIP-191)', 'Sign typed data (EIP-712)', 'Sign transaction (EVM)', 'Sign raw payload'].map(s => (
                    <div key={s} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                      <span className="text-emerald-500">✓</span>{s}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {infraTab === 'policy' && <TurnkeyPolicyPanel />}
      {infraTab === 'ops'    && <TurnkeyOpsPanel />}

      <button onClick={() => {
        localStorage.removeItem(SUBORG_KEY)
        localStorage.removeItem(TK_STORAGE_KEY)
        clearTurnkeySigner()
        onReconfigure()
      }} className="text-xs text-slate-400 hover:text-slate-600 text-center py-1">
        ⚙️ Reconfigure / Logout Turnkey
      </button>
    </div>
  )
}

// ─── Login panel (shared by wallet + send when not logged in) ─────────────────

function LoginPanel({
  email, setEmail, otp, setOtp, otpSent, setOtpSent,
  busy, onEmailLogin, onOtpVerify, onPasskey, onCreateWallet,
}: {
  email: string; setEmail: (v: string) => void
  otp: string; setOtp: (v: string) => void
  otpSent: boolean; setOtpSent: (v: boolean) => void
  busy: boolean
  onEmailLogin: () => void; onOtpVerify: () => void
  onPasskey: () => void; onCreateWallet: () => void
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-xl shrink-0">🔐</div>
        <div>
          <h3 className="font-bold text-slate-900 text-sm">Login with Turnkey</h3>
          <p className="text-slate-500 text-xs mt-0.5">Email OTP or passkey — no seed phrase needed</p>
        </div>
      </div>

      {!otpSent ? (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onEmailLogin()}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="you@example.com" />
            <button onClick={onEmailLogin} disabled={busy || !email.includes('@')}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:bg-indigo-500">
              {busy ? '⏳' : '→ OTP'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-100" />
            <span className="text-[10px] text-slate-400 font-medium">or</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>
          <button onClick={onPasskey}
            className="py-2.5 border-2 border-dashed border-indigo-300 text-indigo-600 rounded-xl text-sm font-bold hover:bg-indigo-50 transition-colors">
            🔑 Login with Passkey
          </button>
          <button onClick={onCreateWallet} disabled={busy}
            className="py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50">
            {busy ? '⏳ Creating…' : '+ Create New Embedded Wallet'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-emerald-700 text-xs bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
            ✅ OTP sent to <strong>{email}</strong>
          </p>
          <div className="flex gap-2">
            <input value={otp} onChange={e => setOtp(e.target.value.toUpperCase())}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Enter OTP code" maxLength={8} autoComplete="one-time-code" />
            <button onClick={onOtpVerify} disabled={busy || otp.length < 4}
              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">
              {busy ? '⏳' : 'Verify'}
            </button>
          </div>
          <button onClick={() => { setOtpSent(false); setOtp('') }}
            className="text-xs text-slate-400 hover:text-slate-600 text-left">
            ← Resend / use different email
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Policy panel ─────────────────────────────────────────────────────────────

function TurnkeyPolicyPanel() {
  const [policies, setPolicies] = useState(DEMO_POLICIES.map(p => ({ ...p })))
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">
      <h3 className="font-bold text-slate-900 text-sm">🛡 Policy-Based Access Controls</h3>
      <p className="text-slate-500 text-xs leading-relaxed">
        Define exactly what each wallet key is allowed to sign. Policies are enforced at the Turnkey infrastructure layer — not in your app code.
      </p>
      <div className="flex flex-col divide-y divide-slate-50 border border-slate-200 rounded-xl overflow-hidden">
        {policies.map((p, i) => (
          <div key={p.name} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
            <div className={`w-2 h-2 rounded-full shrink-0 ${p.on ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 text-xs">{p.name}</p>
              <p className="text-slate-400 text-[10px] truncate">{p.rule}</p>
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
              p.type === 'Multisig' ? 'bg-violet-100 text-violet-700' :
              p.type === 'Rate'     ? 'bg-amber-100  text-amber-700'  :
              p.type === 'Chain'    ? 'bg-blue-100   text-blue-700'   :
                                     'bg-slate-100   text-slate-600'
            }`}>{p.type}</span>
            <button onClick={() => setPolicies(prev => prev.map((r, j) => j === i ? { ...r, on: !r.on } : r))}
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${p.on ? 'bg-emerald-500' : 'bg-slate-200'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${p.on ? 'left-4' : 'left-0.5'}`} />
            </button>
          </div>
        ))}
      </div>
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-indigo-700 text-xs leading-relaxed">
        💡 Policies apply before signing — a transaction violating a policy is rejected at the Turnkey layer, never reaching the chain.
      </div>
    </div>
  )
}

// ─── Operational wallet panel ─────────────────────────────────────────────────

function TurnkeyOpsPanel() {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">
      <h3 className="font-bold text-slate-900 text-sm">⚙️ Operational Wallets</h3>
      <p className="text-slate-500 text-xs leading-relaxed">
        Backend wallets for treasury management, automated payouts, and contract admin — each with scoped permissions.
      </p>
      <div className="flex flex-col gap-3">
        {DEMO_OPS_WALLETS.map(w => (
          <div key={w.name} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <span className="text-2xl shrink-0">{w.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-slate-900 text-sm">{w.name}</p>
                <span className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">{w.role}</span>
              </div>
              <p className="text-slate-400 text-[10px] mt-0.5">{w.txs} transactions signed</p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-extrabold text-slate-900 text-sm">{w.balance}</p>
              <p className="text-slate-400 text-[10px]">USDC</p>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: '🤖', title: 'Agent-driven', desc: 'Automated actions with narrowed permissions per agent' },
          { icon: '🔐', title: 'Key isolation',  desc: 'Each wallet uses a separate key — no shared signing' },
          { icon: '📋', title: 'Full audit log', desc: 'Every signing request logged with timestamp + caller' },
          { icon: '⚡', title: 'Sub-second',     desc: 'HSM signs and submits to Arc in < 200 ms' },
        ].map(f => (
          <div key={f.title} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-base mb-1">{f.icon}</p>
            <p className="font-bold text-slate-900 text-xs">{f.title}</p>
            <p className="text-slate-400 text-[10px] mt-0.5 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── TURNKEY INFRA TAB (outer wrapper with banner) ────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function TurnkeyInfraTab() {
  return (
    <div className="flex flex-col gap-4">

      {/* Hero banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-violet-900 to-purple-900 rounded-2xl p-5 flex items-start gap-4">
        <span className="text-3xl shrink-0">🏛</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="text-white font-extrabold text-base">Wallet Infrastructure</p>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/50 text-indigo-200 font-bold uppercase tracking-wider">Turnkey HSM</span>
          </div>
          <p className="text-indigo-200 text-xs leading-relaxed">
            Embedded wallets secured by Turnkey's SGX enclave · Send, receive & sign on Arc Testnet · Policy-based access controls · No seed phrase exposure
          </p>
          <div className="flex items-center gap-4 mt-2.5">
            {[
              { icon: '📤', label: 'Send USDC/EURC' },
              { icon: '📥', label: 'Receive & QR' },
              { icon: '✍️', label: 'HSM Signing' },
              { icon: '🛡', label: 'Policies' },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-1 text-indigo-300 text-[10px]">
                <span>{f.icon}</span><span>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
        <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
        <p className="text-emerald-700 text-xs font-semibold">
          Turnkey live · org: <code className="font-mono">4b3cc4a1-ed21…</code>
        </p>
      </div>

      {/* Dashboard */}
      <TurnkeyProvider config={{ organizationId: '4b3cc4a1-ed21-4ea9-b913-f0751fc41678', authProxyConfigId: '42a731dd-f14c-497c-b91c-62e90405684c' }}>
        <TurnkeyDashboard onReconfigure={() => {}} />
      </TurnkeyProvider>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── GENERIC RECEIVE TAB (any wallet) ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function ReceiveTab({ address }: { address: `0x${string}` | undefined }) {
  const usdcBal = useTokenBalance('USDC', address)
  const eurcBal = useTokenBalance('EURC', address)

  if (!address) return (
    <div className="flex flex-col items-center gap-4 py-16 bg-white border border-slate-200 rounded-2xl shadow-sm">
      <p className="text-slate-500 text-sm">Connect your wallet to receive tokens</p>
      <ConnectButton label="Connect Wallet" />
    </div>
  )

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&format=svg&data=${encodeURIComponent(address)}`

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="shrink-0 p-3 bg-white border-2 border-violet-200 rounded-2xl shadow-sm">
            <img src={qrUrl} alt="QR" width={160} height={160} className="rounded-lg" />
          </div>
          <div className="flex flex-col gap-3 flex-1 w-full">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Your Wallet Address</p>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                <p className="font-mono text-xs text-slate-700 break-all flex-1">{address}</p>
                <CopyBtn value={address} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { symbol: 'USDC', balance: usdcBal, icon: '💵', color: 'text-blue-600 bg-blue-50 border-blue-200' },
                { symbol: 'EURC', balance: eurcBal, icon: '💶', color: 'text-violet-600 bg-violet-50 border-violet-200' },
              ].map(t => (
                <div key={t.symbol} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${t.color}`}>
                  <span className="text-xl">{t.icon}</span>
                  <div>
                    <p className="font-bold text-sm">{t.balance.toFixed(4)}</p>
                    <p className="text-[10px] opacity-70">{t.symbol}</p>
                  </div>
                </div>
              ))}
            </div>
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-semibold hover:from-emerald-400 hover:to-teal-400 transition-all shadow-sm">
              💧 Get Free Testnet USDC
            </a>
          </div>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Token Addresses on Arc Testnet</p>
        <div className="flex flex-col gap-2">
          {Object.entries(TOKEN_ADDRESSES).map(([sym, addr]) => (
            <div key={sym} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-lg">{sym === 'USDC' ? '💵' : '💶'}</span>
              <span className="font-semibold text-slate-700 text-sm w-12">{sym}</span>
              <span className="font-mono text-xs text-slate-500 flex-1 truncate">{addr}</span>
              <CopyBtn value={addr} />
            </div>
          ))}
        </div>
      </div>
      <div className="bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-200 rounded-2xl p-4 text-center">
        <p className="text-slate-600 text-xs">
          Arc Testnet · Chain ID <code className="bg-violet-100 px-1 rounded text-violet-700">5042002</code> · Gas paid in USDC · Sub-second finality
        </p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── GENERIC SEND TAB (any wallet) ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function SendTab({ address }: { address: `0x${string}` | undefined }) {
  const [token,    setToken]    = useState<'USDC' | 'EURC'>('USDC')
  const [toAddr,   setToAddr]   = useState('')
  const [amount,   setAmount]   = useState('')
  const [step,     setStep]     = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [txHash,   setTxHash]   = useState<`0x${string}` | null>(null)

  const usdcBal = useTokenBalance('USDC', address)
  const eurcBal = useTokenBalance('EURC', address)
  const balance = token === 'USDC' ? usdcBal : eurcBal

  const { writeContractAsync } = useWriteContract()
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash ?? undefined })

  useEffect(() => { if (receipt) setStep('done') }, [receipt])

  const validAddress = isAddress(toAddr)
  const amountN      = parseFloat(amount) || 0
  const canSend      = validAddress && amountN > 0 && amountN <= balance && step === 'idle'

  const handleSend = async () => {
    if (!canSend) return
    setStep('sending'); setErrorMsg(''); setTxHash(null)
    try {
      const hash = await writeContractAsync({
        address:      TOKEN_ADDRESSES[token],
        abi:          TRANSFER_ABI,
        functionName: 'transfer',
        args:         [toAddr as `0x${string}`, parseUnits(amount, TOKEN_DECIMALS[token])],
      })
      setTxHash(hash)
    } catch (e: unknown) {
      setStep('error')
      setErrorMsg(e instanceof Error ? e.message.split('\n')[0] : 'Transaction failed')
    }
  }

  const reset = () => { setStep('idle'); setErrorMsg(''); setTxHash(null); setToAddr(''); setAmount('') }

  if (!address) return (
    <div className="flex flex-col items-center gap-4 py-16 bg-white border border-slate-200 rounded-2xl shadow-sm">
      <p className="text-slate-500 text-sm">Connect your wallet to send tokens</p>
      <ConnectButton label="Connect Wallet" />
    </div>
  )

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-xs">
        💡 For Turnkey HSM signing, use the <strong>Wallet Infra → Send</strong> tab instead.
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 flex flex-col gap-5">
        <h3 className="font-bold text-slate-900 text-base">Send Tokens</h3>

        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">Token</label>
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
            <span className="text-xs text-slate-400">Balance</span>
            <span className="text-xs font-semibold text-slate-600">{balance.toFixed(4)} {token}</span>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">Recipient Address</label>
          <div className={`flex items-center gap-2 bg-slate-50 border rounded-xl px-3 py-2.5 focus-within:border-violet-400 transition-colors ${
            toAddr && !validAddress ? 'border-red-300' : 'border-slate-200'
          }`}>
            <span className="text-slate-400">👤</span>
            <input type="text" placeholder="0x…" value={toAddr}
              onChange={e => { setToAddr(e.target.value); setStep('idle') }}
              className="flex-1 bg-transparent text-slate-900 text-sm font-mono outline-none placeholder:text-slate-300" />
            {validAddress && <span className="text-emerald-500 text-sm">✓</span>}
          </div>
          {toAddr && !validAddress && <p className="text-red-500 text-xs mt-1">Invalid address format</p>}
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">Amount</label>
          <div className={`flex items-center gap-2 bg-slate-50 border rounded-xl px-3 py-2.5 focus-within:border-violet-400 transition-colors ${
            amountN > balance ? 'border-red-300' : 'border-slate-200'
          }`}>
            <span className="text-slate-400">{token === 'USDC' ? '💵' : '💶'}</span>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={amount}
              onChange={e => { setAmount(e.target.value); setStep('idle') }}
              className="flex-1 bg-transparent text-slate-900 font-bold text-xl outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            <span className="text-slate-500 font-semibold text-sm">{token}</span>
            <button onClick={() => setAmount(balance.toFixed(6))}
              className="px-2 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-600 text-xs font-semibold hover:bg-violet-100 transition-colors">
              Max
            </button>
          </div>
          {amountN > balance && <p className="text-red-500 text-xs mt-1">Insufficient {token} balance</p>}
        </div>

        {validAddress && amountN > 0 && amountN <= balance && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs flex flex-col gap-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Sending</span>
              <span className="font-bold text-slate-900">{amount} {token}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">To</span>
              <span className="font-mono text-slate-600">{toAddr.slice(0, 10)}…{toAddr.slice(-8)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Network</span>
              <span className="text-violet-600 font-medium">Arc Testnet · gas: USDC</span>
            </div>
          </div>
        )}

        {step !== 'idle' && (
          <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-xs ${
            step === 'done'  ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
            step === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                               'bg-violet-50 border-violet-200 text-violet-700'
          }`}>
            <span>{step === 'done' ? '✅' : step === 'error' ? '⚠' : '⏳'}</span>
            <div className="flex-1">
              <p className="font-semibold">
                {step === 'sending' ? 'Sending transaction…' :
                 step === 'done'    ? `Sent ${amount} ${token} successfully!` : errorMsg}
              </p>
              {txHash && step !== 'error' && (
                <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer"
                  className="text-[10px] font-mono underline opacity-70 hover:opacity-100 block mt-0.5">
                  {txHash.slice(0, 18)}… ↗ View on ArcScan
                </a>
              )}
            </div>
          </div>
        )}

        {step === 'done' ? (
          <button onClick={reset}
            className="w-full py-3.5 rounded-2xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 transition-colors">
            ↩ Send Another
          </button>
        ) : (
          <button onClick={handleSend} disabled={!canSend}
            className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
              canSend
                ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 shadow-lg shadow-violet-900/20'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}>
            {step === 'sending' ? '⏳ Sending…'
              : `Send ${amount || '0'} ${token}${validAddress ? ` → ${toAddr.slice(0, 6)}…` : ''}`}
          </button>
        )}
      </div>

      {address && (
        <a href={`https://testnet.arcscan.app/address/${address}`} target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-white border border-slate-200 text-slate-500 text-xs hover:border-violet-300 hover:text-violet-600 transition-all shadow-sm">
          🔍 View all transactions on ArcScan ↗
        </a>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CREATE TAB ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function CreateTab() {
  const [wallet,      setWallet]      = useState<GeneratedWallet | null>(null)
  const [generating,  setGenerating]  = useState(false)
  const [importPK,    setImportPK]    = useState('')
  const [importAddr,  setImportAddr]  = useState<string | null>(null)
  const [importError, setImportError] = useState('')

  const handleGenerate = async () => {
    setGenerating(true)
    try { setWallet(await generateNewWallet()) } finally { setGenerating(false) }
  }

  const handleImport = useCallback(async () => {
    setImportError('')
    if (!importPK.trim()) return
    const addr = await deriveFromPK(importPK.trim())
    if (!addr) setImportError('Invalid private key')
    else setImportAddr(addr)
  }, [importPK])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200">
        <span className="text-amber-500 text-lg mt-0.5">⚠️</span>
        <div>
          <p className="text-amber-700 font-semibold text-sm">Security Notice</p>
          <p className="text-amber-600 text-xs mt-0.5 leading-relaxed">
            Never share your private key or seed phrase with anyone.
            This tool is for <strong>testnet use only</strong> — do not use real funds.
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">✨</span>
          <div>
            <h3 className="font-bold text-slate-900">Generate New Wallet</h3>
            <p className="text-slate-500 text-xs mt-0.5">Create a brand-new Arc Testnet wallet in your browser</p>
          </div>
          <button onClick={handleGenerate} disabled={generating}
            className="ml-auto px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition-colors disabled:opacity-50">
            {generating ? '⏳ Generating…' : '+ New Wallet'}
          </button>
        </div>
        {wallet && (
          <div className="flex flex-col gap-3 mt-1">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Wallet Address</span>
                <CopyBtn value={wallet.address} />
              </div>
              <p className="font-mono text-sm text-emerald-800 break-all">{wallet.address}</p>
            </div>
            <RevealField label="Seed Phrase (12 words)" value={wallet.mnemonic} mono={false} warn />
            <RevealField label="Private Key" value={wallet.privateKey} warn />
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
              <strong>How to use in MetaMask:</strong><br />
              1. Open MetaMask → Import Account → Paste Private Key<br />
              2. Add Arc Testnet: RPC <code className="bg-blue-100 px-1 rounded">https://rpc.testnet.arc.network</code> · Chain ID <code className="bg-blue-100 px-1 rounded">5042002</code>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">🔑</span>
          <div>
            <h3 className="font-bold text-slate-900">Derive Address from Private Key</h3>
            <p className="text-slate-500 text-xs mt-0.5">Paste a private key to get the corresponding address</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input type="password" placeholder="0x private key…" value={importPK}
            onChange={e => { setImportPK(e.target.value); setImportAddr(null); setImportError('') }}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-900 focus:outline-none focus:border-violet-400 transition-colors" />
          <button onClick={handleImport}
            className="px-4 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-semibold hover:bg-slate-700 transition-colors">
            Derive
          </button>
        </div>
        {importError && <p className="text-red-500 text-xs mt-2 flex items-center gap-1"><span>⚠</span> {importError}</p>}
        {importAddr && (
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-emerald-700">Derived Address</span>
              <CopyBtn value={importAddr} />
            </div>
            <p className="font-mono text-sm text-emerald-800 break-all">{importAddr}</p>
          </div>
        )}
      </div>

      {/* Arc Testnet info */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">🌐</span>
          <div>
            <h3 className="font-bold text-slate-900">Add Arc Testnet to MetaMask</h3>
            <p className="text-slate-500 text-xs mt-0.5">Network settings</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {[
            { label: 'Network Name',    value: 'Arc Testnet'                     },
            { label: 'RPC URL',         value: 'https://rpc.testnet.arc.network' },
            { label: 'Chain ID',        value: '5042002'                         },
            { label: 'Currency Symbol', value: 'USDC'                            },
            { label: 'Block Explorer',  value: 'https://testnet.arcscan.app'     },
            { label: 'USDC Address',    value: '0x36000000000000000000000000000000000000' },
          ].map(row => (
            <div key={row.label} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200">
              <span className="text-slate-400 w-28 shrink-0">{row.label}</span>
              <span className="font-mono text-slate-700 text-[11px] flex-1 truncate">{row.value}</span>
              <CopyBtn value={row.value} label="" />
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
            className="flex-1 text-center py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 transition-colors">
            💧 Get Free USDC → faucet.circle.com
          </a>
          <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer"
            className="flex-1 text-center py-2 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-xs font-semibold hover:bg-violet-100 transition-colors">
            🔍 Explorer → arcscan.app
          </a>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MAIN PANEL ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export default function WalletPanel() {
  const { address, isConnected } = useAccount()
  // Default to Wallet Infrastructure tab
  const [tab, setTab] = useState<WTab>('infra')

  const usdcBal = useTokenBalance('USDC', address)

  const TABS: { key: WTab; label: string; icon: string; primary?: boolean }[] = [
    { key: 'infra',   label: 'Wallet Infra', icon: '🏛',  primary: true },
    { key: 'receive', label: 'Receive',      icon: '📥' },
    { key: 'send',    label: 'Send',         icon: '📤' },
    { key: 'create',  label: 'Tools',        icon: '🔧' },
  ]

  return (
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-gradient-to-r from-indigo-950 via-indigo-900 to-violet-900 border border-indigo-700 shadow-lg">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-2xl shrink-0">🏛</div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-white font-extrabold text-lg">Wallet</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/40 text-indigo-200 font-bold uppercase tracking-wider">Infrastructure</span>
            {isConnected && address && (
              <span className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-emerald-900/40 border border-emerald-500/30 text-emerald-400 font-semibold">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                Connected
              </span>
            )}
          </div>
          {isConnected && address ? (
            <p className="text-indigo-300 text-xs font-mono">
              {address.slice(0, 12)}…{address.slice(-8)} · {usdcBal.toFixed(2)} USDC
            </p>
          ) : (
            <p className="text-indigo-400 text-xs">Turnkey HSM embedded wallets · Send · Receive · Policy-based signing</p>
          )}
        </div>
        {!isConnected && (
          <div className="shrink-0">
            <ConnectButton label="Connect" />
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex bg-white border border-slate-200 shadow-sm rounded-2xl p-1.5 gap-1.5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              tab === t.key
                ? t.primary
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg'
                  : 'bg-violet-600 text-white shadow-lg'
                : t.primary
                  ? 'text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}>
            <span>{t.icon}</span>
            <span className="hidden sm:inline text-xs">{t.label}</span>
            {t.primary && tab !== t.key && (
              <span className="hidden sm:inline text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-bold">Primary</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'infra'   && <TurnkeyInfraTab />}
      {tab === 'receive' && <ReceiveTab address={address} />}
      {tab === 'send'    && <SendTab    address={address} />}
      {tab === 'create'  && <CreateTab />}

      {/* Footer */}
      <p className="text-center text-xs text-slate-400 pb-2">
        Arc Testnet · Powered by Turnkey HSM · For testing purposes only
      </p>
    </div>
  )
}
