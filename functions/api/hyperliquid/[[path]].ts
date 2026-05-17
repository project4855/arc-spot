// Cloudflare Pages Function — proxy cho Hyperliquid API
// Giải quyết CORS khi gọi từ browser

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url)

  // OPTIONS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() })
  }

  // Xác định upstream dựa vào path
  //   /api/hyperliquid/leaderboard → stats-data.hyperliquid.xyz
  //   /api/hyperliquid/trades      → api.hyperliquid.xyz/info  (POST)
  const path = url.pathname.replace(/^\/api\/hyperliquid\/?/, '')

  try {
    let response: Response

    if (path === 'leaderboard') {
      // GET leaderboard từ stats endpoint
      response = await fetch(
        'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard',
        { method: 'GET', headers: { 'Accept': 'application/json' } }
      )
    } else {
      // POST trades / info endpoint
      const body = await context.request.text()
      response = await fetch('https://api.hyperliquid.xyz/info', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    }

    const text = await response.text()
    return new Response(text, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        ...cors(),
      },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Proxy error', detail: String(err) }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...cors() } }
    )
  }
}

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}
