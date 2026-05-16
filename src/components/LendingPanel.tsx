import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useLendingContract } from '../hooks/useLendingContract'
import type { PoolAsset } from '../hooks/useLendingContract'
import { LENDING_ADDRESS } from '../config/contracts'

type ActionType = 'supply' | 'withdraw' | 'borrow' | 'repay'

function fmtUSD(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function HealthBadge({ factor }: { factor: number }) {
  if (!isFinite(factor)) return <span className="text-gray-400 font-mono font-bold text-xl">∞</span>
  const cls =
    factor >= 2   ? 'text-green-400'  :
    factor >= 1.5 ? 'text-yellow-400' :
    factor >= 1   ? 'text-orange-400' : 'text-red-400'
  return <span className={`font-mono font-bold text-xl ${cls}`}>{factor.toFixed(2)}</span>
}

export default function LendingPanel() {
  const { isConnected } = useAccount()
  const {
    isDeployed,
    assets,
    healthFactor,
    totalSuppliedUSD,
    totalBorrowedUSD,
    netAPY,
    txHash,
    txError,
    txStep,
    executeWithApprove,
    executeDirectly,
    setTxError,
  } = useLendingContract()

  const [modal, setModal] = useState<{ type: ActionType; asset: PoolAsset } | null>(null)
  const [amount, setAmount] = useState('')

  const openModal = (type: ActionType, asset: PoolAsset) => {
    setModal({ type, asset })
    setAmount('')
    setTxError(null)
  }

  const handleConfirm = async () => {
    if (!modal || !amount || parseFloat(amount) <= 0) return
    if (modal.type === 'supply' || modal.type === 'repay') {
      await executeWithApprove(modal.type, modal.asset.symbol, amount)
    } else {
      await executeDirectly(modal.type, modal.asset.symbol, amount)
    }
  }

  const isActing = txStep === 'approving' || txStep === 'sending'
  const isDone   = txStep === 'done'

  // ── Contract not deployed yet ─────────────────────────────────────────────
  if (!isDeployed) {
    return (
      <div className="bg-[#0d0e12] border border-yellow-500/30 rounded-2xl p-8 text-center flex flex-col items-center gap-4">
        <span className="text-4xl">🏗️</span>
        <h3 className="text-white font-bold text-lg">Contract chưa được deploy</h3>
        <p className="text-gray-400 text-sm max-w-md leading-relaxed">
          Smart contract <code className="text-violet-400">ArcLending.sol</code> cần được deploy lên Arc Testnet trước.
          Chạy lệnh sau trong terminal:
        </p>
        <div className="bg-black/40 border border-gray-700 rounded-xl px-6 py-4 text-left w-full max-w-lg">
          <p className="text-gray-500 text-xs mb-2"># 1. Thêm private key vào contracts/.env</p>
          <code className="text-green-400 text-sm block">PRIVATE_KEY=0x...</code>
          <p className="text-gray-500 text-xs mt-3 mb-2"># 2. Deploy contract</p>
          <code className="text-green-400 text-sm block">cd contracts</code>
          <code className="text-green-400 text-sm block">npx hardhat run scripts/deployLending.ts --network arc_testnet</code>
          <p className="text-gray-500 text-xs mt-3 mb-2"># 3. Copy địa chỉ vào</p>
          <code className="text-violet-400 text-sm block">src/config/contracts.ts → LENDING_ADDRESS</code>
        </div>
        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-green-400 hover:underline"
        >
          💧 Lấy testnet USDC để trả phí gas → faucet.circle.com
        </a>
      </div>
    )
  }

  const actionColor: Record<ActionType, string> = {
    supply:   'from-green-600 to-green-500 hover:from-green-500 hover:to-green-400',
    withdraw: 'from-gray-600 to-gray-500 hover:from-gray-500 hover:to-gray-400',
    borrow:   'from-violet-600 to-blue-500 hover:from-violet-500 hover:to-blue-400',
    repay:    'from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400',
  }

  const stepLabel: Record<string, string> = {
    approving: '⏳ Đang approve token...',
    sending:   '⏳ Đang gửi giao dịch...',
    done:      '✓ Thành công!',
    idle:      '',
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── On-chain badge ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-green-500/10 border border-green-500/25">
        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
        <span className="text-green-400 text-sm font-medium">On-chain · Arc Testnet</span>
        <a
          href={`https://testnet.arcscan.app/address/${LENDING_ADDRESS}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs text-green-400/60 hover:text-green-400 underline underline-offset-2"
        >
          {LENDING_ADDRESS.slice(0, 10)}…{LENDING_ADDRESS.slice(-6)} ↗
        </a>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4">
          <p className="text-gray-500 text-xs mb-1">Your Supply</p>
          <p className="text-green-400 text-xl font-bold">{fmtUSD(totalSuppliedUSD)}</p>
        </div>
        <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4">
          <p className="text-gray-500 text-xs mb-1">Your Borrow</p>
          <p className="text-red-400 text-xl font-bold">{fmtUSD(totalBorrowedUSD)}</p>
        </div>
        <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4">
          <p className="text-gray-500 text-xs mb-1">Net APY</p>
          <p className={`text-xl font-bold ${netAPY >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {netAPY >= 0 ? '+' : ''}{netAPY.toFixed(2)}%
          </p>
        </div>
        <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4">
          <p className="text-gray-500 text-xs mb-1">Health Factor</p>
          <HealthBadge factor={healthFactor} />
          {isFinite(healthFactor) && healthFactor < 1.2 && (
            <p className="text-red-400 text-[10px] mt-0.5">⚠ Nguy cơ thanh lý</p>
          )}
        </div>
      </div>

      {/* ── Markets ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Supply Markets */}
        <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-white font-semibold text-sm">Supply Markets</h3>
            <span className="text-xs text-gray-500">Gửi token để nhận lãi</span>
          </div>
          <div className="grid grid-cols-[1fr_60px_80px_auto] text-xs text-gray-600 px-1">
            <span>Token</span><span className="text-center">APY</span>
            <span className="text-center">Total</span><span />
          </div>
          {assets.map((asset) => (
            <div key={asset.symbol} className="grid grid-cols-[1fr_60px_80px_auto] items-center px-1 py-2 rounded-xl hover:bg-white/5 transition-colors gap-1">
              <div className="flex items-center gap-2">
                <span className="text-base w-5 text-center">{asset.icon}</span>
                <div>
                  <p className="text-white text-xs font-semibold">{asset.symbol}</p>
                  {asset.userSupplied > 0 && (
                    <p className="text-green-400 text-[10px]">
                      {asset.userSupplied.toFixed(4)} · {fmtUSD(asset.userSuppliedUSD)}
                    </p>
                  )}
                </div>
              </div>
              <span className="text-green-400 text-xs font-mono text-center">{asset.supplyAPY.toFixed(2)}%</span>
              <span className="text-gray-400 text-xs font-mono text-center">{fmtUSD(asset.totalSupplied * asset.priceUSD)}</span>
              <div className="flex gap-1 justify-end">
                <button
                  onClick={() => openModal('supply', asset)}
                  className="px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs hover:bg-green-500/20 transition-colors"
                >Supply</button>
                {asset.userSupplied > 0 && (
                  <button
                    onClick={() => openModal('withdraw', asset)}
                    className="px-2.5 py-1 rounded-lg bg-gray-700/40 border border-gray-700 text-gray-300 text-xs hover:bg-gray-700 transition-colors"
                  >Withdraw</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Borrow Markets */}
        <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-white font-semibold text-sm">Borrow Markets</h3>
            <span className="text-xs text-gray-500">Vay bằng tài sản thế chấp</span>
          </div>
          <div className="grid grid-cols-[1fr_60px_72px_auto] text-xs text-gray-600 px-1">
            <span>Token</span><span className="text-center">APY</span>
            <span className="text-center">Util</span><span />
          </div>
          {assets.map((asset) => (
            <div key={asset.symbol} className="grid grid-cols-[1fr_60px_72px_auto] items-center px-1 py-2 rounded-xl hover:bg-white/5 transition-colors gap-1">
              <div className="flex items-center gap-2">
                <span className="text-base w-5 text-center">{asset.icon}</span>
                <div>
                  <p className="text-white text-xs font-semibold">{asset.symbol}</p>
                  {asset.userBorrowed > 0 && (
                    <p className="text-red-400 text-[10px]">
                      {asset.userBorrowed.toFixed(4)} · {fmtUSD(asset.userBorrowedUSD)}
                    </p>
                  )}
                </div>
              </div>
              <span className="text-red-400 text-xs font-mono text-center">{asset.borrowAPY.toFixed(2)}%</span>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-gray-400 text-[10px] font-mono">{asset.utilizationPct.toFixed(1)}%</span>
                <div className="w-full h-1 bg-gray-800 rounded-full">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, asset.utilizationPct)}%`,
                      backgroundColor:
                        asset.utilizationPct > 80 ? '#ef4444' :
                        asset.utilizationPct > 60 ? '#f59e0b' : '#8b5cf6',
                    }}
                  />
                </div>
              </div>
              <div className="flex gap-1 justify-end">
                <button
                  onClick={() => openModal('borrow', asset)}
                  disabled={totalSuppliedUSD === 0}
                  title={totalSuppliedUSD === 0 ? 'Supply collateral trước' : ''}
                  className="px-2.5 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs hover:bg-violet-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >Borrow</button>
                {asset.userBorrowed > 0 && (
                  <button
                    onClick={() => openModal('repay', asset)}
                    className="px-2.5 py-1 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs hover:bg-orange-500/20 transition-colors"
                  >Repay</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Connect prompt ── */}
      {!isConnected && (
        <div className="flex flex-col items-center gap-3 py-4 bg-[#0d0e12] border border-gray-800 rounded-2xl">
          <p className="text-gray-400 text-sm">Kết nối ví để supply hoặc borrow</p>
          <ConnectButton label="Connect Wallet" />
        </div>
      )}

      {/* ── Info row ── */}
      <p className="text-xs text-gray-600 px-1">
        Collateral factors: USDC 90% · EURC 88% · Giao dịch thật trên Arc Testnet · Phí gas thanh toán bằng USDC
      </p>

      {/* ── Modal ── */}
      {modal && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => { if (!isActing) setModal(null) }}
        >
          <div
            className="bg-[#0d0e12] border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-white font-bold text-lg capitalize">{modal.type}</h3>
                <p className="text-gray-500 text-sm">{modal.asset.icon} {modal.asset.symbol} · Arc Testnet</p>
              </div>
              {!isActing && (
                <button onClick={() => setModal(null)} className="text-gray-600 hover:text-gray-400 text-xl">✕</button>
              )}
            </div>

            {/* APY */}
            <div className="bg-[#111318] rounded-xl p-3 mb-4 flex justify-between text-sm">
              <span className="text-gray-500">
                {modal.type === 'supply' || modal.type === 'withdraw' ? 'Supply APY' : 'Borrow APY'}
              </span>
              <span className={`font-semibold ${modal.type === 'supply' || modal.type === 'withdraw' ? 'text-green-400' : 'text-red-400'}`}>
                {modal.type === 'supply' || modal.type === 'withdraw'
                  ? `${modal.asset.supplyAPY.toFixed(2)}%`
                  : `${modal.asset.borrowAPY.toFixed(2)}%`}
              </span>
            </div>

            {/* Amount input */}
            <label className="text-gray-400 text-xs block mb-1">Số lượng ({modal.asset.symbol})</label>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
              disabled={isActing}
              className="w-full bg-[#111318] border border-gray-700 focus:border-violet-500 rounded-xl px-4 py-3 text-white text-xl font-mono outline-none transition-colors mb-1 disabled:opacity-50"
            />
            {amount && parseFloat(amount) > 0 && (
              <p className="text-gray-600 text-xs mb-3">
                ≈ {fmtUSD(parseFloat(amount) * modal.asset.priceUSD)}
              </p>
            )}

            {/* Borrow warning */}
            {modal.type === 'borrow' && (
              <div className="mb-4 p-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs text-yellow-400">
                Giữ health factor &gt; 1.0 để tránh bị thanh lý tài sản thế chấp
              </div>
            )}

            {/* Status */}
            {(isActing || isDone) && (
              <div className={`mb-3 p-2.5 rounded-xl text-sm text-center font-medium border ${
                isDone
                  ? 'bg-green-500/10 border-green-500/30 text-green-400'
                  : 'bg-violet-500/10 border-violet-500/30 text-violet-300'
              }`}>
                {stepLabel[txStep]}
                {txHash && !isDone && (
                  <a
                    href={`https://testnet.arcscan.app/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-violet-400/70 hover:text-violet-400 mt-0.5"
                  >
                    {txHash.slice(0, 16)}… ↗ ArcScan
                  </a>
                )}
              </div>
            )}

            {/* Error */}
            {txError && (
              <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400">
                {txError}
              </div>
            )}

            {/* Buttons */}
            {!isDone && (
              <div className="flex gap-2">
                <button
                  onClick={() => setModal(null)}
                  disabled={isActing}
                  className="flex-1 py-3 rounded-xl bg-gray-800 text-gray-400 text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-40"
                >Hủy</button>
                <button
                  onClick={handleConfirm}
                  disabled={!isConnected || !amount || parseFloat(amount) <= 0 || isActing}
                  className={`flex-1 py-3 rounded-xl bg-gradient-to-r ${actionColor[modal.type]} disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-all capitalize`}
                >
                  {isActing
                    ? txStep === 'approving' ? 'Approving…' : 'Sending…'
                    : modal.type}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
