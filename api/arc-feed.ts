// api/arc-feed.ts
// Fetches latest content from community.arc.io and arc.io/blog
// Cached at Vercel edge for 1 hour (s-maxage=3600)

import type { VercelRequest, VercelResponse } from '@vercel/node'

export interface FeedItem {
  type: string
  title: string
  date: string
  views: string
  icon: string
  url: string
}

// ── Icon map by content type ──────────────────────────────────────────────────
function iconFor(type: string, title: string): string {
  const t = (type + title).toLowerCase()
  if (t.includes('prediction market')) return '🎯'
  if (t.includes('agentic') || t.includes('agent') || t.includes('ai')) return '🤖'
  if (t.includes('lend') || t.includes('borrow') || t.includes('credit')) return '🏦'
  if (t.includes('turnkey') || t.includes('wallet') || t.includes('signing')) return '🔑'
  if (t.includes('crosschain') || t.includes('bridge') || t.includes('li.fi') || t.includes('lifi')) return '🌉'
  if (t.includes('grant')) return '🎟️'
  if (t.includes('dynamic')) return '⚡'
  if (t.includes('treasury')) return '🏛️'
  if (t.includes('stablecoin') || t.includes('stablecorp') || t.includes('qcad')) return '💵'
  if (t.includes('quantum')) return '🔐'
  if (t.includes('settlement') || t.includes('capital market')) return '📊'
  if (t.includes('tokeniz') || t.includes('rwa')) return '🏗️'
  if (t.includes('payment') || t.includes('cross-border')) return '💸'
  if (t.includes('fx') || t.includes('forex')) return '💱'
  if (t.includes('blueprint')) return '📐'
  if (t.includes('whitepaper')) return '📄'
  if (t.includes('app kit') || t.includes('sdk')) return '🛠️'
  if (t.includes('open source') || t.includes('node') || t.includes('bug bounty')) return '💻'
  if (t.includes('hackathon')) return '🏆'
  if (t.includes('video') || t.includes('replay')) return '🎥'
  if (t.includes('house') || t.includes('architect')) return '🏠'
  if (t.includes('morpho')) return '🌀'
  if (t.includes('defi') || t.includes('institutional')) return '📈'
  return '📝'
}

// ── Parse community.arc.io HTML ───────────────────────────────────────────────
async function fetchCommunity(): Promise<FeedItem[]> {
  const items: FeedItem[] = []

  try {
    // Fetch blogs
    const blogHtml = await fetch('https://community.arc.io/en/home/blogs', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArcEcosystem/1.0)' },
      signal: AbortSignal.timeout(8000),
    }).then(r => r.text())

    // Extract blog items — look for slug patterns
    const blogSlugs = blogHtml.match(/\/en\/public\/blogs\/[a-z0-9-]+/g) ?? []
    const blogTitles = [...blogHtml.matchAll(/class="[^"]*title[^"]*"[^>]*>\s*([^<]{10,120})/gi)].map(m => m[1].trim())

    // Extract dates like "May 21st, 2026" or "May 21, 2026"
    const blogDates = [...blogHtml.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}/gi)].map(m => m[0].replace(/(\d+)(st|nd|rd|th)/, '$1'))

    // Extract view counts
    const blogViews = [...blogHtml.matchAll(/([\d,.]+[KkMm]?)\s*(?:views?|Views?)/gi)].map(m => m[1])

    const seenBlogSlugs = new Set<string>()
    for (let i = 0; i < Math.min(blogSlugs.length, 12); i++) {
      const slug = blogSlugs[i]
      if (seenBlogSlugs.has(slug)) continue
      seenBlogSlugs.add(slug)
      const title = blogTitles[i] ?? slug.split('/').pop()!.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-/g, ' ')
      const titleClean = title.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      items.push({
        type: 'Blog',
        title: titleClean,
        date: blogDates[i] ?? '',
        views: blogViews[i] ?? '',
        icon: iconFor('blog', titleClean),
        url: `https://community.arc.io${slug}`,
      })
    }

    // Fetch videos
    const videoHtml = await fetch('https://community.arc.io/en/home/videos', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArcEcosystem/1.0)' },
      signal: AbortSignal.timeout(8000),
    }).then(r => r.text())

    const videoSlugs = videoHtml.match(/\/en\/public\/videos\/[a-z0-9-]+/g) ?? []
    const videoTitles = [...videoHtml.matchAll(/class="[^"]*title[^"]*"[^>]*>\s*([^<]{10,120})/gi)].map(m => m[1].trim())
    const videoDates = [...videoHtml.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}/gi)].map(m => m[0].replace(/(\d+)(st|nd|rd|th)/, '$1'))
    const videoViews = [...videoHtml.matchAll(/([\d,.]+[KkMm]?)\s*(?:views?|Views?)/gi)].map(m => m[1])

    const seenVideoSlugs = new Set<string>()
    for (let i = 0; i < Math.min(videoSlugs.length, 8); i++) {
      const slug = videoSlugs[i]
      if (seenVideoSlugs.has(slug)) continue
      seenVideoSlugs.add(slug)
      const title = videoTitles[i] ?? slug.split('/').pop()!.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-/g, ' ')
      const titleClean = title.replace(/&amp;/g, '&').replace(/&#39;/g, "'")
      items.push({
        type: 'Video',
        title: titleClean,
        date: videoDates[i] ?? '',
        views: videoViews[i] ?? '',
        icon: '🎥',
        url: `https://community.arc.io${slug}`,
      })
    }
  } catch {
    // Community fetch failed — fall back to static data below
  }

  return items
}

// ── Parse arc.io/blog ─────────────────────────────────────────────────────────
async function fetchArcBlog(): Promise<FeedItem[]> {
  const items: FeedItem[] = []
  try {
    const html = await fetch('https://www.arc.io/blog', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArcEcosystem/1.0)' },
      signal: AbortSignal.timeout(8000),
    }).then(r => r.text())

    // Extract blog slugs from arc.io/blog
    const slugs = html.match(/\/blog\/[a-z0-9-]{10,}/g) ?? []
    const titles = [...html.matchAll(/<h[23][^>]*>\s*([^<]{15,150})\s*<\/h[23]>/gi)].map(m => m[1].trim())
    const dates  = [...html.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}/gi)].map(m => m[0])
    const types  = [...html.matchAll(/class="[^"]*categor[^"]*"[^>]*>\s*([^<]{3,40})/gi)].map(m => m[1].trim())

    const seen = new Set<string>()
    for (let i = 0; i < Math.min(slugs.length, 10); i++) {
      const slug = slugs[i]
      if (seen.has(slug) || slug === '/blog') continue
      seen.add(slug)
      const title = (titles[i] ?? '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ')
      if (!title || title.length < 10) continue
      const typeRaw = types[i] ?? 'Blog'
      const isBlueprint = title.toLowerCase().includes('blueprint')
      items.push({
        type: isBlueprint ? 'Arc Blueprints' : typeRaw || 'Blog',
        title,
        date: dates[i] ?? '',
        views: '',
        icon: iconFor(typeRaw, title),
        url: `https://www.arc.io${slug}`,
      })
    }
  } catch {
    // ignore
  }
  return items
}

// ── Static fallback (always-correct, correct URLs) ────────────────────────────
const STATIC_FALLBACK: FeedItem[] = [
  { type: 'Blog',         title: 'Stablecorp brings QCAD to Arc, expanding StableFX into Canadian dollars', date: 'May 21, 2026', views: '10.5K', icon: '💵', url: 'https://community.arc.io/en/public/blogs/stablecorp-brings-qcad-to-arc-expanding-stablefx-into-canadian-dollars-2026-05-21' },
  { type: 'Video',        title: 'Replay: Arc Enterprise & DeFi Hackathon Spotlight: Chariot',               date: 'May 20, 2026', views: '26K',   icon: '🏆', url: 'https://community.arc.io/en/public/videos/replay-arc-enterprise-and-defi-hackathon-spotlight-chariot-crosschain-collateral-lending-protocol-on-arc-2026-05-20' },
  { type: 'Arc Blueprints', title: 'Build Institutional Grade Prediction Markets on Arc',                   date: 'May 15, 2026', views: '20.2K', icon: '🎯', url: 'https://www.arc.io/blog/build-institutional-grade-prediction-markets-on-arc-arc-blueprints' },
  { type: 'Arc Blueprints', title: 'How Arc Supports the Agentic Economy',                                  date: 'May 15, 2026', views: '14K',   icon: '🤖', url: 'https://www.arc.io/blog/how-arc-supports-the-agentic-economy-arc-blueprints' },
  { type: 'Arc Blueprints', title: 'How Arc Supports Lending and Borrowing',                                date: 'May 15, 2026', views: '19K',   icon: '🏦', url: 'https://www.arc.io/blog/how-arc-supports-lending-and-borrowing-arc-blueprints' },
  { type: 'Blog',         title: 'Circle Developer Grants Program Relaunches',                              date: 'May 14, 2026', views: '559',   icon: '🎟️', url: 'https://community.arc.io/en/public/blogs/circle-developer-grants-program-relaunches-2026-05-14' },
  { type: 'Video',        title: 'Circle Developer Grants: From idea to funded',                            date: 'May 14, 2026', views: '480',   icon: '🎥', url: 'https://community.arc.io/en/public/videos/circle-developer-grants-from-idea-to-funded-2026-05-14' },
  { type: 'Blog · Partner', title: 'Arc 🤝 Turnkey: Wallet and signing infrastructure for builders on Arc', date: 'May 13, 2026', views: '533', icon: '🔑', url: 'https://community.arc.io/en/public/blogs/arc-turnkey-wallet-and-signing-infrastructure-for-builders-on-arc' },
  { type: 'Blog · Partner', title: 'Arc 🤝 LI.FI: Crosschain routing and liquidity access for Arc builders', date: 'May 10, 2026', views: '', icon: '🌉', url: 'https://community.arc.io/en/public/blogs/arc-x-lifi-crosschain-routing-and-liquidity-access-for-arc-builders' },
  { type: 'Arc Blueprints', title: 'Introducing the ARC Whitepaper: Coordination Asset',                   date: 'May 11, 2026', views: '',    icon: '📄', url: 'https://www.arc.io/blog/introducing-the-arc-token-whitepaper' },
  { type: 'Blog · Arc Updates', title: 'App Kits: A Suite of SDKs to Build Onchain',                       date: 'Apr 10, 2026', views: '',    icon: '🛠️', url: 'https://www.arc.io/blog/app-kits-a-suite-of-sdks-to-build-onchain' },
  { type: 'Blog · Arc Updates', title: 'Open Sourcing Arc: Run Your Own Node + Bug Bounty',                date: 'Apr 10, 2026', views: '',    icon: '💻', url: 'https://www.arc.io/blog/open-sourcing-arc-run-your-own-arc-node-and-bug-bounty-program' },
  { type: 'Blog · Arc Updates', title: 'Unified Balance Kit: One Integration for Unified USDC Flows',      date: 'Apr 2026',     views: '',    icon: '🔗', url: 'https://www.arc.io/blog/unified-balance-kit-one-integration-for-unified-usdc-flows' },
  { type: 'Blog · Arc Updates', title: "Arc's Quantum-Resistant Design and Roadmap",                       date: 'Apr 4, 2026',  views: '',    icon: '🔐', url: 'https://www.arc.io/blog/arcs-quantum-resistant-design-and-roadmap-why-it-matters' },
  { type: 'Video',        title: 'Event Replay: Introducing Arc House and Architects',                      date: 'Apr 6, 2026',  views: '',    icon: '🏠', url: 'https://community.arc.io/en/home/videos' },
  { type: 'Blog · Partner', title: 'Arc 🤝 Dynamic: Better onboarding for Arc apps',                       date: 'May 6, 2026',  views: '',    icon: '⚡', url: 'https://community.arc.io/en/home/blogs' },
]

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1h edge cache, stale-while-revalidate so users never wait
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600')
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method === 'OPTIONS') return res.status(204).end()

  try {
    // Fetch in parallel
    const [community, blog] = await Promise.allSettled([fetchCommunity(), fetchArcBlog()])

    const communityItems = community.status === 'fulfilled' ? community.value : []
    const blogItems      = blog.status      === 'fulfilled' ? blog.value      : []

    // Merge: community first (has videos + partner posts), then blog-only
    const merged = [...communityItems, ...blogItems]

    // If both sources failed, return static fallback
    const items = merged.length >= 4 ? merged : STATIC_FALLBACK

    return res.status(200).json({ items, source: merged.length >= 4 ? 'live' : 'fallback', fetchedAt: new Date().toISOString() })
  } catch {
    return res.status(200).json({ items: STATIC_FALLBACK, source: 'fallback', fetchedAt: new Date().toISOString() })
  }
}
