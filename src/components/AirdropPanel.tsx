// ── AirdropPanel.tsx ──────────────────────────────────────────────────────────
// Chỉ liệt kê dự án CHƯA phát token / chưa airdrop

import { useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = 'L1' | 'L2' | 'DeFi' | 'Infra' | 'BTC Layer' | 'Gaming'
type Status   = 'Testnet' | 'Mainnet Beta' | 'Pre-launch' | 'Points Live'
type Prob     = 'Rất cao' | 'Cao' | 'Trung bình'

interface Step {
  action: string
  detail: string
}

interface AirdropProject {
  id:        string
  name:      string
  logo:      string
  category:  Category
  raised:    string
  investors: string
  status:    Status
  prob:      Prob
  tge?:      string          // dự kiến TGE
  desc:      string
  steps:     Step[]
  links: {
    site:     string
    twitter?: string
    app?:     string
  }
}

// ── Data — chỉ dự án CHƯA có token ───────────────────────────────────────────

const PROJECTS: AirdropProject[] = [
  // ── L1 ──────────────────────────────────────────────────────────────────────
  {
    id: 'monad',
    name: 'Monad',
    logo: '🟣',
    category: 'L1',
    raised: '$244M',
    investors: 'Paradigm, a16z Crypto',
    status: 'Testnet',
    prob: 'Rất cao',
    tge: 'Mainnet 2025',
    desc: 'L1 EVM song song hóa thực thi, 10,000+ TPS. Chưa có token. Backed bởi Paradigm.',
    steps: [
      { action: 'Dùng testnet hàng ngày', detail: 'Truy cập testnet.monad.xyz, thực hiện swap/transfer mỗi ngày' },
      { action: 'Deploy smart contract', detail: 'Deploy ít nhất 1 contract EVM trên Monad testnet' },
      { action: 'Tương tác DeFi', detail: 'Swap trên Ambient, Kuru Finance, Uniswap fork trên testnet' },
      { action: 'NFT mint', detail: 'Mint NFT trên các marketplace testnet của Monad' },
      { action: 'Galxe / Zealy quest', detail: 'Hoàn thành quest trên Galxe và Zealy của Monad community' },
    ],
    links: { site: 'https://monad.xyz', twitter: 'https://twitter.com/monad_xyz', app: 'https://testnet.monad.xyz' },
  },
  {
    id: 'megaeth',
    name: 'MegaETH',
    logo: '⚡',
    category: 'L2',
    raised: '$30M',
    investors: 'Dragonfly, Vitalik Buterin (angel)',
    status: 'Testnet',
    prob: 'Rất cao',
    tge: '2025',
    desc: 'L2 real-time với 100,000+ TPS và latency dưới 1ms. Chưa có token.',
    steps: [
      { action: 'Đăng ký whitelist', detail: 'Điền form tại megaeth.com để lấy testnet access sớm' },
      { action: 'Testnet giao dịch', detail: 'Nhận ETH testnet qua faucet, thực hiện giao dịch hàng ngày' },
      { action: 'Mint Fluffle NFT', detail: 'Mint Fluffle — NFT mascot chính thức của MegaETH' },
      { action: 'Dùng dApps testnet', detail: 'Tương tác với các ứng dụng trên MegaETH testnet' },
      { action: 'Twitter engagement', detail: 'Follow @megaeth_labs, retweet, bình luận thường xuyên' },
    ],
    links: { site: 'https://megaeth.com', twitter: 'https://twitter.com/megaeth_labs', app: 'https://testnet.megaeth.com' },
  },

  // ── L2 ──────────────────────────────────────────────────────────────────────
  {
    id: 'unichain',
    name: 'Unichain',
    logo: '🦄',
    category: 'L2',
    raised: 'Uniswap Labs',
    investors: 'a16z (Uniswap backer)',
    status: 'Mainnet Beta',
    prob: 'Rất cao',
    tge: '2025',
    desc: 'L2 chính thức của Uniswap Labs trên OP Stack. Chưa có token UNI L2 riêng. Lượng dùng khổng lồ.',
    steps: [
      { action: 'Bridge ETH sang Unichain', detail: 'Bridge ETH qua bridge.unichain.org' },
      { action: 'Swap trên Uniswap v4', detail: 'Thực hiện swap trên Uniswap v4 deploy trên Unichain' },
      { action: 'Cung cấp thanh khoản', detail: 'Add LP cho các cặp phổ biến trên Unichain' },
      { action: 'Giao dịch volume lớn', detail: 'Volume giao dịch cao tăng cơ hội nhận airdrop' },
      { action: 'Dùng đa dạng dApps', detail: 'Tương tác với nhiều protocols khác nhau trên Unichain' },
    ],
    links: { site: 'https://unichain.org', twitter: 'https://twitter.com/unichain', app: 'https://app.uniswap.org' },
  },
  {
    id: 'eclipse',
    name: 'Eclipse',
    logo: '🌑',
    category: 'L2',
    raised: '$65M',
    investors: 'Placeholder, Hack VC, Tribe Capital',
    status: 'Mainnet Beta',
    prob: 'Rất cao',
    tge: '2025',
    desc: 'L2 Ethereum dùng Solana VM (SVM). Nhanh nhất trong hệ Ethereum L2. Chưa có token.',
    steps: [
      { action: 'Bridge ETH', detail: 'Bridge ETH sang Eclipse mainnet qua app.eclipse.xyz' },
      { action: 'Swap trên Orca', detail: 'Giao dịch trên Orca DEX được port sang Eclipse' },
      { action: 'Mint NFT', detail: 'Mint NFT trên Satoshi Universe hoặc các marketplace Eclipse' },
      { action: 'Duy trì volume', detail: 'Volume và số lần giao dịch càng nhiều càng tốt' },
      { action: 'Turbo Tap faucet', detail: 'Claim ETH qua faucet để dùng mỗi ngày' },
    ],
    links: { site: 'https://eclipse.xyz', twitter: 'https://twitter.com/EclipseFND', app: 'https://app.eclipse.xyz' },
  },
  {
    id: 'linea',
    name: 'Linea',
    logo: '🔷',
    category: 'L2',
    raised: 'Consensys',
    investors: 'Consensys (MetaMask maker)',
    status: 'Points Live',
    prob: 'Rất cao',
    tge: '2025',
    desc: 'zkEVM L2 của Consensys / MetaMask. Chưa có token. Đang tích lũy LXP points chính thức.',
    steps: [
      { action: 'Bridge ETH vào Linea', detail: 'Bridge qua MetaMask Portfolio hoặc bridge.linea.build' },
      { action: 'Tham gia Linea Surge', detail: 'Chương trình LXP Points — mỗi hoạt động = điểm tích lũy' },
      { action: 'Mint LXP-L NFT', detail: 'Mint Linea Voyage NFT làm sổ theo dõi điểm' },
      { action: 'Swap / cung cấp LP', detail: 'Dùng Velocore, Lynex, SyncSwap, iZUMi trên Linea' },
      { action: 'Duy trì hoạt động', detail: 'Giao dịch ít nhất 1 lần/tuần để không mất streak' },
    ],
    links: { site: 'https://linea.build', twitter: 'https://twitter.com/LineaBuild', app: 'https://bridge.linea.build' },
  },
  {
    id: 'ink',
    name: 'Ink',
    logo: '🖋',
    category: 'L2',
    raised: 'Kraken',
    investors: 'Kraken Exchange',
    status: 'Mainnet Beta',
    prob: 'Cao',
    tge: '2025',
    desc: 'L2 chính thức của Kraken Exchange trên OP Stack. Backed bởi exchange top 5 toàn cầu. Chưa có token.',
    steps: [
      { action: 'Bridge ETH sang Ink', detail: 'Bridge ETH tại inkonchain.com/bridge' },
      { action: 'Dùng InkSwap', detail: 'Swap token trên InkSwap — DEX chính thức' },
      { action: 'Cung cấp thanh khoản', detail: 'Add LP trên Velodrome fork deploy trên Ink' },
      { action: 'Mint NFT', detail: 'Mint NFT từ các collection trên Ink Mainnet' },
      { action: 'Volume đều đặn', detail: 'Giao dịch hàng ngày, tập trung vào unique interactions' },
    ],
    links: { site: 'https://inkonchain.com', twitter: 'https://twitter.com/inkonchain', app: 'https://inkonchain.com' },
  },
  {
    id: 'worldchain',
    name: 'World Chain',
    logo: '🌍',
    category: 'L2',
    raised: 'World ($WLD)',
    investors: 'a16z (World/Worldcoin backer)',
    status: 'Mainnet Beta',
    prob: 'Cao',
    tge: '2025',
    desc: 'L2 của World App (Worldcoin). Ưu tiên giao dịch cho người đã verify World ID. Chưa có token L2 riêng.',
    steps: [
      { action: 'Verify World ID', detail: 'Quét iris tại orb hoặc dùng World App để lấy World ID' },
      { action: 'Bridge sang World Chain', detail: 'Bridge ETH hoặc USDC vào World Chain' },
      { action: 'Dùng dApps', detail: 'Tương tác với các dApps có World ID verification' },
      { action: 'World App activities', detail: 'Hoàn thành các tính năng trong World App' },
      { action: 'Human verification bonus', detail: 'User đã verify nhận gas fee miễn phí — dùng tối đa' },
    ],
    links: { site: 'https://worldchain.network', twitter: 'https://twitter.com/worldcoin', app: 'https://world.org' },
  },

  // ── Infra ────────────────────────────────────────────────────────────────────
  {
    id: '0glabs',
    name: '0G Labs',
    logo: '🔵',
    category: 'Infra',
    raised: '$325M',
    investors: 'Hack VC, Samsung Next, OKX Ventures',
    status: 'Testnet',
    prob: 'Rất cao',
    tge: 'Mainnet 2025',
    desc: 'DA Layer tốc độ cao cho AI. Raise $325M — một trong những raise lớn nhất 2024. Chưa có token.',
    steps: [
      { action: 'Chạy storage node', detail: 'Deploy 0G Storage Node trên testnet — được thưởng điểm cao nhất' },
      { action: 'Faucet + giao dịch', detail: 'Nhận testnet token và thực hiện giao dịch mỗi ngày' },
      { action: 'Upload dữ liệu', detail: 'Upload file lên 0G Storage testnet qua CLI hoặc SDK' },
      { action: 'Galxe quest', detail: 'Hoàn thành toàn bộ task trên Galxe của 0G Labs' },
      { action: 'Lấy vai trò OG Discord', detail: 'Tham gia Discord và lấy vai trò early member' },
    ],
    links: { site: 'https://0g.ai', twitter: 'https://twitter.com/0G_labs', app: 'https://testnet.0g.ai' },
  },
  {
    id: 'succinct',
    name: 'Succinct',
    logo: '✅',
    category: 'Infra',
    raised: '$55M',
    investors: 'Paradigm, Geometry Research',
    status: 'Points Live',
    prob: 'Rất cao',
    tge: '2025',
    desc: 'SP1 zkVM — generate ZK proof cho bất kỳ Rust code nào. Infrastructure cốt lõi cho zk ecosystem.',
    steps: [
      { action: 'Dùng SP1 Prover Network', detail: 'Gửi proof generation jobs lên Succinct Prover Network' },
      { action: 'Tích lũy Succinct Points', detail: 'Mỗi proof được generate = điểm thưởng có thể convert token' },
      { action: 'GitHub contributions', detail: 'Contribute vào sp1, sp1-project-template repo trên GitHub' },
      { action: 'Xây dApp dùng SP1', detail: 'Deploy ứng dụng sử dụng SP1 cho ZK proof — developer bonus' },
      { action: 'Discord active', detail: 'Tham gia Discord SuccinctLabs, trả lời câu hỏi kỹ thuật' },
    ],
    links: { site: 'https://succinct.xyz', twitter: 'https://twitter.com/SuccinctLabs', app: 'https://network.succinct.xyz' },
  },
  {
    id: 'nexus',
    name: 'Nexus',
    logo: '🔮',
    category: 'Infra',
    raised: '$25M',
    investors: 'Lightspeed, Pantera Capital',
    status: 'Testnet',
    prob: 'Cao',
    tge: '2025',
    desc: 'zkVM mở — prove bất kỳ computation nào. Mạng lưới proof generation phi tập trung.',
    steps: [
      { action: 'Cài Nexus CLI', detail: 'Cài đặt nexus CLI và kết nối vào Nexus Network' },
      { action: 'Đóng góp compute', detail: 'Chạy prover để generate proof — mỗi proof = NEX Points' },
      { action: 'Tích lũy NEX Points', detail: 'Points tích lũy có khả năng convert sang token khi TGE' },
      { action: 'Testnet giao dịch', detail: 'Thực hiện giao dịch hàng ngày trên Nexus testnet' },
      { action: 'Đăng ký sớm', detail: 'Vào nexus.xyz đăng ký email để nhận whitelist ưu tiên' },
    ],
    links: { site: 'https://nexus.xyz', twitter: 'https://twitter.com/NexusLabsHQ', app: 'https://beta.nexus.xyz' },
  },
  {
    id: 'symbiotic',
    name: 'Symbiotic',
    logo: '🔗',
    category: 'Infra',
    raised: '$29M',
    investors: 'Paradigm, cyber•Fund',
    status: 'Mainnet Beta',
    prob: 'Rất cao',
    tge: '2025',
    desc: 'Restaking protocol linh hoạt nhất, được Paradigm backed. Đối thủ trực tiếp EigenLayer. Chưa có token.',
    steps: [
      { action: 'Deposit vào Symbiotic', detail: 'Deposit ETH, stETH, wBTC vào các vault trên app.symbiotic.fi' },
      { action: 'Chọn Networks/Operators', detail: 'Opt-in vào các mạng lưới được bảo mật bởi Symbiotic' },
      { action: 'Dùng LST compatible', detail: 'Stake qua Mellow Protocol để nhận thêm điểm Symbiotic' },
      { action: 'Duy trì deposit lâu dài', detail: 'Số ngày deposit càng dài, điểm tích lũy càng nhiều' },
      { action: 'Discord + Twitter', detail: 'Follow @symbioticfi và tham gia cộng đồng developer' },
    ],
    links: { site: 'https://symbiotic.fi', twitter: 'https://twitter.com/symbioticfi', app: 'https://app.symbiotic.fi' },
  },
  {
    id: 'karak',
    name: 'Karak Network',
    logo: '⚔️',
    category: 'Infra',
    raised: '$48M',
    investors: 'Coinbase Ventures, Pantera Capital',
    status: 'Mainnet Beta',
    prob: 'Cao',
    tge: '2025',
    desc: 'Universal restaking network — restake bất kỳ tài sản nào để bảo mật Distributed Secure Services.',
    steps: [
      { action: 'Deposit vào Karak', detail: 'Deposit ETH, stETH, USDC, USDe tại app.karak.network' },
      { action: 'Stake vào DSS', detail: 'Opt-in vào Distributed Secure Services để kiếm thêm yield' },
      { action: 'Tích lũy XP', detail: 'Karak XP được trao theo số lượng và thời gian deposit' },
      { action: 'Refer bạn bè', detail: 'Mỗi referral thành công tăng thêm XP multiplier' },
      { action: 'Layer cộng thêm', detail: 'Dùng K2 (Karak L2) để nhân đôi điểm tích lũy' },
    ],
    links: { site: 'https://karak.network', twitter: 'https://twitter.com/Karak_Network', app: 'https://app.karak.network' },
  },

  // ── BTC Layer ────────────────────────────────────────────────────────────────
  {
    id: 'babylon',
    name: 'Babylon',
    logo: '₿',
    category: 'BTC Layer',
    raised: '$70M',
    investors: 'Paradigm, Polychain Capital',
    status: 'Mainnet Beta',
    prob: 'Cao',
    tge: 'Phase 2 2025',
    desc: 'Staking BTC native không cần trust để bảo mật PoS chains. Token $BBN đã ra nhưng rewards farming vẫn tiếp tục.',
    steps: [
      { action: 'Stake BTC native', detail: 'Stake BTC tại babylon.foundation (tối thiểu 0.005 BTC)' },
      { action: 'Chọn Finality Provider', detail: 'Chọn FP uy tín, có uptime cao để tối đa điểm thưởng' },
      { action: 'Canh cap mở', detail: 'Staking có giới hạn cap — vào nhanh khi mở đợt mới' },
      { action: 'Dùng LST protocol', detail: 'Nhận liquid staking token từ Lombard, Solv, PumpBTC...' },
      { action: 'Phase 2 farming', detail: 'Tiếp tục farm rewards khi Phase 2 mở — vẫn còn nhiều token phân phối' },
    ],
    links: { site: 'https://babylon.foundation', twitter: 'https://twitter.com/babylon_chain', app: 'https://babylon.foundation' },
  },
  {
    id: 'movement',
    name: 'Movement Labs',
    logo: '🔴',
    category: 'L2',
    raised: '$38M',
    investors: 'Polychain Capital, Hack VC',
    status: 'Mainnet Beta',
    prob: 'Cao',
    tge: '2025',
    desc: 'MoveVM L2 trên Ethereum. Mang tốc độ và bảo mật của Move language sang Ethereum ecosystem.',
    steps: [
      { action: 'Bridge ETH', detail: 'Bridge ETH sang Movement Mainnet Beta qua bridge.movementlabs.xyz' },
      { action: 'Swap trên MoveDEX', detail: 'Sử dụng các DEX native trên Movement (Mosaic, Meridian)' },
      { action: 'Deploy Move contract', detail: 'Deploy smart contract bằng ngôn ngữ Move — developer bonus' },
      { action: 'Tích lũy điểm', detail: 'Tham gia Move Points Program tại points.movementlabs.xyz' },
      { action: 'Ecosystem apps', detail: 'Tương tác đa dạng với các dApps trong hệ sinh thái Movement' },
    ],
    links: { site: 'https://movementlabs.xyz', twitter: 'https://twitter.com/movementlabsxyz', app: 'https://bridge.movementlabs.xyz' },
  },

  // ── Gaming / Other ───────────────────────────────────────────────────────────
  {
    id: 'sophon',
    name: 'Sophon',
    logo: '🎮',
    category: 'Gaming',
    raised: '$65M',
    investors: 'Paper Ventures, Folius Ventures',
    status: 'Mainnet Beta',
    prob: 'Cao',
    tge: '2025',
    desc: 'Gaming & Consumer zkRollup trên ZK Stack (zkSync). Tập trung vào game và ứng dụng tiêu dùng.',
    steps: [
      { action: 'Bridge vào Sophon', detail: 'Bridge ETH hoặc USDC vào Sophon Mainnet qua bridge.sophon.xyz' },
      { action: 'Chơi game trên Sophon', detail: 'Tham gia các game/app trong hệ sinh thái Sophon' },
      { action: 'Farming nodes', detail: 'Mua hoặc delegate node để kiếm node points' },
      { action: 'Tích lũy Sophon Points', detail: 'Mỗi hoạt động on-chain tích lũy points có thể đổi token' },
      { action: 'NFT / Items', detail: 'Mint và giao dịch NFT, in-game items trên Sophon' },
    ],
    links: { site: 'https://sophon.xyz', twitter: 'https://twitter.com/sophon', app: 'https://bridge.sophon.xyz' },
  },
  {
    id: 'fuel',
    name: 'Fuel Network',
    logo: '⛽',
    category: 'Infra',
    raised: '$81.5M',
    investors: 'Blockchain Capital, CoinFund, Stratos',
    status: 'Mainnet Beta',
    prob: 'Trung bình',
    tge: '2025',
    desc: 'Modular execution layer với UTXO model và ngôn ngữ Sway. Tối ưu cho parallelization.',
    steps: [
      { action: 'Bridge ETH / USDC', detail: 'Bridge tài sản sang Fuel qua app.fuel.network/bridge' },
      { action: 'Swap trên Spark', detail: 'Giao dịch trên Spark — CLOB DEX đầu tiên trên Fuel' },
      { action: 'Dùng Mira Exchange', detail: 'Swap và add LP trên Mira — AMM native của Fuel' },
      { action: 'Deploy Sway contract', detail: 'Thử viết và deploy smart contract bằng Sway language' },
      { action: 'Volume đều đặn', detail: 'Duy trì giao dịch hàng tuần để tích lũy lịch sử on-chain' },
    ],
    links: { site: 'https://fuel.network', twitter: 'https://twitter.com/fuel_network', app: 'https://app.fuel.network' },
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<Category, string> = {
  'L1':       'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'L2':       'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'DeFi':     'bg-green-500/15 text-green-300 border-green-500/30',
  'Infra':    'bg-orange-500/15 text-orange-300 border-orange-500/30',
  'Gaming':   'bg-pink-500/15 text-pink-300 border-pink-500/30',
  'BTC Layer':'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
}

const PROB_CONFIG: Record<Prob, { color: string; bg: string; dot: string }> = {
  'Rất cao':    { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/25', dot: 'bg-emerald-400' },
  'Cao':        { color: 'text-green-400',   bg: 'bg-green-500/10 border-green-500/25',     dot: 'bg-green-400'  },
  'Trung bình': { color: 'text-yellow-400',  bg: 'bg-yellow-500/10 border-yellow-500/25',   dot: 'bg-yellow-400' },
}

const STATUS_COLORS: Record<Status, string> = {
  'Testnet':      'text-blue-400 bg-blue-500/10 border-blue-500/20',
  'Mainnet Beta': 'text-green-400 bg-green-500/10 border-green-500/20',
  'Pre-launch':   'text-gray-400 bg-gray-500/10 border-gray-500/20',
  'Points Live':  'text-purple-400 bg-purple-500/10 border-purple-500/20',
}

const ALL_CATEGORIES: (Category | 'Tất cả')[] = ['Tất cả', 'L1', 'L2', 'Infra', 'BTC Layer', 'Gaming']

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({ p }: { p: AirdropProject }) {
  const [expanded, setExpanded] = useState(false)
  const probCfg = PROB_CONFIG[p.prob]

  return (
    <div className="bg-[#0d0e12] border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 transition-all flex flex-col">

      {/* Top accent bar */}
      <div className={`h-0.5 ${
        p.prob === 'Rất cao' ? 'bg-gradient-to-r from-emerald-500 to-green-400'
        : p.prob === 'Cao'   ? 'bg-gradient-to-r from-green-500 to-teal-400'
        :                      'bg-gradient-to-r from-yellow-500 to-amber-400'
      }`} />

      <div className="p-4 flex flex-col gap-3 flex-1">

        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="text-2xl w-10 h-10 flex items-center justify-center rounded-xl bg-gray-800/60 shrink-0">
              {p.logo}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-white font-bold text-sm">{p.name}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${CATEGORY_COLORS[p.category]}`}>
                  {p.category}
                </span>
              </div>
              <span className={`text-[10px] px-2 py-0.5 mt-1 inline-block rounded-full border font-medium ${STATUS_COLORS[p.status]}`}>
                {p.status}
              </span>
            </div>
          </div>

          {/* Prob badge */}
          <div className={`shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg border ${probCfg.bg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${probCfg.dot} animate-pulse`} />
            <span className={`text-xs font-bold ${probCfg.color}`}>{p.prob}</span>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-900/50 rounded-xl p-2.5">
            <div className="text-gray-600 text-[10px] mb-0.5">💰 Vốn huy động</div>
            <div className="text-white font-bold text-sm">{p.raised}</div>
          </div>
          <div className="bg-gray-900/50 rounded-xl p-2.5">
            <div className="text-gray-600 text-[10px] mb-0.5">🏦 Nhà đầu tư</div>
            <div className="text-gray-300 text-xs font-medium leading-tight">{p.investors}</div>
          </div>
        </div>

        {/* Description */}
        <p className="text-gray-400 text-xs leading-relaxed">{p.desc}</p>

        {/* TGE estimate */}
        {p.tge && (
          <div className="flex items-center gap-1.5 text-xs">
            <span>🗓</span>
            <span className="text-gray-500">Dự kiến TGE:</span>
            <span className="text-yellow-400 font-semibold">{p.tge}</span>
          </div>
        )}
      </div>

      {/* Steps accordion */}
      <div className="border-t border-gray-800/80">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 hover:text-white hover:bg-white/5 transition-all"
        >
          <div className="flex items-center gap-2">
            <span>📋</span>
            <span>Cách tham gia ({p.steps.length} bước)</span>
          </div>
          <span className={`transition-transform duration-200 text-gray-600 ${expanded ? 'rotate-180' : ''}`}>▼</span>
        </button>

        {expanded && (
          <div className="px-4 pb-4 flex flex-col gap-2.5 bg-gray-900/20">
            {p.steps.map((s, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-5 h-5 rounded-full bg-violet-600/20 border border-violet-500/30 text-violet-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div>
                  <div className="text-white text-xs font-semibold">{s.action}</div>
                  <div className="text-gray-500 text-xs mt-0.5 leading-relaxed">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Links footer */}
      <div className="border-t border-gray-800/60 px-4 py-2.5 flex gap-3 bg-gray-900/10">
        <a href={p.links.site} target="_blank" rel="noreferrer"
          className="text-xs text-gray-600 hover:text-violet-400 transition-colors flex items-center gap-1">
          🌐 Website
        </a>
        {p.links.twitter && (
          <a href={p.links.twitter} target="_blank" rel="noreferrer"
            className="text-xs text-gray-600 hover:text-sky-400 transition-colors flex items-center gap-1">
            𝕏 Twitter
          </a>
        )}
        {p.links.app && (
          <a href={p.links.app} target="_blank" rel="noreferrer"
            className="text-xs text-gray-600 hover:text-green-400 transition-colors flex items-center gap-1 ml-auto font-medium">
            Vào App →
          </a>
        )}
      </div>
    </div>
  )
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function SummaryStats() {
  const highProb = PROJECTS.filter((p) => p.prob === 'Rất cao' || p.prob === 'Cao').length
  const live     = PROJECTS.filter((p) => p.status !== 'Pre-launch').length

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Chưa airdrop',     value: String(PROJECTS.length), icon: '🪂', color: 'text-violet-400' },
        { label: 'Xác suất cao+',    value: String(highProb),        icon: '🎯', color: 'text-emerald-400' },
        { label: 'Đang hoạt động',   value: String(live),            icon: '🟢', color: 'text-blue-400'   },
        { label: 'Tổng vốn raise',   value: '$1.8B+',                icon: '💰', color: 'text-yellow-400' },
      ].map((s) => (
        <div key={s.label} className="bg-[#0d0e12] border border-gray-800 rounded-2xl p-3 text-center">
          <div className="text-xl mb-1">{s.icon}</div>
          <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
          <div className="text-gray-600 text-xs mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function AirdropPanel() {
  const [catFilter,  setCatFilter]  = useState<Category | 'Tất cả'>('Tất cả')
  const [probFilter, setProbFilter] = useState<Prob | 'Tất cả'>('Tất cả')
  const [search,     setSearch]     = useState('')

  const filtered = PROJECTS.filter((p) => {
    if (catFilter  !== 'Tất cả' && p.category !== catFilter) return false
    if (probFilter !== 'Tất cả' && p.prob     !== probFilter) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="flex flex-col gap-5">

      {/* Banner */}
      <div className="w-full rounded-2xl bg-gradient-to-r from-violet-900/30 via-blue-900/20 to-violet-900/30 border border-violet-500/20 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-2xl">🪂</span>
              <h2 className="text-white font-bold text-lg">Airdrop Radar</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-semibold">
                ✓ Chưa phát token
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/25 text-violet-400 font-medium">
                {PROJECTS.length} dự án
              </span>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed max-w-xl">
              Tổng hợp các dự án <strong className="text-white">chưa phát token / chưa airdrop</strong>,
              vốn huy động lớn từ quỹ hàng đầu. Cập nhật thường xuyên.
            </p>
          </div>
          <div className="text-xs text-gray-600 bg-gray-900/60 rounded-xl px-3 py-2 border border-gray-800 shrink-0">
            <div className="text-yellow-500/80 mb-1 font-medium">⚠️ Lưu ý</div>
            <div className="leading-relaxed">
              Không phải lời khuyên đầu tư<br />
              DYOR trước khi tham gia
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <SummaryStats />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600">🔍</span>
          <input
            type="text"
            placeholder="Tìm dự án..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-[#0d0e12] border border-gray-800 rounded-xl pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500/50 w-36"
          />
        </div>

        {/* Category */}
        <div className="flex gap-1 flex-wrap">
          {ALL_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c as Category | 'Tất cả')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                catFilter === c
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-[#0d0e12] border border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Probability */}
        <div className="flex gap-1 ml-auto">
          {(['Tất cả', 'Rất cao', 'Cao', 'Trung bình'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProbFilter(p as Prob | 'Tất cả')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                probFilter === p
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-[#0d0e12] border border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white'
              }`}
            >
              {p === 'Tất cả' ? 'Xác suất' : p}
            </button>
          ))}
        </div>
      </div>

      {/* Result count */}
      {filtered.length !== PROJECTS.length && (
        <p className="text-gray-600 text-xs">Hiển thị {filtered.length}/{PROJECTS.length} dự án</p>
      )}

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <div className="text-4xl mb-3">🔍</div>
          <div>Không tìm thấy dự án phù hợp</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-center text-xs text-gray-700 py-2">
        Thông tin mang tính tham khảo · Không phải lời khuyên tài chính · Luôn DYOR trước khi tham gia
      </p>
    </div>
  )
}
