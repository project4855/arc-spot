// ── ArcLending contract ───────────────────────────────────────────────────────
// Set this address after running: cd contracts && npx hardhat run scripts/deployLending.ts --network arc_testnet
export const LENDING_ADDRESS = '' as `0x${string}`

// ── Token addresses on Arc Testnet ────────────────────────────────────────────
// Source: https://docs.arc.io/arc/references/contract-addresses
export const TOKEN_ADDRESSES: Record<string, `0x${string}`> = {
  USDC:   '0x3600000000000000000000000000000000000000',
  EURC:   '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
}

export const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  EURC: 6,
}

// ── ArcLending ABI ────────────────────────────────────────────────────────────
export const LENDING_ABI = [
  // Read
  {
    name: 'getHealthFactor',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getUserPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user',  type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [
      { name: 'supplied',     type: 'uint256' },
      { name: 'borrowed',     type: 'uint256' },
      { name: 'suppliedUSD6', type: 'uint256' },
      { name: 'borrowedUSD6', type: 'uint256' },
    ],
  },
  {
    name: 'getPoolInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'totalSupplied',  type: 'uint256' },
      { name: 'totalBorrowed',  type: 'uint256' },
      { name: 'utilizationBps', type: 'uint256' },
      { name: 'supplyRateBps',  type: 'uint256' },
      { name: 'borrowRateBps',  type: 'uint256' },
      { name: 'priceUSD6',      type: 'uint256' },
    ],
  },
  {
    name: 'getTokenList',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  // Write
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token',  type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token',  type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'borrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token',  type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'repay',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token',  type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  // Events
  {
    name: 'Supplied',
    type: 'event',
    inputs: [
      { name: 'user',   type: 'address', indexed: true },
      { name: 'token',  type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Borrowed',
    type: 'event',
    inputs: [
      { name: 'user',   type: 'address', indexed: true },
      { name: 'token',  type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Withdrawn',
    type: 'event',
    inputs: [
      { name: 'user',   type: 'address', indexed: true },
      { name: 'token',  type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Repaid',
    type: 'event',
    inputs: [
      { name: 'user',   type: 'address', indexed: true },
      { name: 'token',  type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

// ── ERC-20 minimal ABI (for approve + allowance) ──────────────────────────────
export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount',  type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner',   type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
