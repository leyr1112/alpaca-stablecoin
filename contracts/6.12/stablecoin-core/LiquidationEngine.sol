// SPDX-License-Identifier: AGPL-3.0-or-later

/// dog.sol -- Dai liquidation module 2.0

// Copyright (C) 2020-2021 Maker Ecosystem Growth Holdings, INC.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../interfaces/IBookKeeper.sol";
import "../interfaces/IAuctioneer.sol";
import "../interfaces/ILiquidationEngine.sol";
import "../interfaces/ISystemDebtEngine.sol";
import "../interfaces/ILiquidationStrategy.sol";

contract LiquidationEngine is
  OwnableUpgradeable,
  PausableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  ILiquidationEngine
{
  // --- Auth ---
  mapping(address => uint256) public whitelist;

  function rely(address usr) external auth {
    whitelist[usr] = 1;
    emit Rely(usr);
  }

  function deny(address usr) external auth {
    whitelist[usr] = 0;
    emit Deny(usr);
  }

  modifier auth() {
    require(whitelist[msg.sender] == 1, "LiquidationEngine/not-authorized");
    _;
  }

  // --- Data ---
  struct CollateralPool {
    address strategy; // Liquidation strategy address
  }

  IBookKeeper public bookKeeper; // CDP Engine

  mapping(bytes32 => CollateralPool) public override collateralPools;

  ISystemDebtEngine public systemDebtEngine; // Debt Engine
  uint256 public live; // Active Flag
  uint256 public liquidationMaxSize; // Max DAI needed to cover debt+fees of active auctions [rad]
  uint256 public stablecoinNeededForDebtRepay; // Amt DAI needed to cover debt+fees of active auctions [rad]

  // --- Events ---
  event Rely(address indexed usr);
  event Deny(address indexed usr);

  event File(bytes32 indexed what, uint256 data);
  event File(bytes32 indexed what, address data);
  event File(bytes32 indexed collateralPoolId, bytes32 indexed what, uint256 data);
  event File(bytes32 indexed collateralPoolId, bytes32 indexed what, address auctioneer);

  event StartLiquidation(
    bytes32 indexed collateralPoolId,
    address indexed positionAddress,
    uint256 collateralAmountToBeLiquidated,
    uint256 debtShareToBeLiquidated,
    uint256 debtValueToBeLiquidatedWithoutPenalty,
    address auctioneer,
    uint256 indexed id
  );
  event RemoveRepaidDebtFromAuction(bytes32 indexed collateralPoolId, uint256 rad);
  event Cage();

  // --- Init ---
  function initialize(address _bookKeeper) external initializer {
    OwnableUpgradeable.__Ownable_init();
    PausableUpgradeable.__Pausable_init();
    AccessControlUpgradeable.__AccessControl_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    bookKeeper = IBookKeeper(_bookKeeper);
    live = 1;
    whitelist[msg.sender] = 1;
    emit Rely(msg.sender);
  }

  // --- Math ---
  uint256 constant WAD = 10**18;

  function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
    z = x <= y ? x : y;
  }

  function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x + y) >= x);
  }

  function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require((z = x - y) <= x);
  }

  function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
    require(y == 0 || (z = x * y) / y == x);
  }

  // --- Administration ---
  function file(bytes32 what, address data) external auth {
    if (what == "systemDebtEngine") systemDebtEngine = ISystemDebtEngine(data);
    else revert("LiquidationEngine/file-unrecognized-param");
    emit File(what, data);
  }

  function file(bytes32 what, uint256 data) external auth {
    if (what == "liquidationMaxSize") liquidationMaxSize = data;
    else revert("LiquidationEngine/file-unrecognized-param");
    emit File(what, data);
  }

  // function file(
  //   bytes32 collateralPoolId,
  //   bytes32 what,
  //   uint256 data
  // ) external auth {
  //   if (what == "liquidationPenalty") {
  //     require(data >= WAD, "LiquidationEngine/file-liquidationPenalty-lt-WAD");
  //     collateralPools[collateralPoolId].liquidationPenalty = data;
  //   } else if (what == "liquidationMaxSize") collateralPools[collateralPoolId].liquidationMaxSize = data;
  //   else revert("LiquidationEngine/file-unrecognized-param");
  //   emit File(collateralPoolId, what, data);
  // }

  // function file(
  //   bytes32 collateralPoolId,
  //   bytes32 what,
  //   address auctioneer
  // ) external auth {
  //   if (what == "auctioneer") {
  //     require(
  //       collateralPoolId == IAuctioneer(auctioneer).collateralPoolId(),
  //       "LiquidationEngine/file-collateralPoolId-neq-auctioneer.collateralPoolId"
  //     );
  //     collateralPools[collateralPoolId].auctioneer = auctioneer;
  //   } else revert("LiquidationEngine/file-unrecognized-param");
  //   emit File(collateralPoolId, what, auctioneer);
  // }

  // function liquidationPenalty(bytes32 collateralPoolId) external view override returns (uint256) {
  //   return collateralPools[collateralPoolId].liquidationPenalty;
  // }

  // --- CDP Liquidation: all bark and no bite ---
  //
  // Liquidate a Vault and start a Dutch auction to sell its collateral for DAI.
  //
  // The third argument is the address that will receive the liquidation reward, if any.
  //
  // The entire Vault will be liquidated except when the target amount of DAI to be raised in
  // the resulting auction (debt of Vault + liquidation penalty) causes either stablecoinNeededForDebtRepay to exceed
  // liquidationMaxSize or collateralPool.stablecoinNeededForDebtRepay to exceed collateralPool.liquidationMaxSize by an economically significant amount. In that
  // case, a partial liquidation is performed to respect the global and per-collateralPool limits on
  // outstanding DAI target. The one exception is if the resulting auction would likely
  // have too little collateral to be interesting to Keepers (debt taken from Vault < collateralPool.debtFloor),
  // in which case the function reverts. Please refer to the code and comments within if
  // more detail is desired.
  function liquidate(
    bytes32 collateralPoolId,
    address positionAddress,
    address liquidatorAddress,
    uint256 debtShareToRepay,
    bytes calldata data
  ) external nonReentrant returns (uint256 id) {
    require(live == 1, "LiquidationEngine/not-live");

    (uint256 positionLockedCollateral, uint256 positionDebtShare) = bookKeeper.positions(
      collateralPoolId,
      positionAddress
    );
    CollateralPool memory mcollateralPool = collateralPools[collateralPoolId];
    uint256 debtAccumulatedRate;
    uint256 debtFloor;
    {
      // 1. Check if the position is underwater
      uint256 priceWithSafetyMargin;
      (, debtAccumulatedRate, priceWithSafetyMargin, , debtFloor) = bookKeeper.collateralPools(collateralPoolId);
      require(
        priceWithSafetyMargin > 0 &&
          mul(positionLockedCollateral, priceWithSafetyMargin) < mul(positionDebtShare, debtAccumulatedRate),
        "LiquidationEngine/not-unsafe"
      );
    }

    (address collateralRecipient, bytes memory ext) = abi.decode(data, (address, bytes));
    ILiquidationStrategy(mcollateralPool.strategy).execute(
      collateralPoolId,
      positionDebtShare,
      positionLockedCollateral,
      positionAddress,
      liquidatorAddress,
      debtShareToRepay,
      collateralRecipient,
      ext
    );
  }

  function removeRepaidDebtFromAuction(bytes32 collateralPoolId, uint256 rad) external override auth {
    // stablecoinNeededForDebtRepay = sub(stablecoinNeededForDebtRepay, rad);
    // collateralPools[collateralPoolId].stablecoinNeededForDebtRepay = sub(
    //   collateralPools[collateralPoolId].stablecoinNeededForDebtRepay,
    //   rad
    // );
    // emit RemoveRepaidDebtFromAuction(collateralPoolId, rad);
  }

  function cage() external override auth {
    live = 0;
    emit Cage();
  }
}
