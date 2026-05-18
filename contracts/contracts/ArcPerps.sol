// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ArcPerps
 * @notice Perpetual futures trading on Arc Testnet
 * @dev
 *   - USDC as sole collateral (6 decimals)
 *   - Prices stored with 6 decimal precision (e.g. BTC $105000 → 105000_000000)
 *   - Position size = margin × leverage (in USD, 6 decimals)
 *   - PnL = size × (exitPrice − entryPrice) / entryPrice  (long)
 *          = size × (entryPrice − exitPrice) / entryPrice  (short)
 *   - Opening fee: 0.1%  |  Closing fee: 0.1%
 *   - Liquidation when unrealised loss ≥ margin × 95%  (maintenance 5%)
 *   - Liquidator bonus: 10% of remaining margin
 *   - Funding rate: owner sets 8h rate per market, accrued at close
 */
contract ArcPerps is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;

    uint256 public constant MAX_LEVERAGE         = 20;
    uint256 public constant TRADING_FEE_BPS      = 10;    // 0.10%
    uint256 public constant MAINTENANCE_MARGIN   = 500;   // 5.00%
    uint256 public constant LIQUIDATION_BONUS    = 1000;  // 10.00%
    uint256 public constant BPS_BASE             = 10_000;
    uint256 public constant PRICE_PRECISION      = 1e6;   // prices have 6 decimals
    uint256 public constant FUNDING_INTERVAL     = 8 hours;

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct Position {
        address trader;
        string  coin;
        bool    isLong;
        uint256 sizeUsd;        // notional size in USD (6 dec)
        uint256 margin;         // USDC collateral remaining (6 dec)
        uint256 entryPrice;     // entry oracle price (6 dec)
        uint256 leverage;       // 1-20
        uint256 openedAt;       // block.timestamp
        bool    isOpen;
        int256  fundingAccrued; // cumulative funding index at open (signed)
    }

    struct Market {
        bool    active;
        uint256 price;          // current oracle price (6 dec)
        int256  fundingIndex;   // cumulative 8h funding (signed, 1e9 precision)
        uint256 fundingRate8h;  // absolute 8h rate bps (e.g. 1 = 0.0001%)
        bool    fundingLongPays;// true = longs pay shorts, false = shorts pay longs
        uint256 lastFundingAt;
        uint256 openInterest;   // total open notional USD (6 dec)
    }

    // ─── State ────────────────────────────────────────────────────────────────

    mapping(uint256 => Position)  public positions;
    mapping(string  => Market)    public markets;
    mapping(address => uint256[]) public userPositionIds;
    string[] public coinList;

    uint256 public nextPositionId;
    uint256 public insuranceFund;
    address public feeRecipient;

    // ─── Events ───────────────────────────────────────────────────────────────

    event PositionOpened(
        uint256 indexed id,
        address indexed trader,
        string  coin,
        bool    isLong,
        uint256 sizeUsd,
        uint256 margin,
        uint256 entryPrice,
        uint256 leverage
    );

    event PositionClosed(
        uint256 indexed id,
        address indexed trader,
        int256  pnl,
        uint256 exitPrice,
        uint256 payout
    );

    event MarginAdded(uint256 indexed id, uint256 amount);
    event Liquidated(uint256 indexed id, address indexed trader, address liquidator, uint256 exitPrice);
    event PriceUpdated(string coin, uint256 price);
    event FundingUpdated(string coin, int256 fundingIndex, uint256 rate8h, bool longPays);
    event MarketAdded(string coin);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _usdc) Ownable(msg.sender) {
        usdc         = IERC20(_usdc);
        feeRecipient = msg.sender;

        // Pre-load top 10 markets (prices set separately via setPrice)
        string[10] memory defaultCoins = [
            "BTC","ETH","SOL","ARB","OP","AVAX","MATIC","LINK","DOGE","WIF"
        ];
        for (uint i = 0; i < defaultCoins.length; i++) {
            _addMarket(defaultCoins[i]);
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Batch-update oracle prices (called by the oracle script)
    function setPrices(
        string[]  calldata coins,
        uint256[] calldata prices_
    ) external onlyOwner {
        require(coins.length == prices_.length, "Length mismatch");
        for (uint i = 0; i < coins.length; i++) {
            Market storage m = markets[coins[i]];
            require(m.active, "Market not active");
            m.price = prices_[i];
            emit PriceUpdated(coins[i], prices_[i]);
        }
    }

    function setPrice(string calldata coin, uint256 price_) external onlyOwner {
        Market storage m = markets[coin];
        require(m.active, "Market not active");
        m.price = price_;
        emit PriceUpdated(coin, price_);
    }

    /// @notice Update funding rate for a market (called periodically by oracle)
    function setFundingRate(
        string calldata coin,
        uint256 rate8h,
        bool    longPays
    ) external onlyOwner {
        Market storage m = markets[coin];
        require(m.active, "Market not active");
        _applyFunding(coin);
        m.fundingRate8h   = rate8h;
        m.fundingLongPays = longPays;
        emit FundingUpdated(coin, m.fundingIndex, rate8h, longPays);
    }

    function addMarket(string calldata coin) external onlyOwner {
        _addMarket(coin);
    }

    function setMarketActive(string calldata coin, bool active) external onlyOwner {
        markets[coin].active = active;
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        feeRecipient = recipient;
    }

    function withdrawInsuranceFund(uint256 amount) external onlyOwner {
        require(amount <= insuranceFund, "Exceeds insurance fund");
        insuranceFund -= amount;
        usdc.safeTransfer(owner(), amount);
    }

    // ─── Trading ──────────────────────────────────────────────────────────────

    /**
     * @notice Open a leveraged long or short position
     * @param coin     Market identifier e.g. "BTC"
     * @param isLong   true = long, false = short
     * @param margin   USDC collateral amount (6 dec)
     * @param leverage 1–20
     */
    function openPosition(
        string calldata coin,
        bool    isLong,
        uint256 margin,
        uint256 leverage
    ) external nonReentrant returns (uint256 positionId) {
        Market storage m = markets[coin];
        require(m.active,              "Market not active");
        require(m.price > 0,           "No price set");
        require(margin  > 0,           "Margin required");
        require(leverage >= 1 && leverage <= MAX_LEVERAGE, "Bad leverage");

        // Opening fee deducted from margin
        uint256 sizeUsd = margin * leverage;
        uint256 fee     = sizeUsd * TRADING_FEE_BPS / BPS_BASE;
        require(margin > fee, "Margin too small");

        usdc.safeTransferFrom(msg.sender, address(this), margin);
        usdc.safeTransfer(feeRecipient, fee);
        uint256 netMargin = margin - fee;

        // Accrue funding before recording position
        _applyFunding(coin);

        positionId = nextPositionId++;
        positions[positionId] = Position({
            trader:         msg.sender,
            coin:           coin,
            isLong:         isLong,
            sizeUsd:        sizeUsd,
            margin:         netMargin,
            entryPrice:     m.price,
            leverage:       leverage,
            openedAt:       block.timestamp,
            isOpen:         true,
            fundingAccrued: m.fundingIndex
        });

        userPositionIds[msg.sender].push(positionId);
        m.openInterest += sizeUsd;

        emit PositionOpened(positionId, msg.sender, coin, isLong,
            sizeUsd, netMargin, m.price, leverage);
    }

    /**
     * @notice Close an open position and receive PnL
     */
    function closePosition(uint256 positionId) external nonReentrant {
        Position storage pos = positions[positionId];
        require(pos.isOpen,                  "Not open");
        require(pos.trader == msg.sender,    "Not owner");

        Market storage m = markets[pos.coin];
        require(m.price > 0, "No price");

        _applyFunding(pos.coin);

        (int256 pnl, int256 fundingPnl) = _calcPnl(pos, m);
        int256 totalPnl = pnl + fundingPnl;

        uint256 closeFee = pos.sizeUsd * TRADING_FEE_BPS / BPS_BASE;
        uint256 payout   = _calcPayout(pos.margin, totalPnl, closeFee);

        _closePosition(pos, m);
        _settle(msg.sender, feeRecipient, payout, closeFee, pos.margin, totalPnl);

        emit PositionClosed(positionId, msg.sender, totalPnl, m.price, payout);
    }

    /**
     * @notice Add extra margin to an open position to avoid liquidation
     */
    function addMargin(uint256 positionId, uint256 amount) external nonReentrant {
        Position storage pos = positions[positionId];
        require(pos.isOpen,               "Not open");
        require(pos.trader == msg.sender, "Not owner");
        require(amount > 0,               "Amount required");

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        pos.margin += amount;

        emit MarginAdded(positionId, amount);
    }

    /**
     * @notice Liquidate an undercollateralised position
     * @dev Anyone can call; liquidator earns 10% of remaining margin
     */
    function liquidate(uint256 positionId) external nonReentrant {
        Position storage pos = positions[positionId];
        require(pos.isOpen, "Not open");

        Market storage m = markets[pos.coin];
        require(m.price > 0, "No price");

        _applyFunding(pos.coin);

        require(_isLiquidatable(pos, m), "Not liquidatable");

        _closePosition(pos, m);

        uint256 bonus = pos.margin * LIQUIDATION_BONUS / BPS_BASE;
        if (bonus > 0) {
            uint256 actual = bonus < pos.margin ? bonus : pos.margin;
            usdc.safeTransfer(msg.sender, actual);
            insuranceFund += pos.margin - actual;
        } else {
            insuranceFund += pos.margin;
        }

        emit Liquidated(positionId, pos.trader, msg.sender, m.price);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getPositionInfo(uint256 positionId) external view returns (
        address trader,
        string  memory coin,
        bool    isLong,
        uint256 sizeUsd,
        uint256 margin,
        uint256 entryPrice,
        uint256 leverage,
        bool    isOpen,
        int256  unrealisedPnl,
        uint256 liquidationPrice,
        bool    liquidatable
    ) {
        Position storage pos = positions[positionId];
        Market   storage m   = markets[pos.coin];

        (int256 pnl, int256 fpnl) = pos.isOpen
            ? _calcPnl(pos, m)
            : (int256(0), int256(0));

        return (
            pos.trader,
            pos.coin,
            pos.isLong,
            pos.sizeUsd,
            pos.margin,
            pos.entryPrice,
            pos.leverage,
            pos.isOpen,
            pnl + fpnl,
            _liqPrice(pos),
            pos.isOpen && _isLiquidatable(pos, m)
        );
    }

    function getUserPositions(address user) external view returns (uint256[] memory) {
        return userPositionIds[user];
    }

    function getMarket(string calldata coin) external view returns (
        bool    active,
        uint256 price,
        int256  fundingIndex,
        uint256 fundingRate8h,
        bool    longPays,
        uint256 openInterest
    ) {
        Market storage m = markets[coin];
        return (m.active, m.price, m.fundingIndex, m.fundingRate8h, m.fundingLongPays, m.openInterest);
    }

    function getAllMarkets() external view returns (
        string[] memory coins,
        uint256[] memory prices_,
        uint256[] memory ois,
        uint256[] memory rates
    ) {
        uint len = coinList.length;
        coins   = new string[](len);
        prices_ = new uint256[](len);
        ois     = new uint256[](len);
        rates   = new uint256[](len);
        for (uint i = 0; i < len; i++) {
            Market storage m = markets[coinList[i]];
            coins[i]   = coinList[i];
            prices_[i] = m.price;
            ois[i]     = m.openInterest;
            rates[i]   = m.fundingRate8h;
        }
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _addMarket(string memory coin) internal {
        if (!markets[coin].active) {
            markets[coin].active        = true;
            markets[coin].lastFundingAt = block.timestamp;
            coinList.push(coin);
            emit MarketAdded(coin);
        }
    }

    /// @dev Advance funding index by elapsed 8h intervals
    function _applyFunding(string memory coin) internal {
        Market storage m = markets[coin];
        if (m.fundingRate8h == 0) {
            m.lastFundingAt = block.timestamp;
            return;
        }
        uint256 elapsed   = block.timestamp - m.lastFundingAt;
        uint256 intervals = elapsed / FUNDING_INTERVAL;
        if (intervals == 0) return;

        // fundingIndex accumulates rate * intervals (signed by direction)
        // Stored as bps × 1e6 for precision
        int256 delta = int256(m.fundingRate8h * intervals);
        m.fundingIndex     += m.fundingLongPays ? delta : -delta;
        m.lastFundingAt    += intervals * FUNDING_INTERVAL;
    }

    function _calcPnl(
        Position storage pos,
        Market   storage m
    ) internal view returns (int256 pnl, int256 fundingPnl) {
        // Price PnL
        int256 priceDelta = int256(m.price) - int256(pos.entryPrice);
        pnl = int256(pos.sizeUsd) * priceDelta / int256(pos.entryPrice);
        if (!pos.isLong) pnl = -pnl;

        // Funding PnL: fundingDelta (bps) applied to size
        int256 fundingDelta = m.fundingIndex - pos.fundingAccrued;
        // Long pays positive funding, short receives it
        fundingPnl = int256(pos.sizeUsd) * fundingDelta / int256(BPS_BASE) / 1e6;
        if (!pos.isLong) fundingPnl = -fundingPnl;
        fundingPnl = -fundingPnl; // flip: positive fundingDelta means long pays
    }

    function _isLiquidatable(
        Position storage pos,
        Market   storage m
    ) internal view returns (bool) {
        (int256 pnl, int256 fpnl) = _calcPnl(pos, m);
        int256 total = pnl + fpnl;
        if (total >= 0) return false;
        uint256 loss    = uint256(-total);
        uint256 maxLoss = pos.margin * (BPS_BASE - MAINTENANCE_MARGIN) / BPS_BASE;
        return loss >= maxLoss;
    }

    function _liqPrice(Position storage pos) internal view returns (uint256) {
        if (!pos.isOpen || pos.sizeUsd == 0) return 0;
        uint256 maxLoss  = pos.margin * (BPS_BASE - MAINTENANCE_MARGIN) / BPS_BASE;
        uint256 moveUsd  = maxLoss * pos.entryPrice / pos.sizeUsd;
        if (pos.isLong)  return pos.entryPrice > moveUsd ? pos.entryPrice - moveUsd : 0;
        return pos.entryPrice + moveUsd;
    }

    function _calcPayout(
        uint256 margin,
        int256  totalPnl,
        uint256 closeFee
    ) internal pure returns (uint256 payout) {
        int256 gross = int256(margin) + totalPnl;
        if (gross <= 0) return 0;
        uint256 grossU = uint256(gross);
        return grossU > closeFee ? grossU - closeFee : 0;
    }

    function _closePosition(Position storage pos, Market storage m) internal {
        m.openInterest  = m.openInterest >= pos.sizeUsd
            ? m.openInterest - pos.sizeUsd : 0;
        pos.isOpen      = false;
    }

    function _settle(
        address trader,
        address feeDest,
        uint256 payout,
        uint256 fee,
        uint256 margin,
        int256  totalPnl
    ) internal {
        // Pay close fee first
        uint256 available = uint256(int256(margin) + totalPnl);
        if (available == 0) return;

        if (fee > 0 && available > fee) {
            usdc.safeTransfer(feeDest, fee);
        }
        if (payout > 0) {
            usdc.safeTransfer(trader, payout);
        }
        // Residual (protocol profit from winning trades) stays in contract as insurance
        int256 residual = int256(margin) + totalPnl - int256(fee) - int256(payout);
        if (residual > 0) {
            insuranceFund += uint256(residual);
        }
    }
}
