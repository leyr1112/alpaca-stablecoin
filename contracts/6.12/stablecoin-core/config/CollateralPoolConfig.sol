pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

import "../../interfaces/IPriceFeed.sol";
import "../../interfaces/IGenericTokenAdapter.sol";
import "../../interfaces/ICollateralPoolConfig.sol";

contract CollateralPoolConfig is AccessControlUpgradeable, ICollateralPoolConfig {
  using SafeMathUpgradeable for uint256;

  bytes32 public constant OWNER_ROLE = DEFAULT_ADMIN_ROLE;
  bytes32 public constant PRICE_ORACLE_ROLE = keccak256("PRICE_ORACLE_ROLE");
  bytes32 public constant BOOK_KEEPER_ROLE = keccak256("BOOK_KEEPER_ROLE");
  bytes32 public constant STABILITY_FEE_COLLECTOR_ROLE = keccak256("STABILITY_FEE_COLLECTOR_ROLE");

  event LogSetPriceWithSafetyMargin(address indexed caller, bytes32 collateralPoolId, uint256 priceWithSafetyMargin);
  event LogSetDebtCeiling(address indexed caller, bytes32 collateralPoolId, uint256 debtCeiling);
  event LogSetDebtFloor(address indexed caller, bytes32 collateralPoolId, uint256 debtFloor);
  event LogSetPriceFeed(address indexed caller, bytes32 poolId, address priceFeed);
  event LogSetLiquidationRatio(address indexed caller, bytes32 poolId, uint256 data);
  event LogSetStabilityFeeRate(address indexed caller, bytes32 poolId, uint256 data);
  event LogSetAdapter(address indexed caller, bytes32 collateralPoolId, address _adapter);
  event LogSetCloseFactorBps(address indexed caller, bytes32 collateralPoolId, uint256 _closeFactorBps);
  event LogSetLiquidatorIncentiveBps(address indexed caller, bytes32 collateralPoolId, uint256 _liquidatorIncentiveBps);
  event LogSetTreasuryFeesBps(address indexed caller, bytes32 collateralPoolId, uint256 _treasuryFeeBps);

  mapping(bytes32 => CollateralPool) public override collateralPools;

  modifier onlyOwner() {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    _;
  }

  // --- Init ---
  function initialize() external initializer {
    AccessControlUpgradeable.__AccessControl_init();

    // Grant the contract deployer the owner role: it will be able
    // to grant and revoke any roles
    _setupRole(OWNER_ROLE, msg.sender);
  }

  function initCollateralPool(
    bytes32 _collateralPoolId,
    uint256 _debtCeiling,
    uint256 _debtFloor,
    IPriceFeed _priceFeed,
    uint256 _liquidationRatio,
    uint256 _stabilityFeeRate,
    IGenericTokenAdapter _adapter,
    uint256 _closeFactorBps,
    uint256 _liquidatorIncentiveBps,
    uint256 _treasuryFeesBps
  ) external onlyOwner {
    require(
      collateralPools[_collateralPoolId].debtAccumulatedRate == 0,
      "CollateralPoolConfig/collateral-pool-already-init"
    );
    collateralPools[_collateralPoolId].debtAccumulatedRate = 10**27;
    collateralPools[_collateralPoolId].debtCeiling = _debtCeiling;
    collateralPools[_collateralPoolId].debtFloor = _debtFloor;
    _priceFeed.peekPrice(); // Sanity Check Call
    collateralPools[_collateralPoolId].priceFeed = _priceFeed;
    collateralPools[_collateralPoolId].liquidationRatio = _liquidationRatio;
    collateralPools[_collateralPoolId].stabilityFeeRate = _stabilityFeeRate;
    collateralPools[_collateralPoolId].lastAccumulationTime = now;
    _adapter.decimals(); // Sanity Check Call
    collateralPools[_collateralPoolId].adapter = _adapter;
    collateralPools[_collateralPoolId].closeFactorBps = _closeFactorBps;
    collateralPools[_collateralPoolId].liquidatorIncentiveBps = _liquidatorIncentiveBps;
    collateralPools[_collateralPoolId].treasuryFeesBps = _treasuryFeesBps;
  }

  function setPriceWithSafetyMargin(bytes32 _collateralPoolId, uint256 _priceWithSafetyMargin) external override {
    require(hasRole(PRICE_ORACLE_ROLE, msg.sender), "!priceOracleRole");
    collateralPools[_collateralPoolId].priceWithSafetyMargin = _priceWithSafetyMargin;
    emit LogSetPriceWithSafetyMargin(msg.sender, _collateralPoolId, _priceWithSafetyMargin);
  }

  function setDebtCeiling(bytes32 _collateralPoolId, uint256 _debtCeiling) external onlyOwner {
    collateralPools[_collateralPoolId].debtCeiling = _debtCeiling;
    emit LogSetDebtCeiling(msg.sender, _collateralPoolId, _debtCeiling);
  }

  function setDebtFloor(bytes32 _collateralPoolId, uint256 _debtFloor) external onlyOwner {
    collateralPools[_collateralPoolId].debtFloor = _debtFloor;
    emit LogSetDebtFloor(msg.sender, _collateralPoolId, _debtFloor);
  }

  function setPriceFeed(bytes32 _poolId, address _priceFeed) external onlyOwner {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    collateralPools[_poolId].priceFeed = IPriceFeed(_priceFeed);
    emit LogSetPriceFeed(msg.sender, _poolId, _priceFeed);
  }

  function setLiquidationRatio(bytes32 _poolId, uint256 _data) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    collateralPools[_poolId].liquidationRatio = _data;
    emit LogSetLiquidationRatio(msg.sender, _poolId, _data);
  }

  /** @dev Set the stability fee rate of the collateral pool.
      The rate to be set here is the `r` in:

          r^N = APR

      Where:
        r = stability fee rate
        N = Accumulation frequency which is per-second in this case; the value will be 60*60*24*365 = 31536000 to signify the number of seconds within a year.
        APR = the annual percentage rate

    For example, to achieve 0.5% APR for stability fee rate:

          r^31536000 = 1.005

    Find the 31536000th root of 1.005 and we will get:

          r = 1.000000000158153903837946258002097...

    The rate is in [ray] format, so the actual value of `stabilityFeeRate` will be:

          stabilityFeeRate = 1000000000158153903837946258

    The above `stabilityFeeRate` will be the value we will use in this contract.
  */
  /// @param _collateralPool Collateral pool id
  /// @param _stabilityFeeRate the new stability fee rate [ray]
  function setStabilityFeeRate(bytes32 _collateralPool, uint256 _stabilityFeeRate) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    collateralPools[_collateralPool].stabilityFeeRate = _stabilityFeeRate;
    emit LogSetStabilityFeeRate(msg.sender, _collateralPool, _stabilityFeeRate);
  }

  function setAdapter(bytes32 collateralPoolId, address _adapter) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    collateralPools[collateralPoolId].adapter = IGenericTokenAdapter(_adapter);
    emit LogSetAdapter(msg.sender, collateralPoolId, _adapter);
  }

  function setCloseFactorBps(bytes32 collateralPoolId, uint256 _closeFactorBps) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(_closeFactorBps <= 10000, "CollateralPoolConfig/close-factor-bps-more-10000");
    collateralPools[collateralPoolId].closeFactorBps = _closeFactorBps;
    emit LogSetCloseFactorBps(msg.sender, collateralPoolId, _closeFactorBps);
  }

  function setLiquidatorIncentiveBps(bytes32 collateralPoolId, uint256 _liquidatorIncentiveBps) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(_liquidatorIncentiveBps <= 2500, "CollateralPoolConfig/liquidator-incentive-bps-more-2500");
    collateralPools[collateralPoolId].liquidatorIncentiveBps = _liquidatorIncentiveBps;
    emit LogSetLiquidatorIncentiveBps(msg.sender, collateralPoolId, _liquidatorIncentiveBps);
  }

  function setTreasuryFeesBps(bytes32 collateralPoolId, uint256 _treasuryFeesBps) external {
    require(hasRole(OWNER_ROLE, msg.sender), "!ownerRole");
    require(_treasuryFeesBps <= 2500, "CollateralPoolConfig/treasury-fees-bps-more-2500");
    collateralPools[collateralPoolId].treasuryFeesBps = _treasuryFeesBps;
    emit LogSetTreasuryFeesBps(msg.sender, collateralPoolId, _treasuryFeesBps);
  }

  function setTotalDebtShare(bytes32 _collateralPoolId, uint256 _totalDebtShare) external override {
    require(hasRole(BOOK_KEEPER_ROLE, msg.sender), "!bookKeeperRole");
    collateralPools[_collateralPoolId].totalDebtShare = _totalDebtShare;
  }

  function setDebtAccumulatedRate(bytes32 _collateralPoolId, uint256 _debtAccumulatedRate) external override {
    require(hasRole(BOOK_KEEPER_ROLE, msg.sender), "!bookKeeperRole");
    collateralPools[_collateralPoolId].debtAccumulatedRate = _debtAccumulatedRate;
  }

  function updateLastAccumulationTime(bytes32 _collateralPoolId) external override {
    require(hasRole(STABILITY_FEE_COLLECTOR_ROLE, msg.sender), "!stabilityFeeCollectorRole");
    collateralPools[_collateralPoolId].lastAccumulationTime = now;
  }
}
