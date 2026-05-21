// api/swap.ts — Vercel serverless proxy for Circle Stablecoin Kit swap endpoint.
// The kit key lives in CIRCLE_KIT_KEY (server env, never sent to browser).
// Frontend calls POST /api/swap with the same body it would send to Circle.

import type { VercelRequest, VercelResponse } from '@vercel/node'

const CIRCLE_SWAP_URL = 'https://api.circle.com/v1/stablecoinKits/swap'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const kitKey = process.env.CIRCLE_KIT_KEY
  if (!kitKey) {
    return res.status(500).json({
      error:
        'CIRCLE_KIT_KEY is not set on the server. ' +
        'Add it in Vercel → Project → Settings → Environment Variables ' +
        '(key: CIRCLE_KIT_KEY, value: KIT_KEY:<id>:<secret>). ' +
        'Do NOT use the VITE_ prefix — this variable must remain server-side only.',
    })
  }

  try {
    const upstream = await fetch(CIRCLE_SWAP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kitKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })

    // Forward status + body verbatim
    const text = await upstream.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }

    return res.status(upstream.status).json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/swap] fetch failed:', err)
    return res.status(502).json({ error: `Proxy fetch failed: ${message}` })
  }
}
