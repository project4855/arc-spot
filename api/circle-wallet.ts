// api/circle-wallet.ts — Circle Developer-Controlled Wallet proxy
// Env vars needed (add to Vercel → Settings → Environment Variables):
//   CIRCLE_API_KEY        = TEST_API_KEY:…  (from console.circle.com → API Keys)
//   CIRCLE_ENTITY_SECRET  = a9d9ef125e0657920e003d3ffa76b2e494f3699b45d5e258633b382f73c5eece
//   CIRCLE_WALLET_SET_ID  = (created on first "create" call — copy from response)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import * as nodeCrypto from 'crypto'

const CIRCLE   = 'https://api.circle.com/v1/w3s'
const CHAIN    = 'ARC-TESTNET'
const USDC_ARK = '0x3600000000000000000000000000000000000000'

function uid() { return nodeCrypto.randomUUID() }

// ── Encrypt entity secret with Circle's current RSA public key ────────────────
async function entityCiphertext(apiKey: string, secret: string): Promise<string> {
  const r = await fetch(`${CIRCLE}/config/entity/publicKey`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!r.ok) throw new Error(`Circle pubkey fetch failed: ${r.status} ${await r.text()}`)
  const { data } = await r.json() as { data: { publicKey: string } }

  const encrypted = nodeCrypto.publicEncrypt(
    { key: data.publicKey, padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(secret, 'hex'),
  )
  return encrypted.toString('base64')
}

// ── Generic Circle API call ───────────────────────────────────────────────────
async function circle(apiKey: string, method: string, path: string, body?: object) {
  const r = await fetch(`${CIRCLE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(json))
  return json
}

// ── Poll for a blockchain txHash (Arc confirms in ~780ms) ─────────────────────
async function pollTxHash(apiKey: string, circleTxId: string, maxMs = 90_000): Promise<string> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const { data } = await circle(apiKey, 'GET', `/transactions/${circleTxId}`) as {
      data: { transaction: { txHash?: string; state: string; errorReason?: string } }
    }
    const tx = data.transaction
    if (tx.txHash && ['CONFIRMED', 'COMPLETE', 'SENT'].includes(tx.state)) return tx.txHash
    if (['FAILED', 'DENIED', 'CANCELLED'].includes(tx.state)) {
      throw new Error(`Circle tx ${tx.state}: ${tx.errorReason ?? ''}`)
    }
    await new Promise(r => setTimeout(r, 1_500))
  }
  throw new Error('Circle tx confirmation timeout (90s)')
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' })

  const apiKey = process.env.CIRCLE_API_KEY?.trim()
  const secret = (process.env.CIRCLE_ENTITY_SECRET ?? 'a9d9ef125e0657920e003d3ffa76b2e494f3699b45d5e258633b382f73c5eece').trim()

  if (!apiKey) return res.status(500).json({
    error: 'CIRCLE_API_KEY not set',
    hint: 'Add TEST_API_KEY:…  from console.circle.com → API Keys → Create to Vercel env',
  })

  const { action, ...p } = (req.body ?? {}) as Record<string, string>

  try {
    const cipher = await entityCiphertext(apiKey, secret)

    // ── create ─────────────────────────────────────────────────────────────────
    if (action === 'create') {
      let walletSetId = process.env.CIRCLE_WALLET_SET_ID

      if (!walletSetId) {
        // First time: create a wallet set and tell the user to save the ID
        const ws = await circle(apiKey, 'POST', '/developer/walletSets', {
          idempotencyKey: uid(),
          entitySecretCiphertext: cipher,
          name: 'Arc Ecosystem — Developer Wallets',
        }) as { data: { walletSet: { id: string } } }
        walletSetId = ws.data.walletSet.id
        return res.status(200).json({
          setup_required: true,
          message: `✅ Wallet set created! Add this to Vercel env and redeploy, then create the wallet again:`,
          env: `CIRCLE_WALLET_SET_ID=${walletSetId}`,
          walletSetId,
        })
      }

      const wResp = await circle(apiKey, 'POST', '/developer/wallets', {
        idempotencyKey: uid(),
        entitySecretCiphertext: cipher,
        walletSetId,
        blockchains: [CHAIN],
        count: 1,
      }) as { data: { wallets: Array<{ id: string; address: string }> } }

      const w = wResp.data.wallets[0]
      return res.status(200).json({ walletId: w.id, address: w.address })
    }

    // ── balance ────────────────────────────────────────────────────────────────
    if (action === 'balance') {
      const { walletId } = p
      if (!walletId) return res.status(400).json({ error: 'walletId required' })
      const data = await circle(apiKey, 'GET', `/wallets/${walletId}/balances`) as {
        data: { tokenBalances: Array<{ token: { symbol: string; decimals: number }; amount: string }> }
      }
      return res.status(200).json(data.data)
    }

    // ── send USDC ──────────────────────────────────────────────────────────────
    if (action === 'send') {
      const { walletId, to, amount } = p
      if (!walletId || !to || !amount) return res.status(400).json({ error: 'walletId, to, amount required' })

      const txResp = await circle(apiKey, 'POST', '/developer/transactions/transfer', {
        idempotencyKey: uid(),
        entitySecretCiphertext: cipher,
        walletId,
        destinationAddress: to,
        amounts: [String(amount)],
        tokenAddress: USDC_ARK,
        blockchain: CHAIN,
        feeLevel: 'MEDIUM',
      }) as { data: { id: string } }

      const txHash = await pollTxHash(apiKey, txResp.data.id)
      return res.status(200).json({ txHash, circleTxId: txResp.data.id })
    }

    // ── execute smart contract ─────────────────────────────────────────────────
    if (action === 'execute') {
      const { walletId, contractAddress, abiFunctionSignature, abiParameters } = p
      if (!walletId || !contractAddress || !abiFunctionSignature) {
        return res.status(400).json({ error: 'walletId, contractAddress, abiFunctionSignature required' })
      }

      const params: string[] = abiParameters
        ? (Array.isArray(abiParameters) ? abiParameters : JSON.parse(abiParameters))
        : []

      const txResp = await circle(apiKey, 'POST', '/developer/transactions/contractExecution', {
        idempotencyKey: uid(),
        entitySecretCiphertext: cipher,
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters: params,
        blockchain: CHAIN,
        feeLevel: 'MEDIUM',
      }) as { data: { id: string } }

      const txHash = await pollTxHash(apiKey, txResp.data.id)
      return res.status(200).json({ txHash, circleTxId: txResp.data.id })
    }

    // ── execute raw calldata (viem-encoded, handles tuples/bytes/arrays) ──────
    if (action === 'executeRaw') {
      const { walletId, contractAddress, callData } = p
      if (!walletId || !contractAddress || !callData) {
        return res.status(400).json({ error: 'walletId, contractAddress, callData required' })
      }

      const txResp = await circle(apiKey, 'POST', '/developer/transactions/contractExecution', {
        idempotencyKey: uid(),
        entitySecretCiphertext: cipher,
        walletId,
        contractAddress,
        callData,
        blockchain: CHAIN,
        feeLevel: 'MEDIUM',
      }) as { data: { id: string } }

      const txHash = await pollTxHash(apiKey, txResp.data.id)
      return res.status(200).json({ txHash, circleTxId: txResp.data.id })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[circle-wallet]', msg)
    return res.status(500).json({ error: msg })
  }
}
