// AgentPanel.tsx — Autonomous DeFi Agent: chat → plan → confirm → execute on-chain
import { useState, useRef, useEffect } from 'react'
import { useBalance, useReadContract, usePublicClient } from 'wagmi'
import { formatUnits } from 'viem'
import { useWallet } from '../hooks/useWallet'
import { arcTestnet } from '../config/wagmi'
import { useLivePrices } from '../hooks/useLivePrices'
import { ARC_SWAP_ADDRESS, TOKEN_ADDRESSES, TOKEN_DECIMALS } from '../config/contracts'

// ── Types ────────────────────────────────────────────────────────────────────

type Role = 'user' | 'agent' | 'system'
interface ChatMessage { id: string; role: Role; text: string; timestamp: string }
type AgentAction =
  | { type: 'swap';     fromToken: string; toToken: string; amount: number; expectedOut: number }
  | { type: 'transfer'; toAddress: string; token: string;  amount: number }

// ── ABIs ─────────────────────────────────────────────────────────────────────

const ERC20_APPROVE_ABI = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ type: 'bool' }],
}] as const

const ERC20_TRANSFER_ABI = [{
  name: 'transfer', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ type: 'bool' }],
}] as const

const ARC_SWAP_ABI = [{
  name: 'swap', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenIn',  type: 'address' },
    { name: 'tokenOut', type: 'address' },
    { name: 'amountIn', type: 'uint256' },
  ],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}] as const

const ERC20_BAL_ABI = [{
  name: 'balanceOf', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'a', type: 'address' }],
  outputs: [{ type: 'uint256' }],
}] as const

// ── Helpers ──────────────────────────────────────────────────────────────────

const nowTime = () => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const uid     = () => Math.random().toString(36).slice(2)

const SUGGESTIONS = [
  '💰 Số dư ví của tôi',
  '💱 Swap 5 USDC sang ARC',
  '📈 Giá cirBTC là bao nhiêu?',
  '🔄 Đổi 10 ARC sang USDC',
  '💸 Kiểm tra liquidity USDC → cirBTC',
]

// ── Component ────────────────────────────────────────────────────────────────

export default function AgentPanel() {
  const { address, isReady, walletType, chainId, writeContract } = useWallet()
  const isArc = walletType === 'turnkey' || walletType === 'circle' || chainId === arcTestnet.id
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  const { prices } = useLivePrices(15_000)

  // ── Balances ──────────────────────────────────────────────────────────────
  const ZERO = '0x0000000000000000000000000000000000000000' as const
  const { data: nativeBal } = useBalance({ address, chainId: arcTestnet.id, query: { refetchInterval: 10_000 } })
  const { data: eurcRaw  } = useReadContract({ address: TOKEN_ADDRESSES.EURC,   abi: ERC20_BAL_ABI, functionName: 'balanceOf', args: [address ?? ZERO], chainId: arcTestnet.id, query: { enabled: !!address, refetchInterval: 10_000 } })
  const { data: arcRaw   } = useReadContract({ address: TOKEN_ADDRESSES.ARC,    abi: ERC20_BAL_ABI, functionName: 'balanceOf', args: [address ?? ZERO], chainId: arcTestnet.id, query: { enabled: !!address, refetchInterval: 10_000 } })
  const { data: cirBtcRaw} = useReadContract({ address: TOKEN_ADDRESSES.cirBTC, abi: ERC20_BAL_ABI, functionName: 'balanceOf', args: [address ?? ZERO], chainId: arcTestnet.id, query: { enabled: !!address, refetchInterval: 10_000 } })
  const { data: qcadRaw  } = useReadContract({ address: TOKEN_ADDRESSES.QCAD,   abi: ERC20_BAL_ABI, functionName: 'balanceOf', args: [address ?? ZERO], chainId: arcTestnet.id, query: { enabled: !!address, refetchInterval: 10_000 } })

  const balances = {
    USDC:   nativeBal ? parseFloat(formatUnits(nativeBal.value, nativeBal.decimals)) : 0,
    EURC:   eurcRaw   ? parseFloat(formatUnits(eurcRaw   as bigint, 6)) : 0,
    ARC:    arcRaw    ? parseFloat(formatUnits(arcRaw    as bigint, 6)) : 0,
    cirBTC: cirBtcRaw ? parseFloat(formatUnits(cirBtcRaw as bigint, 8)) : 0,
    QCAD:   qcadRaw   ? parseFloat(formatUnits(qcadRaw   as bigint, 6)) : 0,
  }

  // ── Chat state ────────────────────────────────────────────────────────────
  const [messages,  setMessages]  = useState<ChatMessage[]>([{
    id: uid(), role: 'agent', timestamp: nowTime(),
    text: '👋 Xin chào! Tôi là AI Agent DeFi trên Arc Testnet.\n\nTôi có thể giúp bạn:\n• Kiểm tra số dư ví\n• Swap token (USDC, EURC, ARC, cirBTC, QCAD)\n• Chuyển token đến ví khác\n• Xem giá và liquidity\n\nHãy nhập lệnh bằng tiếng Việt hoặc tiếng Anh!',
  }])
  const [input,     setInput]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [pendingAction, setPendingAction] = useState<AgentAction | null>(null)
  const [executing, setExecuting] = useState(false)
  const [txHash,    setTxHash]    = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  // API message history (only user/assistant for Claude)
  const apiHistory = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // ── Send message to agent ─────────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: ChatMessage = { id: uid(), role: 'user', text: text.trim(), timestamp: nowTime() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setPendingAction(null)
    setTxHash(null)

    apiHistory.current.push({ role: 'user', content: text.trim() })

    try {
      const resp = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiHistory.current,
          walletAddress: address ?? 'Chưa kết nối',
          balances,
          prices,
        }),
      })
      const data = await resp.json() as { reply?: string; action?: AgentAction; error?: string }

      if (data.error) throw new Error(data.error)

      const reply = data.reply || '...'
      apiHistory.current.push({ role: 'assistant', content: reply })

      setMessages(prev => [...prev, { id: uid(), role: 'agent', text: reply, timestamp: nowTime() }])
      if (data.action && (data.action.type === 'swap' || data.action.type === 'transfer')) setPendingAction(data.action as AgentAction)
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      setMessages(prev => [...prev, { id: uid(), role: 'system', text: `❌ Lỗi: ${err}`, timestamp: nowTime() }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  // ── Execute confirmed action ───────────────────────────────────────────────
  const executeAction = async () => {
    if (!pendingAction || !address) return
    setExecuting(true)

    const addSys = (text: string) =>
      setMessages(prev => [...prev, { id: uid(), role: 'system', text, timestamp: nowTime() }])

    try {
      if (pendingAction.type === 'swap') {
        const { fromToken, toToken, amount } = pendingAction
        const inAddr  = TOKEN_ADDRESSES[fromToken] as `0x${string}`
        const outAddr = TOKEN_ADDRESSES[toToken]   as `0x${string}`
        const inDec   = TOKEN_DECIMALS[fromToken]  ?? 6
        const amtRaw  = BigInt(Math.round(amount * Math.pow(10, inDec)))

        addSys(`⏳ Đang approve ${fromToken}…`)
        const approveHash = await writeContract({
          address: inAddr, abi: ERC20_APPROVE_ABI, functionName: 'approve',
          args: [ARC_SWAP_ADDRESS, amtRaw],
        })
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: approveHash, confirmations: 1 })
        addSys('✅ Approve thành công')

        addSys(`⏳ Đang swap ${amount} ${fromToken} → ${toToken}…`)
        const swapHash = await writeContract({
          address: ARC_SWAP_ADDRESS, abi: ARC_SWAP_ABI, functionName: 'swap',
          args: [inAddr, outAddr, amtRaw],
        })
        if (publicClient) {
          const rcpt = await publicClient.waitForTransactionReceipt({ hash: swapHash, confirmations: 1 })
          if (rcpt.status === 'reverted') throw new Error('Giao dịch bị revert — kiểm tra liquidity.')
        }
        setTxHash(swapHash)
        addSys(`✅ Swap thành công! Tx: ${swapHash.slice(0, 14)}…`)

        // Report result to agent
        apiHistory.current.push({ role: 'user', content: `Swap đã xác nhận. Tx hash: ${swapHash}` })
        setMessages(prev => [...prev, { id: uid(), role: 'agent', text: `🎉 Đã swap thành công!\nTx: ${swapHash.slice(0,14)}…\n\n[Xem trên ArcScan](https://testnet.arcscan.app/tx/${swapHash})`, timestamp: nowTime() }])
      }
      else if (pendingAction.type === 'transfer') {
        const { toAddress, token, amount } = pendingAction
        const tokenAddr = TOKEN_ADDRESSES[token] as `0x${string}`
        const dec       = TOKEN_DECIMALS[token] ?? 6
        const amtRaw    = BigInt(Math.round(amount * Math.pow(10, dec)))

        addSys(`⏳ Đang chuyển ${amount} ${token}…`)
        const hash = await writeContract({
          address: tokenAddr, abi: ERC20_TRANSFER_ABI, functionName: 'transfer',
          args: [toAddress as `0x${string}`, amtRaw],
        })
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
        setTxHash(hash)
        addSys(`✅ Chuyển thành công! Tx: ${hash.slice(0, 14)}…`)
        setMessages(prev => [...prev, { id: uid(), role: 'agent', text: `🎉 Đã chuyển ${amount} ${token} thành công!\nTx: ${hash.slice(0,14)}…`, timestamp: nowTime() }])
      }

      setPendingAction(null)
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      addSys(`❌ Thất bại: ${err}`)
    } finally {
      setExecuting(false)
    }
  }

  const cancelAction = () => {
    setPendingAction(null)
    setMessages(prev => [...prev, { id: uid(), role: 'system', text: '↩️ Đã huỷ lệnh.', timestamp: nowTime() }])
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto w-full">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 p-4 border-b border-slate-200 bg-white rounded-t-2xl shrink-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center text-white text-lg font-bold shadow-md">
          🤖
        </div>
        <div>
          <h2 className="font-bold text-slate-900 text-base">AI DeFi Agent</h2>
          <p className="text-[11px] text-slate-400">Powered by Claude · Arc Testnet</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${isReady && isArc ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'}`} />
          <span className="text-[11px] text-slate-400">{isReady && isArc ? 'Đã kết nối' : 'Chưa kết nối'}</span>
        </div>
      </div>

      {/* ── Balance chips ── */}
      {isReady && isArc && (
        <div className="flex gap-1.5 px-4 py-2 border-b border-slate-100 bg-slate-50 overflow-x-auto [scrollbar-width:none] shrink-0">
          {Object.entries(balances).map(([sym, bal]) => (
            <span key={sym} className="flex-shrink-0 px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-[10px] font-mono text-slate-600 shadow-sm">
              <span className="font-semibold text-slate-900">{sym}</span>{' '}
              {sym === 'cirBTC' ? bal.toFixed(8) : bal.toFixed(2)}
            </span>
          ))}
        </div>
      )}

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#F8F9FB]">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? '' : 'flex gap-2 items-start'}`}>
              {msg.role !== 'user' && (
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 mt-0.5 ${
                  msg.role === 'agent' ? 'bg-violet-100' : 'bg-amber-100'
                }`}>
                  {msg.role === 'agent' ? '🤖' : '⚙️'}
                </div>
              )}
              <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-violet-600 text-white rounded-br-sm'
                  : msg.role === 'system'
                  ? 'bg-amber-50 border border-amber-200 text-amber-800 text-xs font-mono'
                  : 'bg-white border border-slate-200 text-slate-800 shadow-sm rounded-tl-sm'
              }`}>
                {/* Render markdown links */}
                {msg.text.split(/(\[.*?\]\(.*?\))/g).map((part, i) => {
                  const m = part.match(/\[(.*?)\]\((.*?)\)/)
                  return m ? (
                    <a key={i} href={m[2]} target="_blank" rel="noreferrer" className="text-violet-600 underline">{m[1]}</a>
                  ) : part
                })}
              </div>
              {msg.role !== 'user' && (
                <span className="text-[9px] text-slate-300 mt-1 block ml-1">{msg.timestamp}</span>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="flex gap-2 items-center">
              <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center text-sm">🤖</div>
              <div className="bg-white border border-slate-200 px-3 py-2 rounded-2xl rounded-tl-sm shadow-sm">
                <div className="flex gap-1 items-center h-4">
                  {[0,1,2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Pending action card ── */}
      {pendingAction && !executing && (
        <div className="mx-4 mb-3 p-4 bg-white border-2 border-violet-300 rounded-2xl shadow-lg shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center text-base">
              {pendingAction.type === 'swap' ? '💱' : '💸'}
            </span>
            <span className="font-bold text-slate-900 text-sm">
              {pendingAction.type === 'swap' ? 'Xác nhận Swap' : 'Xác nhận Chuyển'}
            </span>
          </div>

          {pendingAction.type === 'swap' && (
            <div className="flex items-center justify-between mb-4 bg-slate-50 rounded-xl p-3">
              <div className="text-center">
                <p className="text-lg font-bold text-slate-900">{pendingAction.amount}</p>
                <p className="text-xs text-slate-500">{pendingAction.fromToken}</p>
              </div>
              <div className="text-violet-500 text-xl font-bold">→</div>
              <div className="text-center">
                <p className="text-lg font-bold text-emerald-600">
                  ~{pendingAction.toToken === 'cirBTC' ? pendingAction.expectedOut.toFixed(8) : pendingAction.expectedOut.toFixed(4)}
                </p>
                <p className="text-xs text-slate-500">{pendingAction.toToken}</p>
              </div>
            </div>
          )}

          {pendingAction.type === 'transfer' && (
            <div className="mb-4 bg-slate-50 rounded-xl p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Số lượng</span>
                <span className="font-bold text-slate-900">{pendingAction.amount} {pendingAction.token}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Đến</span>
                <span className="font-mono text-xs text-slate-700">{pendingAction.toAddress.slice(0,8)}…{pendingAction.toAddress.slice(-6)}</span>
              </div>
            </div>
          )}

          {!isReady ? (
            <p className="text-xs text-red-500 text-center">Kết nối ví để tiếp tục</p>
          ) : !isArc ? (
            <p className="text-xs text-amber-600 text-center">Chuyển sang Arc Testnet để tiếp tục</p>
          ) : (
            <div className="flex gap-2">
              <button onClick={cancelAction}
                className="flex-1 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
                Huỷ
              </button>
              <button onClick={executeAction}
                className="flex-1 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 transition-colors shadow-sm">
                ✅ Xác nhận
              </button>
            </div>
          )}
        </div>
      )}

      {/* Executing state */}
      {executing && (
        <div className="mx-4 mb-3 p-3 bg-violet-50 border border-violet-200 rounded-2xl flex items-center gap-2 shrink-0">
          <svg className="animate-spin h-4 w-4 text-violet-600 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <span className="text-sm text-violet-700 font-medium">Đang thực hiện giao dịch…</span>
        </div>
      )}

      {/* Tx hash */}
      {txHash && (
        <div className="mx-4 mb-2 shrink-0">
          <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer"
            className="block text-center text-xs text-emerald-600 hover:text-emerald-500 underline underline-offset-2 truncate">
            🔗 Xem giao dịch trên ArcScan ↗
          </a>
        </div>
      )}

      {/* ── Suggestions (show when empty) ── */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => sendMessage(s)}
              className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[12px] text-slate-600 hover:border-violet-300 hover:text-violet-600 transition-colors shadow-sm">
              {s}
            </button>
          ))}
        </div>
      )}

      {/* ── Input ── */}
      <div className="p-3 border-t border-slate-200 bg-white rounded-b-2xl shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
            }}
            placeholder={isReady ? 'Nhập lệnh… (Enter để gửi)' : 'Kết nối ví để sử dụng AI Agent'}
            disabled={loading}
            rows={1}
            className="flex-1 resize-none bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-400 focus:bg-white transition-colors disabled:opacity-50"
            style={{ maxHeight: 100 }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="w-10 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors shrink-0 shadow-sm"
          >
            {loading
              ? <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
              : <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
            }
          </button>
        </div>
        <p className="text-[10px] text-slate-300 text-center mt-1">AI Agent · Chỉ thực thi khi bạn Xác nhận · Testnet only</p>
      </div>

    </div>
  )
}
