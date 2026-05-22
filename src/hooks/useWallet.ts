// ── useWallet.ts ──────────────────────────────────────────────────────────────
// Unified wallet hook — works seamlessly with MetaMask / browser wallets (wagmi)
// AND Turnkey HSM. Consumers never need to know which is active.
//
// Priority rule: Turnkey if active, else wagmi.
// Automatic fallback: if Turnkey signing fails (stale credentials, deleted key,
// org mismatch) it clears the stale signer and retries with wagmi if available.

import { useState, useEffect, useCallback } from 'react'
import {
  useAccount,
  useWriteContract,
  useSendTransaction,
  useBalance,
  useReadContract,
} from 'wagmi'
import { encodeFunctionData } from 'viem'
import { getTurnkeyAddress, getTurnkeyWalletClient, clearTurnkeySigner } from '../lib/turnkeySigner'
import { getCircleAddress, loadCircleWallet, circleExecuteContractRaw } from '../lib/circleWalletClient'

// ── Types ─────────────────────────────────────────────────────────────────────

export type WalletType = 'turnkey' | 'circle' | 'wagmi' | 'none'

export interface WriteContractParams {
  address: `0x${string}`
  abi: readonly unknown[]
  functionName: string
  args?: readonly unknown[]
  value?: bigint
  chainId?: number
}

export interface SendTransactionParams {
  to?: `0x${string}`   // optional — omit for contract creation (no `to`)
  value?: bigint
  data?: `0x${string}`
}

// ── Detect Turnkey-specific signing errors ────────────────────────────────────

/** Quota exhausted — credentials are still valid, org just hit free-plan limit. */
function isTurnkeyQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('Resource exhausted') ||
    msg.includes('over its allotted quota') ||
    msg.includes('Signing is disabled') ||
    msg.includes('upgrade to a paid plan')
  )
}

/** Stale/invalid credentials — safe to clear and fall back to wagmi. */
function isTurnkeyCredentialError(err: unknown): boolean {
  if (isTurnkeyQuotaError(err)) return false   // quota is NOT a credential error
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('Turnkey error') ||
    msg.includes('could not find public key') ||
    msg.includes('TurnkeyRequestError') ||
    msg.includes('Failed to sign') ||
    (msg.includes('turnkey') && msg.includes('sign'))
  )
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useWallet() {
  const { address: wagmiAddress, isConnected, chainId } = useAccount()
  const [tkAddress,     setTkAddress]     = useState<`0x${string}` | null>(getTurnkeyAddress())
  const [circleAddress, setCircleAddress] = useState<`0x${string}` | null>(getCircleAddress())

  const { writeContractAsync: wagmiWrite } = useWriteContract()
  const { sendTransactionAsync: wagmiSend } = useSendTransaction()

  // Track Turnkey and Circle wallet login/logout events
  useEffect(() => {
    const tkHandler     = () => setTkAddress(getTurnkeyAddress())
    const circleHandler = () => setCircleAddress(getCircleAddress())
    window.addEventListener('turnkey_signer_ready',  tkHandler)
    window.addEventListener('circle_wallet_updated', circleHandler)
    return () => {
      window.removeEventListener('turnkey_signer_ready',  tkHandler)
      window.removeEventListener('circle_wallet_updated', circleHandler)
    }
  }, [])

  const tkClient = getTurnkeyWalletClient()
  const tkReady     = !!tkAddress && !!tkClient
  const circleReady = !!circleAddress

  // Priority: Turnkey > Circle > wagmi
  const address: `0x${string}` | undefined = tkAddress ?? circleAddress ?? wagmiAddress ?? undefined

  const isReady = tkReady || circleReady || isConnected

  const walletType: WalletType =
    tkReady     ? 'turnkey' :
    circleReady ? 'circle'  :
    isConnected ? 'wagmi'   : 'none'

  const onWrongNetwork = isConnected && !tkReady && !circleReady && chainId !== 5042002

  // ── writeContract ──────────────────────────────────────────────────────────
  const writeContract = useCallback(async (params: WriteContractParams): Promise<`0x${string}`> => {

    // ── Circle Developer-Controlled Wallet ────────────────────────────────────
    if (circleReady && !tkReady) {
      const wallet = loadCircleWallet()
      if (!wallet) throw new Error('Circle wallet not found. Please re-create it in the Wallet tab.')

      // Encode calldata with viem to handle complex types (tuples, bytes, arrays)
      const callData = encodeFunctionData({
        abi: params.abi as Parameters<typeof encodeFunctionData>[0]['abi'],
        functionName: params.functionName,
        args: (params.args ?? []) as Parameters<typeof encodeFunctionData>[0]['args'],
      })

      return circleExecuteContractRaw(wallet.walletId, params.address, callData)
    }

    // ── Turnkey HSM ───────────────────────────────────────────────────────────
    const client = getTurnkeyWalletClient()
    if (client && tkReady) {
      try {
        const data = encodeFunctionData({
          abi: params.abi as Parameters<typeof encodeFunctionData>[0]['abi'],
          functionName: params.functionName,
          args: (params.args ?? []) as Parameters<typeof encodeFunctionData>[0]['args'],
        })
        const hash = await (client as ReturnType<typeof getTurnkeyWalletClient> & {
          sendTransaction: (p: { to: `0x${string}`; data: `0x${string}`; value: bigint }) => Promise<`0x${string}`>
        })!.sendTransaction({
          to: params.address,
          data,
          value: params.value ?? 0n,
        })
        return hash
      } catch (err) {
        // ── Quota exhausted (free plan limit) — keep signer, try MetaMask fallback ──
        if (isTurnkeyQuotaError(err)) {
          console.warn('[useWallet] Turnkey quota exhausted. Trying MetaMask fallback.', err)
          if (isConnected) {
            console.info('[useWallet] Falling back to MetaMask/wagmi…')
            return wagmiWrite(params as Parameters<typeof wagmiWrite>[0])
          }
          throw new Error(
            '📊 Turnkey signing quota exhausted (free plan limit reached).\n\n' +
            'To continue swapping:\n' +
            '• Option 1: Use Circle Wallet in Wallet tab → Circle Wallet (no quota!)\n' +
            '• Option 2: Connect MetaMask in Wallet tab → External Wallet\n' +
            '• Option 3: Upgrade your Turnkey plan at turnkey.com'
          )
        }
        // ── Stale/invalid credentials — clear and fall back to wagmi ──
        if (isTurnkeyCredentialError(err)) {
          console.warn('[useWallet] Turnkey credential error. Clearing signer and falling back to MetaMask.', err)
          clearTurnkeySigner()
          setTkAddress(null)
          if (isConnected) {
            console.info('[useWallet] Retrying with MetaMask/wagmi…')
            return wagmiWrite(params as Parameters<typeof wagmiWrite>[0])
          }
          throw new Error(
            '🔐 Turnkey wallet credentials expired or invalid.\n' +
            'Please go to the Wallet tab → Wallet Infrastructure and re-authenticate.\n\n' +
            `Original error: ${err instanceof Error ? err.message : String(err)}`
          )
        }
        throw err // non-Turnkey error — propagate as-is
      }
    }
    return wagmiWrite(params as Parameters<typeof wagmiWrite>[0])
  }, [tkReady, isConnected, wagmiWrite])

  // ── sendTransaction ────────────────────────────────────────────────────────
  const sendTransaction = useCallback(async (params: SendTransactionParams): Promise<`0x${string}`> => {
    // Circle wallet: use contractExecution with raw calldata
    if (circleReady && !tkReady) {
      const wallet = loadCircleWallet()
      if (!wallet) throw new Error('Circle wallet not found')
      if (!params.to) throw new Error('Circle wallet sendTransaction requires a "to" address')
      // Encode as a raw contract call passing the data hex
      const dataHex = params.data ?? '0x'
      return circleExecuteContractRaw(wallet.walletId, params.to, dataHex as `0x${string}`)
    }

    const client = getTurnkeyWalletClient()
    if (client && tkReady) {
      try {
        return await (client as ReturnType<typeof getTurnkeyWalletClient> & {
          sendTransaction: (p: SendTransactionParams) => Promise<`0x${string}`>
        })!.sendTransaction(params)
      } catch (err) {
        if (isTurnkeyQuotaError(err)) {
          console.warn('[useWallet] Turnkey quota exhausted (sendTransaction). Trying MetaMask fallback.', err)
          if (isConnected) return wagmiSend(params)
          throw new Error(
            '📊 Turnkey signing quota exhausted.\n' +
            'Connect MetaMask in Wallet tab → External Wallet, or upgrade your Turnkey plan at turnkey.com'
          )
        }
        if (isTurnkeyCredentialError(err)) {
          console.warn('[useWallet] Turnkey credential error (sendTransaction). Clearing and falling back.', err)
          clearTurnkeySigner()
          setTkAddress(null)
          if (isConnected) return wagmiSend(params)
          throw new Error(
            '🔐 Turnkey wallet credentials expired.\n' +
            'Please re-authenticate in Wallet tab → Wallet Infrastructure.'
          )
        }
        throw err
      }
    }
    return wagmiSend(params)
  }, [tkReady, isConnected, wagmiSend])

  return {
    // State
    address,
    isConnected: isReady,   // alias for backward compat
    isReady,
    walletType,
    tkReady,
    circleReady,
    onWrongNetwork,
    chainId,
    // Actions
    writeContract,
    sendTransaction,
  }
}

// ── Convenience re-export: balance read (works with either address) ────────────

export function useWalletBalance(chainId?: number) {
  const { address } = useWallet()
  return useBalance({ address, chainId })
}

// ── Convenience re-export: ERC-20 balanceOf ──────────────────────────────────

const BALANCE_ABI = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ type: 'uint256' }],
}] as const

export function useERC20Balance(tokenAddress: `0x${string}`, chainId?: number) {
  const { address } = useWallet()
  return useReadContract({
    address: tokenAddress,
    abi: BALANCE_ABI,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    chainId,
    query: { enabled: !!address },
  })
}
