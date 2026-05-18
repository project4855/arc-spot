import { ethers } from 'hardhat'

// Arc Testnet USDC address
const USDC = '0x3600000000000000000000000000000000000000'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deploying ArcPerps with:', deployer.address)
  console.log('Balance:', ethers.formatUnits(await ethers.provider.getBalance(deployer.address), 18))

  const Factory = await ethers.getContractFactory('ArcPerps')
  const perps   = await Factory.deploy(USDC)
  await perps.waitForDeployment()

  const addr = await perps.getAddress()
  console.log('\n✅ ArcPerps deployed to:', addr)
  console.log('   Add to src/config/contracts.ts:')
  console.log(`   PERPS_ADDRESS = '${addr}'`)

  // Seed initial prices (BTC, ETH, SOL, ARB, OP, AVAX, MATIC, LINK, DOGE, WIF)
  // Prices with 6 decimals — will be kept live by oracle script
  console.log('\nSetting initial prices...')
  const coins  = ['BTC','ETH','SOL','ARB','OP','AVAX','MATIC','LINK','DOGE','WIF']
  // Approximate prices in USD × 1e6
  const prices = [
    105_000_000_000n,  // BTC  $105,000
      2_500_000_000n,  // ETH    $2,500
        155_000_000n,  // SOL      $155
          1_100_000n,  // ARB     $1.10
          1_200_000n,  // OP      $1.20
         28_000_000n,  // AVAX     $28
            500_000n,  // MATIC   $0.50
         14_000_000n,  // LINK     $14
            130_000n,  // DOGE   $0.13
          1_500_000n,  // WIF     $1.50
  ]

  const tx = await perps.setPrices(coins, prices)
  await tx.wait()
  console.log('✅ Initial prices set')

  // Fund the insurance pool with a small deposit so first trades can be settled
  // (contract owner approves + deposits directly via addMargin or we seed via transfer)
  // The contract holds USDC that winning traders can withdraw — seed with ~10 USDC
  console.log('\nDone! Contract address:', addr)
}

main().catch((e) => { console.error(e); process.exit(1) })
