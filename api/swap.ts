// api/swap.ts — Vercel serverless proxy for Circle Stablecoin Kit swap endpoint.
// Circle Stablecoin Kit requires KIT_KEY (not standard API key) as Bearer token.
// Full format: "Authorization: Bearer KIT_KEY:<id>:<secret>"

import type { VercelRequest, VercelResponse } from '@vercel/node'

const CIRCLE_SWAP_URL = 'https://api.circle.com/v1/stablecoinKits/swap'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Kit Key is required for Stablecoin Kit endpoints (full format: KIT_KEY:id:secret)
  const kitKey = process.env.CIRCLE_KIT_KEY
  if (!kitKey) {
    return res.status(500).json({
      error: 'CIRCLE_KIT_KEY not set — add CIRCLE_KIT_KEY in Vercel env vars.',
    })
  }

  try {
    const upstream = await fetch(CIRCLE_SWAP_URL, {
      method: 'POST',
      headers: {
        // Kit Key must be sent as-is with full KIT_KEY: prefix
        Authorization: `Bearer ${kitKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })

    const text = await upstream.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = { raw: text } }

    // Log full response for debugging
    console.log(`[api/swap] Circle ${upstream.status}:`, text.slice(0, 1000))

    return res.status(upstream.status).json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/swap] fetch error:', err)
    return res.status(502).json({ error: `Proxy fetch failed: ${message}` })
  }
}
