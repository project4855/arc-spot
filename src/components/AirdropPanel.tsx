// ── AirdropPanel.tsx ──────────────────────────────────────────────────────────
// Chỉ liệt kê dự án CHƯA phát token / chưa airdrop
// Dữ liệu xác minh từ X & nguồn tin. Cập nhật hàng tuần.

import { useState, useEffect } from 'react'
import airdropData from '../data/airdrops.json'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Step {
  action: string
  detail: string
}

interface AirdropProject {
  id:        string
  name:      string
  logo:      string
  category:  string
  raised:    string
  investors: string
  status:    string
  prob:      string
  tge?:      string
  hasToken:  boolean
  xSearch:   string
  desc:      string
  steps:     Step[]
  links: {
    site:     string
    twitter?: string
    app?:     string
  }
}

// ── Data từ JSON (cập nhật tự động hàng ngày) ────────────────────────────────

const PROJECTS     = airdropData.projects as AirdropProject[]
const LAST_UPDATED = airdropData.lastUpdated
const DATA_SOURCE  = airdropData.source
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GRADUATED    = (airdropData as any).graduated as {
  id: string; name: string; logo: string; detectedAt: string; confidence: string
}[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const UPDATE_LOG   = (airdropData as any).updateLog as {
  graduatedThisRun: string[]; checkedProjects: number; runAt: string; xApiUsed: boolean
} | undefined

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  'L1':       'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'L2':       'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'DeFi':     'bg-green-500/15 text-green-300 border-green-500/30',
  'Infra':    'bg-orange-500/15 text-orange-300 border-orange-500/30',
  'Gaming':   'bg-pink-500/15 text-pink-300 border-pink-500/30',
  'BTC Layer':'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
}

const PROB_CONFIG: Record<string, { color: string; bg: string; dot: string; bar: string }> = {
  'Rất cao':    { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400', bar: 'from-emerald-500 to-green-400' },
  'Cao':        { color: 'text-green-400',   bg: 'bg-green-500/10 border-green-500/30',     dot: 'bg-green-400',   bar: 'from-green-500 to-teal-400'   },
  'Trung bình': { color: 'text-yellow-400',  bg: 'bg-yellow-500/10 border-yellow-500/30',   dot: 'bg-yellow-400',  bar: 'from-yellow-500 to-amber-400'  },
}

const STATUS_COLORS: Record<string, string> = {
  'Testnet':      'text-blue-400 bg-blue-500/10 border-blue-500/20',
  'Mainnet Beta': 'text-green-400 bg-green-500/10 border-green-500/20',
  'Pre-launch':   'text-gray-400 bg-gray-500/10 border-gray-500/20',
  'Points Live':  'text-purple-400 bg-purple-500/10 border-purple-500/20',
}

const ALL_CATEGORIES = ['Tất cả', 'L1', 'L2', 'Infra', 'DeFi', 'BTC Layer', 'Gaming'] as const

// ── TGE Countdown ─────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

function parseTGEDate(tge: string): Date | null {
  if (!tge) return null
  const lower = tge.toLowerCase()
  // Too vague
  if (lower === '2026' || lower === '2025' || lower === '2027') return null
  if (lower.startsWith('tbd') || lower.startsWith('mainnet 20')) return null

  // "July–Sept 2026", "July 2026", "July-Sept 2026" — take first month
  const mMatch = lower.match(/([a-z]{3,})[^a-z0-9]*(\d{4})/)
  if (mMatch) {
    const month = MONTH_MAP[mMatch[1]]
    const year  = parseInt(mMatch[2])
    if (month !== undefined && !isNaN(year)) return new Date(year, month, 1)
  }

  // "Q1 2026", "Q3 2026"
  const qMatch = lower.match(/q([1-4])[^0-9]*(\d{4})/)
  if (qMatch) {
    const q    = parseInt(qMatch[1])
    const year = parseInt(qMatch[2])
    return new Date(year, (q - 1) * 3, 1)
  }

  return null
}

function CountdownBadge({ tge }: { tge: string }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const target = parseTGEDate(tge)

  if (!target) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span>🗓</span>
        <span className="text-gray-500">Dự kiến TGE:</span>
        <span className="text-yellow-400 font-semibold">{tge}</span>
      </div>
    )
  }

  const diff  = target.getTime() - now
  const days  = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)

  if (diff <= 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs flex-wrap">
        <span>🚨</span>
        <span className="text-gray-500">TGE:</span>
        <span className="text-orange-400 font-bold animate-pulse">{tge} — có thể đã TGE!</span>
      </div>
    )
  }

  let countdown: React.ReactNode
  if (days <= 30) {
    countdown = (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 font-bold animate-pulse">
        ⏰ {days}d {hours}h nữa!
      </span>
    )
  } else if (days <= 90) {
    countdown = (
      <span className="px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400 font-semibold">
        📅 ~{days} ngày nữa
      </span>
    )
  } else {
    countdown = (
      <span className="px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 font-medium">
        📅 ~{Math.ceil(days / 30)} tháng nữa
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-xs flex-wrap">
      <span>🗓</span>
      <span className="text-gray-500">TGE:</span>
      <span className="text-yellow-400">{tge}</span>
      <span className="text-gray-700">·</span>
      {countdown}
    </div>
  )
}

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({ p }: { p: AirdropProject }) {
  const [expanded, setExpanded] = useState(false)
  const probCfg = PROB_CONFIG[p.prob] ?? PROB_CONFIG['Trung bình']
  const catColor = CATEGORY_COLORS[p.category] ?? 'bg-gray-500/15 text-gray-300 border-gray-500/30'
  const statusColor = STATUS_COLORS[p.status] ?? 'text-gray-400 bg-gray-500/10 border-gray-500/20'

  const xUrl = `https://x.com/search?q=${encodeURIComponent(p.xSearch)}&f=live`

  return (
    <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 transition-all flex flex-col">

      {/* Accent bar */}
      <div className={`h-0.5 bg-gradient-to-r ${probCfg.bar}`} />

      <div className="p-4 flex flex-col gap-3 flex-1">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="text-2xl w-10 h-10 flex items-center justify-center rounded-xl bg-gray-800/60 shrink-0">
              {p.logo}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-white font-bold text-sm">{p.name}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${catColor}`}>
                  {p.category}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${statusColor}`}>
                  {p.status}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400 font-medium">
                  ✗ Chưa có token
                </span>
              </div>
            </div>
          </div>

          {/* Prob badge */}
          <div className={`shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg border ${probCfg.bg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${probCfg.dot} animate-pulse`} />
            <span className={`text-xs font-bold ${probCfg.color}`}>{p.prob}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-900/50 rounded-xl p-2.5">
            <div className="text-gray-600 text-[10px] mb-0.5">💰 Vốn huy động</div>
            <div className="text-white font-bold text-sm">{p.raised}</div>
          </div>
          <div className="bg-gray-900/50 rounded-xl p-2.5">
            <div className="text-gray-600 text-[10px] mb-0.5">🏦 Nhà đầu tư</div>
            <div className="text-gray-300 text-xs font-medium leading-tight">{p.investors}</div>
          </div>
        </div>

        {/* Description */}
        <p className="text-gray-400 text-xs leading-relaxed">{p.desc}</p>

        {/* TGE với countdown */}
        {p.tge && <CountdownBadge tge={p.tge} />}

        {/* X verification link */}
        <a
          href={xUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-xs text-gray-600 hover:text-sky-400 transition-colors"
        >
          <span className="font-bold">𝕏</span>
          <span>Xem cập nhật mới nhất trên X →</span>
        </a>
      </div>

      {/* Steps accordion */}
      <div className="border-t border-gray-800/80">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 hover:text-white hover:bg-white/5 transition-all"
        >
          <div className="flex items-center gap-2">
            <span>📋</span>
            <span>Cách tham gia ({p.steps.length} bước)</span>
          </div>
          <span className={`transition-transform duration-200 text-gray-600 ${expanded ? 'rotate-180' : ''}`}>▼</span>
        </button>

        {expanded && (
          <div className="px-4 pb-4 flex flex-col gap-2.5 bg-gray-900/20">
            {p.steps.map((s, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-5 h-5 rounded-full bg-violet-600/20 border border-violet-500/30 text-violet-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div>
                  <div className="text-white text-xs font-semibold">{s.action}</div>
                  <div className="text-gray-500 text-xs mt-0.5 leading-relaxed">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer links */}
      <div className="border-t border-gray-800/60 px-4 py-2.5 flex gap-3 bg-gray-900/10">
        <a href={p.links.site} target="_blank" rel="noreferrer"
          className="text-xs text-gray-600 hover:text-violet-400 transition-colors">
          🌐 Website
        </a>
        {p.links.twitter && (
          <a href={p.links.twitter} target="_blank" rel="noreferrer"
            className="text-xs text-gray-600 hover:text-sky-400 transition-colors">
            𝕏 Twitter
          </a>
        )}
        {p.links.app && (
          <a href={p.links.app} target="_blank" rel="noreferrer"
            className="text-xs text-gray-600 hover:text-green-400 transition-colors ml-auto font-medium">
            Vào App →
          </a>
        )}
      </div>
    </div>
  )
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function SummaryStats({ projects }: { projects: AirdropProject[] }) {
  const veryHigh = projects.filter((p) => p.prob === 'Rất cao').length
  const high     = projects.filter((p) => p.prob === 'Cao').length
  const live     = projects.filter((p) => p.status !== 'Pre-launch').length

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Chưa airdrop',   value: String(projects.length), icon: '🪂', color: 'text-violet-400' },
        { label: 'Xác suất rất cao', value: String(veryHigh),      icon: '🎯', color: 'text-emerald-400' },
        { label: 'Xác suất cao',   value: String(high),            icon: '✅', color: 'text-green-400'   },
        { label: 'Đang hoạt động', value: String(live),            icon: '🟢', color: 'text-blue-400'    },
      ].map((s) => (
        <div key={s.label} className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-3 text-center">
          <div className="text-xl mb-1">{s.icon}</div>
          <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
          <div className="text-gray-600 text-xs mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Graduated banner (đọc từ JSON) ───────────────────────────────────────────

function GraduatedBanner() {
  const [show, setShow] = useState(false)
  const newThisRun = UPDATE_LOG?.graduatedThisRun ?? []

  return (
    <div className={`border rounded-2xl p-4 ${
      newThisRun.length > 0
        ? 'bg-orange-500/5 border-orange-500/20'
        : 'bg-gray-900/40 border-gray-800'
    }`}>
      <button
        onClick={() => setShow((v) => !v)}
        className="w-full flex items-center justify-between text-xs text-gray-500 hover:text-gray-400 transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap">
          {newThisRun.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-orange-500/20 border border-orange-500/30 text-orange-400 font-semibold animate-pulse">
              🔔 {newThisRun.length} dự án vừa phát token!
            </span>
          )}
          <span>✅</span>
          <span className="font-semibold">Đã airdrop / có token ({GRADUATED.length} dự án)</span>
          <span className="text-gray-700">— không cần farm nữa</span>
        </div>
        <span className={`transition-transform duration-200 shrink-0 ${show ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {show && (
        <div className="mt-3 flex flex-wrap gap-2">
          {GRADUATED.map((g) => {
            const isNew = newThisRun.includes(g.name)
            return (
              <div key={g.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border ${
                  isNew
                    ? 'bg-orange-500/10 border-orange-500/30'
                    : 'bg-gray-800/60 border-gray-700'
                }`}>
                <span className="text-sm">{g.logo}</span>
                <span className={`text-xs font-semibold ${isNew ? 'text-orange-300' : 'text-gray-400'}`}>
                  {g.name}
                </span>
                <span className="text-gray-700 text-xs">· {g.detectedAt}</span>
                {isNew && <span className="text-orange-400 text-[10px] font-bold">NEW</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function AirdropPanel() {
  const [catFilter,  setCatFilter]  = useState<string>('Tất cả')
  const [probFilter, setProbFilter] = useState<string>('Tất cả')
  const [search,     setSearch]     = useState('')

  const filtered = PROJECTS.filter((p) => {
    if (catFilter  !== 'Tất cả' && p.category !== catFilter) return false
    if (probFilter !== 'Tất cả' && p.prob     !== probFilter) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Format last updated
  const updatedDate = new Date(LAST_UPDATED).toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  return (
    <div className="flex flex-col gap-5">

      {/* Banner */}
      <div className="w-full rounded-2xl bg-gradient-to-r from-violet-900/30 via-blue-900/20 to-violet-900/30 border border-violet-500/20 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-2xl">🪂</span>
              <h2 className="text-white font-bold text-lg">Airdrop Radar</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-semibold">
                ✗ Chưa phát token
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/25 text-violet-400 font-medium">
                {PROJECTS.length} dự án
              </span>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed max-w-xl">
              Chỉ liệt kê dự án <strong className="text-white">chưa phát token và chưa airdrop</strong>.
              Xác minh từ X và các nguồn tin. Cập nhật hàng tuần.
            </p>
          </div>

          {/* Update info */}
          <div className="text-xs bg-gray-900/60 rounded-xl px-3 py-2.5 border border-gray-800 shrink-0 flex flex-col gap-1.5 min-w-[160px]">
            <div className="flex items-center gap-1.5 text-gray-400">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              <span className="font-medium">Tự động cập nhật</span>
            </div>
            <div className="text-white font-semibold">{updatedDate}</div>
            <div className="flex items-center gap-1 text-gray-600">
              <span>{UPDATE_LOG?.xApiUsed ? '𝕏 X API ✓' : '𝕏 X API'}</span>
              <span>·</span>
              <span>CryptoRank</span>
            </div>
            <a
              href="https://github.com/project4855/arc-spot/actions"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors"
            >
              <span>⚙️</span>
              <span>GitHub Actions →</span>
            </a>
          </div>
        </div>
      </div>

      {/* Data source note */}
      <div className="flex items-center gap-2 text-xs text-gray-600 bg-gray-900/30 rounded-xl px-3 py-2 border border-gray-800">
        <span>📌</span>
        <span>Nguồn: {DATA_SOURCE}</span>
      </div>

      {/* Stats */}
      <SummaryStats projects={PROJECTS} />

      {/* Already graduated */}
      <GraduatedBanner />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600">🔍</span>
          <input
            type="text"
            placeholder="Tìm dự án..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-[#0d0e12] border border-gray-800 rounded-xl pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500/50 w-36"
          />
        </div>

        <div className="flex gap-1 flex-wrap">
          {ALL_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                catFilter === c
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-[#0d0e12] border border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="flex gap-1 ml-auto">
          {['Tất cả', 'Rất cao', 'Cao', 'Trung bình'].map((p) => (
            <button
              key={p}
              onClick={() => setProbFilter(p)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                probFilter === p
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-[#0d0e12] border border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white'
              }`}
            >
              {p === 'Tất cả' ? 'Xác suất' : p}
            </button>
          ))}
        </div>
      </div>

      {filtered.length !== PROJECTS.length && (
        <p className="text-gray-600 text-xs">Hiển thị {filtered.length}/{PROJECTS.length} dự án</p>
      )}

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <div className="text-4xl mb-3">🔍</div>
          <div>Không tìm thấy dự án phù hợp</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      )}

      <p className="text-center text-xs text-gray-700 py-2">
        Thông tin mang tính tham khảo · Không phải lời khuyên tài chính ·
        Luôn kiểm tra trên <a href="https://x.com" target="_blank" rel="noreferrer" className="text-sky-600 hover:text-sky-500">X</a> trước khi tham gia
      </p>
    </div>
  )
}
