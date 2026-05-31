// api/agent.ts — Autonomous DeFi Agent using Claude tool use
// Receives: { messages, walletAddress, balances, prices }
// Returns:  { reply, action? }

import Anthropic from '@anthropic-ai/sdk'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Token config ─────────────────────────────────────────────────────────────
const TOKEN_ADDR: Record<string, string> = {
  USDC:   '0x3600000000000000000000000000000000000000',
  EURC:   '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
  ARC:    '0x55e1a127e33C4Ccca470Ea9eE8F15683DEf2dCc1',
  QCAD:   '0xf546Bc238F0893eD08586c892f3a111cBFf0d19a',
}
const TOKEN_DEC: Record<string, number> = {
  USDC: 6, EURC: 6, ARC: 6, QCAD: 6, cirBTC: 8,
}
const ARC_SWAP = '0x8C16097F1f9a4B7Fab0497C29D3fC6a85a43C550'
const ARC_RPC  = 'https://rpc.testnet.arc.network'

// ── RPC helper ───────────────────────────────────────────────────────────────
async function ethCall(to: string, data: string): Promise<string> {
  const res = await fetch(ARC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  })
  const json = await res.json() as { result?: string; error?: unknown }
  if (!json.result || json.result === '0x') return '0x0'
  return json.result
}

function encodeGetAmountOut(tIn: string, tOut: string, amt: bigint): string {
  // getAmountOut(address,address,uint256) = 0xb10a6fd6
  const pad = (s: string) => s.toLowerCase().replace('0x','').padStart(64,'0')
  return '0xb10a6fd6' + pad(tIn) + pad(tOut) + amt.toString(16).padStart(64,'0')
}
function encodeLiquidity(token: string): string {
  // liquidity(address) = 0x1090ce62
  return '0x1090ce62' + token.toLowerCase().replace('0x','').padStart(64,'0')
}
function hexToNum(hex: string, decimals: number): number {
  const big = BigInt(hex === '0x' ? '0x0' : hex)
  return Number(big) / Math.pow(10, decimals)
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_wallet_info',
    description: 'Lấy thông tin ví: địa chỉ và số dư tất cả token (USDC, EURC, ARC, cirBTC, QCAD). Dùng khi user hỏi "số dư", "ví của tôi", "tôi có bao nhiêu".',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_token_prices',
    description: 'Lấy giá hiện tại của các cặp token trên Arc Testnet. Dùng khi user hỏi giá.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'check_swap_liquidity',
    description: 'Kiểm tra xem có đủ liquidity trên ArcSwap để thực hiện swap không. Trả về số lượng tối đa có thể swap.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fromToken: { type: 'string', description: 'Token input', enum: ['USDC','EURC','ARC','cirBTC','QCAD'] },
        toToken:   { type: 'string', description: 'Token output', enum: ['USDC','EURC','ARC','cirBTC','QCAD'] },
        amount:    { type: 'number', description: 'Số lượng fromToken muốn swap' },
      },
      required: ['fromToken', 'toToken', 'amount'],
    },
  },
  {
    name: 'prepare_swap',
    description: 'Chuẩn bị lệnh swap token. Sau khi gọi tool này, frontend sẽ hiển thị nút Xác nhận để user ký giao dịch.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fromToken:   { type: 'string', enum: ['USDC','EURC','ARC','cirBTC','QCAD'] },
        toToken:     { type: 'string', enum: ['USDC','EURC','ARC','cirBTC','QCAD'] },
        amount:      { type: 'number', description: 'Số lượng fromToken' },
        expectedOut: { type: 'number', description: 'Số lượng toToken dự kiến nhận được' },
      },
      required: ['fromToken', 'toToken', 'amount', 'expectedOut'],
    },
  },
  {
    name: 'prepare_transfer',
    description: 'Chuẩn bị lệnh chuyển token (USDC, EURC, ARC...) đến địa chỉ ví khác.',
    input_schema: {
      type: 'object' as const,
      properties: {
        toAddress: { type: 'string', description: 'Địa chỉ ví nhận (0x...)' },
        token:     { type: 'string', enum: ['USDC','EURC','ARC','cirBTC','QCAD'] },
        amount:    { type: 'number', description: 'Số lượng token' },
      },
      required: ['toAddress', 'token', 'amount'],
    },
  },
]

const SYSTEM = `Bạn là AI DeFi Agent trên Arc Testnet — blockchain stablecoin-native của Circle.
Bạn có thể giúp người dùng kiểm tra số dư, xem giá, swap token, và chuyển token.

Các token hỗ trợ: USDC (gas token), EURC, ARC, cirBTC (Circle Bitcoin, 8 decimals), QCAD
Swap route: USDC/EURC ↔ Circle Swap Kit | Các cặp khác ↔ ArcSwap contract

Quy tắc:
- Luôn trả lời bằng tiếng Việt, ngắn gọn
- Trước khi prepare_swap/prepare_transfer, hãy check_swap_liquidity trước
- Không thực thi giao dịch nếu số dư không đủ — thông báo rõ cho user
- cirBTC có 8 chữ số thập phân, các token khác 6 chữ số
- Sau khi prepare_swap/prepare_transfer, kết thúc bằng câu "Bấm Xác nhận để thực hiện giao dịch."
`

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel env vars.' })
  }

  const { messages, walletAddress, balances, prices } = req.body as {
    messages: Anthropic.MessageParam[]
    walletAddress: string
    balances: Record<string, number>
    prices: Record<string, number>
  }

  // Context injected as first assistant turn so Claude always knows current state
  const contextNote = `[Context hiện tại]
Ví: ${walletAddress || 'Chưa kết nối'}
Số dư: ${JSON.stringify(balances)}
Giá: ${JSON.stringify(prices)}`

  const allMessages: Anthropic.MessageParam[] = [
    { role: 'user', content: contextNote },
    { role: 'assistant', content: 'Đã nhận thông tin ví và giá hiện tại.' },
    ...messages,
  ]

  // ── Agentic loop ────────────────────────────────────────────────────────────
  let action: Record<string, unknown> | undefined

  try {
    let loopMessages = [...allMessages]
    let finalReply = ''

    for (let i = 0; i < 5; i++) {   // max 5 tool calls
      const resp = await client.messages.create({
        model:      'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system:     SYSTEM,
        tools:      TOOLS,
        messages:   loopMessages,
      })

      // Collect text content
      const textBlocks = resp.content.filter(b => b.type === 'text')
      if (textBlocks.length) finalReply = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('\n')

      // No tool calls → done
      if (resp.stop_reason === 'end_turn') break

      // Process tool calls
      const toolUses = resp.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]
      if (!toolUses.length) break

      // Add assistant message with tool use
      loopMessages.push({ role: 'assistant', content: resp.content })

      // Handle each tool
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const tu of toolUses) {
        let result = ''
        const inp = tu.input as Record<string, unknown>

        if (tu.name === 'get_wallet_info') {
          result = JSON.stringify({ address: walletAddress, balances })
        }
        else if (tu.name === 'get_token_prices') {
          result = JSON.stringify(prices)
        }
        else if (tu.name === 'check_swap_liquidity') {
          const { fromToken, toToken, amount } = inp as { fromToken: string; toToken: string; amount: number }
          const fAddr = TOKEN_ADDR[fromToken]
          const tAddr = TOKEN_ADDR[toToken]
          const fDec  = TOKEN_DEC[fromToken] ?? 6
          const tDec  = TOKEN_DEC[toToken]   ?? 6
          if (!fAddr || !tAddr) { result = `Token không hỗ trợ.`; continue }
          const amtRaw = BigInt(Math.round(amount * Math.pow(10, fDec)))
          try {
            const [outHex, liqHex] = await Promise.all([
              ethCall(ARC_SWAP, encodeGetAmountOut(fAddr, tAddr, amtRaw)),
              ethCall(ARC_SWAP, encodeLiquidity(tAddr)),
            ])
            const expectedOut = hexToNum(outHex, tDec)
            const liquidity   = hexToNum(liqHex, tDec)
            if (expectedOut === 0) {
              result = `Rate chưa set cho cặp ${fromToken}→${toToken}.`
            } else if (liquidity < expectedOut) {
              result = `Không đủ liquidity: cần ${expectedOut.toFixed(tDec === 8 ? 8 : 4)} ${toToken} nhưng pool chỉ có ${liquidity.toFixed(tDec === 8 ? 8 : 4)} ${toToken}.`
            } else {
              result = `OK: ${amount} ${fromToken} → ~${expectedOut.toFixed(tDec === 8 ? 8 : 4)} ${toToken}. Pool còn ${liquidity.toFixed(tDec === 8 ? 8 : 4)} ${toToken}.`
            }
          } catch { result = 'Không thể kiểm tra liquidity (RPC lỗi).'; }
        }
        else if (tu.name === 'prepare_swap') {
          const { fromToken, toToken, amount, expectedOut } = inp as { fromToken: string; toToken: string; amount: number; expectedOut: number }
          action = { type: 'swap', fromToken, toToken, amount, expectedOut }
          result = `Đã chuẩn bị lệnh swap: ${amount} ${fromToken} → ~${expectedOut} ${toToken}`
        }
        else if (tu.name === 'prepare_transfer') {
          const { toAddress, token, amount } = inp as { toAddress: string; token: string; amount: number }
          action = { type: 'transfer', toAddress, token, amount }
          result = `Đã chuẩn bị lệnh chuyển: ${amount} ${token} → ${toAddress}`
        }

        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
      }

      loopMessages.push({ role: 'user', content: toolResults })
    }

    return res.status(200).json({ reply: finalReply, action })
  } catch (e) {
    console.error('[agent]', e)
    return res.status(500).json({ error: String(e) })
  }
}
