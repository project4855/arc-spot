// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ArcLending
 * @notice Over-collateralized lending pool for Arc Testnet
 * @dev Supports USDC and EURC (real Circle tokens on Arc Testnet)
 *
 * Token addresses (Arc Testnet):
 *   USDC  0x3600000000000000000000000000000000000000
 *   EURC  0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
 */
contract ArcLending is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct TokenInfo {
        bool     supported;
        uint8    decimals;
        uint256  collateralFactor; // bps: 9000 = 90%
        uint256  supplyRateBps;   // annual rate bps: 520 = 5.20% APY
        uint256  borrowRateBps;   // annual rate bps: 810 = 8.10% APY
        uint256  priceUSD6;       // USD price × 1e6: 1_000_000 = $1.00
        uint256  totalSupplied;   // in token units
        uint256  totalBorrowed;   // in token units
    }

    struct UserPosition {
        uint256 supplied;     // in token units (interest-accrued)
        uint256 borrowed;     // in token units (interest-accrued)
        uint256 supplyIndex;  // global index snapshot at last interaction
        uint256 borrowIndex;  // global index snapshot at last interaction
    }

    // ─── State ────────────────────────────────────────────────────────────────

    mapping(address => TokenInfo)                              public tokens;
    address[]                                                  public tokenList;
    mapping(address => mapping(address => UserPosition))       public positions; // user → token → pos

    // Global interest index per token (starts at 1e18, grows over time)
    mapping(address => uint256) public supplyIndex;
    mapping(address => uint256) public borrowIndex;
    mapping(address => uint256) public lastAccrualTime;

    uint256 private constant INDEX_BASE        = 1e18;
    uint256 private constant SECONDS_PER_YEAR  = 365 days;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Supplied(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event Borrowed(address indexed user, address indexed token, uint256 amount);
    event Repaid(address indexed user, address indexed token, uint256 amount);
    event TokenAdded(address indexed token, string symbol);
    event PriceUpdated(address indexed token, uint256 priceUSD6);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── Owner: token management ──────────────────────────────────────────────

    /**
     * @notice Add a new supported token to the pool
     * @param token              ERC-20 token address
     * @param decimals_          Token decimals
     * @param collateralFactor   Collateral factor in bps (e.g. 9000 = 90%)
     * @param supplyRateBps      Annual supply APY in bps (e.g. 520 = 5.20%)
     * @param borrowRateBps      Annual borrow APY in bps (e.g. 810 = 8.10%)
     * @param initialPriceUSD6   USD price with 6 decimals (e.g. 1_000_000 = $1.00)
     * @param symbol             Human-readable symbol for the event
     */
    function addToken(
        address token,
        uint8   decimals_,
        uint256 collateralFactor,
        uint256 supplyRateBps,
        uint256 borrowRateBps,
        uint256 initialPriceUSD6,
        string  calldata symbol
    ) external onlyOwner {
        require(!tokens[token].supported, "Token already added");
        require(collateralFactor <= 10000, "Factor > 100%");

        tokens[token] = TokenInfo({
            supported:        true,
            decimals:         decimals_,
            collateralFactor: collateralFactor,
            supplyRateBps:    supplyRateBps,
            borrowRateBps:    borrowRateBps,
            priceUSD6:        initialPriceUSD6,
            totalSupplied:    0,
            totalBorrowed:    0
        });

        supplyIndex[token]     = INDEX_BASE;
        borrowIndex[token]     = INDEX_BASE;
        lastAccrualTime[token] = block.timestamp;
        tokenList.push(token);

        emit TokenAdded(token, symbol);
    }

    /// @notice Update the oracle price for a token (owner only)
    function setPrice(address token, uint256 priceUSD6) external onlyOwner {
        require(tokens[token].supported, "Not supported");
        _accrueToken(token);
        tokens[token].priceUSD6 = priceUSD6;
        emit PriceUpdated(token, priceUSD6);
    }

    /// @notice Update interest rates for a token (owner only)
    function setRates(
        address token,
        uint256 supplyRateBps,
        uint256 borrowRateBps
    ) external onlyOwner {
        require(tokens[token].supported, "Not supported");
        _accrueToken(token);
        tokens[token].supplyRateBps = supplyRateBps;
        tokens[token].borrowRateBps = borrowRateBps;
    }

    // ─── User: supply ─────────────────────────────────────────────────────────

    /**
     * @notice Deposit tokens into the pool to earn interest
     * @dev Caller must approve this contract to spend `amount` of `token`
     */
    function supply(address token, uint256 amount) external nonReentrant {
        require(tokens[token].supported, "Token not supported");
        require(amount > 0, "Amount must be > 0");

        _accrueToken(token);
        _settleUser(msg.sender, token);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        positions[msg.sender][token].supplied += amount;
        tokens[token].totalSupplied          += amount;

        emit Supplied(msg.sender, token, amount);
    }

    /**
     * @notice Withdraw previously supplied tokens
     */
    function withdraw(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        _accrueToken(token);
        _settleUser(msg.sender, token);

        UserPosition storage pos = positions[msg.sender][token];
        require(pos.supplied >= amount, "Exceeds supplied balance");

        pos.supplied                -= amount;
        tokens[token].totalSupplied -= amount;

        require(_isHealthy(msg.sender), "Would be under-collateralized");
        require(
            IERC20(token).balanceOf(address(this)) >= amount,
            "Insufficient pool liquidity"
        );

        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    // ─── User: borrow ─────────────────────────────────────────────────────────

    /**
     * @notice Borrow tokens against your supplied collateral
     */
    function borrow(address token, uint256 amount) external nonReentrant {
        require(tokens[token].supported, "Token not supported");
        require(amount > 0, "Amount must be > 0");

        _accrueToken(token);
        _settleUser(msg.sender, token);

        positions[msg.sender][token].borrowed += amount;
        tokens[token].totalBorrowed           += amount;

        require(_isHealthy(msg.sender), "Insufficient collateral to borrow");
        require(
            IERC20(token).balanceOf(address(this)) >= amount,
            "Insufficient pool liquidity"
        );

        IERC20(token).safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, token, amount);
    }

    /**
     * @notice Repay borrowed tokens
     * @dev Caller must approve this contract to spend `amount` of `token`
     */
    function repay(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        _accrueToken(token);
        _settleUser(msg.sender, token);

        UserPosition storage pos = positions[msg.sender][token];
        uint256 toRepay = amount > pos.borrowed ? pos.borrowed : amount;
        require(toRepay > 0, "No outstanding borrow");

        IERC20(token).safeTransferFrom(msg.sender, address(this), toRepay);
        pos.borrowed                -= toRepay;
        tokens[token].totalBorrowed -= toRepay;

        emit Repaid(msg.sender, token, toRepay);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /**
     * @notice Health factor for a user (1e18 = 1.0)
     * @return type(uint256).max when no debt
     */
    function getHealthFactor(address user) external view returns (uint256) {
        (uint256 col, uint256 bor) = _positionValues(user);
        if (bor == 0) return type(uint256).max;
        return (col * INDEX_BASE) / bor;
    }

    /**
     * @notice Get a user's position for a specific token (with accrued interest)
     */
    function getUserPosition(address user, address token)
        external view
        returns (
            uint256 supplied,
            uint256 borrowed,
            uint256 suppliedUSD6,   // × 1e6
            uint256 borrowedUSD6    // × 1e6
        )
    {
        TokenInfo memory info = tokens[token];
        UserPosition memory pos = positions[user][token];

        // Project indices forward without state change
        uint256 sIdx = _projectSupplyIndex(token);
        uint256 bIdx = _projectBorrowIndex(token);

        uint256 s = pos.supplyIndex > 0
            ? (pos.supplied * sIdx) / pos.supplyIndex
            : pos.supplied;
        uint256 b = pos.borrowIndex > 0
            ? (pos.borrowed * bIdx) / pos.borrowIndex
            : pos.borrowed;

        uint256 scale = 10 ** uint256(info.decimals);
        return (s, b, (s * info.priceUSD6) / scale, (b * info.priceUSD6) / scale);
    }

    /**
     * @notice Pool-level data for a token
     */
    function getPoolInfo(address token)
        external view
        returns (
            uint256 totalSupplied,
            uint256 totalBorrowed,
            uint256 utilizationBps,  // 0–10000
            uint256 supplyRateBps,
            uint256 borrowRateBps,
            uint256 priceUSD6
        )
    {
        TokenInfo memory info = tokens[token];
        uint256 util = info.totalSupplied > 0
            ? (info.totalBorrowed * 10000) / info.totalSupplied
            : 0;
        return (
            info.totalSupplied,
            info.totalBorrowed,
            util,
            info.supplyRateBps,
            info.borrowRateBps,
            info.priceUSD6
        );
    }

    /// @notice Returns all supported token addresses
    function getTokenList() external view returns (address[] memory) {
        return tokenList;
    }

    // ─── Internal: interest accrual ───────────────────────────────────────────

    function _accrueToken(address token) internal {
        uint256 elapsed = block.timestamp - lastAccrualTime[token];
        if (elapsed == 0) return;

        TokenInfo storage info = tokens[token];

        supplyIndex[token] +=
            (supplyIndex[token] * info.supplyRateBps * elapsed) /
            (10000 * SECONDS_PER_YEAR);

        borrowIndex[token] +=
            (borrowIndex[token] * info.borrowRateBps * elapsed) /
            (10000 * SECONDS_PER_YEAR);

        lastAccrualTime[token] = block.timestamp;
    }

    function _settleUser(address user, address token) internal {
        UserPosition storage pos = positions[user][token];

        if (pos.supplied > 0 && pos.supplyIndex > 0) {
            pos.supplied = (pos.supplied * supplyIndex[token]) / pos.supplyIndex;
        }
        if (pos.borrowed > 0 && pos.borrowIndex > 0) {
            pos.borrowed = (pos.borrowed * borrowIndex[token]) / pos.borrowIndex;
        }

        pos.supplyIndex = supplyIndex[token];
        pos.borrowIndex = borrowIndex[token];
    }

    function _projectSupplyIndex(address token) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - lastAccrualTime[token];
        if (elapsed == 0) return supplyIndex[token];
        return supplyIndex[token] +
            (supplyIndex[token] * tokens[token].supplyRateBps * elapsed) /
            (10000 * SECONDS_PER_YEAR);
    }

    function _projectBorrowIndex(address token) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - lastAccrualTime[token];
        if (elapsed == 0) return borrowIndex[token];
        return borrowIndex[token] +
            (borrowIndex[token] * tokens[token].borrowRateBps * elapsed) /
            (10000 * SECONDS_PER_YEAR);
    }

    function _positionValues(address user)
        internal view
        returns (uint256 collateralUSD, uint256 borrowUSD)
    {
        for (uint256 i = 0; i < tokenList.length; i++) {
            address token       = tokenList[i];
            TokenInfo memory info = tokens[token];
            UserPosition memory pos = positions[user][token];

            uint256 scale = 10 ** uint256(info.decimals);

            if (pos.supplied > 0) {
                collateralUSD +=
                    (pos.supplied * info.priceUSD6 * info.collateralFactor) /
                    (scale * 10000);
            }
            if (pos.borrowed > 0) {
                borrowUSD += (pos.borrowed * info.priceUSD6) / scale;
            }
        }
    }

    function _isHealthy(address user) internal view returns (bool) {
        (uint256 col, uint256 bor) = _positionValues(user);
        return bor == 0 || col >= bor;
    }
}
