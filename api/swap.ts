// api/swap.ts — Vercel serverless proxy for Circle Stablecoin Kit swap endpoint.
// Circle server-to-server API calls use CIRCLE_API_KEY (TEST_API_KEY:...).
// CIRCLE_KIT_KEY (KIT_KEY:...) is for client-side SDK only — NOT for direct API calls.

import type { VercelRequest, VercelResponse } from '@vercel/node'

const CIRCLE_SWAP_URL = 'https://api.circle.com/v1/stablecoinKits/swap'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Use API Key for server-to-server calls (Circle server APIs require TEST_API_KEY / API_KEY)
  // Fall back to Kit Key if API Key not available
  const apiKey = process.env.CIRCLE_API_KEY || process.env.CIRCLE_KIT_KEY
  if (!apiKey) {
    return res.status(500).json({
      error: 'CIRCLE_KIT_KEY not set — add CIRCLE_API_KEY or CIRCLE_KIT_KEY in Vercel env vars.',
    })
  }

  try {
    const upstream = await fetch(CIRCLE_SWAP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })

    // Forward status + body verbatim
    const text = await upstream.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = { raw: text } }

    // Log errors for debugging
    if (!upstream.ok) {
      console.error(`[api/swap] Circle returned ${upstream.status}:`, text.slice(0, 500))
    }

    return res.status(upstream.status).json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/swap] fetch failed:', err)
    return res.status(502).json({ error: `Proxy fetch failed: ${message}` })
  }
}
