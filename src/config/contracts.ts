// ── ArcLending contract ───────────────────────────────────────────────────────
export const LENDING_ADDRESS = '0x918C2DD0D65eA2550D0059f93A8D6EC9C76d780a' as `0x${string}`

// ── ArcPerps contract ─────────────────────────────────────────────────────────
// Deployed: 2026-05-19  chain: Arc Testnet (5042002)
export const PERPS_ADDRESS = '0xdc0eFcdC43F764903aAC58ba6261D8f05b2244dD' as `0x${string}`

export const PERPS_COINS = ['BTC','ETH','SOL','ARB','OP','AVAX','MATIC','LINK','DOGE','WIF'] as const

export const PERPS_ABI = [
  // ── Read ──────────────────────────────────────────────────────────────────
  {
    name: 'getPositionInfo',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'positionId', type: 'uint256' }],
    outputs: [
      { name: 'trader',           type: 'address' },
      { name: 'coin',             type: 'string'  },
      { name: 'isLong',           type: 'bool'    },
      { name: 'sizeUsd',          type: 'uint256' },
      { name: 'margin',           type: 'uint256' },
      { name: 'entryPrice',       type: 'uint256' },
      { name: 'leverage',         type: 'uint256' },
      { name: 'isOpen',           type: 'bool'    },
      { name: 'unrealisedPnl',    type: 'int256'  },
      { name: 'liquidationPrice', type: 'uint256' },
      { name: 'liquidatable',     type: 'bool'    },
    ],
  },
  {
    name: 'getUserPositions',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'getMarket',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'coin', type: 'string' }],
    outputs: [
      { name: 'active',        type: 'bool'    },
      { name: 'price',         type: 'uint256' },
      { name: 'fundingIndex',  type: 'int256'  },
      { name: 'fundingRate8h', type: 'uint256' },
      { name: 'longPays',      type: 'bool'    },
      { name: 'openInterest',  type: 'uint256' },
    ],
  },
  {
    name: 'getAllMarkets',
    type: 'function',
    stateMutability: 'view',
    inputs:  [],
    outputs: [
      { name: 'coins',   type: 'string[]'  },
      { name: 'prices',  type: 'uint256[]' },
      { name: 'ois',     type: 'uint256[]' },
      { name: 'rates',   type: 'uint256[]' },
    ],
  },
  // ── Write ─────────────────────────────────────────────────────────────────
  {
    name: 'openPosition',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'coin',     type: 'string'  },
      { name: 'isLong',   type: 'bool'    },
      { name: 'margin',   type: 'uint256' },
      { name: 'leverage', type: 'uint256' },
    ],
    outputs: [{ name: 'positionId', type: 'uint256' }],
  },
  {
    name: 'closePosition',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'positionId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'addMargin',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'positionId', type: 'uint256' },
      { name: 'amount',     type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'liquidate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'positionId', type: 'uint256' }],
    outputs: [],
  },
  // ── Events ────────────────────────────────────────────────────────────────
  {
    name: 'PositionOpened',
    type: 'event',
    inputs: [
      { name: 'id',         type: 'uint256', indexed: true  },
      { name: 'trader',     type: 'address', indexed: true  },
      { name: 'coin',       type: 'string',  indexed: false },
      { name: 'isLong',     type: 'bool',    indexed: false },
      { name: 'sizeUsd',    type: 'uint256', indexed: false },
      { name: 'margin',     type: 'uint256', indexed: false },
      { name: 'entryPrice', type: 'uint256', indexed: false },
      { name: 'leverage',   type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'PositionClosed',
    type: 'event',
    inputs: [
      { name: 'id',         type: 'uint256', indexed: true  },
      { name: 'trader',     type: 'address', indexed: true  },
      { name: 'pnl',        type: 'int256',  indexed: false },
      { name: 'exitPrice',  type: 'uint256', indexed: false },
      { name: 'payout',     type: 'uint256', indexed: false },
    ],
  },
] as const

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
