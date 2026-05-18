/**
 * update-perps-prices.mjs
 * Fetches live mark prices from Hyperliquid and pushes them on-chain to ArcPerps.
 * Run: node scripts/update-perps-prices.mjs
 * Or: via GitHub Actions cron every 5 minutes.
 */

import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as dotenv from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../contracts/.env') })

// ── Config ────────────────────────────────────────────────────────────────────

const PERPS_ADDRESS = '0xdc0eFcdC43F764903aAC58ba6261D8f05b2244dD'
const ARC_RPC       = 'https://rpc.testnet.arc.network'
const CHAIN_ID      = 5042002

const SUPPORTED_COINS = ['BTC','ETH','SOL','ARB','OP','AVAX','MATIC','LINK','DOGE','WIF']

const PERPS_ABI = parseAbi([
  'function setPrices(string[] coins, uint256[] prices) external',
  'function setFundingRate(string coin, uint256 rate8h, bool longPays) external',
])

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchHLPrices() {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  })
  if (!res.ok) throw new Error(`HL allMids HTTP ${res.status}`)
  return await res.json()  // { BTC: "105000.5", ETH: "2500.1", ... }
}

async function fetchHLFunding() {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  })
  if (!res.ok) throw new Error(`HL meta HTTP ${res.status}`)
  const data = await res.json()
  const universe = data?.[0]?.universe ?? []
  const ctxs     = data?.[1] ?? []
  const map = {}
  universe.forEach((asset, i) => {
    const ctx  = ctxs[i] ?? {}
    const rate = parseFloat(ctx.funding ?? '0')   // 8h rate as decimal
    map[asset.name] = rate
  })
  return map
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not set in contracts/.env')

  const account = privateKeyToAccount(pk)

  const chain = {
    id: CHAIN_ID,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [ARC_RPC] } },
  }

  const publicClient = createPublicClient({ chain, transport: http(ARC_RPC) })
  const walletClient = createWalletClient({ account, chain, transport: http(ARC_RPC) })

  console.log(`[${new Date().toISOString()}] Fetching prices from Hyperliquid...`)

  const [mids, funding] = await Promise.all([fetchHLPrices(), fetchHLFunding()])

  // Build price arrays — prices stored as uint256 with 6 decimals
  const coins  = []
  const prices = []

  for (const coin of SUPPORTED_COINS) {
    const mid = parseFloat(mids[coin] ?? '0')
    if (mid <= 0) { console.warn(`No price for ${coin}, skipping`); continue }
    coins.push(coin)
    prices.push(BigInt(Math.round(mid * 1_000_000)))
  }

  if (coins.length === 0) { console.error('No prices to update'); return }

  console.log('Prices:', coins.map((c, i) => `${c}=$${(Number(prices[i]) / 1e6).toFixed(4)}`).join(' '))

  // Send setPrices transaction
  const hash = await walletClient.writeContract({
    address: PERPS_ADDRESS,
    abi:     PERPS_ABI,
    functionName: 'setPrices',
    args:    [coins, prices],
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`✅ Prices updated  tx=${hash}  block=${receipt.blockNumber}`)

  // Update funding rates (top coins only, skip if 0)
  for (const coin of SUPPORTED_COINS) {
    const rate8h = funding[coin] ?? 0
    if (Math.abs(rate8h) < 0.000001) continue   // skip near-zero
    // Convert to bps: 0.0001 = 1 bps
    const rateBps = Math.abs(Math.round(rate8h * 10_000))
    const longPays = rate8h >= 0
    try {
      const fh = await walletClient.writeContract({
        address:      PERPS_ADDRESS,
        abi:          PERPS_ABI,
        functionName: 'setFundingRate',
        args:         [coin, BigInt(rateBps), longPays],
      })
      await publicClient.waitForTransactionReceipt({ hash: fh })
      console.log(`  Funding ${coin}: ${longPays ? '+' : '-'}${rateBps}bps`)
    } catch (e) {
      console.warn(`  Funding update failed for ${coin}:`, e.shortMessage ?? e.message)
    }
  }

  console.log('Done.')
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
