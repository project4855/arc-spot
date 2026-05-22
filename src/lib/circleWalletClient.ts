// ── circleWalletClient.ts ─────────────────────────────────────────────────────
// Client-side façade for Circle Developer-Controlled Wallets.
// All signing happens server-side via /api/circle-wallet.
// Wallet ID + address are persisted in localStorage.

const API = '/api/circle-wallet'

export interface CircleWalletInfo {
  walletId: string
  address: `0x${string}`
}

const LS_KEY = 'circle_wallet_v1'

// ── Persistence ───────────────────────────────────────────────────────────────

export function saveCircleWallet(info: CircleWalletInfo) {
  localStorage.setItem(LS_KEY, JSON.stringify(info))
  window.dispatchEvent(new Event('circle_wallet_updated'))
}

export function loadCircleWallet(): CircleWalletInfo | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearCircleWallet() {
  localStorage.removeItem(LS_KEY)
  window.dispatchEvent(new Event('circle_wallet_updated'))
}

export function getCircleAddress(): `0x${string}` | null {
  return loadCircleWallet()?.address ?? null
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function post(body: object): Promise<Record<string, unknown>> {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json() as Record<string, unknown>
  if (!r.ok || data.error) throw new Error((data.error as string) ?? `HTTP ${r.status}`)
  return data
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new Circle developer-controlled wallet on Arc Testnet.
 * Returns the wallet info, or throws with a `setup_required` property if
 * CIRCLE_WALLET_SET_ID needs to be added to Vercel env first.
 */
export async function createCircleWallet(): Promise<CircleWalletInfo> {
  const data = await post({ action: 'create' })

  // First-time setup: wallet set just created, user must add env var
  if (data.setup_required) {
    throw Object.assign(
      new Error(data.message as string),
      { setup_required: true, env: data.env as string, walletSetId: data.walletSetId as string },
    )
  }

  const info: CircleWalletInfo = {
    walletId: data.walletId as string,
    address:  data.address as `0x${string}`,
  }
  saveCircleWallet(info)
  return info
}

export interface TokenBalance {
  symbol: string
  amount: string
  decimals: number
}

/** Get USDC / EURC balances for a Circle wallet */
export async function getCircleBalance(walletId: string): Promise<TokenBalance[]> {
  const data = await post({ action: 'balance', walletId })
  const raw = data.tokenBalances as Array<{ token: { symbol: string; decimals: number }; amount: string }>
  return (raw ?? []).map(b => ({
    symbol:   b.token.symbol,
    amount:   b.amount,
    decimals: b.token.decimals,
  }))
}

/** Send USDC from a Circle wallet. Returns the onchain txHash. */
export async function sendCircleUSDC(
  walletId: string,
  to: string,
  amount: string,
): Promise<`0x${string}`> {
  const data = await post({ action: 'send', walletId, to, amount })
  return data.txHash as `0x${string}`
}

/**
 * Execute a smart contract function via Circle signing.
 * Returns the onchain txHash.
 *
 * @param walletId             Circle wallet ID
 * @param contractAddress      Target contract
 * @param abiFunctionSignature e.g. "approve(address,uint256)"
 * @param abiParameters        Array of string-encoded params
 */
export async function circleExecuteContract(
  walletId: string,
  contractAddress: string,
  abiFunctionSignature: string,
  abiParameters: string[],
): Promise<`0x${string}`> {
  const data = await post({
    action: 'execute',
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
  })
  return data.txHash as `0x${string}`
}
