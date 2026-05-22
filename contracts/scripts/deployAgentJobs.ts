import { ethers } from 'hardhat'

const USDC = '0x3600000000000000000000000000000000000000'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deploying ArcAgentJobs with:', deployer.address)

  const balance = await ethers.provider.getBalance(deployer.address)
  console.log('Balance (USDC for gas):', ethers.formatUnits(balance, 6), 'USDC')

  const Factory = await ethers.getContractFactory('ArcAgentJobs')
  const contract = await Factory.deploy(USDC)
  await contract.waitForDeployment()

  const addr = await contract.getAddress()
  console.log('\n✅ ArcAgentJobs deployed to:', addr)
  console.log('   ArcScan: https://testnet.arcscan.app/address/' + addr)
  console.log('\nNext step: add to src/config/contracts.ts:')
  console.log(`  export const AGENT_JOBS_ADDRESS = '${addr}' as \`0x\${string}\``)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
