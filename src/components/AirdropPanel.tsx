// ── CommunityPanel.tsx ────────────────────────────────────────────────────────
// Tab "Community" — Arc House, Architects Program, Builders Fund, Circle Grants,
// latest content from community.arc.io — auto-refreshes every hour

import { useState, useEffect, useCallback } from 'react'

type CommunityTab = 'archouse' | 'architects' | 'builders' | 'content' | 'events'

export interface FeedItem {
  type: string; title: string; date: string; views: string; icon: string; url: string
}

// ── Static fallback (used until API responds) ─────────────────────────────────

const FALLBACK_CONTENT: FeedItem[] = [
  { type: 'Blog',              title: 'Stablecorp brings QCAD to Arc, expanding StableFX into Canadian dollars', date: 'May 21, 2026', views: '10.5K', icon: '💵', url: 'https://community.arc.io/en/public/blogs/stablecorp-brings-qcad-to-arc-expanding-stablefx-into-canadian-dollars-2026-05-21' },
  { type: 'Video',             title: 'Replay: Arc Enterprise & DeFi Hackathon Spotlight: Chariot',              date: 'May 20, 2026', views: '26K',   icon: '🏆', url: 'https://community.arc.io/en/public/videos/replay-arc-enterprise-and-defi-hackathon-spotlight-chariot-crosschain-collateral-lending-protocol-on-arc-2026-05-20' },
  { type: 'Arc Blueprints',   title: 'Build Institutional Grade Prediction Markets on Arc',                      date: 'May 15, 2026', views: '20.2K', icon: '🎯', url: 'https://www.arc.io/blog/build-institutional-grade-prediction-markets-on-arc-arc-blueprints' },
  { type: 'Arc Blueprints',   title: 'How Arc Supports the Agentic Economy',                                    date: 'May 15, 2026', views: '14K',   icon: '🤖', url: 'https://www.arc.io/blog/how-arc-supports-the-agentic-economy-arc-blueprints' },
  { type: 'Arc Blueprints',   title: 'How Arc Supports Lending and Borrowing',                                  date: 'May 15, 2026', views: '19K',   icon: '🏦', url: 'https://www.arc.io/blog/how-arc-supports-lending-and-borrowing-arc-blueprints' },
  { type: 'Blog',             title: 'Circle Developer Grants Program Relaunches',                              date: 'May 14, 2026', views: '559',   icon: '🎟️', url: 'https://community.arc.io/en/public/blogs/circle-developer-grants-program-relaunches-2026-05-14' },
  { type: 'Video',            title: 'Circle Developer Grants: From idea to funded',                            date: 'May 14, 2026', views: '480',   icon: '🎥', url: 'https://community.arc.io/en/public/videos/circle-developer-grants-from-idea-to-funded-2026-05-14' },
  { type: 'Blog · Partner',  title: 'Arc 🤝 Turnkey: Wallet and signing infrastructure for builders on Arc',   date: 'May 13, 2026', views: '533',   icon: '🔑', url: 'https://community.arc.io/en/public/blogs/arc-turnkey-wallet-and-signing-infrastructure-for-builders-on-arc' },
  { type: 'Blog · Partner',  title: 'Arc 🤝 LI.FI: Crosschain routing and liquidity access for Arc builders',  date: 'May 10, 2026', views: '',      icon: '🌉', url: 'https://community.arc.io/en/public/blogs/arc-x-lifi-crosschain-routing-and-liquidity-access-for-arc-builders' },
  { type: 'Blog · Partner',  title: 'Arc 🤝 Dynamic: Better onboarding for Arc apps',                          date: 'May 6, 2026',  views: '',      icon: '⚡', url: 'https://community.arc.io/en/home/blogs' },
  { type: 'Arc Blueprints',  title: 'Introducing the ARC Whitepaper: Coordination Asset',                       date: 'May 11, 2026', views: '',      icon: '📄', url: 'https://www.arc.io/blog/introducing-the-arc-token-whitepaper' },
  { type: 'Blog · Arc Updates', title: 'App Kits: A Suite of SDKs to Build Onchain',                           date: 'Apr 10, 2026', views: '',      icon: '🛠️', url: 'https://www.arc.io/blog/app-kits-a-suite-of-sdks-to-build-onchain' },
  { type: 'Blog · Arc Updates', title: 'Open Sourcing Arc: Run Your Own Node + Bug Bounty',                     date: 'Apr 10, 2026', views: '',      icon: '💻', url: 'https://www.arc.io/blog/open-sourcing-arc-run-your-own-arc-node-and-bug-bounty-program' },
  { type: 'Blog · Arc Updates', title: 'Unified Balance Kit: One Integration for Unified USDC Flows',           date: 'Apr 2026',     views: '',      icon: '🔗', url: 'https://www.arc.io/blog/unified-balance-kit-one-integration-for-unified-usdc-flows' },
  { type: 'Blog · Arc Updates', title: "Arc's Quantum-Resistant Design and Roadmap",                            date: 'Apr 4, 2026',  views: '',      icon: '🔐', url: 'https://www.arc.io/blog/arcs-quantum-resistant-design-and-roadmap-why-it-matters' },
  { type: 'Video',            title: 'Event Replay: Introducing Arc House and Architects',                       date: 'Apr 6, 2026',  views: '',      icon: '🏠', url: 'https://community.arc.io/en/home/videos' },
]

const ARCTALKS = [
  { title: 'AI Agents, USDC, and the Programmable Economy',      speaker: 'Furqan Rydhan (thirdweb)',     date: 'Feb 2, 2026',  icon: '🤖' },
  { title: 'Arc: The Economic OS (Parts 1, 2 & 3)',              speaker: 'Jeremy Allaire + Nikhil Chandhok', date: 'Dec 6, 2025', icon: '⚡' },
  { title: 'Arc Builders Fund Spotlight: Hibachi',               speaker: 'Chip Dempsey (Hibachi)',       date: 'Feb 26, 2026', icon: '🍱' },
  { title: 'Roundtable: Arc\'s Core Design Features',            speaker: 'Gordon Liao + Adrian Sighioan', date: 'Dec 7, 2025', icon: '🔧' },
  { title: 'Roundtable: The Arc Experience — Use Cases',         speaker: 'Rachel Major + Sanket Jain',  date: 'Dec 6, 2025',  icon: '📊' },
  { title: 'Arc Community Spotlight: Social Payments (XyloNet & PayX)', speaker: 'Panchu (XyloNet)',     date: 'Mar 27, 2026', icon: '💸' },
]

const ARCSHOPS = [
  { title: 'App Kits: Bridge, Swap, Send, and Monetization',    date: 'Apr 21, 2026',  host: 'Elton Tay · Developer Relations, Arc', icon: '🛠️' },
  { title: 'ArcShop: Understanding Gateway',                     date: 'Apr 28, 2026',  host: 'HJ · Senior Manager, Ecosystem Marketing', icon: '🌐' },
  { title: 'ArcShop: Unified Balance Kit for Crosschain USDC',   date: 'May 2, 2026',   host: 'Elton Tay · Developer Relations, Arc', icon: '🔗' },
  { title: 'Technical Office Hours (bi-weekly)',                  date: 'Every other Thu', host: 'Arc Architects Team', icon: '🏗️' },
]

const PARTNER_SPOTLIGHTS = [
  { partner: 'Turnkey',   desc: 'Wallet and signing infrastructure for builders on Arc',   date: 'May 13', icon: '🔑', type: 'Partner Spotlight' },
  { partner: 'LI.FI',    desc: 'Crosschain routing and liquidity access for Arc builders', date: 'May 10', icon: '🌉', type: 'Partner Spotlight' },
  { partner: 'Dynamic',  desc: 'Better onboarding for apps built on Arc',                 date: 'May 6',  icon: '⚡', type: 'Partner Spotlight' },
  { partner: 'TRM Labs', desc: 'Blockchain intelligence + monitoring for enterprise apps', date: 'Mar 27', icon: '🔍', type: 'Partner Spotlight' },
  { partner: 'Elliptic', desc: 'Blockchain analytics and monitoring for compliance apps',  date: 'Feb 25', icon: '📊', type: 'Partner Spotlight' },
  { partner: 'Across',   desc: 'Day-one crosschain transfers for builders on Arc',         date: 'Mar 25', icon: '🌉', type: 'Partner Spotlight' },
  { partner: 'Alchemy',  desc: 'Alchemy integrates with Arc — RPC and infrastructure',     date: 'Feb 18', icon: '🧪', type: 'Partner Spotlight' },
  { partner: 'Morpho',   desc: 'Arc Enterprise & DeFi Hackathon featuring Morpho × Arc',   date: 'Apr 29', icon: '🌀', type: 'Partner Spotlight' },
]

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AirdropPanel() {
  const [activeTab,   setActiveTab]   = useState<CommunityTab>('archouse')
  const [feedItems,   setFeedItems]   = useState<FeedItem[]>(FALLBACK_CONTENT)
  const [feedSource,  setFeedSource]  = useState<'live' | 'fallback' | 'loading'>('loading')
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch('/api/arc-feed')
      if (!res.ok) throw new Error('feed error')
      const data = await res.json() as { items: FeedItem[]; source: 'live' | 'fallback'; fetchedAt: string }
      if (data.items?.length) {
        setFeedItems(data.items)
        setFeedSource(data.source)
        setLastFetched(new Date())
      }
    } catch {
      setFeedSource('fallback')
    }
  }, [])

  useEffect(() => {
    fetchFeed()
    const id = setInterval(fetchFeed, 60 * 60 * 1000) // refresh every hour
    return () => clearInterval(id)
  }, [fetchFeed])

  const TABS: { key: CommunityTab; label: string; icon: string }[] = [
    { key: 'archouse',   label: 'Arc House',       icon: '🏠' },
    { key: 'architects', label: 'Architects',      icon: '🏛️' },
    { key: 'builders',   label: 'Builders Fund',   icon: '💰' },
    { key: 'content',    label: 'Latest Content',  icon: '📚' },
    { key: 'events',     label: 'ArcTalks & Shops', icon: '🎙️' },
  ]

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-violet-950 to-blue-950 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl shrink-0">🏠</div>
          <div>
            <h2 className="text-white font-extrabold text-xl leading-tight">Arc House Community</h2>
            <p className="text-slate-300 text-sm mt-1 max-w-xl">
              The central hub for everything happening in the Arc ecosystem — content, events, programs, and the community of builders
              shaping the internet financial system.
            </p>
          </div>
        </div>
        <a href="https://community.arc.io" target="_blank" rel="noreferrer"
          className="shrink-0 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 transition-colors">
          Join Arc House ↗
        </a>
      </div>

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

      {/* ── Arc House overview ── */}
      {activeTab === 'archouse' && (
        <div className="flex flex-col gap-6">
          {/* Active programs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: '🏆',
                tag: 'Active · Ends Jul 13',
                title: 'Stablecoins Commerce Stack Challenge',
                desc: 'Build the next great commerce application on Arc\'s stablecoin-native infrastructure. Open to teams and individuals. Prizes + Builder Fund backing.',
                url: 'https://community.arc.io',
                color: 'from-violet-600 to-blue-600',
                bg: 'bg-violet-50 border-violet-200',
              },
              {
                icon: '🎟️',
                tag: 'Relaunched May 2026',
                title: 'Circle Developer Grants',
                desc: 'Grants program for builders on Arc and the Circle Developer Platform. Applications open now — projects of all sizes welcome.',
                url: 'https://community.arc.io',
                color: 'from-emerald-600 to-teal-600',
                bg: 'bg-emerald-50 border-emerald-200',
              },
              {
                icon: '📅',
                tag: 'Every other Thursday',
                title: 'Architect Technical Office Hours',
                desc: 'Bi-weekly technical office hours with the Arc core team. Get answers to your builder questions live.',
                url: 'https://community.arc.io',
                color: 'from-orange-500 to-amber-500',
                bg: 'bg-amber-50 border-amber-200',
              },
            ].map(p => (
              <a key={p.title} href={p.url} target="_blank" rel="noreferrer"
                className={`${p.bg} border rounded-2xl p-5 hover:shadow-md transition-all flex flex-col gap-2 group`}>
                <div className="flex items-center gap-2">
                  <span className="text-xl">{p.icon}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r ${p.color} text-white font-bold`}>{p.tag}</span>
                </div>
                <h3 className="text-slate-900 font-bold text-sm group-hover:text-violet-700 transition-colors">{p.title}</h3>
                <p className="text-slate-500 text-xs leading-relaxed flex-1">{p.desc}</p>
                <span className="text-violet-600 text-xs font-semibold">Learn more →</span>
              </a>
            ))}
          </div>

          {/* Upcoming events */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-slate-900 font-bold text-base">Upcoming Builder Events</h3>
              <p className="text-slate-400 text-xs">Live sessions, spotlights and office hours from community.arc.io</p>
            </div>
            <div className="divide-y divide-slate-100">
              {[
                { date: 'May 20 · 2:00 PM GMT', title: 'Builder Spotlight: Synthra', sub: 'Spot, Concentrated Liquidity, and Perpetual Markets on Arc', type: 'Builder Spotlight', color: 'text-blue-600 bg-blue-50' },
                { date: 'May 21 · 2:00 PM GMT', title: 'Builder Spotlight: Tower Exchange', sub: 'Native Stablecoin DEX Aggregation on Arc', type: 'Builder Spotlight', color: 'text-violet-600 bg-violet-50' },
                { date: 'May 22 · 3:00 PM GMT', title: 'Circle Developer Grants: Building on Arc', sub: 'How to apply, what we fund, and getting started', type: 'Developer Program', color: 'text-emerald-600 bg-emerald-50' },
              ].map(e => (
                <a key={e.title} href="https://community.arc.io" target="_blank" rel="noreferrer"
                  className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors group">
                  <div className="text-right shrink-0 min-w-[120px]">
                    <p className="text-slate-600 text-xs font-semibold">{e.date}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-900 font-semibold text-sm group-hover:text-violet-700 transition-colors">{e.title}</p>
                    <p className="text-slate-400 text-xs truncate">{e.sub}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] px-2 py-1 rounded-lg font-bold ${e.color}`}>{e.type}</span>
                </a>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
              <a href="https://community.arc.io" target="_blank" rel="noreferrer"
                className="text-violet-600 text-xs font-bold hover:text-violet-500">
                View all events on Arc House →
              </a>
            </div>
          </div>

          {/* Content categories */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              { icon: '📘', label: 'Arc Blueprints',    desc: '10 use case deep-dives',  url: 'https://www.arc.io/blog', color: 'border-violet-200 bg-violet-50 text-violet-700' },
              { icon: '🎙️', label: 'ArcTalks',          desc: 'Roundtables & spotlights', url: 'https://community.arc.io', color: 'border-blue-200 bg-blue-50 text-blue-700' },
              { icon: '🏪', label: 'ArcShops',           desc: 'Dev office hours & demos', url: 'https://community.arc.io', color: 'border-amber-200 bg-amber-50 text-amber-700' },
              { icon: '🎓', label: 'Stablecoin 101',    desc: 'Educational video series', url: 'https://community.arc.io', color: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
              { icon: '🤝', label: 'Partner Spotlights', desc: 'Ecosystem integrations',  url: 'https://community.arc.io', color: 'border-slate-200 bg-slate-50 text-slate-700' },
              { icon: '🏗️', label: 'Builder Spotlights', desc: 'Teams shipping on Arc',   url: 'https://community.arc.io', color: 'border-orange-200 bg-orange-50 text-orange-700' },
            ].map(cat => (
              <a key={cat.label} href={cat.url} target="_blank" rel="noreferrer"
                className={`border rounded-2xl p-4 hover:shadow-sm transition-all flex flex-col items-center text-center gap-2 group ${cat.color}`}>
                <span className="text-2xl">{cat.icon}</span>
                <p className="font-bold text-xs">{cat.label}</p>
                <p className="text-[10px] opacity-70">{cat.desc}</p>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Architects Program ── */}
      {activeTab === 'architects' && (
        <div className="flex flex-col gap-6">
          <div className="bg-gradient-to-br from-emerald-900 to-teal-900 rounded-2xl p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-3xl">🏛️</div>
              <div>
                <h3 className="text-white font-extrabold text-xl">The Architects Program</h3>
                <p className="text-emerald-300 text-sm">Arc's community ambassador initiative · Launched April 2, 2026</p>
              </div>
            </div>
            <p className="text-slate-200 text-sm leading-relaxed mb-4 max-w-2xl">
              Architects is a <strong className="text-white">merit-based recognition system</strong> for contributors who actively grow the Arc ecosystem.
              It's not application-driven — you earn your place through contributions, building, and community engagement.
              Points are tracked transparently within Arc House.
            </p>
            <div className="flex gap-3 flex-wrap">
              <a href="https://community.arc.io" target="_blank" rel="noreferrer"
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition-colors">
                Join Architects ↗
              </a>
              <a href="https://community.arc.io" target="_blank" rel="noreferrer"
                className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-semibold hover:bg-white/20 transition-colors">
                View Program Details ↗
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Roles */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <h3 className="text-slate-900 font-bold text-base mb-4">Available Roles</h3>
              <div className="flex flex-col gap-3">
                {[
                  { role: 'Technical Speaker',   icon: '🎙️', desc: 'Share technical knowledge about Arc at conferences, meetups, and online events. Represent the Arc ecosystem to developers.' },
                  { role: 'Meetup Organizer',    icon: '📍', desc: 'Organize and lead regional Arc community meetups. Build the Arc builder community in your city or country.' },
                  { role: 'Community Moderator', icon: '🛡️', desc: 'Moderate Arc House and Discord. Help new builders navigate the ecosystem. Maintain community standards.' },
                  { role: 'Regional Lead',       icon: '🌍', desc: 'Serve as the primary point of contact for Arc in a geographic region. Coordinate with the core team on regional growth.' },
                ].map(r => (
                  <div key={r.role} className="flex gap-3 p-3 rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-colors">
                    <span className="text-2xl">{r.icon}</span>
                    <div>
                      <p className="text-slate-900 font-bold text-sm">{r.role}</p>
                      <p className="text-slate-400 text-xs leading-relaxed">{r.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Benefits & resources */}
            <div className="flex flex-col gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <h3 className="text-slate-900 font-bold text-base mb-4">Benefits</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { icon: '🤝', benefit: 'Exclusive networking' },
                    { icon: '👁️', benefit: 'Project visibility' },
                    { icon: '🎁', benefit: 'Swag & merch' },
                    { icon: '🎫', benefit: 'VIP event invitations' },
                    { icon: '🏅', benefit: 'Recognition & badges' },
                    { icon: '💼', benefit: 'Career opportunities' },
                  ].map(b => (
                    <div key={b.benefit} className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 border border-emerald-100">
                      <span className="text-base">{b.icon}</span>
                      <span className="text-slate-700 text-xs font-medium">{b.benefit}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <h3 className="text-slate-900 font-bold text-base mb-3">Program Resources</h3>
                <div className="flex flex-col gap-2">
                  {[
                    { label: 'Program Overview',         icon: '📋' },
                    { label: 'Tiers & Benefits Guide',   icon: '🏅' },
                    { label: 'Roles Documentation',      icon: '📌' },
                    { label: 'Contribution Opportunities', icon: '🔨' },
                    { label: 'Terms & Conditions',       icon: '📄' },
                    { label: 'Arc Engagement Amplification Guide', icon: '📣' },
                  ].map(r => (
                    <a key={r.label} href="https://community.arc.io" target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors group">
                      <span className="text-base">{r.icon}</span>
                      <span className="text-slate-600 text-xs group-hover:text-violet-600 transition-colors flex-1">{r.label}</span>
                      <span className="text-slate-300 text-xs">↗</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Builders Fund ── */}
      {activeTab === 'builders' && (
        <div className="flex flex-col gap-6">
          <div className="bg-gradient-to-br from-slate-900 to-violet-950 rounded-2xl p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center text-3xl">💰</div>
              <div>
                <h3 className="text-white font-extrabold text-xl">Arc Builders Fund</h3>
                <p className="text-violet-300 text-sm">A Circle Ventures corporate initiative · Backs early-stage teams</p>
              </div>
            </div>
            <p className="text-slate-200 text-sm leading-relaxed mb-4 max-w-2xl">
              The Arc Builders Fund backs early-stage teams building real-world financial apps on Arc.
              Recipients receive <strong className="text-white">capital, hands-on support from Arc's core teams</strong>, and
              a front-row seat in shaping the new Economic OS for the internet. Focus areas: stablecoin-based gas,
              deterministic sub-second finality, and opt-in privacy applications.
            </p>
            <a href="https://arc.io/builders-fund" target="_blank" rel="noreferrer"
              className="inline-block px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 transition-colors">
              Apply to Builders Fund ↗
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-3">
              <h3 className="text-slate-900 font-bold text-base mb-4">Funded Projects</h3>
            </div>
            {[
              {
                name: 'Tradable',
                icon: '📊',
                category: 'Institutional Private Credit',
                desc: 'Onchain asset manager with decades of traditional finance and crypto experience. Building institutional private credit infrastructure on Arc.',
                date: 'Apr 3, 2026',
                tags: ['Private Credit', 'RWA', 'Institutional'],
                color: 'border-violet-200 bg-violet-50',
              },
              {
                name: 'Hibachi',
                icon: '🍱',
                category: 'Arc Builders Fund',
                desc: 'Featured in Arc Builders Fund Spotlight — building the next generation of onchain financial infrastructure backed by Circle Ventures.',
                date: 'Feb 26, 2026',
                tags: ['Builders Fund', 'DeFi'],
                color: 'border-orange-200 bg-orange-50',
              },
              {
                name: 'Trad.Fi (Circle Ventures)',
                icon: '🏦',
                category: 'Circle Ventures Spotlight',
                desc: 'Circle Ventures Spotlight featuring Trad.Fi — building bridges between traditional finance and onchain infrastructure on Arc.',
                date: 'Dec 22, 2025',
                tags: ['TradFi', 'Circle Ventures', 'Bridge'],
                color: 'border-blue-200 bg-blue-50',
              },
            ].map(p => (
              <a key={p.name} href="https://community.arc.io" target="_blank" rel="noreferrer"
                className={`${p.color} border rounded-2xl p-5 hover:shadow-md transition-all flex flex-col gap-3 group`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{p.icon}</span>
                    <div>
                      <h4 className="text-slate-900 font-bold text-base group-hover:text-violet-700 transition-colors">{p.name}</h4>
                      <p className="text-slate-500 text-[10px]">{p.category}</p>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400">{p.date}</span>
                </div>
                <p className="text-slate-500 text-xs leading-relaxed flex-1">{p.desc}</p>
                <div className="flex flex-wrap gap-1">
                  {p.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-500 text-[10px]">{tag}</span>
                  ))}
                </div>
              </a>
            ))}
          </div>

          {/* Hackathon winners */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <h3 className="text-slate-900 font-bold text-base mb-4">Hackathon Winners on Arc</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {[
                { event: 'Arc Enterprise & DeFi Hackathon', winner: 'Crumb', feat: 'Gasless USDC Nanopayments', icon: '🏆', color: 'bg-amber-50 border-amber-200' },
                { event: 'Arc Enterprise & DeFi Hackathon', winner: 'Blink', feat: 'Nanopayment Insurance infrastructure', icon: '🥈', color: 'bg-slate-50 border-slate-200' },
                { event: 'USDC OpenClaw Hackathon',         winner: 'ClawRouter (BlockRunAI)', feat: 'Crosschain USDC routing', icon: '🥇', color: 'bg-amber-50 border-amber-200' },
                { event: 'ETHGlobal Cannes',                winner: 'Multiple Arc track winners', feat: 'Arc track at ETHGlobal', icon: '🌍', color: 'bg-blue-50 border-blue-200' },
                { event: 'HackMoney 2026',                  winner: 'Multiple Arc track winners', feat: 'Arc track at HackMoney', icon: '💰', color: 'bg-violet-50 border-violet-200' },
              ].map(h => (
                <div key={h.winner} className={`border rounded-xl p-3 ${h.color}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base">{h.icon}</span>
                    <p className="text-slate-900 font-bold text-sm">{h.winner}</p>
                  </div>
                  <p className="text-slate-500 text-[10px]">{h.event}</p>
                  <p className="text-slate-600 text-xs mt-1">{h.feat}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Latest Content ── */}
      {activeTab === 'content' && (
        <div className="flex flex-col gap-4">

          {/* Status bar */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              {feedSource === 'loading' && (
                <span className="text-xs text-slate-400 animate-pulse">⏳ Loading latest content…</span>
              )}
              {feedSource === 'live' && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  Live · auto-updates every hour
                </span>
              )}
              {feedSource === 'fallback' && (
                <span className="text-xs text-amber-600 font-semibold">📋 Cached content</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {lastFetched && (
                <span className="text-[10px] text-slate-400">
                  Updated {lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <button onClick={fetchFeed}
                className="text-[11px] px-2 py-1 rounded-lg bg-slate-100 text-slate-500 hover:bg-violet-100 hover:text-violet-600 font-semibold transition-colors">
                ↻ Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {feedItems.map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noreferrer"
                className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-violet-300 hover:shadow-md transition-all group flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{item.icon}</span>
                  <div className="text-right">
                    {item.views && <p className="text-violet-600 text-[10px] font-bold">{item.views} views</p>}
                    <p className="text-slate-400 text-[10px]">{item.date}</p>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold self-start ${
                  item.type.includes('Blueprint') ? 'bg-violet-100 text-violet-700' :
                  item.type.includes('Video')     ? 'bg-red-50 text-red-600' :
                  item.type.includes('Partner')   ? 'bg-amber-50 text-amber-700' :
                  'bg-slate-100 text-slate-500'
                }`}>{item.type}</span>
                <h4 className="text-slate-800 font-semibold text-sm leading-snug group-hover:text-violet-700 transition-colors flex-1">{item.title}</h4>
                <span className="text-[10px] text-violet-400 group-hover:text-violet-600 transition-colors self-end">Read more ↗</span>
              </a>
            ))}
          </div>
          <div className="text-center">
            <a href="https://community.arc.io/en/home" target="_blank" rel="noreferrer"
              className="inline-block px-6 py-3 rounded-xl bg-violet-600 text-white font-bold text-sm hover:bg-violet-500 transition-colors">
              View All Content on Arc House ↗
            </a>
          </div>
        </div>
      )}

      {/* ── ArcTalks & ArcShops ── */}
      {activeTab === 'events' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* ArcTalks */}
          <div className="flex flex-col gap-4">
            <div className="bg-violet-600 rounded-2xl p-4">
              <h3 className="text-white font-extrabold text-lg">🎙️ ArcTalks</h3>
              <p className="text-violet-200 text-xs mt-1">Roundtables, interviews, and community discussions about building on Arc</p>
            </div>
            <div className="flex flex-col gap-2">
              {ARCTALKS.map(talk => (
                <a key={talk.title} href="https://community.arc.io" target="_blank" rel="noreferrer"
                  className="bg-white border border-slate-200 rounded-xl p-4 hover:border-violet-300 hover:bg-violet-50/30 transition-all group flex gap-3">
                  <span className="text-xl shrink-0">{talk.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-800 font-semibold text-sm group-hover:text-violet-700 transition-colors leading-snug">{talk.title}</p>
                    <p className="text-slate-400 text-[11px] mt-0.5">{talk.speaker}</p>
                    <p className="text-slate-300 text-[10px]">{talk.date}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* ArcShops + Partner Spotlights */}
          <div className="flex flex-col gap-4">
            <div className="bg-amber-500 rounded-2xl p-4">
              <h3 className="text-white font-extrabold text-lg">🏪 ArcShops — Dev Office Hours</h3>
              <p className="text-amber-100 text-xs mt-1">Live developer sessions: Bridge, Swap, Send, Gateway, App Kits, and more</p>
            </div>
            <div className="flex flex-col gap-2">
              {ARCSHOPS.map(shop => (
                <a key={shop.title} href="https://community.arc.io" target="_blank" rel="noreferrer"
                  className="bg-white border border-slate-200 rounded-xl p-4 hover:border-amber-300 hover:bg-amber-50/30 transition-all group flex gap-3">
                  <span className="text-xl shrink-0">{shop.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-800 font-semibold text-sm group-hover:text-amber-700 transition-colors leading-snug">{shop.title}</p>
                    <p className="text-slate-400 text-[11px] mt-0.5">{shop.host}</p>
                    <p className="text-slate-300 text-[10px]">{shop.date}</p>
                  </div>
                </a>
              ))}
            </div>

            {/* Partner spotlights mini */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <h4 className="text-slate-900 font-bold text-sm mb-3">🤝 Recent Partner Spotlights</h4>
              <div className="grid grid-cols-2 gap-2">
                {PARTNER_SPOTLIGHTS.slice(0, 6).map(p => (
                  <a key={p.partner} href="https://community.arc.io" target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-100 hover:border-violet-200 hover:bg-violet-50/30 transition-colors group">
                    <span className="text-base">{p.icon}</span>
                    <div>
                      <p className="text-slate-800 text-xs font-bold group-hover:text-violet-700 transition-colors">{p.partner}</p>
                      <p className="text-slate-400 text-[9px]">{p.date}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
