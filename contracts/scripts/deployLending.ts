import { ethers } from 'hardhat'

// ── Arc Testnet token addresses ────────────────────────────────────────────────
// Source: https://docs.arc.io/arc/references/contract-addresses
const TOKENS = {
  USDC: {
    address:          '0x3600000000000000000000000000000000000000',
    decimals:         6,
    collateralFactor: 9000,       // 90%
    supplyRateBps:    520,        // 5.20% APY
    borrowRateBps:    810,        // 8.10% APY
    priceUSD6:        1_000_000,  // $1.00
    symbol:           'USDC',
  },
  EURC: {
    address:          '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    decimals:         6,
    collateralFactor: 8800,       // 88%
    supplyRateBps:    480,        // 4.80% APY
    borrowRateBps:    750,        // 7.50% APY
    priceUSD6:        1_163_900,  // $1.1639
    symbol:           'EURC',
  },
} as const

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deploying with account:', deployer.address)

  const balance = await ethers.provider.getBalance(deployer.address)
  console.log('Balance (USDC for gas):', ethers.formatUnits(balance, 6), 'USDC')

  // ── Deploy ──────────────────────────────────────────────────────────────────
  console.log('\n📦 Deploying ArcLending...')
  const ArcLending = await ethers.getContractFactory('ArcLending')
  const lending = await ArcLending.deploy()
  await lending.waitForDeployment()

  const contractAddress = await lending.getAddress()
  console.log('✅ ArcLending deployed to:', contractAddress)
  console.log('   View on ArcScan: https://testnet.arcscan.app/address/' + contractAddress)

  // ── Add tokens ──────────────────────────────────────────────────────────────
  for (const [, token] of Object.entries(TOKENS)) {
    console.log(`\n➕ Adding ${token.symbol}...`)
    const tx = await lending.addToken(
      token.address,
      token.decimals,
      token.collateralFactor,
      token.supplyRateBps,
      token.borrowRateBps,
      token.priceUSD6,
      token.symbol
    )
    await tx.wait()
    console.log(`   ✅ ${token.symbol} added (tx: ${tx.hash})`)
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('🎉 Deployment complete!')
  console.log('═══════════════════════════════════════════════════════')
  console.log('Contract address:', contractAddress)
  console.log('\nNext step: copy this address into')
  console.log('  src/config/contracts.ts  →  LENDING_ADDRESS')
  console.log('═══════════════════════════════════════════════════════')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
