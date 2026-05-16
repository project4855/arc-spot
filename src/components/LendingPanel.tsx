import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useLending } from '../hooks/useLending'
import type { LendingAsset } from '../hooks/useLending'

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
    assets, userSupplies, userBorrows,
    supply, withdraw, borrow, repay,
    totalSuppliedUSD, totalBorrowedUSD, healthFactor, netAPY,
  } = useLending()

  const [modal, setModal] = useState<{ type: ActionType; asset: LendingAsset } | null>(null)
  const [amount, setAmount] = useState('')
  const [done, setDone] = useState(false)

  const openModal = (type: ActionType, asset: LendingAsset) => {
    setModal({ type, asset })
    setAmount('')
    setDone(false)
  }

  const handleConfirm = () => {
    if (!modal || !amount || parseFloat(amount) <= 0) return
    const n = parseFloat(amount)
    if (modal.type === 'supply')   supply(modal.asset.symbol, n)
    if (modal.type === 'withdraw') withdraw(modal.asset.symbol, n)
    if (modal.type === 'borrow')   borrow(modal.asset.symbol, n)
    if (modal.type === 'repay')    repay(modal.asset.symbol, n)
    setDone(true)
    setTimeout(() => { setModal(null); setAmount(''); setDone(false) }, 1400)
  }

  const actionColor: Record<ActionType, string> = {
    supply:   'from-green-600 to-green-500 hover:from-green-500 hover:to-green-400',
    withdraw: 'from-gray-600 to-gray-500 hover:from-gray-500 hover:to-gray-400',
    borrow:   'from-violet-600 to-blue-500 hover:from-violet-500 hover:to-blue-400',
    repay:    'from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400',
  }

  return (
    <div className="flex flex-col gap-4">

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
            <p className="text-red-400 text-[10px] mt-0.5">⚠ Risk of liquidation</p>
          )}
        </div>
      </div>

      {/* ── Markets ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Supply Markets */}
        <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-white font-semibold text-sm">Supply Markets</h3>
            <span className="text-xs text-gray-500">Earn interest on deposits</span>
          </div>

          <div className="grid grid-cols-[1fr_60px_72px_auto] text-xs text-gray-600 px-1">
            <span>Asset</span>
            <span className="text-center">APY</span>
            <span className="text-center">TVL</span>
            <span />
          </div>

          {assets.map((asset) => {
            const mine = userSupplies.find((s) => s.symbol === asset.symbol)
            return (
              <div key={asset.symbol} className="grid grid-cols-[1fr_60px_72px_auto] items-center px-1 py-2 rounded-xl hover:bg-white/5 transition-colors gap-1">
                {/* Asset */}
                <div className="flex items-center gap-2">
                  <span className="text-base w-5 text-center">{asset.icon}</span>
                  <div>
                    <p className="text-white text-xs font-semibold">{asset.symbol}</p>
                    {mine && (
                      <p className="text-green-400 text-[10px]">
                        {mine.amount.toFixed(4)} · {fmtUSD(mine.valueUSD)}
                      </p>
                    )}
                  </div>
                </div>

                {/* APY */}
                <span className="text-green-400 text-xs font-mono text-center">
                  {asset.supplyAPY.toFixed(2)}%
                </span>

                {/* TVL */}
                <span className="text-gray-400 text-xs font-mono text-center">
                  {fmtUSD(asset.totalSupplied)}
                </span>

                {/* Actions */}
                <div className="flex gap-1 justify-end">
                  <button
                    onClick={() => openModal('supply', asset)}
                    className="px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs hover:bg-green-500/20 transition-colors"
                  >
                    Supply
                  </button>
                  {mine && (
                    <button
                      onClick={() => openModal('withdraw', asset)}
                      className="px-2.5 py-1 rounded-lg bg-gray-700/40 border border-gray-700 text-gray-300 text-xs hover:bg-gray-700 transition-colors"
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Borrow Markets */}
        <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-white font-semibold text-sm">Borrow Markets</h3>
            <span className="text-xs text-gray-500">Borrow against collateral</span>
          </div>

          <div className="grid grid-cols-[1fr_60px_72px_auto] text-xs text-gray-600 px-1">
            <span>Asset</span>
            <span className="text-center">APY</span>
            <span className="text-center">Util</span>
            <span />
          </div>

          {assets.map((asset) => {
            const mine = userBorrows.find((b) => b.symbol === asset.symbol)
            return (
              <div key={asset.symbol} className="grid grid-cols-[1fr_60px_72px_auto] items-center px-1 py-2 rounded-xl hover:bg-white/5 transition-colors gap-1">
                {/* Asset */}
                <div className="flex items-center gap-2">
                  <span className="text-base w-5 text-center">{asset.icon}</span>
                  <div>
                    <p className="text-white text-xs font-semibold">{asset.symbol}</p>
                    {mine && (
                      <p className="text-red-400 text-[10px]">
                        {mine.amount.toFixed(4)} · {fmtUSD(mine.valueUSD)}
                      </p>
                    )}
                  </div>
                </div>

                {/* APY */}
                <span className="text-red-400 text-xs font-mono text-center">
                  {asset.borrowAPY.toFixed(2)}%
                </span>

                {/* Utilization bar */}
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-gray-400 text-[10px] font-mono">
                    {(asset.utilization * 100).toFixed(1)}%
                  </span>
                  <div className="w-full h-1 bg-gray-800 rounded-full">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${asset.utilization * 100}%`,
                        backgroundColor: asset.utilization > 0.8 ? '#ef4444' : asset.utilization > 0.6 ? '#f59e0b' : '#8b5cf6',
                      }}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-1 justify-end">
                  <button
                    onClick={() => openModal('borrow', asset)}
                    disabled={totalSuppliedUSD === 0}
                    className="px-2.5 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs hover:bg-violet-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title={totalSuppliedUSD === 0 ? 'Supply collateral first' : ''}
                  >
                    Borrow
                  </button>
                  {mine && (
                    <button
                      onClick={() => openModal('repay', asset)}
                      className="px-2.5 py-1 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs hover:bg-orange-500/20 transition-colors"
                    >
                      Repay
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Connect wallet prompt ── */}
      {!isConnected && (
        <div className="flex flex-col items-center gap-3 py-4 bg-[#0d0e12] border border-gray-800 rounded-2xl">
          <p className="text-gray-400 text-sm">Connect wallet to supply or borrow</p>
          <ConnectButton label="Connect Wallet" />
        </div>
      )}

      {/* ── Info bar ── */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-600 px-1">
        <span>Collateral factors: USDC 90% · EURC 88% · ETH 82% · cirBTC 75% · SOL 70%</span>
        <span>· Simulated on Arc Testnet</span>
      </div>

      {/* ── Modal ── */}
      {modal && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-[#0d0e12] border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-white font-bold text-lg capitalize">{modal.type}</h3>
                <p className="text-gray-500 text-sm">{modal.asset.icon} {modal.asset.name}</p>
              </div>
              <button onClick={() => setModal(null)} className="text-gray-600 hover:text-gray-400 text-xl">✕</button>
            </div>

            {/* APY info */}
            <div className="bg-[#111318] rounded-xl p-3 mb-4 flex justify-between text-sm">
              <span className="text-gray-500">
                {modal.type === 'supply' || modal.type === 'withdraw' ? 'Supply APY' : 'Borrow APY'}
              </span>
              <span className={modal.type === 'supply' || modal.type === 'withdraw' ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                {modal.type === 'supply' || modal.type === 'withdraw'
                  ? `${modal.asset.supplyAPY.toFixed(2)}%`
                  : `${modal.asset.borrowAPY.toFixed(2)}%`}
              </span>
            </div>

            {/* Amount input */}
            <label className="text-gray-400 text-xs block mb-1">Amount ({modal.asset.symbol})</label>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="w-full bg-[#111318] border border-gray-700 focus:border-violet-500 rounded-xl px-4 py-3 text-white text-xl font-mono outline-none transition-colors mb-1"
            />
            {amount && parseFloat(amount) > 0 && (
              <p className="text-gray-600 text-xs mb-3">
                ≈ {fmtUSD(parseFloat(amount) * modal.asset.price)}
              </p>
            )}

            {/* Borrow collateral warning */}
            {modal.type === 'borrow' && (
              <div className="mb-4 p-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs text-yellow-400">
                Collateral factor {(modal.asset.collateralFactor * 100).toFixed(0)}% ·
                Keep health factor above 1.0 to avoid liquidation
              </div>
            )}

            {done ? (
              <div className="py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-medium text-center">
                ✓ {modal.type.charAt(0).toUpperCase() + modal.type.slice(1)} successful!
              </div>
            ) : (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setModal(null)}
                  className="flex-1 py-3 rounded-xl bg-gray-800 text-gray-400 text-sm font-medium hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!isConnected || !amount || parseFloat(amount) <= 0}
                  className={`flex-1 py-3 rounded-xl bg-gradient-to-r ${actionColor[modal.type]} disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-all capitalize`}
                >
                  {modal.type}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
