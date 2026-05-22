// ── AgenticEconomyPanel.tsx ───────────────────────────────────────────────────
// Tab "Agents" — ERC-8183 Job Marketplace on Arc Testnet (onchain)
// Contract: ArcAgentJobs @ 0x55031271BDEfeBd9b6E6af52B9a92992aa6E3EFD

import { useState, useEffect, useRef, useCallback } from 'react'
import { useReadContract, usePublicClient, useWaitForTransactionReceipt } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { useWallet } from '../hooks/useWallet'
import { AGENT_JOBS_ADDRESS, AGENT_JOBS_ABI, TOKEN_ADDRESSES, ERC20_ABI } from '../config/contracts'

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentTab = 'jobs' | 'create' | 'myjobs' | 'nanopay' | 'erc8183'

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

function shortAddr(a: string) { return a === '0x0000000000000000000000000000000000000000' ? 'Open' : `${a.slice(0,6)}…${a.slice(-4)}` }
function fmtUsdc(n: bigint)   { return `${(Number(n) / 1e6).toFixed(2)} USDC` }
function fmtDate(ts: bigint)  {
  const d = new Date(Number(ts) * 1000)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function statusName(s: number): StatusName { return STATUS_LABEL[s] ?? 'Open' }

const USDC = TOKEN_ADDRESSES.USDC
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`

// ── Live nanopayment ticker ───────────────────────────────────────────────────

function NanoTicker() {
  const [ticks, setTicks] = useState<{ id: number; label: string; amount: string; color: string }[]>([])
  const counterRef = useRef(0)
  useEffect(() => {
    const EVENTS = [
      { label: 'EV → Charger',       amount: '$0.000120', color: 'text-amber-600' },
      { label: 'Agent → API',         amount: '$0.000500', color: 'text-violet-600' },
      { label: 'Sensor → Hub',        amount: '$0.000010', color: 'text-blue-600' },
      { label: 'Bot → Inference',     amount: '$0.000050', color: 'text-emerald-600' },
      { label: 'Agent → Bandwidth',   amount: '$0.000001', color: 'text-slate-600' },
      { label: 'Vehicle → Toll',      amount: '$0.000002', color: 'text-orange-600' },
    ]
    const iv = setInterval(() => {
      const ev = EVENTS[counterRef.current % EVENTS.length]
      counterRef.current++
      setTicks(prev => [{ id: counterRef.current, ...ev }, ...prev].slice(0, 8))
    }, 600)
    return () => clearInterval(iv)
  }, [])
  return (
    <div className="bg-slate-900 rounded-2xl p-4 min-h-[160px]">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
        <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">Live M2M Stream · Arc Testnet</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {ticks.map((t, i) => (
          <div key={t.id} className="flex items-center justify-between" style={{ opacity: 1 - i * 0.1 }}>
            <span className="text-slate-400 text-xs font-mono">{t.label}</span>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-mono font-bold ${t.color}`}>{t.amount}</span>
              <span className="text-slate-600 text-[10px]">~780ms ✓</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Job card ──────────────────────────────────────────────────────────────────

function JobCard({ job, myAddress, onAction, loading }: {
  job: OnchainJob
  myAddress?: string
  onAction: (action: 'fund' | 'submit' | 'complete' | 'reject' | 'claimRefund', jobId: bigint, extra?: string) => void
  loading: bigint | null
}) {
  const [deliverableInput, setDeliverableInput] = useState('')
  const sName = statusName(job.status)
  const isCreator   = myAddress?.toLowerCase() === job.creator.toLowerCase()
  const isProvider  = myAddress?.toLowerCase() === job.provider.toLowerCase()
  const isEvaluator = myAddress?.toLowerCase() === job.evaluator.toLowerCase()
  const isExpired   = Date.now() / 1000 > Number(job.deadline)
  const busy = loading === job.id

  return (
    <div className={`bg-white border rounded-2xl p-4 flex flex-col gap-3 ${sName === 'Completed' ? 'border-emerald-200' : sName === 'Rejected' || sName === 'Expired' ? 'border-slate-200 opacity-70' : 'border-slate-200 hover:border-violet-200'} transition-all`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-400 text-[10px] font-mono">#{job.id.toString()}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${STATUS_STYLES[sName]}`}>{sName}</span>
            {isCreator   && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-600 font-semibold">You created</span>}
            {isProvider  && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-violet-50 border border-violet-200 text-violet-600 font-semibold">You provide</span>}
            {isEvaluator && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-600 font-semibold">You evaluate</span>}
          </div>
          <p className="text-slate-900 font-bold text-sm mt-1 leading-snug">{job.title}</p>
          {job.description && <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{job.description}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-emerald-600 font-extrabold text-base font-mono">{fmtUsdc(job.budgetUsdc)}</p>
          <p className="text-slate-400 text-[10px] mt-0.5">Budget</p>
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-400">
        <span>👤 Creator: <span className="font-mono text-slate-600">{shortAddr(job.creator)}</span></span>
        <span>🔧 Provider: <span className="font-mono text-slate-600">{shortAddr(job.provider)}</span></span>
        <span>⏱ Deadline: <span className="text-slate-600">{fmtDate(job.deadline)}</span></span>
        <span>📅 Created: <span className="text-slate-600">{fmtDate(job.createdAt)}</span></span>
        {job.deliverable !== '0x' + '0'.repeat(64) && (
          <span className="col-span-2">📦 Deliverable: <span className="font-mono text-violet-600">{job.deliverable.slice(0, 18)}…</span></span>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        {/* Fund — anyone can fund an open job */}
        {sName === 'Open' && !isExpired && myAddress && (
          <button onClick={() => onAction('fund', job.id)}
            disabled={busy}
            className="w-full py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-400 transition-colors disabled:opacity-50">
            {busy ? '⏳ Funding…' : `💰 Fund Job (approve ${fmtUsdc(job.budgetUsdc)} USDC)`}
          </button>
        )}

        {/* Submit — provider submits deliverable */}
        {sName === 'Funded' && !isExpired && myAddress && (job.provider === ZERO_ADDR || isProvider) && (
          <div className="flex gap-2">
            <input
              value={deliverableInput}
              onChange={e => setDeliverableInput(e.target.value)}
              placeholder="IPFS CID or deliverable identifier"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-violet-400"
            />
            <button onClick={() => onAction('submit', job.id, deliverableInput)}
              disabled={busy || !deliverableInput.trim()}
              className="px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-500 transition-colors disabled:opacity-50">
              {busy ? '⏳' : '📤 Submit'}
            </button>
          </div>
        )}

        {/* Complete / Reject — evaluator only */}
        {sName === 'Submitted' && isEvaluator && (
          <div className="flex gap-2">
            <button onClick={() => onAction('complete', job.id)}
              disabled={busy}
              className="flex-1 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-400 transition-colors disabled:opacity-50">
              {busy ? '⏳' : '✅ Complete & Release USDC'}
            </button>
            <button onClick={() => onAction('reject', job.id)}
              disabled={busy}
              className="flex-1 py-2 rounded-xl bg-red-500 text-white text-xs font-bold hover:bg-red-400 transition-colors disabled:opacity-50">
              {busy ? '⏳' : '❌ Reject & Refund'}
            </button>
          </div>
        )}

        {/* Claim refund — creator after expiry */}
        {(sName === 'Funded' || sName === 'Submitted') && isExpired && isCreator && (
          <button onClick={() => onAction('claimRefund', job.id)}
            disabled={busy}
            className="w-full py-2 rounded-xl bg-slate-600 text-white text-xs font-bold hover:bg-slate-500 transition-colors disabled:opacity-50">
            {busy ? '⏳ Claiming…' : '🔙 Claim Refund (expired)'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function HyperliquidPanel() {
  const { address, isReady, writeContract } = useWallet()
  const publicClient = usePublicClient()

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
    title: '',
    description: '',
    budget: '',
    deadlineHours: '24',
    provider: '',
    evaluator: '',
  })
  const [creating, setCreating] = useState(false)

  // Read total job count from chain
  const { data: jobCountData, refetch: refetchCount } = useReadContract({
    address: AGENT_JOBS_ADDRESS,
    abi: AGENT_JOBS_ABI,
    functionName: 'jobCount',
  })

  // Wait for tx confirmation
  const { isLoading: txPending, isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined })

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
    } catch (e) {
      console.error('loadJobs', e)
    } finally {
      setLoadingJobs(false)
    }
  }, [publicClient])

  // Load my jobs
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
          address: AGENT_JOBS_ADDRESS,
          abi: AGENT_JOBS_ABI,
          functionName: 'getJob',
          args: [id],
        }) as Promise<OnchainJob>
      ))
      setMyJobs(fetched.filter(j => j.id > 0n).reverse())
    } catch (e) {
      console.error('loadMyJobs', e)
    }
  }, [publicClient, address])

  useEffect(() => { loadJobs() }, [loadJobs])
  useEffect(() => { if (address) loadMyJobs() }, [loadMyJobs, address])

  // Reload after tx confirms
  useEffect(() => {
    if (txConfirmed) {
      loadJobs()
      if (address) loadMyJobs()
      refetchCount()
      setActionLoading(null)
      setTxHash(null)
    }
  }, [txConfirmed, loadJobs, loadMyJobs, refetchCount, address])

  // ── Action handler ─────────────────────────────────────────────────────────

  const handleAction = useCallback(async (
    action: 'fund' | 'submit' | 'complete' | 'reject' | 'claimRefund',
    jobId: bigint,
    extra?: string,
  ) => {
    if (!isReady) return
    setTxError(null)
    setTxSuccess(null)
    setActionLoading(jobId)

    try {
      let hash: `0x${string}`

      if (action === 'fund') {
        // Find the job to get budget
        const job = [...jobs, ...myJobs].find(j => j.id === jobId)
        if (!job) throw new Error('Job not found')

        // Approve USDC first
        await writeContract({
          address: USDC,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [AGENT_JOBS_ADDRESS, job.budgetUsdc],
        })

        // Fund the job
        hash = await writeContract({
          address: AGENT_JOBS_ADDRESS,
          abi: AGENT_JOBS_ABI,
          functionName: 'fund',
          args: [jobId],
        })
      } else if (action === 'submit') {
        const deliverable = extra?.trim() || 'deliverable'
        const deliverableHash = keccak256(toBytes(deliverable))
        hash = await writeContract({
          address: AGENT_JOBS_ADDRESS,
          abi: AGENT_JOBS_ABI,
          functionName: 'submit',
          args: [jobId, deliverableHash],
        })
      } else {
        hash = await writeContract({
          address: AGENT_JOBS_ADDRESS,
          abi: AGENT_JOBS_ABI,
          functionName: action,
          args: [jobId],
        })
      }

      setTxHash(hash)
      setTxSuccess(`Transaction submitted → waiting for confirmation…`)
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
    setCreating(true)
    setTxError(null)
    setTxSuccess(null)
    try {
      const budgetUsdc = BigInt(Math.round(budget * 1e6))
      const hash = await writeContract({
        address: AGENT_JOBS_ADDRESS,
        abi: AGENT_JOBS_ABI,
        functionName: 'createJob',
        args: [
          (form.provider as `0x${string}`) || ZERO_ADDR,
          (form.evaluator as `0x${string}`) || ZERO_ADDR,
          budgetUsdc,
          BigInt(parseInt(form.deadlineHours) || 24),
          form.title,
          form.description,
        ],
      })
      setTxHash(hash)
      setTxSuccess('Job created onchain! Waiting for confirmation…')
      setForm({ title: '', description: '', budget: '', deadlineHours: '24', provider: '', evaluator: '' })
      setActiveTab('myjobs')
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  // ── Tabs config ────────────────────────────────────────────────────────────

  const TABS: { key: AgentTab; label: string; icon: string }[] = [
    { key: 'jobs',    label: 'Job Board',       icon: '📋' },
    { key: 'create',  label: 'Post a Job',      icon: '➕' },
    { key: 'myjobs',  label: 'My Jobs',         icon: '👤' },
    { key: 'nanopay', label: 'Nanopayments',    icon: '💸' },
    { key: 'erc8183', label: 'ERC-8183 Spec',   icon: '📖' },
  ]

  return (
    <div className="flex flex-col gap-5">

      {/* Header banner */}
      <div className="bg-gradient-to-r from-slate-900 via-violet-950 to-blue-950 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl shrink-0">🤖</div>
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/30 border border-violet-400/40 text-violet-300 font-bold">Arc Testnet · Chain 5042002</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-white/60 font-semibold">
                {jobCountData !== undefined ? `${jobCountData.toString()} jobs onchain` : 'Loading…'}
              </span>
            </div>
            <h2 className="text-white font-extrabold text-lg leading-tight">Agentic Economy · Job Marketplace</h2>
            <p className="text-slate-300 text-sm mt-1">
              Real onchain jobs powered by <strong className="text-white">ArcAgentJobs</strong> (ERC-8183 style) ·
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
      {(txError || txSuccess || txPending) && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${txError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-emerald-50 border border-emerald-200 text-emerald-700'}`}>
          {txPending && '⏳ Confirming on Arc Testnet…  '}
          {txSuccess && !txPending && `✅ ${txSuccess}`}
          {txError && `❌ ${txError.slice(0, 200)}`}
          {txHash && (
            <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer"
              className="ml-2 underline text-violet-600 text-xs">View tx ↗</a>
          )}
        </div>
      )}

      {/* Tab switcher */}
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
            <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
              ⏳ Reading from Arc Testnet…
            </div>
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
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Summarise risk signals from Arc testnet mempool"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-violet-400 focus:bg-white transition-colors"
              />
            </div>

            <div>
              <label className="block text-slate-700 text-xs font-bold mb-1.5">Description</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="Describe the deliverable, acceptance criteria, and any context…"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-violet-400 focus:bg-white transition-colors resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-700 text-xs font-bold mb-1.5">Budget (USDC) *</label>
                <input
                  type="number"
                  value={form.budget}
                  onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
                  placeholder="25"
                  min="0.01"
                  step="0.01"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-violet-400 transition-colors"
                />
              </div>
              <div>
                <label className="block text-slate-700 text-xs font-bold mb-1.5">Deadline (hours)</label>
                <input
                  type="number"
                  value={form.deadlineHours}
                  onChange={e => setForm(f => ({ ...f, deadlineHours: e.target.value }))}
                  placeholder="24"
                  min="1"
                  max="8760"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm focus:outline-none focus:border-violet-400 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-700 text-xs font-bold mb-1.5">Provider Address <span className="text-slate-400 font-normal">(optional — leave blank for open market)</span></label>
              <input
                value={form.provider}
                onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
                placeholder="0x… or leave blank"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm font-mono focus:outline-none focus:border-violet-400 transition-colors"
              />
            </div>

            <div>
              <label className="block text-slate-700 text-xs font-bold mb-1.5">Evaluator Address <span className="text-slate-400 font-normal">(optional — defaults to you)</span></label>
              <input
                value={form.evaluator}
                onChange={e => setForm(f => ({ ...f, evaluator: e.target.value }))}
                placeholder="0x… or leave blank (you evaluate)"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-sm font-mono focus:outline-none focus:border-violet-400 transition-colors"
              />
            </div>

            <button
              onClick={handleCreate}
              disabled={!isReady || creating || !form.title || !form.budget}
              className="w-full py-3 rounded-xl bg-violet-600 text-white font-bold text-sm hover:bg-violet-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {creating ? '⏳ Creating job onchain…' : `🚀 createJob() on Arc Testnet`}
            </button>
            <p className="text-slate-400 text-[11px] text-center">
              Gas paid in USDC · ~780ms finality · ArcAgentJobs contract
            </p>
          </div>

          {/* Side info */}
          <div className="flex flex-col gap-4">
            <div className="bg-slate-900 rounded-xl p-4">
              <p className="text-emerald-400 text-xs font-bold mb-2">// Job lifecycle after creation:</p>
              <pre className="text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap">
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
                The job is open for any provider to bid once funded.
              </p>
            </div>
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <p className="text-indigo-700 text-xs font-bold mb-1">🔐 Opt-in Privacy</p>
              <p className="text-slate-600 text-xs leading-relaxed">
                Arc's Privacy VM allows agents to shield bid details from competitors while
                remaining auditable. Full privacy integration coming in next release.
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

      {/* ── Nanopayments ── */}
      {activeTab === 'nanopay' && (
        <div className="flex flex-col gap-6">
          <div className="bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-200 rounded-2xl p-6">
            <h3 className="text-slate-900 font-extrabold text-xl mb-2">Nanopayments: Usage-Based Billing at Internet Scale</h3>
            <p className="text-slate-500 text-sm leading-relaxed max-w-2xl mb-3">
              Arc enables transactions as small as <strong>$0.000001</strong> — economically viable because
              USDC gas fees are stable and dollar-denominated. <strong>Circle Nanopayments</strong> makes
              what was impossible with volatile ETH gas now production-ready.
            </p>
            <div className="flex flex-wrap gap-2">
              {['$0.000001 minimum', 'Circle Nanopayments API', 'Pay-per-byte', 'Pay-per-token', 'M2M flows'].map(t => (
                <span key={t} className="px-2.5 py-1 rounded-full bg-violet-100 border border-violet-200 text-violet-700 text-[11px] font-semibold">{t}</span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {[
              { service: 'Pay-per-query AI research',   unit: 'per query',  amount: '$0.000500', volume: '1.2M/day',  icon: '🧠' },
              { service: 'IoT sensor data stream',       unit: 'per MB',     amount: '$0.000010', volume: '42M/day',   icon: '📡' },
              { service: 'Agent bandwidth allocation',   unit: 'per second', amount: '$0.000001', volume: '200M/day',  icon: '🔌' },
              { service: 'Usage-based AI inference',     unit: 'per token',  amount: '$0.000050', volume: '5M/day',    icon: '💡' },
              { service: 'EV charging (M2M)',            unit: 'per kWh',    amount: '$0.000120', volume: '18M/day',   icon: '⚡' },
              { service: 'Vehicle tolls (autonomous)',   unit: 'per meter',  amount: '$0.000002', volume: '500M/day',  icon: '🚗' },
            ].map(d => (
              <div key={d.service} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-2 hover:border-violet-200 transition-all">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{d.icon}</span>
                  <p className="text-slate-700 font-bold text-sm">{d.service}</p>
                </div>
                <div className="flex flex-col gap-1 mt-auto pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs">Per unit ({d.unit})</span>
                    <span className="text-emerald-600 font-mono font-bold text-sm">{d.amount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs">Est. daily volume</span>
                    <span className="text-slate-600 font-mono text-xs">{d.volume}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <NanoTicker />
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: '⚡', label: 'Finality',   value: '~780ms',    sub: 'Deterministic, no reorgs', color: 'bg-blue-50 border-blue-200' },
                { icon: '💰', label: 'Min payment', value: '$0.000001', sub: 'USDC-denominated gas',      color: 'bg-violet-50 border-violet-200' },
                { icon: '🔐', label: 'Privacy',     value: 'Opt-in',    sub: 'Shield agent strategies',   color: 'bg-indigo-50 border-indigo-200' },
                { icon: '🔗', label: 'Standard',    value: 'ERC-8183',  sub: 'Open escrow protocol',      color: 'bg-amber-50 border-amber-200' },
              ].map(s => (
                <div key={s.label} className={`${s.color} border rounded-2xl p-4`}>
                  <span className="text-2xl">{s.icon}</span>
                  <p className="text-slate-900 font-extrabold text-lg mt-1">{s.value}</p>
                  <p className="text-slate-700 font-semibold text-xs">{s.label}</p>
                  <p className="text-slate-400 text-[10px] mt-0.5">{s.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ERC-8183 Spec ── */}
      {activeTab === 'erc8183' && (
        <div className="flex flex-col gap-6">
          <div className="bg-slate-900 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-violet-600/30 border border-violet-500/40 flex items-center justify-center text-xl">🔗</div>
              <div>
                <h3 className="text-white font-extrabold text-lg">ArcAgentJobs — ERC-8183 Style Contract</h3>
                <a href={`https://testnet.arcscan.app/address/${AGENT_JOBS_ADDRESS}`} target="_blank" rel="noreferrer"
                  className="text-violet-400 text-xs hover:text-violet-300 font-mono">{AGENT_JOBS_ADDRESS} ↗</a>
              </div>
            </div>

            {/* Lifecycle */}
            <div className="mb-5">
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-3">Job Lifecycle</p>
              <div className="flex items-center gap-2 flex-wrap">
                {['Open', 'Funded', 'Submitted', 'Completed'].map((s, i, arr) => (
                  <div key={s} className="flex items-center gap-2">
                    <div className={`px-3 py-1.5 rounded-xl text-xs font-bold border ${STATUS_STYLES[s as StatusName]}`}>{s}</div>
                    {i < arr.length - 1 && <span className="text-slate-600">→</span>}
                  </div>
                ))}
              </div>
              <p className="text-slate-500 text-xs mt-2">Alternative exits: Rejected (evaluator rejects) · Expired (creator reclaims after deadline)</p>
            </div>

            {/* Functions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
              {[
                { fn: 'createJob()', desc: 'Define job: title, description, budget, deadline, provider (optional), evaluator', color: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
                { fn: 'fund()',       desc: 'Escrow USDC onchain. Caller must approve() this contract for budgetUsdc first.', color: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
                { fn: 'submit()',     desc: 'Provider submits deliverable as bytes32 hash (keccak256 of IPFS CID).', color: 'bg-violet-500/10 border-violet-500/30 text-violet-400' },
                { fn: 'complete()',   desc: 'Evaluator approves — USDC released to provider instantly.', color: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' },
                { fn: 'reject()',     desc: 'Evaluator rejects — USDC returned to creator.', color: 'bg-red-500/10 border-red-500/30 text-red-400' },
                { fn: 'claimRefund()', desc: 'Creator reclaims USDC after deadline passes without completion.', color: 'bg-slate-500/10 border-slate-500/30 text-slate-400' },
              ].map(f => (
                <div key={f.fn} className={`${f.color} border rounded-xl p-3`}>
                  <code className="font-mono font-bold text-sm block mb-1">{f.fn}</code>
                  <p className="text-slate-400 text-[11px] leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>

            {/* Code example */}
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Example: Full lifecycle in JS (viem)</p>
            <pre className="bg-black/40 rounded-xl p-4 text-xs text-emerald-400 font-mono overflow-x-auto leading-relaxed">
{`// 1. Create job
const jobId = await writeContract({
  address: '${AGENT_JOBS_ADDRESS}',
  functionName: 'createJob',
  args: [providerAddr, evaluatorAddr, 25_000_000n, 24n, "My task", "Details"]
})

// 2. Approve USDC, then fund
await writeContract({ address: USDC, functionName: 'approve',
  args: ['${AGENT_JOBS_ADDRESS}', 25_000_000n] })
await writeContract({ address: '${AGENT_JOBS_ADDRESS}',
  functionName: 'fund', args: [jobId] })

// 3. Provider submits deliverable
const hash = keccak256(toBytes('QmIPFScid...'))
await writeContract({ address: '${AGENT_JOBS_ADDRESS}',
  functionName: 'submit', args: [jobId, hash] })

// 4. Evaluator completes → USDC released
await writeContract({ address: '${AGENT_JOBS_ADDRESS}',
  functionName: 'complete', args: [jobId] })`}
            </pre>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { name: 'Circle Agent Stack', icon: '🧠', desc: 'Official Circle quickstart for building financial AI agent infrastructure on Arc. Circle Wallets + ERC-8183.', link: 'https://community.arc.io', color: 'border-violet-200 bg-violet-50' },
              { name: 'Arc Blueprint', icon: '📄', desc: 'How Arc supports the Agentic Economy — nanopayments, M2M flows, real-time coordination, opt-in privacy.', link: 'https://www.arc.io/blog/how-arc-supports-the-agentic-economy-arc-blueprints', color: 'border-blue-200 bg-blue-50' },
              { name: 'Agentic Commerce Hackathon', icon: '🎯', desc: 'Build AI agent commerce apps using Circle\'s payment infrastructure on Arc. Active challenge with prizes.', link: 'https://lablab.ai/ai-hackathons/agentic-commerce-on-arc', color: 'border-amber-200 bg-amber-50' },
            ].map(p => (
              <a key={p.name} href={p.link} target="_blank" rel="noreferrer"
                className={`${p.color} border rounded-2xl p-4 hover:shadow-md transition-all flex flex-col gap-3`}>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{p.icon}</span>
                  <h4 className="text-slate-900 font-bold text-sm">{p.name}</h4>
                </div>
                <p className="text-slate-500 text-xs leading-relaxed">{p.desc}</p>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
