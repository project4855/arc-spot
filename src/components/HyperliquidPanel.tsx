// ── HyperliquidPanel.tsx (AgenticEconomyPanel) ───────────────────────────────
// Tab "Agents" — ERC-8183 Job Marketplace on Arc Testnet (onchain)
// Contract: ArcAgentJobs @ 0x55031271BDEfeBd9b6E6af52B9a92992aa6E3EFD

import { useState, useEffect, useCallback } from 'react'
import { useReadContract, usePublicClient, useWaitForTransactionReceipt } from 'wagmi'
import { keccak256, toBytes, parseUnits } from 'viem'
import { useWallet } from '../hooks/useWallet'
import { AGENT_JOBS_ADDRESS, AGENT_JOBS_ABI, TOKEN_ADDRESSES, ERC20_ABI } from '../config/contracts'
import { usePerpTrade } from '../hooks/usePerpsContract'

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentTab = 'jobs' | 'create' | 'myjobs' | 'nanopay'

const STATUS_LABEL = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'] as const
type StatusName = typeof STATUS_LABEL[number]

const STATUS_STYLES: Record<StatusName, string> = {
  Open:      'bg-blue-50 text-blue-700 border-blue-200',
  Funded:    'bg-amber-50 text-amber-700 border-amber-200',
  Submitted: 'bg-violet-50 text-violet-700 border-violet-200',
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Rejected:  'bg-red-50 text-red-700 border-red-200',
  Expired:   'bg-slate-100 text-slate-500 border-slate-200',
}

interface OnchainJob {
  id: bigint
  creator: string
  provider: string
  evaluator: string
  budgetUsdc: bigint
  deadline: bigint
  title: string
  description: string
  deliverable: string
  status: number
  createdAt: bigint
}

interface NanoTx {
  to: string
  amount: string
  txHash: string
  time: number
}

const LS_NANO_KEY = 'arc_nano_txs_v1'

function loadNanoTxs(): NanoTx[] {
  try { return JSON.parse(localStorage.getItem(LS_NANO_KEY) ?? '[]') } catch { return [] }
}

// Parse raw error (Circle JSON, wagmi revert, generic) into a short human message
function parseErr(raw: string): { msg: string; needsFaucet: boolean } {
  try {
    // Circle API JSON error
    const j = JSON.parse(raw.match(/\{.*\}/s)?.[0] ?? raw)
    const circleMsg: string = j?.message ?? j?.errors?.[0]?.message ?? ''
    if (circleMsg.includes('insufficient') || circleMsg.includes('balance')) {
      return { msg: 'Insufficient USDC balance — get testnet USDC from faucet.circle.com first.', needsFaucet: true }
    }
    if (circleMsg) return { msg: circleMsg, needsFaucet: false }
  } catch { /* not JSON */ }

  const lo = raw.toLowerCase()
  if (lo.includes('insufficient') || lo.includes('balance') || lo.includes('token balance')) {
    return { msg: 'Insufficient USDC balance — get testnet USDC from faucet.circle.com first.', needsFaucet: true }
  }
  if (lo.includes('user rejected') || lo.includes('denied')) {
    return { msg: 'Transaction rejected by user.', needsFaucet: false }
  }
  if (lo.includes('allowance')) {
    return { msg: 'USDC allowance too low — approval step may have failed.', needsFaucet: false }
  }
  return { msg: raw.slice(0, 160), needsFaucet: false }
}

function shortAddr(a: string) {
  return a === '0x0000000000000000000000000000000000000000' ? 'Open' : `${a.slice(0,6)}…${a.slice(-4)}`
}
function fmtUsdc(n: bigint)  { return `${(Number(n) / 1e6).toFixed(2)} USDC` }
function fmtDate(ts: bigint) {
  const d = new Date(Number(ts) * 1000)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtRelative(ms: number) {
  const diff = Date.now() - ms
  if (diff < 60_000)     return 'just now'
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
function statusName(s: number): StatusName { return STATUS_LABEL[s] ?? 'Open' }

const USDC      = TOKEN_ADDRESSES.USDC
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`

// ── Job card ──────────────────────────────────────────────────────────────────

function JobCard({ job, myAddress, onAction, loading }: {
  job: OnchainJob
  myAddress?: string
  onAction: (action: 'fund' | 'submit' | 'complete' | 'reject' | 'claimRefund', jobId: bigint, extra?: string) => void
  loading: bigint | null
}) {
  const [deliverableInput, setDeliverableInput] = useState('')
  const sName      = statusName(job.status)
  const isCreator   = myAddress?.toLowerCase() === job.creator.toLowerCase()
  const isProvider  = myAddress?.toLowerCase() === job.provider.toLowerCase()
  const isEvaluator = myAddress?.toLowerCase() === job.evaluator.toLowerCase()
  const isExpired   = Date.now() / 1000 > Number(job.deadline)
  const busy        = loading === job.id

  // Next-step hint based on status + role
  const nextStep = (() => {
    if (isExpired && (sName === 'Funded' || sName === 'Submitted') && isCreator)
      return { icon: '🔙', text: 'Deadline passed — you can reclaim your USDC.', color: 'bg-slate-100 border-slate-300 text-slate-700' }
    if (sName === 'Open' && myAddress)
      return { icon: '💰', text: 'Fund this job to escrow USDC and open it to providers.', color: 'bg-amber-50 border-amber-200 text-amber-800' }
    if (sName === 'Funded' && (job.provider === ZERO_ADDR || isProvider) && myAddress)
      return { icon: '📤', text: 'Submit your deliverable (paste any text / IPFS CID) to move to review.', color: 'bg-violet-50 border-violet-200 text-violet-800' }
    if (sName === 'Submitted' && isEvaluator)
      return { icon: '⚖️', text: 'Review the deliverable, then Complete (release USDC) or Reject (refund creator).', color: 'bg-blue-50 border-blue-200 text-blue-800' }
    if (sName === 'Submitted' && !isEvaluator)
      return { icon: '⏳', text: 'Waiting for evaluator to review and complete or reject.', color: 'bg-slate-100 border-slate-200 text-slate-600' }
    if (sName === 'Completed')
      return { icon: '✅', text: 'Job completed. USDC has been released to the provider.', color: 'bg-emerald-50 border-emerald-200 text-emerald-800' }
    if (sName === 'Rejected')
      return { icon: '❌', text: 'Job rejected. USDC has been returned to the creator.', color: 'bg-red-50 border-red-200 text-red-700' }
    return null
  })()

  return (
    <div className={`bg-white border-2 rounded-2xl overflow-hidden flex flex-col ${
      sName === 'Completed' ? 'border-emerald-300' :
      sName === 'Rejected' || sName === 'Expired' ? 'border-slate-200 opacity-75' :
      sName === 'Funded'    ? 'border-amber-300' :
      sName === 'Submitted' ? 'border-violet-300' :
      'border-slate-200 hover:border-violet-300'
    } transition-all shadow-sm`}>

      {/* ── Top bar: ID + status + budget ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-400 text-xs font-mono font-bold">Job #{job.id.toString()}</span>
          <span className={`text-xs px-3 py-1 rounded-full border font-bold ${STATUS_STYLES[sName]}`}>{sName}</span>
          {isCreator   && <span className="text-xs px-2 py-0.5 rounded-lg bg-indigo-100 border border-indigo-200 text-indigo-700 font-semibold">You created</span>}
          {isProvider  && <span className="text-xs px-2 py-0.5 rounded-lg bg-violet-100 border border-violet-200 text-violet-700 font-semibold">You provide</span>}
          {isEvaluator && <span className="text-xs px-2 py-0.5 rounded-lg bg-amber-100 border border-amber-200 text-amber-700 font-semibold">You evaluate</span>}
        </div>
        <div className="text-right shrink-0 ml-4">
          <p className="text-emerald-600 font-extrabold text-xl font-mono leading-none">{fmtUsdc(job.budgetUsdc)}</p>
          <p className="text-slate-400 text-xs mt-0.5">Budget</p>
        </div>
      </div>

      {/* ── Title + description ── */}
      <div className="px-5 py-4">
        <p className="text-slate-900 font-extrabold text-base leading-snug">{job.title || <span className="italic text-slate-400">Untitled</span>}</p>
        {job.description && (
          <p className="text-slate-500 text-sm mt-1 leading-relaxed">{job.description}</p>
        )}
      </div>

      {/* ── Meta grid ── */}
      <div className="px-5 pb-4 grid grid-cols-2 gap-y-2 gap-x-4">
        <div>
          <p className="text-slate-400 text-xs mb-0.5">Creator</p>
          <p className="text-slate-700 text-sm font-mono font-semibold">{shortAddr(job.creator)}</p>
        </div>
        <div>
          <p className="text-slate-400 text-xs mb-0.5">Provider</p>
          <p className="text-slate-700 text-sm font-mono font-semibold">{shortAddr(job.provider)}</p>
        </div>
        <div>
          <p className="text-slate-400 text-xs mb-0.5">Deadline</p>
          <p className={`text-sm font-semibold ${isExpired ? 'text-red-500' : 'text-slate-700'}`}>{fmtDate(job.deadline)}{isExpired && ' · Expired'}</p>
        </div>
        <div>
          <p className="text-slate-400 text-xs mb-0.5">Created</p>
          <p className="text-slate-700 text-sm font-semibold">{fmtDate(job.createdAt)}</p>
        </div>
        {job.deliverable !== '0x' + '0'.repeat(64) && (
          <div className="col-span-2">
            <p className="text-slate-400 text-xs mb-0.5">Deliverable hash</p>
            <p className="text-violet-600 text-sm font-mono font-semibold truncate">{job.deliverable.slice(0, 26)}…</p>
          </div>
        )}
      </div>

      {/* ── Next step hint ── */}
      {nextStep && (
        <div className={`mx-5 mb-4 flex items-start gap-2 px-4 py-3 rounded-xl border text-sm font-medium ${nextStep.color}`}>
          <span className="text-base shrink-0">{nextStep.icon}</span>
          <p>{nextStep.text}</p>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="px-5 pb-5 flex flex-col gap-3">
        {sName === 'Open' && !isExpired && myAddress && (
          <button onClick={() => onAction('fund', job.id)} disabled={busy}
            className="w-full py-3 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-400 transition-colors disabled:opacity-50 shadow-sm">
            {busy ? '⏳ Funding…' : `💰 Fund Job — escrow ${fmtUsdc(job.budgetUsdc)}`}
          </button>
        )}

        {sName === 'Funded' && !isExpired && myAddress && (job.provider === ZERO_ADDR || isProvider) && (
          <div className="flex flex-col gap-2">
            <input
              value={deliverableInput}
              onChange={e => setDeliverableInput(e.target.value)}
              placeholder="Paste IPFS CID or any deliverable text…"
              className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 text-sm focus:outline-none focus:border-violet-400 bg-slate-50 focus:bg-white transition-colors"
            />
            <button onClick={() => onAction('submit', job.id, deliverableInput)}
              disabled={busy || !deliverableInput.trim()}
              className="w-full py-3 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 transition-colors disabled:opacity-50 shadow-sm">
              {busy ? '⏳ Submitting…' : '📤 Submit Deliverable'}
            </button>
          </div>
        )}

        {sName === 'Submitted' && isEvaluator && (
          <div className="flex gap-3">
            <button onClick={() => onAction('complete', job.id)} disabled={busy}
              className="flex-1 py-3 rounded-xl bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-400 transition-colors disabled:opacity-50 shadow-sm">
              {busy ? '⏳' : '✅ Complete & Release USDC'}
            </button>
            <button onClick={() => onAction('reject', job.id)} disabled={busy}
              className="flex-1 py-3 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-400 transition-colors disabled:opacity-50 shadow-sm">
              {busy ? '⏳' : '❌ Reject & Refund'}
            </button>
          </div>
        )}

        {(sName === 'Funded' || sName === 'Submitted') && isExpired && isCreator && (
          <button onClick={() => onAction('claimRefund', job.id)} disabled={busy}
            className="w-full py-3 rounded-xl bg-slate-600 text-white text-sm font-bold hover:bg-slate-500 transition-colors disabled:opacity-50">
            {busy ? '⏳ Claiming…' : '🔙 Claim Refund (deadline passed)'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function HyperliquidPanel() {
  const { address, isReady, writeContract } = useWallet()
  const { balanceUSDC }  = usePerpTrade()
  const publicClient     = usePublicClient()

  const [activeTab, setActiveTab] = useState<AgentTab>('jobs')
  const [jobs, setJobs]           = useState<OnchainJob[]>([])
  const [myJobs, setMyJobs]       = useState<OnchainJob[]>([])
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [actionLoading, setActionLoading] = useState<bigint | null>(null)
  const [txHash, setTxHash]       = useState<`0x${string}` | null>(null)
  const [txError, setTxError]     = useState<string | null>(null)
  const [txSuccess, setTxSuccess] = useState<string | null>(null)

  // Create job form
  const [form, setForm] = useState({
    title: '', description: '', budget: '',
    deadlineHours: '24', provider: '', evaluator: '',
  })
  const [creating, setCreating] = useState(false)

  // Nanopayments
  const [nanoTo, setNanoTo]         = useState('')
  const [nanoAmount, setNanoAmount] = useState('')
  const [nanoSending, setNanoSending] = useState(false)
  const [nanoTxHash, setNanoTxHash] = useState<`0x${string}` | null>(null)
  const [nanoErr, setNanoErr]       = useState<string | null>(null)
  const [nanoTxs, setNanoTxs]       = useState<NanoTx[]>(loadNanoTxs)

  // Read total job count from chain
  const { data: jobCountData, refetch: refetchCount } = useReadContract({
    address: AGENT_JOBS_ADDRESS,
    abi: AGENT_JOBS_ABI,
    functionName: 'jobCount',
  })

  const { isLoading: txPending, isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined })
  const { isLoading: nanoPending, isSuccess: nanoConfirmed } = useWaitForTransactionReceipt({ hash: nanoTxHash ?? undefined })

  // Load recent jobs from chain
  const loadJobs = useCallback(async () => {
    if (!publicClient) return
    setLoadingJobs(true)
    try {
      const result = await publicClient.readContract({
        address: AGENT_JOBS_ADDRESS,
        abi: AGENT_JOBS_ABI,
        functionName: 'getRecentJobs',
        args: [20n],
      }) as OnchainJob[]
      setJobs(result.filter(j => j.id > 0n))
    } catch (e) { console.error('loadJobs', e) }
    finally { setLoadingJobs(false) }
  }, [publicClient])

  const loadMyJobs = useCallback(async () => {
    if (!publicClient || !address) return
    try {
      const ids = await publicClient.readContract({
        address: AGENT_JOBS_ADDRESS,
        abi: AGENT_JOBS_ABI,
        functionName: 'getJobsByCreator',
        args: [address],
      }) as bigint[]
      const fetched = await Promise.all(ids.map(id =>
        publicClient.readContract({
          address: AGENT_JOBS_ADDRESS, abi: AGENT_JOBS_ABI,
          functionName: 'getJob', args: [id],
        }) as Promise<OnchainJob>
      ))
      setMyJobs(fetched.filter(j => j.id > 0n).reverse())
    } catch (e) { console.error('loadMyJobs', e) }
  }, [publicClient, address])

  useEffect(() => { loadJobs() }, [loadJobs])
  useEffect(() => { if (address) loadMyJobs() }, [loadMyJobs, address])

  useEffect(() => {
    if (txConfirmed) {
      loadJobs(); if (address) loadMyJobs(); refetchCount()
      setActionLoading(null); setTxHash(null)
    }
  }, [txConfirmed, loadJobs, loadMyJobs, refetchCount, address])

  useEffect(() => {
    if (nanoConfirmed && nanoTxHash) {
      const rec: NanoTx = { to: nanoTo, amount: nanoAmount, txHash: nanoTxHash, time: Date.now() }
      setNanoTxs(prev => {
        const next = [rec, ...prev].slice(0, 20)
        localStorage.setItem(LS_NANO_KEY, JSON.stringify(next))
        return next
      })
      setNanoTxHash(null); setNanoTo(''); setNanoAmount('')
    }
  }, [nanoConfirmed, nanoTxHash, nanoTo, nanoAmount])

  // ── Action handler ─────────────────────────────────────────────────────────

  const handleAction = useCallback(async (
    action: 'fund' | 'submit' | 'complete' | 'reject' | 'claimRefund',
    jobId: bigint,
    extra?: string,
  ) => {
    if (!isReady) return
    setTxError(null); setTxSuccess(null); setActionLoading(jobId)
    try {
      let hash: `0x${string}`
      if (action === 'fund') {
        const job = [...jobs, ...myJobs].find(j => j.id === jobId)
        if (!job) throw new Error('Job not found')
        await writeContract({ address: USDC, abi: ERC20_ABI, functionName: 'approve', args: [AGENT_JOBS_ADDRESS, job.budgetUsdc] })
        hash = await writeContract({ address: AGENT_JOBS_ADDRESS, abi: AGENT_JOBS_ABI, functionName: 'fund', args: [jobId] })
      } else if (action === 'submit') {
        const deliverable = extra?.trim() || 'deliverable'
        const deliverableHash = keccak256(toBytes(deliverable))
        hash = await writeContract({ address: AGENT_JOBS_ADDRESS, abi: AGENT_JOBS_ABI, functionName: 'submit', args: [jobId, deliverableHash] })
      } else {
        hash = await writeContract({ address: AGENT_JOBS_ADDRESS, abi: AGENT_JOBS_ABI, functionName: action, args: [jobId] })
      }
      setTxHash(hash)
      setTxSuccess('Transaction submitted → waiting for confirmation…')
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e))
      setActionLoading(null)
    }
  }, [isReady, jobs, myJobs, writeContract])

  // ── Create job ─────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!isReady) return
    const budget = parseFloat(form.budget)
    if (!form.title || !budget || budget <= 0) { setTxError('Title and budget required'); return }
    setCreating(true); setTxError(null); setTxSuccess(null)
    try {
      const budgetUsdc = BigInt(Math.round(budget * 1e6))
      const hash = await writeContract({
        address: AGENT_JOBS_ADDRESS, abi: AGENT_JOBS_ABI, functionName: 'createJob',
        args: [
          (form.provider as `0x${string}`) || ZERO_ADDR,
          (form.evaluator as `0x${string}`) || ZERO_ADDR,
          budgetUsdc,
          BigInt(parseInt(form.deadlineHours) || 24),
          form.title, form.description,
        ],
      })
      setTxHash(hash)
      setTxSuccess('Job created onchain! Waiting for confirmation…')
      setForm({ title: '', description: '', budget: '', deadlineHours: '24', provider: '', evaluator: '' })
      setActiveTab('myjobs')
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e))
    } finally { setCreating(false) }
  }

  // ── Send nanopayment ────────────────────────────────────────────────────────

  const handleNanoSend = async () => {
    if (!isReady) return
    const amt = parseFloat(nanoAmount)
    if (!nanoTo.startsWith('0x') || !amt || amt <= 0) { setNanoErr('Valid address and amount required'); return }
    setNanoSending(true); setNanoErr(null)
    try {
      const raw = parseUnits(nanoAmount, 6)
      const hash = await writeContract({
        address: USDC, abi: ERC20_ABI,
        functionName: 'transfer',
        args: [nanoTo as `0x${string}`, raw],
      })
      setNanoTxHash(hash)
    } catch (e) {
      setNanoErr(e instanceof Error ? e.message.slice(0, 200) : String(e))
    } finally { setNanoSending(false) }
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────

  const TABS: { key: AgentTab; label: string; icon: string }[] = [
    { key: 'jobs',    label: 'Job Board',    icon: '📋' },
    { key: 'create',  label: 'Post a Job',   icon: '➕' },
    { key: 'myjobs',  label: 'My Jobs',      icon: '👤' },
    { key: 'nanopay', label: 'Nanopayments', icon: '💸' },
  ]

  return (
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="bg-gradient-to-r from-violet-50 via-blue-50 to-indigo-50 border border-violet-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center text-2xl shrink-0">🤖</div>
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 border border-violet-200 text-violet-600 font-bold">Arc Testnet · Chain 5042002</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500 font-semibold">
                {jobCountData !== undefined ? `${jobCountData.toString()} jobs onchain` : 'Loading…'}
              </span>
            </div>
            <h2 className="text-slate-900 font-extrabold text-lg leading-tight">Agentic Economy · Job Marketplace</h2>
            <p className="text-slate-600 text-sm mt-1">
              Real onchain jobs powered by <strong className="text-slate-900">ArcAgentJobs</strong> (ERC-8183 style) ·
              USDC escrow · deterministic ~780ms finality
            </p>
          </div>
        </div>
        <a href={`https://testnet.arcscan.app/address/${AGENT_JOBS_ADDRESS}`} target="_blank" rel="noreferrer"
          className="shrink-0 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 transition-colors">
          Contract ↗
        </a>
      </div>

      {/* Tx status */}
      {(txError || txSuccess || txPending) && (() => {
        const parsed = txError ? parseErr(txError) : null
        return (
          <div className={`px-4 py-3 rounded-xl text-sm font-medium flex flex-col gap-2 ${txError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-emerald-50 border border-emerald-200 text-emerald-700'}`}>
            <div className="flex items-start gap-2">
              <span>{txPending ? '⏳' : txError ? '❌' : '✅'}</span>
              <span>
                {txPending && 'Confirming on Arc Testnet…'}
                {txSuccess && !txPending && txSuccess}
                {txError && parsed?.msg}
              </span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {txHash && (
                <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer"
                  className="underline text-violet-600 text-xs font-semibold">View tx ↗</a>
              )}
              {parsed?.needsFaucet && (
                <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
                  className="px-3 py-1 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-500 transition-colors">
                  💧 Get Testnet USDC ↗
                </a>
              )}
            </div>
          </div>
        )
      })()}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
              activeTab === t.key
                ? 'bg-violet-600 border-violet-500 text-white shadow-sm'
                : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300'
            }`}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ── Job Board ── */}
      {activeTab === 'jobs' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-slate-900 font-bold text-base">
              Recent Jobs — {jobs.length > 0 ? `${jobs.length} loaded` : 'Loading…'}
            </h3>
            <button onClick={loadJobs} disabled={loadingJobs}
              className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50">
              {loadingJobs ? '⏳ Loading…' : '🔄 Refresh'}
            </button>
          </div>
          {loadingJobs && jobs.length === 0 && (
            <div className="flex items-center justify-center py-12 text-slate-400 text-sm">⏳ Reading from Arc Testnet…</div>
          )}
          {!loadingJobs && jobs.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 bg-white border border-dashed border-slate-200 rounded-2xl">
              <span className="text-4xl">📋</span>
              <p className="text-slate-600 font-semibold">No jobs yet</p>
              <p className="text-slate-400 text-sm">Be the first — post a job and fund it with USDC</p>
              <button onClick={() => setActiveTab('create')}
                className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 transition-colors">
                Post a Job →
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {jobs.map(job => (
              <JobCard key={job.id.toString()} job={job} myAddress={address}
                onAction={handleAction} loading={actionLoading} />
            ))}
          </div>

          {/* ── Compact ERC-8183 spec ── */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col gap-4 mt-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-slate-900 font-extrabold text-sm">ArcAgentJobs Contract · ERC-8183</p>
                <a href={`https://testnet.arcscan.app/address/${AGENT_JOBS_ADDRESS}`} target="_blank" rel="noreferrer"
                  className="text-violet-600 text-[11px] font-mono hover:text-violet-500">{AGENT_JOBS_ADDRESS} ↗</a>
              </div>
              {/* Lifecycle flow */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {(['Open','Funded','Submitted','Completed'] as StatusName[]).map((s,i,arr) => (
                  <div key={s} className="flex items-center gap-1.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${STATUS_STYLES[s]}`}>{s}</span>
                    {i < arr.length-1 && <span className="text-slate-600 text-xs">→</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* 6 functions in 2 rows */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { fn: 'createJob()', color: 'text-blue-600 border-blue-200 bg-blue-50',     desc: 'Define title, budget, deadline, provider, evaluator' },
                { fn: 'fund()',      color: 'text-amber-600 border-amber-200 bg-amber-50',   desc: 'Approve + escrow USDC into contract' },
                { fn: 'submit()',    color: 'text-violet-600 border-violet-200 bg-violet-50',desc: 'Provider submits keccak256(IPFS CID)' },
                { fn: 'complete()', color: 'text-emerald-600 border-emerald-200 bg-emerald-50', desc: 'Evaluator releases USDC to provider' },
                { fn: 'reject()',   color: 'text-red-600 border-red-200 bg-red-50',          desc: 'Evaluator refunds USDC to creator' },
                { fn: 'claimRefund()', color: 'text-slate-600 border-slate-200 bg-slate-100',desc: 'Creator reclaims after deadline' },
              ].map(f => (
                <div key={f.fn} className={`${f.color} border rounded-xl px-3 py-2 flex flex-col gap-0.5`}>
                  <code className="font-mono font-bold text-xs">{f.fn}</code>
                  <p className="text-slate-500 text-[10px] leading-snug">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Create Job ── */}
      {activeTab === 'create' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col gap-4">
            <div>
              <h3 className="text-slate-900 font-bold text-base mb-0.5">Post a Job Onchain</h3>
              <p className="text-slate-400 text-xs">Creates an ERC-8183-style escrow job on Arc Testnet. USDC funded after creation.</p>
            </div>
            {!isReady && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-700 text-sm font-semibold">
                ⚠ Connect your wallet to post a job
              </div>
            )}
            <div>
              <label className="block text-slate-700 text-xs font-bold mb-1.5">Job Title *</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Summarise risk signals from Arc testnet mempool"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-violet-400 focus:bg-white transition-colors" />
            </div>
            <div>
              <label className="block text-slate-700 text-xs font-bold mb-1.5">Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3} placeholder="Describe the deliverable, acceptance criteria, and any context…"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-violet-400 focus:bg-white transition-colors resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-700 text-xs font-bold mb-1.5">Budget (USDC) *</label>
                <input type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
                  placeholder="25" min="0.01" step="0.01"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-violet-400 transition-colors" />
              </div>
              <div>
                <label className="block text-slate-700 text-xs font-bold mb-1.5">Deadline (hours)</label>
                <input type="number" value={form.deadlineHours} onChange={e => setForm(f => ({ ...f, deadlineHours: e.target.value }))}
                  placeholder="24" min="1" max="8760"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-violet-400 transition-colors" />
              </div>
            </div>
            <div>
              <label className="block text-slate-700 text-xs font-bold mb-1.5">
                Provider Address <span className="text-slate-400 font-normal">(optional — leave blank for open market)</span>
              </label>
              <input value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
                placeholder="0x… or leave blank"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm font-mono focus:outline-none focus:border-violet-400 transition-colors" />
            </div>
            <div>
              <label className="block text-slate-700 text-xs font-bold mb-1.5">
                Evaluator Address <span className="text-slate-400 font-normal">(optional — defaults to you)</span>
              </label>
              <input value={form.evaluator} onChange={e => setForm(f => ({ ...f, evaluator: e.target.value }))}
                placeholder="0x… or leave blank (you evaluate)"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm font-mono focus:outline-none focus:border-violet-400 transition-colors" />
            </div>
            <button onClick={handleCreate} disabled={!isReady || creating || !form.title || !form.budget}
              className="w-full py-3 rounded-xl bg-violet-600 text-white font-bold text-sm hover:bg-violet-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {creating ? '⏳ Creating job onchain…' : '🚀 createJob() on Arc Testnet'}
            </button>
            <p className="text-slate-400 text-[11px] text-center">Gas paid in USDC · ~780ms finality · ArcAgentJobs contract</p>
          </div>

          {/* Side — lifecycle only */}
          <div className="flex flex-col gap-4">
            <div className="bg-slate-100 border border-slate-200 rounded-xl p-4">
              <p className="text-emerald-700 text-xs font-bold mb-2">// Job lifecycle after creation:</p>
              <pre className="text-xs text-slate-600 font-mono leading-relaxed whitespace-pre-wrap">
{`1. createJob()  → status: Open
   (no USDC needed yet)

2. fund()       → status: Funded
   (USDC escrowed onchain)
   Approve USDC first → then fund()

3. submit()     → status: Submitted
   (provider posts deliverable hash)

4a. complete()  → USDC → provider ✅
4b. reject()    → USDC → creator back ❌
4c. claimRefund() → creator reclaims
    (only after deadline)`}
              </pre>
            </div>
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
              <p className="text-violet-700 text-xs font-bold mb-1">💡 After createJob()</p>
              <p className="text-slate-600 text-xs leading-relaxed">
                Go to <strong>My Jobs</strong> tab and click <strong>Fund Job</strong> to escrow USDC.
                The job is open for any provider to submit once funded.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── My Jobs ── */}
      {activeTab === 'myjobs' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-slate-900 font-bold text-base">
              {address ? `Jobs created by ${address.slice(0,6)}…${address.slice(-4)}` : 'Connect wallet to see your jobs'}
            </h3>
            {address && (
              <button onClick={loadMyJobs}
                className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition-colors">
                🔄 Refresh
              </button>
            )}
          </div>
          {!address && (
            <div className="flex flex-col items-center gap-3 py-12 bg-white border border-dashed border-slate-200 rounded-2xl">
              <span className="text-4xl">👤</span>
              <p className="text-slate-500 text-sm">Connect wallet to view your jobs</p>
            </div>
          )}
          {address && myJobs.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 bg-white border border-dashed border-slate-200 rounded-2xl">
              <span className="text-4xl">📭</span>
              <p className="text-slate-600 font-semibold">No jobs yet</p>
              <button onClick={() => setActiveTab('create')}
                className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 transition-colors">
                Post your first job →
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {myJobs.map(job => (
              <JobCard key={job.id.toString()} job={job} myAddress={address}
                onAction={handleAction} loading={actionLoading} />
            ))}
          </div>
        </div>
      )}

      {/* ── Nanopayments — real onchain USDC transfer ── */}
      {activeTab === 'nanopay' && (
        <div className="flex flex-col gap-5">

          {/* Send form */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col gap-4 max-w-lg">
            <div>
              <h3 className="text-slate-900 font-bold text-base mb-0.5">Send USDC Onchain</h3>
              <p className="text-slate-400 text-xs">
                Transfer any USDC amount directly via <code className="font-mono bg-slate-100 px-1 rounded">transfer()</code> — as small as $0.000001. ~780ms finality.
              </p>
            </div>

            {!isReady && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-700 text-sm font-semibold">
                ⚠ Connect your wallet to send USDC
              </div>
            )}

            {isReady && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 flex items-center justify-between">
                <span className="text-slate-500 text-xs">Your USDC balance</span>
                <span className="text-slate-900 font-bold text-sm font-mono">{balanceUSDC.toFixed(6)} USDC</span>
              </div>
            )}

            <div>
              <label className="block text-slate-700 text-xs font-bold mb-1.5">Recipient Address *</label>
              <input value={nanoTo} onChange={e => setNanoTo(e.target.value)}
                placeholder="0x…"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm font-mono focus:outline-none focus:border-violet-400 focus:bg-white transition-colors" />
            </div>

            <div>
              <label className="block text-slate-700 text-xs font-bold mb-1.5">Amount (USDC) *</label>
              <input type="number" value={nanoAmount} onChange={e => setNanoAmount(e.target.value)}
                placeholder="0.001" min="0.000001" step="any"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-violet-400 transition-colors" />
              {/* Quick-fill amounts */}
              <div className="flex gap-1.5 flex-wrap mt-2">
                {['0.000001', '0.0001', '0.001', '0.01', '0.1', '1'].map(v => (
                  <button key={v} onClick={() => setNanoAmount(v)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                      nanoAmount === v
                        ? 'bg-violet-600 border-violet-500 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300'
                    }`}>
                    ${v}
                  </button>
                ))}
              </div>
            </div>

            {nanoErr && (() => {
              const p = parseErr(nanoErr)
              return (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-red-700 text-xs font-semibold flex items-center gap-3 flex-wrap">
                  <span>❌ {p.msg}</span>
                  {p.needsFaucet && (
                    <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
                      className="px-3 py-1 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-500 transition-colors shrink-0">
                      💧 Get Testnet USDC ↗
                    </a>
                  )}
                </div>
              )
            })()}

            {(nanoPending || (nanoTxHash && !nanoConfirmed)) && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2 text-emerald-700 text-xs font-semibold flex items-center gap-2">
                ⏳ Confirming…
                {nanoTxHash && (
                  <a href={`https://testnet.arcscan.app/tx/${nanoTxHash}`} target="_blank" rel="noreferrer"
                    className="underline text-violet-600">View tx ↗</a>
                )}
              </div>
            )}

            <button onClick={handleNanoSend}
              disabled={!isReady || nanoSending || nanoPending || !nanoTo || !nanoAmount}
              className="w-full py-3 rounded-xl bg-violet-600 text-white font-bold text-sm hover:bg-violet-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {nanoSending ? '⏳ Sending…' : '💸 Send USDC'}
            </button>
            <p className="text-slate-400 text-[11px] text-center">Gas paid in USDC · USDC ERC-20 on Arc Testnet</p>
          </div>

          {/* Tx history */}
          {nanoTxs.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <h4 className="text-slate-900 font-bold text-sm">Recent Transfers</h4>
                <button onClick={() => {
                  setNanoTxs([])
                  localStorage.removeItem(LS_NANO_KEY)
                }} className="text-[10px] text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-200 px-2 py-0.5 rounded transition-colors">
                  Clear
                </button>
              </div>
              <div className="divide-y divide-slate-50">
                {nanoTxs.map((tx, i) => (
                  <div key={i} className="px-5 py-3 grid grid-cols-[1fr_auto_auto] gap-4 items-center text-xs">
                    <span className="text-slate-500 font-mono truncate">→ {tx.to}</span>
                    <span className="text-emerald-600 font-bold font-mono">${tx.amount} USDC</span>
                    <div className="flex items-center gap-2 text-slate-400 shrink-0">
                      <span>{fmtRelative(tx.time)}</span>
                      <a href={`https://testnet.arcscan.app/tx/${tx.txHash}`} target="_blank" rel="noreferrer"
                        className="hover:text-violet-600 transition-colors">↗</a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
