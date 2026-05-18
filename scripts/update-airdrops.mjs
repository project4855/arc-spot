/**
 * update-airdrops.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Chạy hàng ngày qua GitHub Actions.
 * 1. Đọc src/data/airdrops.json hiện tại
 * 2. Với mỗi dự án → tìm kiếm trên X API (Bearer Token) + CryptoRank scrape
 * 3. Nếu phát hiện token đã launch → đánh dấu hasToken: true, chuyển sang graduated
 * 4. Tìm dự án mới tiềm năng từ CryptoRank drophunting
 * 5. Ghi lại file JSON (GitHub Action sẽ commit auto)
 */

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir   = dirname(fileURLToPath(import.meta.url))
const DATA    = join(__dir, '..', 'src', 'data', 'airdrops.json')
const X_TOKEN = process.env.X_BEARER_TOKEN ?? ''

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`) }

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// ── X API search ──────────────────────────────────────────────────────────────

const TGE_KEYWORDS = [
  'token launch', 'tge', 'token generation event', 'airdrop live',
  'claim your tokens', 'listing today', 'now live', 'has launched',
  'token is live', 'mainnet token', 'airdrop completed', 'token distributed',
  'airdrop claimed', 'token listed', '$',
]

const NEGATIVE_KEYWORDS = ['upcoming', 'soon', 'rumor', 'predicted', 'might', 'could', 'expected', 'potential']

/**
 * Tìm X tweets cho một dự án.
 * Trả về { hasLaunched: bool, confidence: 'high'|'medium'|'low', tweets: [] }
 */
async function searchX(projectName, xSearch) {
  if (!X_TOKEN) return { hasLaunched: false, confidence: 'low', tweets: [] }

  try {
    const query = encodeURIComponent(
      `(${projectName} token launch OR ${projectName} TGE OR ${projectName} airdrop live) -is:retweet lang:en`
    )

    const url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10&tweet.fields=created_at,public_metrics&sort_order=recency`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${X_TOKEN}` },
    })

    if (!res.ok) {
      log(`X API error for ${projectName}: ${res.status}`)
      return { hasLaunched: false, confidence: 'low', tweets: [] }
    }

    const data = await res.json()
    const tweets = data.data ?? []

    // Phân tích nội dung tweet
    let launchSignals  = 0
    let negativeSignals = 0

    for (const tweet of tweets) {
      const text = tweet.text.toLowerCase()
      const likes = tweet.public_metrics?.like_count ?? 0
      const weight = likes > 500 ? 3 : likes > 100 ? 2 : 1

      for (const kw of TGE_KEYWORDS) {
        if (text.includes(kw)) launchSignals += weight
      }
      for (const kw of NEGATIVE_KEYWORDS) {
        if (text.includes(kw)) negativeSignals++
      }
    }

    const score     = launchSignals - negativeSignals
    const hasLaunched = score >= 4
    const confidence  = score >= 8 ? 'high' : score >= 4 ? 'medium' : 'low'

    return {
      hasLaunched,
      confidence,
      tweets: tweets.slice(0, 3).map((t) => ({
        text: t.text.slice(0, 120),
        likes: t.public_metrics?.like_count ?? 0,
        date:  t.created_at,
      })),
    }
  } catch (err) {
    log(`X search error for ${projectName}: ${err.message}`)
    return { hasLaunched: false, confidence: 'low', tweets: [] }
  }
}

// ── CryptoRank — tìm dự án mới ───────────────────────────────────────────────

async function fetchCryptoRankDropHunting() {
  try {
    // CryptoRank v0 API không cần key, tìm coin chưa trade và có funding
    const res = await fetch(
      'https://api.cryptorank.io/v0/coins?limit=200&isTraded=false&hasFundingRounds=true',
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }
    )
    if (!res.ok) return []

    const json = await res.json()
    const coins = json.data ?? []

    return coins
      .filter((c) => {
        // Chỉ lấy coin chưa trade, có funding, không phải stablecoin
        return c.lifeCycle !== 'traded'
          && c.hasFundingRounds === true
          && c.category !== 'Stablecoin'
      })
      .slice(0, 30)
      .map((c) => ({
        id:        c.key,
        name:      c.name,
        symbol:    c.symbol,
        category:  c.category,
        lifeCycle: c.lifeCycle,
        logo:      c.image?.icon ?? null,
      }))
  } catch (err) {
    log(`CryptoRank fetch error: ${err.message}`)
    return []
  }
}

// ── Telegram alert ────────────────────────────────────────────────────────────

async function sendTelegramAlert(graduates) {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    log('⚠️  Không có TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — bỏ qua Telegram')
    return
  }

  const lines = graduates.map((g) =>
    `✅ *${g.name}* đã phát token\\!\nConfidence: \`${g.confidence}\``
  ).join('\n\n')

  const text = `🪂 *Airdrop Bot Alert\\!*\n\n${lines}\n\n_Phát hiện lúc ${new Date().toLocaleString('vi-VN')}_`

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'MarkdownV2' }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) log('✅ Đã gửi Telegram alert')
    else        log(`❌ Telegram lỗi: ${res.status} ${await res.text()}`)
  } catch (err) {
    log(`❌ Telegram error: ${err.message}`)
  }
}

// ── Discord alert ─────────────────────────────────────────────────────────────

async function sendDiscordAlert(graduates) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL
  if (!webhookUrl) {
    log('⚠️  Không có DISCORD_WEBHOOK_URL — bỏ qua Discord')
    return
  }

  const embeds = graduates.map((g) => ({
    title:       `🚀 ${g.name} đã phát token!`,
    description: `Confidence: **${g.confidence}**`,
    color:       0x00ff88,
    timestamp:   new Date().toISOString(),
    footer:      { text: 'Airdrop Bot · arc-spot-trade' },
  }))

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '🪂 **Airdrop Bot Alert** — Có dự án vừa phát token!',
        embeds,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) log('✅ Đã gửi Discord alert')
    else        log(`❌ Discord lỗi: ${res.status}`)
  } catch (err) {
    log(`❌ Discord error: ${err.message}`)
  }
}

// ── Airdrops.io scrape ────────────────────────────────────────────────────────

async function fetchAirdropsIO() {
  try {
    const res = await fetch('https://airdrops.io/latest/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AirdropBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []

    const html = await res.text()

    // Trích xuất tên dự án từ HTML
    const names = []
    const regex = /class="airdrop-name"[^>]*>([^<]+)<\/[^>]+>/g
    let match
    while ((match = regex.exec(html)) !== null) {
      names.push(match[1].trim())
    }

    return names.slice(0, 20)
  } catch {
    return []
  }
}

// ── DeFiLlama Yields ──────────────────────────────────────────────────────────
// Free API, no auth needed. Returns top yield farming pools.

async function fetchDefiLlamaYields() {
  try {
    log('Fetching DeFiLlama yields...')
    const res = await fetch('https://yields.llama.fi/pools', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      log(`DeFiLlama yields error: ${res.status}`)
      return []
    }

    const json = await res.json()
    const pools = json.data ?? []

    // Lọc pool có TVL > $5M, APY > 3%, không stablecoin-only, không deprecated
    const filtered = pools
      .filter(p =>
        p.tvlUsd >= 5_000_000 &&
        p.apy >= 3 &&
        p.status !== 'dead' &&
        !p.outlier &&
        p.exposure !== 'single' // bỏ single-sided stablecoin vô nghĩa
      )
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 50)

    return filtered.map(p => ({
      pool:        p.pool,
      chain:       p.chain,
      project:     p.project,
      symbol:      p.symbol,
      tvlUsd:      p.tvlUsd,
      apy:         Math.round(p.apy * 100) / 100,
      apyBase:     p.apyBase ?? null,
      apyReward:   p.apyReward ?? null,
      stablecoin:  p.stablecoin ?? false,
      ilRisk:      p.ilRisk ?? 'NO',
      exposure:    p.exposure,
      fetchedAt:   new Date().toISOString(),
    }))
  } catch (err) {
    log(`DeFiLlama fetch error: ${err.message}`)
    return []
  }
}

// ── DappRadar Airdrops ────────────────────────────────────────────────────────
// Public demo key. Returns active airdrop campaigns.

async function fetchDappRadarAirdrops() {
  try {
    log('Fetching DappRadar airdrops...')
    const res = await fetch(
      'https://api.dappradar.com/4tsxo4vuhotaojtl/airdrops?resultsPerPage=25&page=1',
      {
        headers: { Accept: 'application/json', 'X-BLOBR-KEY': '4tsxo4vuhotaojtl' },
        signal: AbortSignal.timeout(15_000),
      }
    )
    if (!res.ok) {
      log(`DappRadar error: ${res.status}`)
      return []
    }

    const json = await res.json()
    const items = json.results ?? json.data?.results ?? []

    return items.slice(0, 25).map(a => ({
      id:          a.id ?? a.slug ?? String(Math.random()),
      name:        a.name ?? a.title ?? 'Unknown',
      logo:        a.logo ?? a.icon ?? null,
      chain:       a.chain ?? a.network ?? null,
      description: (a.description ?? '').slice(0, 200),
      totalValue:  a.totalValue ?? a.total_value ?? null,
      endDate:     a.endDate ?? a.end_date ?? null,
      link:        a.link ?? a.url ?? null,
      type:        a.type ?? 'airdrop',
      fetchedAt:   new Date().toISOString(),
    }))
  } catch (err) {
    log(`DappRadar fetch error: ${err.message}`)
    return []
  }
}

// ── AirdropAlert RSS ──────────────────────────────────────────────────────────
// RSS feed — parse XML manually (no external parser needed)

async function fetchAirdropAlertRSS() {
  try {
    log('Fetching AirdropAlert RSS...')
    const res = await fetch('https://airdropalert.com/feed/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AirdropBot/1.0)' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      log(`AirdropAlert RSS error: ${res.status}`)
      return []
    }

    const xml = await res.text()

    // Parse RSS items from XML
    const items = []
    const itemRegex = /<item>([\s\S]*?)<\/item>/g
    let itemMatch
    while ((itemMatch = itemRegex.exec(xml)) !== null) {
      const block = itemMatch[1]

      const title   = (/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/.exec(block) ?? /<title>([^<]+)<\/title>/.exec(block))?.[1]?.trim() ?? ''
      const link    = (/<link>([^<]+)<\/link>/.exec(block))?.[1]?.trim() ?? ''
      const pubDate = (/<pubDate>([^<]+)<\/pubDate>/.exec(block))?.[1]?.trim() ?? ''
      const desc    = (/<description><!\[CDATA\[([^\]]+)\]\]><\/description>/.exec(block) ?? /<description>([^<]+)<\/description>/.exec(block))?.[1]?.trim().replace(/<[^>]+>/g, '').slice(0, 200) ?? ''

      if (title) {
        items.push({ title, link, pubDate, description: desc, fetchedAt: new Date().toISOString() })
      }
    }

    log(`AirdropAlert RSS: ${items.length} items`)
    return items.slice(0, 20)
  } catch (err) {
    log(`AirdropAlert RSS error: ${err.message}`)
    return []
  }
}

// ── CryptoRank Funding Rounds ─────────────────────────────────────────────────
// v0 API — no auth needed

async function fetchCryptoRankFunding() {
  try {
    log('Fetching CryptoRank funding rounds...')
    const res = await fetch(
      'https://api.cryptorank.io/v0/funds/fundingrounds?limit=30&sortBy=date&order=desc',
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      }
    )
    if (!res.ok) {
      log(`CryptoRank funding error: ${res.status}`)
      return []
    }

    const json = await res.json()
    const rounds = json.data ?? []

    return rounds.slice(0, 30).map(r => ({
      id:          r.id ?? String(r.coinKey ?? Math.random()),
      coinName:    r.coinName ?? r.name ?? 'Unknown',
      coinKey:     r.coinKey ?? null,
      symbol:      r.symbol ?? null,
      logo:        r.coin?.image?.icon ?? null,
      amount:      r.amount ?? null,
      amountUsd:   r.amountUsd ?? r.amount ?? null,
      stage:       r.stage ?? r.type ?? null,
      date:        r.date ?? null,
      investors:   (r.investors ?? []).slice(0, 5).map(i => i.name ?? i).filter(Boolean),
      category:    r.category ?? null,
      isTraded:    r.isTraded ?? false,
      fetchedAt:   new Date().toISOString(),
    }))
  } catch (err) {
    log(`CryptoRank funding error: ${err.message}`)
    return []
  }
}

// ── CoinGecko verify ──────────────────────────────────────────────────────────
// Nguồn đáng tin nhất: nếu coin có market_cap_rank → đang được trade thật sự
// Free API, không cần key, phát hiện cả token chỉ list CEX (Binance/Coinbase/OKX)
// Rate limit: ~50 req/min (free tier)

async function checkCoinGecko(project) {
  if (project.cgSkip) return { hasToken: false, source: 'skipped' }

  const searchTerm = project.cgSearch ?? project.name

  try {
    const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(searchTerm)}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })

    if (!res.ok) {
      log(`  CoinGecko ${res.status} for ${project.name}`)
      return { hasToken: false, source: `gecko-${res.status}` }
    }

    const { coins = [] } = await res.json()
    if (!coins.length) return { hasToken: false, source: 'gecko-no-results' }

    // Tìm coin khớp: ưu tiên symbol match, sau đó exact name match
    const match = coins.find(c => {
      const symMatch  = project.symbol && c.symbol?.toUpperCase() === project.symbol.toUpperCase()
      const nameLevel = nameMatchLevel(project.name, c.name ?? '')
      return symMatch || nameLevel === 'exact'
    })

    if (!match) return { hasToken: false, source: 'gecko-no-match' }

    // Không có market_cap_rank → coin chưa có market data (prelaunch/untracked)
    if (!match.market_cap_rank) {
      log(`  🔍 CoinGecko: "${match.name}" $${match.symbol} — no market rank (prelaunch?)`)
      return { hasToken: false, source: 'gecko-no-rank' }
    }

    // Rank ≤ 500 → top coin, rất chắc chắn (Binance/Coinbase/OKX listing)
    // Rank ≤ 2000 → mid-tier, đáng tin
    // Rank > 2000 → quá thấp, nguy cơ scam trùng tên → bỏ qua
    if (match.market_cap_rank > 2000) {
      log(`  🔍 CoinGecko: "${match.name}" rank #${match.market_cap_rank} — quá thấp, bỏ qua`)
      return { hasToken: false, source: 'gecko-rank-too-low' }
    }

    const confidence = match.market_cap_rank <= 500 ? 'high' : 'medium'
    log(`  ✅ CoinGecko: "${match.name}" $${match.symbol} rank #${match.market_cap_rank} | conf=${confidence}`)

    return {
      hasToken:       true,
      coinSymbol:     match.symbol?.toUpperCase(),
      coinName:       match.name,
      marketCapRank:  match.market_cap_rank,
      confidence,
      source:         'coingecko',
    }
  } catch (err) {
    log(`  CoinGecko error for ${project.name}: ${err.message}`)
    return { hasToken: false, source: 'gecko-exception' }
  }
}

// ── Helpers matching ─────────────────────────────────────────────────────────

/**
 * So sánh tên — tránh false positive như "MetaMask" vs "MetaMask USD"
 * Trả về: 'exact' | 'close' | null
 */
function nameMatchLevel(projectName, coinName) {
  const norm    = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const strip   = s => s.replace(/\b(labs?|network|exchange|protocol|finance|foundation)\b/gi, '').trim()

  const a  = norm(projectName)
  const b  = norm(coinName)
  if (a === b) return 'exact'

  // So sánh tên rút gọn (bỏ "Labs", "Network"...) — VD: "0G Labs" vs "0G"
  const as = norm(strip(projectName))
  const bs = norm(strip(coinName))
  if (as && bs && as === bs) return 'exact'

  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
  if (ratio >= 0.85 && (a.startsWith(b) || b.startsWith(a))) return 'close'
  return null
}

// ── DexScreener verify ────────────────────────────────────────────────────────
// Hoàn toàn miễn phí, không cần key, rate limit ~300 req/min
// Tìm token đang được trade thật sự trên DEX

async function checkDexScreener(project) {
  if (project.cgSkip) return { hasToken: false, source: 'skipped' }

  // Ưu tiên: cgSearch > symbol > tên rút gọn (bỏ "Labs", "Network", "Exchange")
  const shortName  = project.name.replace(/\b(labs?|network|exchange|protocol|finance|foundation)\b/gi, '').trim()
  const searchTerm = project.cgSearch ?? project.symbol ?? shortName

  try {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(searchTerm)}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })

    if (!res.ok) return { hasToken: false, source: `dex-error-${res.status}` }

    const { pairs = [] } = await res.json()
    if (!pairs.length) return { hasToken: false, source: 'dex-no-pairs' }

    // Tìm pair khớp tên/symbol của project
    const match = pairs.find(p => {
      const base = p.baseToken
      const symMatch  = project.symbol && base.symbol?.toUpperCase() === project.symbol.toUpperCase()
      const nameLevel = nameMatchLevel(project.name, base.name ?? '')
      return symMatch || nameLevel === 'exact'
    })

    if (!match) return { hasToken: false, source: 'dex-no-match' }

    // Cần volume 24h > $10K để xác nhận đang trade thật (loại scam/test token)
    const vol24h = match.volume?.h24 ?? 0
    const liq    = match.liquidity?.usd ?? 0

    // Ngưỡng tối thiểu: phải có volume VÀ thanh khoản thực
    if (vol24h < 10_000 && liq < 100_000) {
      log(`  🔍 DexScreener: ${match.baseToken.symbol} vol=$${vol24h.toFixed(0)} liq=$${liq.toFixed(0)} — quá thấp`)
      return { hasToken: false, source: 'dex-low-volume' }
    }

    // Sanity check: nếu vol >>> liq → scam / wash-trading (VD: MetaMask meme vol=$7M liq=$1K)
    if (liq > 0 && vol24h > liq * 5) {
      log(`  🚨 DexScreener: $${match.baseToken.symbol} vol/liq = ${(vol24h/liq).toFixed(0)}x — nghi scam/wash-trade, bỏ qua`)
      return { hasToken: false, source: 'dex-suspicious-ratio' }
    }

    // Yêu cầu tối thiểu liq $100K để tránh token nhỏ lẻ trùng tên
    if (liq < 100_000) {
      log(`  🔍 DexScreener: $${match.baseToken.symbol} liq=$${liq.toFixed(0)} < $100K — quá nhỏ`)
      return { hasToken: false, source: 'dex-low-liquidity' }
    }

    const confidence = (vol24h >= 50_000 && liq >= 500_000) || liq >= 2_000_000 ? 'high' : 'medium'
    log(`  ✅ DexScreener: $${match.baseToken.symbol} vol24h=$${(vol24h/1000).toFixed(0)}K liq=$${(liq/1000).toFixed(0)}K | conf=${confidence}`)

    return {
      hasToken:    true,
      coinSymbol:  match.baseToken.symbol,
      coinName:    match.baseToken.name,
      vol24h,
      liquidity:   liq,
      dexId:       match.dexId,
      chainId:     match.chainId,
      confidence,
      source:      'dexscreener',
    }
  } catch (err) {
    log(`  DexScreener error for ${project.name}: ${err.message}`)
    return { hasToken: false, source: 'dex-exception' }
  }
}

// ── CoinPaprika verify ────────────────────────────────────────────────────────
// Hoàn toàn miễn phí, không cần key, rate limit ~150 req/min

async function checkCoinPaprika(project) {
  if (project.cgSkip) return { hasToken: false, source: 'skipped' }

  const searchTerm = project.cgSearch ?? project.name

  try {
    const url = `https://api.coinpaprika.com/v1/search?q=${encodeURIComponent(searchTerm)}&limit=10&categories=currencies`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })

    if (!res.ok) return { hasToken: false, source: `paprika-error-${res.status}` }

    const { currencies = [] } = await res.json()
    if (!currencies.length) return { hasToken: false, source: 'paprika-no-results' }

    // Tìm match tên hoặc symbol
    const match = currencies.find(c => {
      const symMatch  = project.symbol && c.symbol?.toUpperCase() === project.symbol.toUpperCase()
      const nameLevel = nameMatchLevel(project.name, c.name ?? '')
      return symMatch || nameLevel === 'exact'
    })

    if (!match) return { hasToken: false, source: 'paprika-no-match' }

    // is_active = đang được trade
    if (!match.is_active) {
      log(`  🔍 CoinPaprika: "${match.name}" — inactive`)
      return { hasToken: false, source: 'paprika-inactive' }
    }

    // Rank phải hợp lý — tránh coin scam trùng tên
    const rankLimit = project.symbol ? 2000 : 1000
    if (match.rank && match.rank > rankLimit) {
      log(`  🔍 CoinPaprika: "${match.name}" rank #${match.rank} — vượt ngưỡng, bỏ qua`)
      return { hasToken: false, source: 'paprika-rank-too-low' }
    }

    const confidence = (match.rank && match.rank <= 300) ? 'high' : 'medium'
    log(`  ✅ CoinPaprika: "${match.name}" $${match.symbol} rank #${match.rank} | conf=${confidence}`)

    return {
      hasToken:   true,
      coinSymbol: match.symbol,
      coinName:   match.name,
      rank:       match.rank,
      confidence,
      source:     'coinpaprika',
    }
  } catch (err) {
    log(`  CoinPaprika error for ${project.name}: ${err.message}`)
    return { hasToken: false, source: 'paprika-exception' }
  }
}

// ── Combined verify (DexScreener + CoinPaprika + CoinGecko) ──────────────────
// 3 nguồn song song:
//   • DexScreener  — token có DEX liquidity ≥ $100K (on-chain proof)
//   • CoinPaprika  — rank-based, covers các token lớn
//   • CoinGecko    — market_cap_rank, phát hiện token chỉ list CEX (Binance/Coinbase/OKX)
//                    → Giải quyết vấn đề bỏ sót $SONE/$KAR/$SYMB

async function checkTokenStatus(project) {
  // Chạy song song cả 3 nguồn miễn phí, không cần API key
  const [dex, paprika, gecko] = await Promise.all([
    checkDexScreener(project),
    checkCoinPaprika(project),
    checkCoinGecko(project),
  ])

  // ── Ưu tiên CoinGecko high confidence (rank ≤ 500) ──
  // Lý do: CoinGecko là nguồn aggregator đáng tin nhất, bắt được cả CEX-only tokens
  if (gecko.hasToken && gecko.confidence === 'high') {
    return {
      hasToken:       true,
      confidence:     'high',
      coinSymbol:     gecko.coinSymbol ?? dex.coinSymbol ?? paprika.coinSymbol,
      marketCapRank:  gecko.marketCapRank,
      sources:        ['coingecko', dex.hasToken ? 'dexscreener' : null, paprika.hasToken ? 'coinpaprika' : null].filter(Boolean),
      details:        { dex, paprika, gecko },
    }
  }

  // ── Cả 3 nguồn xác nhận → cực kỳ chắc chắn ──
  if (dex.hasToken && paprika.hasToken && gecko.hasToken) {
    return {
      hasToken:       true,
      confidence:     'high',
      coinSymbol:     dex.coinSymbol ?? paprika.coinSymbol ?? gecko.coinSymbol,
      marketCapRank:  gecko.marketCapRank,
      sources:        ['dexscreener', 'coinpaprika', 'coingecko'],
      details:        { dex, paprika, gecko },
    }
  }

  // ── 2 nguồn bất kỳ xác nhận (có DexScreener hoặc CoinPaprika) → high ──
  if (dex.hasToken && paprika.hasToken) {
    return {
      hasToken:       true,
      confidence:     'high',
      coinSymbol:     dex.coinSymbol ?? paprika.coinSymbol,
      marketCapRank:  gecko.marketCapRank ?? null,
      sources:        ['dexscreener', 'coinpaprika'],
      details:        { dex, paprika, gecko },
    }
  }

  // ── 1 nguồn high confidence ──
  if (dex.hasToken && dex.confidence === 'high')
    return { hasToken: true, confidence: 'high', coinSymbol: dex.coinSymbol, marketCapRank: gecko.marketCapRank ?? null, sources: ['dexscreener'], details: { dex, paprika, gecko } }
  if (paprika.hasToken && paprika.confidence === 'high')
    return { hasToken: true, confidence: 'high', coinSymbol: paprika.coinSymbol, marketCapRank: gecko.marketCapRank ?? null, sources: ['coinpaprika'], details: { dex, paprika, gecko } }

  // ── CoinGecko medium (rank 501-2000) → cần X API xác nhận thêm ──
  if (gecko.hasToken && gecko.confidence === 'medium') {
    return {
      hasToken:       true,
      confidence:     'medium',
      coinSymbol:     gecko.coinSymbol ?? dex.coinSymbol ?? paprika.coinSymbol,
      marketCapRank:  gecko.marketCapRank,
      sources:        ['coingecko'],
      needsXVerify:   true,
      details:        { dex, paprika, gecko },
    }
  }

  // ── 1 nguồn medium → cần X API verify ──
  if (dex.hasToken || paprika.hasToken) {
    return {
      hasToken:     true,
      confidence:   'medium',
      coinSymbol:   dex.coinSymbol ?? paprika.coinSymbol,
      sources:      [dex.hasToken ? 'dexscreener' : 'coinpaprika'],
      needsXVerify: true,
      details:      { dex, paprika, gecko },
    }
  }

  return { hasToken: false, sources: [], details: { dex, paprika, gecko } }
}

// ── Kiểm tra từng dự án hiện tại ─────────────────────────────────────────────

async function checkProjectStatus(project) {
  log(`\nChecking: ${project.name}...`)

  // ① DexScreener + CoinPaprika + CoinGecko song song (miễn phí, không cần key)
  // Delay 1.2s sau mỗi project để tránh rate limit CoinGecko (50 req/min free tier)
  const tokenStatus = await checkTokenStatus(project)
  await sleep(1_200)

  if (tokenStatus.hasToken && !tokenStatus.needsXVerify) {
    // Đủ chắc → graduate ngay
    return {
      hasLaunched:  true,
      confidence:   tokenStatus.confidence,
      source:       tokenStatus.sources.join('+'),
      coinSymbol:   tokenStatus.coinSymbol,
      tweets:       [],
      projectId:    project.id,
    }
  }

  // ② X API — bổ sung khi cần verify thêm hoặc cả 2 API không tìm thấy
  if (X_TOKEN) {
    const needsX = tokenStatus.needsXVerify || !tokenStatus.hasToken
    if (needsX) {
      const xResult = await searchX(project.name, project.xSearch ?? project.name)
      await sleep(3_000)

      // Nếu DexScreener/Paprika đã tìm thấy medium + X API cũng confirm → graduate
      if (tokenStatus.hasToken && tokenStatus.needsXVerify && xResult.hasLaunched) {
        log(`  📣 Double-confirm: onchain+X API → graduate`)
        return {
          hasLaunched: true,
          confidence:  'high',
          source:      `${tokenStatus.sources.join('+')}+x-api`,
          coinSymbol:  tokenStatus.coinSymbol,
          tweets:      xResult.tweets,
          projectId:   project.id,
        }
      }

      // Chỉ X API tìm thấy high confidence (không có onchain proof)
      if (!tokenStatus.hasToken && xResult.hasLaunched && xResult.confidence === 'high') {
        log(`  📣 X API high signal nhưng chưa có onchain proof — skip để tránh false positive`)
      }
    }
  }

  log(`  ✓ ${project.name} → chưa có token`)
  return { hasLaunched: false, confidence: 'low', source: 'clean', tweets: [], projectId: project.id }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('═══ Airdrop Update Job bắt đầu ═══')

  // 1. Đọc dữ liệu hiện tại
  const raw   = readFileSync(DATA, 'utf-8')
  const store = JSON.parse(raw)

  const projects  = store.projects    ?? []
  const graduated = store.graduated   ?? []

  log(`Hiện có ${projects.length} dự án active, ${graduated.length} đã graduated`)

  // 2. Kiểm tra từng dự án — CoinGecko (primary) + X API (secondary)
  const stillActive  = []
  const newGraduated = []

  if (!X_TOKEN) log('⚠️  Không có X_BEARER_TOKEN — dùng DexScreener + CoinPaprika + CoinGecko')

  log(`\n── Bắt đầu verify ${projects.length} dự án ──`)

  for (const project of projects) {
    const status = await checkProjectStatus(project)

    if (status.hasLaunched && status.confidence !== 'low') {
      log(`✅ ${project.name} ĐÃ CÓ TOKEN! source=${status.source} confidence=${status.confidence}`)
      newGraduated.push({
        id:           project.id,
        name:         project.name,
        logo:         project.logo,
        detectedAt:   new Date().toISOString().split('T')[0],
        confidence:   status.confidence,
        source:       status.source,
        coinSymbol:   status.coinSymbol ?? null,
        marketCapRank: status.marketCapRank ?? null,
        evidence:     status.tweets ?? [],
      })
    } else {
      stillActive.push(project)
    }
  }

  // 2b. Gửi alert nếu có dự án mới graduated
  if (newGraduated.length > 0) {
    log(`\n🔔 Phát hiện ${newGraduated.length} dự án mới graduated — gửi alerts...`)
    await Promise.allSettled([
      sendTelegramAlert(newGraduated),
      sendDiscordAlert(newGraduated),
    ])
  }

  // 3. Fetch CryptoRank để xem dự án mới
  log('\nFetch CryptoRank drophunting...')
  const crCoins     = await fetchCryptoRankDropHunting()
  const existingIds = new Set(projects.map((p) => p.id))

  const newSuggestions = crCoins
    .filter((c) => !existingIds.has(c.id))
    .slice(0, 5)

  if (newSuggestions.length > 0) {
    log(`\n📌 CryptoRank gợi ý ${newSuggestions.length} dự án mới cần xem xét:`)
    newSuggestions.forEach((c) => log(`   - ${c.name} (${c.symbol}) [${c.lifeCycle}]`))
  }

  // 4. Fetch airdrops.io
  log('\nFetch airdrops.io...')
  const airdropsIONames = await fetchAirdropsIO()
  if (airdropsIONames.length > 0) {
    log(`airdrops.io có ${airdropsIONames.length} tên: ${airdropsIONames.join(', ')}`)
  }

  // 5. Fetch external data sources (chạy song song để nhanh)
  log('\n── Fetching external data sources ──')
  const [defiLlamaYields, dappRadarAirdrops, airdropAlertItems, cryptorankFunding] =
    await Promise.allSettled([
      fetchDefiLlamaYields(),
      fetchDappRadarAirdrops(),
      fetchAirdropAlertRSS(),
      fetchCryptoRankFunding(),
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : []))

  log(`DeFiLlama yields: ${defiLlamaYields.length} pools`)
  log(`DappRadar airdrops: ${dappRadarAirdrops.length} items`)
  log(`AirdropAlert RSS: ${airdropAlertItems.length} items`)
  log(`CryptoRank funding: ${cryptorankFunding.length} rounds`)

  // Keep previous external data if fetch failed (fallback)
  const prevYields    = store.yields ?? []
  const prevExternal  = store.externalAirdrops ?? []
  const prevFunding   = store.cryptorankFunding ?? []

  // 6. Ghi lại JSON
  const updated = {
    lastUpdated: new Date().toISOString().split('T')[0],
    source:      'Auto-updated daily via GitHub Actions · DexScreener + CoinPaprika + CoinGecko + X API + DeFiLlama + DappRadar + AirdropAlert',
    updateLog: {
      graduatedThisRun:  newGraduated.map((g) => g.name),
      checkedProjects:   projects.length,
      runAt:             new Date().toISOString(),
      xApiUsed:          !!X_TOKEN,
      verificationSources: ['dexscreener', 'coinpaprika', 'coingecko', X_TOKEN ? 'x-api' : null].filter(Boolean),
      newSuggestionsFromCryptoRank: newSuggestions.map((c) => `${c.name} (${c.symbol})`),
      externalFetchCounts: {
        defiLlama:    defiLlamaYields.length,
        dappRadar:    dappRadarAirdrops.length,
        airdropAlert: airdropAlertItems.length,
        cryptorank:   cryptorankFunding.length,
      },
    },
    projects:  stillActive,
    graduated: [
      ...newGraduated,
      ...(graduated.filter((g) => !newGraduated.find((n) => n.id === g.id))),
    ],
    // External live data (updated daily)
    yields:           defiLlamaYields.length  > 0 ? defiLlamaYields  : prevYields,
    externalAirdrops: dappRadarAirdrops.length > 0 ? dappRadarAirdrops : prevExternal,
    airdropAlertFeed: airdropAlertItems.length > 0 ? airdropAlertItems : (store.airdropAlertFeed ?? []),
    cryptorankFunding: cryptorankFunding.length > 0 ? cryptorankFunding : prevFunding,
  }

  writeFileSync(DATA, JSON.stringify(updated, null, 2), 'utf-8')

  log(`\n═══ Kết quả ═══`)
  log(`  Active:         ${stillActive.length} dự án`)
  log(`  Graduated:      ${newGraduated.length} dự án mới phát hiện`)
  log(`  DeFiLlama:      ${defiLlamaYields.length} pools`)
  log(`  DappRadar:      ${dappRadarAirdrops.length} airdrops`)
  log(`  AirdropAlert:   ${airdropAlertItems.length} items`)
  log(`  CryptoRank FRs: ${cryptorankFunding.length} funding rounds`)
  log(`  File đã ghi: ${DATA}`)
  log('═══ Done ═══')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
