import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import * as TimeHelpers from "../../helper/time"
import { MaxUint256 } from "@ethersproject/constants"

import {
  ProxyWalletRegistry__factory,
  ProxyWalletFactory__factory,
  ProxyWalletRegistry,
  BookKeeper__factory,
  PositionManager,
  PositionManager__factory,
  BookKeeper,
  BEP20__factory,
  IbTokenAdapter__factory,
  IbTokenAdapter,
  AlpacaToken__factory,
  FairLaunch__factory,
  Shield__factory,
  BEP20,
  Shield,
  AlpacaToken,
  FairLaunch,
  AlpacaStablecoinProxyActions__factory,
  AlpacaStablecoinProxyActions,
  StabilityFeeCollector__factory,
  StabilityFeeCollector,
  StablecoinAdapter__factory,
  StablecoinAdapter,
  AlpacaStablecoin__factory,
  AlpacaStablecoin,
  ProxyWallet,
  LiquidationEngine__factory,
  LiquidationEngine,
  SystemDebtEngine__factory,
  SystemDebtEngine,
  FixedSpreadLiquidationStrategy__factory,
  FixedSpreadLiquidationStrategy,
  PriceOracle,
  PriceOracle__factory,
  SimplePriceFeed__factory,
  SimplePriceFeed,
} from "../../../typechain"
import { expect } from "chai"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import { loadProxyWalletFixtureHandler } from "../../helper/proxy"

import * as AssertHelpers from "../../helper/assert"

const { formatBytes32String } = ethers.utils

type fixture = {
  proxyWalletRegistry: ProxyWalletRegistry
  ibTokenAdapter: IbTokenAdapter
  stablecoinAdapter: StablecoinAdapter
  bookKeeper: BookKeeper
  ibDUMMY: BEP20
  shield: Shield
  alpacaToken: AlpacaToken
  fairLaunch: FairLaunch
  alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  positionManager: PositionManager
  stabilityFeeCollector: StabilityFeeCollector
  alpacaStablecoin: AlpacaStablecoin
  liquidationEngine: LiquidationEngine
  fixedSpreadLiquidationStrategy: FixedSpreadLiquidationStrategy
  simplePriceFeed: SimplePriceFeed
  systemDebtEngine: SystemDebtEngine
}

const ALPACA_PER_BLOCK = ethers.utils.parseEther("100")
const COLLATERAL_POOL_ID = formatBytes32String("ibDUMMY")
const CLOSE_FACTOR_BPS = BigNumber.from(5000)
const LIQUIDATOR_INCENTIVE_BPS = BigNumber.from(10250)
const TREASURY_FEE_BPS = BigNumber.from(100)
const BPS = BigNumber.from(10000)

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer, alice, bob, dev] = await ethers.getSigners()

  const ProxyWalletFactory = new ProxyWalletFactory__factory(deployer)
  const proxyWalletFactory = await ProxyWalletFactory.deploy()

  const ProxyWalletRegistry = new ProxyWalletRegistry__factory(deployer)
  const proxyWalletRegistry = (await upgrades.deployProxy(ProxyWalletRegistry, [
    proxyWalletFactory.address,
  ])) as ProxyWalletRegistry

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [])) as BookKeeper
  await bookKeeper.deployed()

  await bookKeeper.init(COLLATERAL_POOL_ID)
  await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10000000))
  await bookKeeper.setDebtCeiling(COLLATERAL_POOL_ID, WeiPerRad.mul(10000000))

  await bookKeeper.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployer.address)
  await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const ibDUMMY = await BEP20.deploy("ibDUMMY", "ibDUMMY")
  await ibDUMMY.deployed()
  await ibDUMMY.mint(await alice.getAddress(), ethers.utils.parseEther("1000000"))
  await ibDUMMY.mint(await bob.getAddress(), ethers.utils.parseEther("100"))

  // Deploy Alpaca's Fairlaunch
  const AlpacaToken = (await ethers.getContractFactory("AlpacaToken", deployer)) as AlpacaToken__factory
  const alpacaToken = await AlpacaToken.deploy(88, 89)
  await alpacaToken.mint(await deployer.getAddress(), ethers.utils.parseEther("150"))
  await alpacaToken.deployed()

  const FairLaunch = (await ethers.getContractFactory("FairLaunch", deployer)) as FairLaunch__factory
  const fairLaunch = await FairLaunch.deploy(alpacaToken.address, await dev.getAddress(), ALPACA_PER_BLOCK, 0, 0, 0)
  await fairLaunch.deployed()

  const Shield = (await ethers.getContractFactory("Shield", deployer)) as Shield__factory
  const shield = await Shield.deploy(deployer.address, fairLaunch.address)
  await shield.deployed()

  // Config Alpaca's FairLaunch
  // Assuming Deployer is timelock for easy testing
  await fairLaunch.addPool(1, ibDUMMY.address, true)
  await fairLaunch.transferOwnership(shield.address)
  await shield.transferOwnership(await deployer.getAddress())
  await alpacaToken.transferOwnership(fairLaunch.address)

  const IbTokenAdapter = (await ethers.getContractFactory("IbTokenAdapter", deployer)) as IbTokenAdapter__factory
  const ibTokenAdapter = (await upgrades.deployProxy(IbTokenAdapter, [
    bookKeeper.address,
    COLLATERAL_POOL_ID,
    ibDUMMY.address,
    alpacaToken.address,
    fairLaunch.address,
    0,
    shield.address,
    await deployer.getAddress(),
    BigNumber.from(1000),
    await dev.getAddress(),
  ])) as IbTokenAdapter
  await ibTokenAdapter.deployed()

  await bookKeeper.grantRole(ethers.utils.solidityKeccak256(["string"], ["ADAPTER_ROLE"]), ibTokenAdapter.address)
  await bookKeeper.grantRole(await bookKeeper.MINTABLE_ROLE(), deployer.address)

  // Deploy Alpaca Stablecoin
  const AlpacaStablecoin = (await ethers.getContractFactory("AlpacaStablecoin", deployer)) as AlpacaStablecoin__factory
  const alpacaStablecoin = await AlpacaStablecoin.deploy("Alpaca USD", "AUSD", "31337")
  await alpacaStablecoin.deployed()

  const StablecoinAdapter = (await ethers.getContractFactory(
    "StablecoinAdapter",
    deployer
  )) as StablecoinAdapter__factory
  const stablecoinAdapter = (await upgrades.deployProxy(StablecoinAdapter, [
    bookKeeper.address,
    alpacaStablecoin.address,
  ])) as StablecoinAdapter
  await stablecoinAdapter.deployed()

  await alpacaStablecoin.grantRole(await alpacaStablecoin.MINTER_ROLE(), stablecoinAdapter.address)

  const AlpacaStablecoinProxyActions = new AlpacaStablecoinProxyActions__factory(deployer)
  const alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions = await AlpacaStablecoinProxyActions.deploy()

  // Deploy PositionManager
  const PositionManager = (await ethers.getContractFactory("PositionManager", deployer)) as PositionManager__factory
  const positionManager = (await upgrades.deployProxy(PositionManager, [bookKeeper.address])) as PositionManager
  await positionManager.deployed()
  await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), positionManager.address)

  const SystemDebtEngine = (await ethers.getContractFactory("SystemDebtEngine", deployer)) as SystemDebtEngine__factory
  const systemDebtEngine = (await upgrades.deployProxy(SystemDebtEngine, [bookKeeper.address])) as SystemDebtEngine

  // Deploy StabilityFeeCollector
  const StabilityFeeCollector = (await ethers.getContractFactory(
    "StabilityFeeCollector",
    deployer
  )) as StabilityFeeCollector__factory
  const stabilityFeeCollector = (await upgrades.deployProxy(StabilityFeeCollector, [
    bookKeeper.address,
  ])) as StabilityFeeCollector
  await stabilityFeeCollector.init(COLLATERAL_POOL_ID)
  await stabilityFeeCollector.setSystemDebtEngine(systemDebtEngine.address)
  await bookKeeper.grantRole(await bookKeeper.STABILITY_FEE_COLLECTOR_ROLE(), stabilityFeeCollector.address)

  const LiquidationEngine = (await ethers.getContractFactory(
    "LiquidationEngine",
    deployer
  )) as LiquidationEngine__factory
  const liquidationEngine = (await upgrades.deployProxy(LiquidationEngine, [
    bookKeeper.address,
    systemDebtEngine.address,
  ])) as LiquidationEngine

  const PriceOracle = (await ethers.getContractFactory("PriceOracle", deployer)) as PriceOracle__factory
  const priceOracle = (await upgrades.deployProxy(PriceOracle, [bookKeeper.address])) as PriceOracle

  const FixedSpreadLiquidationStrategy = (await ethers.getContractFactory(
    "FixedSpreadLiquidationStrategy",
    deployer
  )) as FixedSpreadLiquidationStrategy__factory
  const fixedSpreadLiquidationStrategy = (await upgrades.deployProxy(FixedSpreadLiquidationStrategy, [
    bookKeeper.address,
    priceOracle.address,
    liquidationEngine.address,
    systemDebtEngine.address,
    positionManager.address,
  ])) as FixedSpreadLiquidationStrategy
  await liquidationEngine.setStrategy(COLLATERAL_POOL_ID, fixedSpreadLiquidationStrategy.address)
  await fixedSpreadLiquidationStrategy.setCollateralPool(
    COLLATERAL_POOL_ID,
    ibTokenAdapter.address,
    CLOSE_FACTOR_BPS,
    LIQUIDATOR_INCENTIVE_BPS,
    TREASURY_FEE_BPS
  )
  await fixedSpreadLiquidationStrategy.grantRole(
    await fixedSpreadLiquidationStrategy.LIQUIDATION_ENGINE_ROLE(),
    liquidationEngine.address
  )
  await bookKeeper.grantRole(await bookKeeper.LIQUIDATION_ENGINE_ROLE(), liquidationEngine.address)
  await bookKeeper.grantRole(await bookKeeper.LIQUIDATION_ENGINE_ROLE(), fixedSpreadLiquidationStrategy.address)

  const SimplePriceFeed = (await ethers.getContractFactory("SimplePriceFeed", deployer)) as SimplePriceFeed__factory
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed, [])) as SimplePriceFeed
  await simplePriceFeed.deployed()
  await priceOracle.setPriceFeed(COLLATERAL_POOL_ID, simplePriceFeed.address)

  return {
    proxyWalletRegistry,
    ibTokenAdapter,
    stablecoinAdapter,
    bookKeeper,
    ibDUMMY,
    shield,
    alpacaToken,
    fairLaunch,
    alpacaStablecoinProxyActions,
    positionManager,
    stabilityFeeCollector,
    alpacaStablecoin,
    liquidationEngine,
    fixedSpreadLiquidationStrategy,
    simplePriceFeed,
    systemDebtEngine,
  }
}

describe("LiquidationEngine", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let bob: Signer
  let dev: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string
  let bobAddress: string
  let devAddress: string

  // Contracts
  let proxyWalletRegistry: ProxyWalletRegistry

  let proxyWalletRegistryAsAlice: ProxyWalletRegistry
  let proxyWalletRegistryAsBob: ProxyWalletRegistry

  let deployerProxyWallet: ProxyWallet
  let aliceProxyWallet: ProxyWallet

  let ibTokenAdapter: IbTokenAdapter
  let stablecoinAdapter: StablecoinAdapter
  let bookKeeper: BookKeeper
  let ibDUMMY: BEP20
  let shield: Shield
  let alpacaToken: AlpacaToken
  let fairLaunch: FairLaunch

  let positionManager: PositionManager

  let stabilityFeeCollector: StabilityFeeCollector

  let liquidationEngine: LiquidationEngine
  let fixedSpreadLiquidationStrategy: FixedSpreadLiquidationStrategy

  let alpacaStablecoinProxyActions: AlpacaStablecoinProxyActions

  let alpacaStablecoin: AlpacaStablecoin

  let simplePriceFeed: SimplePriceFeed

  let systemDebtEngine: SystemDebtEngine

  // Signer
  let ibTokenAdapterAsAlice: IbTokenAdapter
  let ibTokenAdapterAsBob: IbTokenAdapter

  let ibDUMMYasAlice: BEP20
  let ibDUMMYasBob: BEP20

  let liquidationEngineAsBob: LiquidationEngine

  let simplePriceFeedAsDeployer: SimplePriceFeed

  let bookKeeperAsBob: BookKeeper

  before(async () => {
    ;({
      proxyWallets: [deployerProxyWallet, aliceProxyWallet],
    } = await waffle.loadFixture(loadProxyWalletFixtureHandler))
  })

  beforeEach(async () => {
    ;({
      proxyWalletRegistry,
      ibTokenAdapter,
      stablecoinAdapter,
      bookKeeper,
      ibDUMMY,
      shield,
      alpacaToken,
      fairLaunch,
      alpacaStablecoinProxyActions,
      positionManager,
      stabilityFeeCollector,
      alpacaStablecoin,
      liquidationEngine,
      fixedSpreadLiquidationStrategy,
      simplePriceFeed,
      systemDebtEngine,
    } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])
    proxyWalletRegistryAsAlice = ProxyWalletRegistry__factory.connect(proxyWalletRegistry.address, alice)
    proxyWalletRegistryAsBob = ProxyWalletRegistry__factory.connect(proxyWalletRegistry.address, bob)

    ibTokenAdapterAsAlice = IbTokenAdapter__factory.connect(ibTokenAdapter.address, alice)
    ibTokenAdapterAsBob = IbTokenAdapter__factory.connect(ibTokenAdapter.address, bob)

    ibDUMMYasAlice = BEP20__factory.connect(ibDUMMY.address, alice)
    ibDUMMYasBob = BEP20__factory.connect(ibDUMMY.address, bob)

    liquidationEngineAsBob = LiquidationEngine__factory.connect(liquidationEngine.address, bob)

    simplePriceFeedAsDeployer = SimplePriceFeed__factory.connect(simplePriceFeed.address, deployer)

    bookKeeperAsBob = BookKeeper__factory.connect(bookKeeper.address, bob)
  })
  describe("#liquidate", async () => {
    context("price drop but does not make the position underwater", async () => {
      it("should revert", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          WeiPerWad,
          WeiPerWad,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)

        // 3. ibDUMMY price drop to 1 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay)

        // 4. Bob try to liquidate Alice's position but failed due to the price did not drop low enough
        await expect(
          liquidationEngineAsBob.liquidate(COLLATERAL_POOL_ID, alicePositionAddress, 1, 1, aliceAddress, "0x")
        ).to.be.revertedWith("LiquidationEngine/position-is-safe")
      })
    })

    context("safety buffer -0.1%, but liquidator does not have enough AUSD to liquidate", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.99 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
        await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("0.5")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)

        await expect(
          liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            debtShareToRepay,
            bobAddress,
            ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
          )
        ).to.be.reverted
      })
    })

    context("safety buffer -0.1%, position is liquidated up to full close factor", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.99 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
        await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("0.5")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )

        // 5. Settle system bad debt
        await systemDebtEngine.settleSystemBadDebt(debtShareToRepay.mul(WeiPerRay))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        const expectedSeizedCollateral = debtShareToRepay.mul(LIQUIDATOR_INCENTIVE_BPS).div(BPS)
        const expectedTreasuryFee = expectedSeizedCollateral.mul(TREASURY_FEE_BPS).div(BPS)
        const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)

        expect(
          alicePositionAfterLiquidation.lockedCollateral,
          "lockedCollateral should be 0.4875 ibDUMMY after including liquidator incentive and treasury fee"
        )
          .to.be.equal(lockedCollateralAmount.sub(expectedSeizedCollateral))
          .to.be.equal(ethers.utils.parseEther("0.4875"))
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 0.5 AUSD, because Bob liquidated 0.5 AUSD from Alice's position"
        )
          .to.be.equal(alicePosition.debtShare.sub(debtShareToRepay))
          .to.be.equal(ethers.utils.parseEther("0.5"))
        expect(
          await bookKeeper.systemBadDebt(systemDebtEngine.address),
          "System bad debt should be 0 AUSD"
        ).to.be.equal(0)
        expect(await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress), "Bob should receive 0.507375 ibDUMMY")
          .to.be.equal(expectedCollateralBobShouldReceive)
          .to.be.equal(ethers.utils.parseEther("0.507375"))
        expect(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation),
          "Bob should pay 0.5 AUSD for this liquidation"
        ).to.be.equal(ethers.utils.parseEther("0.5").mul(WeiPerRay))
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address),
          "SystemDebtEngine should receive 0.005125 ibDUMMY as treasury fee"
        )
          .to.be.equal(expectedTreasuryFee)
          .to.be.equal(ethers.utils.parseEther("0.005125"))
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)
      })
    })

    context("safety buffer -0.1%, position is liquidated up to some portion of close factor", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.99 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
        await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("0.1")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          bobAddress,
          "0x"
        )

        // 5. Settle system bad debt
        await systemDebtEngine.settleSystemBadDebt(debtShareToRepay.mul(WeiPerRay))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        const expectedSeizedCollateral = debtShareToRepay.mul(LIQUIDATOR_INCENTIVE_BPS).div(BPS)
        const expectedTreasuryFee = expectedSeizedCollateral.mul(TREASURY_FEE_BPS).div(BPS)
        const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)

        expect(
          alicePositionAfterLiquidation.lockedCollateral,
          "lockedCollateral should be 0.8975 ibDUMMY after including liquidator incentive and treasury fee"
        )
          .to.be.equal(lockedCollateralAmount.sub(expectedSeizedCollateral))
          .to.be.equal(ethers.utils.parseEther("0.8975"))
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 0.9 AUSD, because Bob liquidated 0.1 AUSD from Alice's position"
        )
          .to.be.equal(alicePosition.debtShare.sub(debtShareToRepay))
          .to.be.equal(ethers.utils.parseEther("0.9"))
        expect(
          await bookKeeper.systemBadDebt(systemDebtEngine.address),
          "System bad debt should be 0 AUSD"
        ).to.be.equal(0)
        expect(await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress), "Bob should receive 0.101475 ibDUMMY")
          .to.be.equal(expectedCollateralBobShouldReceive)
          .to.be.equal(ethers.utils.parseEther("0.101475"))
        expect(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation),
          "Bob should pay 0.1 AUSD for this liquidation"
        ).to.be.equal(ethers.utils.parseEther("0.1").mul(WeiPerRay))
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address),
          "SystemDebtEngine should receive 0.001025 ibDUMMY as treasury fee"
        )
          .to.be.equal(expectedTreasuryFee)
          .to.be.equal(ethers.utils.parseEther("0.001025"))
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)
      })
    })

    context("safety buffer -0.1%, position is liquidated exceeding close factor", async () => {
      it("should liquidate up to close factor successfully", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.99 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
        await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

        // 4. Bob liquidate Alice's position
        const debtShareToRepay = ethers.utils.parseEther("1")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )

        // 5. Settle system bad debt
        await systemDebtEngine.settleSystemBadDebt(ethers.utils.parseEther("0.5").mul(WeiPerRay))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        const expectedSeizedCollateral = ethers.utils.parseEther("0.5").mul(LIQUIDATOR_INCENTIVE_BPS).div(BPS)
        const expectedTreasuryFee = expectedSeizedCollateral.mul(TREASURY_FEE_BPS).div(BPS)
        const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)

        expect(
          alicePositionAfterLiquidation.lockedCollateral,
          "lockedCollateral should be 0.4875 ibDUMMY after including liquidator incentive and treasury fee"
        )
          .to.be.equal(lockedCollateralAmount.sub(expectedSeizedCollateral))
          .to.be.equal(ethers.utils.parseEther("0.4875"))
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 0.5 AUSD, because Bob liquidated 0.5 AUSD from Alice's position"
        ).to.be.equal(ethers.utils.parseEther("0.5"))
        expect(
          await bookKeeper.systemBadDebt(systemDebtEngine.address),
          "System bad debt should be 0 AUSD"
        ).to.be.equal(0)
        expect(await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress), "Bob should receive 0.507375 ibDUMMY")
          .to.be.equal(expectedCollateralBobShouldReceive)
          .to.be.equal(ethers.utils.parseEther("0.507375"))
        expect(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation),
          "Bob should pay 0.5 AUSD for this liquidation"
        ).to.be.equal(ethers.utils.parseEther("0.5").mul(WeiPerRay))
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address),
          "SystemDebtEngine should receive 0.005125 ibDUMMY as treasury fee"
        )
          .to.be.equal(expectedTreasuryFee)
          .to.be.equal(ethers.utils.parseEther("0.005125"))
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)
      })
    })

    context("safety buffer -20%, position is liquidated up to full close factor", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.80 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, ethers.utils.parseEther("0.8").mul(1e9))
        await simplePriceFeedAsDeployer.setPrice(ethers.utils.parseEther("0.8"))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("0.5")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )

        // 5. Settle system bad debt
        await systemDebtEngine.settleSystemBadDebt(debtShareToRepay.mul(WeiPerRay))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        const expectedSeizedCollateral = ethers.utils.parseEther("0.625").mul(LIQUIDATOR_INCENTIVE_BPS).div(BPS)
        const expectedTreasuryFee = expectedSeizedCollateral.mul(TREASURY_FEE_BPS).div(BPS)
        const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)

        expect(
          alicePositionAfterLiquidation.lockedCollateral,
          "lockedCollateral should be 0.359375 ibDUMMY after including liquidator incentive and treasury fee"
        )
          .to.be.equal(lockedCollateralAmount.sub(expectedSeizedCollateral))
          .to.be.equal(ethers.utils.parseEther("0.359375"))
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 0.5 AUSD, because Bob liquidated 0.5 AUSD from Alice's position"
        )
          .to.be.equal(alicePosition.debtShare.sub(debtShareToRepay))
          .to.be.equal(ethers.utils.parseEther("0.5"))
        expect(
          await bookKeeper.systemBadDebt(systemDebtEngine.address),
          "System bad debt should be 0 AUSD"
        ).to.be.equal(0)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress),
          "Bob should receive 0.63421875 ibDUMMY"
        )
          .to.be.equal(expectedCollateralBobShouldReceive)
          .to.be.equal(ethers.utils.parseEther("0.63421875"))
        expect(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation),
          "Bob should pay 0.5 AUSD for this liquidation"
        ).to.be.equal(ethers.utils.parseEther("0.5").mul(WeiPerRay))
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address),
          "SystemDebtEngine should receive 0.00640625 ibDUMMY as treasury fee"
        )
          .to.be.equal(expectedTreasuryFee)
          .to.be.equal(ethers.utils.parseEther("0.00640625"))
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)
      })
    })

    context("safety buffer -20%, position is liquidated up to some portion of close factor", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.80 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, ethers.utils.parseEther("0.8").mul(1e9))
        await simplePriceFeedAsDeployer.setPrice(ethers.utils.parseEther("0.8"))

        // 4. Bob liquidate Alice's position
        const debtShareToRepay = ethers.utils.parseEther("0.1")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )

        // 5. Settle system bad debt
        await systemDebtEngine.settleSystemBadDebt(debtShareToRepay.mul(WeiPerRay))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        const expectedSeizedCollateral = ethers.utils.parseEther("0.125").mul(LIQUIDATOR_INCENTIVE_BPS).div(BPS)
        const expectedTreasuryFee = expectedSeizedCollateral.mul(TREASURY_FEE_BPS).div(BPS)
        const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)

        expect(
          alicePositionAfterLiquidation.lockedCollateral,
          "lockedCollateral should be 0.871875 ibDUMMY after including liquidator incentive and treasury fee"
        )
          .to.be.equal(lockedCollateralAmount.sub(expectedSeizedCollateral))
          .to.be.equal(ethers.utils.parseEther("0.871875"))
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 0.9 AUSD, because Bob liquidated 0.1 AUSD from Alice's position"
        )
          .to.be.equal(alicePosition.debtShare.sub(debtShareToRepay))
          .to.be.equal(ethers.utils.parseEther("0.9"))
        expect(
          await bookKeeper.systemBadDebt(systemDebtEngine.address),
          "System bad debt should be 0 AUSD"
        ).to.be.equal(0)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress),
          "Bob should receive 0.12684375 ibDUMMY"
        )
          .to.be.equal(expectedCollateralBobShouldReceive)
          .to.be.equal(ethers.utils.parseEther("0.12684375"))
        expect(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation),
          "Bob should pay 0.1 AUSD for this liquidation"
        ).to.be.equal(ethers.utils.parseEther("0.1").mul(WeiPerRay))
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address),
          "SystemDebtEngine should receive 0.00128125 ibDUMMY as treasury fee"
        )
          .to.be.equal(expectedTreasuryFee)
          .to.be.equal(ethers.utils.parseEther("0.00128125"))
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)
      })
    })

    context("safety buffer -50%, position is liquidated up to full close factor", async () => {
      it("should fully liquidate the position", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.50 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, ethers.utils.parseEther("0.5").mul(1e9))
        await simplePriceFeedAsDeployer.setPrice(ethers.utils.parseEther("0.5"))

        // 4. Bob liquidate Alice's position
        const debtShareToRepay = ethers.utils.parseEther("0.5")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )

        // 5. Settle system bad debt
        await systemDebtEngine.settleSystemBadDebt(await bookKeeper.stablecoin(systemDebtEngine.address))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePositionAfterLiquidation.lockedCollateral,
          "lockedCollateral should be 0 ibDUMMY because the position was fully liquidated"
        ).to.be.equal(ethers.utils.parseEther("0"))
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 0 AUSD because the position was fully liquidated"
        ).to.be.equal(ethers.utils.parseEther("0"))
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.systemBadDebt(systemDebtEngine.address)).toString(),
          ethers.utils.parseEther("0.51219512").mul(WeiPerRay).toString()
        ) // System bad debt should be 0.51219512 AUSD
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress),
          "Bob should receive 0.99 ibDUMMY"
        ).to.be.equal(ethers.utils.parseEther("0.99"))
        AssertHelpers.assertAlmostEqual(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation).toString(),
          ethers.utils.parseEther("0.487804878048780487").mul(WeiPerRay).toString()
        ) // Bob should pay 0.487804878048780487 AUSD for this liquidation
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address),
          "SystemDebtEngine should receive 0.01 ibDUMMY as treasury fee"
        ).to.be.equal(ethers.utils.parseEther("0.01"))
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)
      })
    })

    context("safety buffer -50%, position collateral is liquidated within close factor", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.50 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, ethers.utils.parseEther("0.5").mul(1e9))
        await simplePriceFeedAsDeployer.setPrice(ethers.utils.parseEther("0.5"))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("0.483091787439613527")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )

        // 5. Settle system bad debt
        await systemDebtEngine.settleSystemBadDebt(debtShareToRepay.mul(WeiPerRay))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        const expectedSeizedCollateral = ethers.utils
          .parseEther("0.966183574879227054")
          .mul(LIQUIDATOR_INCENTIVE_BPS)
          .div(BPS)
        const expectedTreasuryFee = expectedSeizedCollateral.mul(TREASURY_FEE_BPS).div(BPS)
        const expectedCollateralBobShouldReceive = expectedSeizedCollateral.sub(expectedTreasuryFee)

        expect(
          alicePositionAfterLiquidation.lockedCollateral,
          "lockedCollateral should be 0.00966183574879227 ibDUMMY after including liquidator incentive and treasury fee"
        )
          .to.be.equal(lockedCollateralAmount.sub(expectedSeizedCollateral))
          .to.be.equal(ethers.utils.parseEther("0.00966183574879227"))
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 0.516908212560386473 AUSD, because Bob liquidated 0.483091787439613527 AUSD from Alice's position"
        )
          .to.be.equal(alicePosition.debtShare.sub(debtShareToRepay))
          .to.be.equal(ethers.utils.parseEther("0.516908212560386473"))
        expect(
          await bookKeeper.systemBadDebt(systemDebtEngine.address),
          "System bad debt should be 0 AUSD"
        ).to.be.equal(0)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress),
          "Bob should receive 0.980434782608695653 ibDUMMY"
        )
          .to.be.equal(expectedCollateralBobShouldReceive)
          .to.be.equal(ethers.utils.parseEther("0.980434782608695653"))
        expect(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation),
          "Bob should pay 0.483091787439613527 AUSD for this liquidation"
        ).to.be.equal(ethers.utils.parseEther("0.483091787439613527").mul(WeiPerRay))
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address),
          "SystemDebtEngine should receive 0.009903381642512077 ibDUMMY as treasury fee"
        )
          .to.be.equal(expectedTreasuryFee)
          .to.be.equal(ethers.utils.parseEther("0.009903381642512077"))
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)
      })
    })

    context("safety buffer -50%, position is liquidated gradually", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.50 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, ethers.utils.parseEther("0.5").mul(1e9))
        await simplePriceFeedAsDeployer.setPrice(ethers.utils.parseEther("0.5"))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("0.1")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          debtShareToRepay,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          ethers.utils.parseEther("1000"),
          ethers.utils.parseEther("1000"),
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )
        await systemDebtEngine.settleSystemBadDebt(await bookKeeper.stablecoin(systemDebtEngine.address))

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        expect(alicePositionAfterLiquidation.lockedCollateral).to.be.equal(0)
        expect(alicePositionAfterLiquidation.debtShare).to.be.equal(ethers.utils.parseEther("0"))
      })
    })

    context("1st liquidation keep position unsafe, 2nd position fully liquidate the position", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 3,000 USD with 75% Collateral Factor (priceWithSafetyMargin = 2,250 USD)
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2250))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1,800 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad.mul(1800)
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1,800 AUSD, because Alice drew 1,800 AUSD").to.be.equal(
          drawStablecoinAmount
        )
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1,800 AUSD from drawing 1,800 AUSD").to.be.equal(
          drawStablecoinAmount
        )
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 2,300 USD (priceWithSafetyMargin = 1,725 USD)
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(1725))
        await simplePriceFeedAsDeployer.setPrice(WeiPerWad.mul(2300))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(2000))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          ethers.utils.parseEther("324"),
          ethers.utils.parseEther("324"),
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          MaxUint256,
          MaxUint256,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )

        // 5. Settle system bad debt
        const totalDebtShareLiquidated = ethers.utils.parseEther("1062")
        await systemDebtEngine.settleSystemBadDebt(totalDebtShareLiquidated.mul(WeiPerRay))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        AssertHelpers.assertAlmostEqual(
          alicePositionAfterLiquidation.lockedCollateral.toString(),
          ethers.utils.parseEther("0.5267174").toString()
        )
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 738 AUSD, because Bob liquidated 1,062 AUSD from Alice's position"
        ).to.be.equal(ethers.utils.parseEther("738"))
        expect(
          await bookKeeper.systemBadDebt(systemDebtEngine.address),
          "System bad debt should be 0 AUSD"
        ).to.be.equal(0)
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress)).toString(),
          ethers.utils.parseEther("0.4685472").toString()
        )
        expect(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation),
          "Bob should pay 1062 AUSD for this liquidation"
        ).to.be.equal(ethers.utils.parseEther("1062").mul(WeiPerRay))
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address)).toString(),
          ethers.utils.parseEther("0.004732826").toString()
        )
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)

        await expect(
          liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            ethers.utils.parseEther("0.1"),
            ethers.utils.parseEther("0.1"),
            bobAddress,
            ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
          )
        ).to.be.revertedWith("LiquidationEngine/position-is-safe")
      })
    })

    context("price feed is manipulated", async () => {
      it("should revert, preventing position from being liquidated", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))

        // 2. Alice open a new position with 1 ibDUMMY and draw 1 AUSD
        const lockedCollateralAmount = WeiPerWad
        const drawStablecoinAmount = WeiPerWad
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(10000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)
        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1 ibDUMMY, because Alice locked 1 ibDUMMY"
        ).to.be.equal(WeiPerWad)
        expect(alicePosition.debtShare, "debtShare should be 1 AUSD, because Alice drew 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1 AUSD from drawing 1 AUSD").to.be.equal(WeiPerWad)
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. ibDUMMY price drop to 0.99 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.sub(1))
        await simplePriceFeedAsDeployer.setPrice(WeiPerRay.sub(1).div(1e9))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("0.5")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(100))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await simplePriceFeed.setPriceLife(0)
        await expect(
          liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            debtShareToRepay,
            bobAddress,
            ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
          )
        ).to.be.revertedWith("FixedSpreadLiquidationStrategy/invalid-price")
      })
    })

    context(
      "safety buffer -20%, position is liquidated up to full close factor with some interest and debt floor",
      async () => {
        it("should success", async () => {
          // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
          await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))
          await bookKeeper.setDebtFloor(COLLATERAL_POOL_ID, ethers.utils.parseEther("100").mul(WeiPerRay))

          // 2. Alice open a new position with 1000 ibDUMMY and draw 1000 AUSD
          const lockedCollateralAmount = ethers.utils.parseEther("1000")
          const drawStablecoinAmount = ethers.utils.parseEther("1000")
          const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
            positionManager.address,
            stabilityFeeCollector.address,
            ibTokenAdapter.address,
            stablecoinAdapter.address,
            COLLATERAL_POOL_ID,
            lockedCollateralAmount,
            drawStablecoinAmount,
            true,
            ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
          ])
          await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(100000000))
          await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)

          // Set stability fee rate to 0.5% APR
          await stabilityFeeCollector.setStabilityFeeRate(
            COLLATERAL_POOL_ID,
            BigNumber.from("1000000000158153903837946258")
          )

          const alicePositionAddress = await positionManager.positions(1)
          const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
          const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

          expect(
            alicePosition.lockedCollateral,
            "lockedCollateral should be 1000 ibDUMMY, because Alice locked 1000 ibDUMMY"
          ).to.be.equal(ethers.utils.parseEther("1000"))
          expect(alicePosition.debtShare, "debtShare should be 1000 AUSD, because Alice drew 1000 AUSD").to.be.equal(
            ethers.utils.parseEther("1000")
          )
          expect(
            await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
            "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
          ).to.be.equal(0)
          expect(alpacaStablecoinBalance, "Alice should receive 1000 AUSD from drawing 1000 AUSD").to.be.equal(
            ethers.utils.parseEther("1000")
          )
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
          ).to.be.equal(0)

          // 3. 1 year passed, ibDUMMY price drop to 0.80 USD
          await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("31536000")))
          await stabilityFeeCollector.collect(COLLATERAL_POOL_ID)
          const aliceDebtValueAfterOneYear = (
            await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
          ).debtShare.mul((await bookKeeper.collateralPools(COLLATERAL_POOL_ID)).debtAccumulatedRate)
          AssertHelpers.assertAlmostEqual(
            aliceDebtValueAfterOneYear.toString(),
            ethers.utils.parseEther("1005").mul(WeiPerRay).toString()
          )
          await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, ethers.utils.parseEther("0.8").mul(1e9))
          await simplePriceFeedAsDeployer.setPrice(ethers.utils.parseEther("0.8"))

          // 4. Bob liquidate Alice's position up to full close factor successfully
          const debtShareToRepay = ethers.utils.parseEther("500")
          await bookKeeperAsBob.whitelist(liquidationEngine.address)
          await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(10000))
          const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
          await liquidationEngineAsBob.liquidate(
            COLLATERAL_POOL_ID,
            alicePositionAddress,
            debtShareToRepay,
            debtShareToRepay,
            bobAddress,
            ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
          )

          // 5. Settle system bad debt
          await systemDebtEngine.settleSystemBadDebt(await bookKeeper.systemBadDebt(systemDebtEngine.address))
          AssertHelpers.assertAlmostEqual(
            (await bookKeeper.stablecoin(systemDebtEngine.address)).toString(),
            ethers.utils.parseEther("5").mul(WeiPerRay).toString()
          ) // There should be 5 AUSD left in SystemDebtEngine collected from stability fee after `settleSystemBadDebt`

          const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

          const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

          AssertHelpers.assertAlmostEqual(
            alicePositionAfterLiquidation.lockedCollateral.toString(),
            ethers.utils.parseEther("356.17188").toString()
          )
          expect(
            alicePositionAfterLiquidation.debtShare,
            "debtShare should be 500 AUSD, because Bob liquidated 500 AUSD from Alice's position"
          )
            .to.be.equal(alicePosition.debtShare.sub(debtShareToRepay))
            .to.be.equal(ethers.utils.parseEther("500"))
          expect(
            await bookKeeper.systemBadDebt(systemDebtEngine.address),
            "System bad debt should be 0 AUSD"
          ).to.be.equal(0)
          AssertHelpers.assertAlmostEqual(
            (await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress)).toString(),
            ethers.utils.parseEther("637.38984").toString()
          ) // Bob should receive 637.38984 ibDUMMY
          AssertHelpers.assertAlmostEqual(
            bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation).toString(),
            ethers.utils.parseEther("502.5").mul(WeiPerRay).toString()
          ) // Bob should pay 502.5 AUSD for this liquidation
          AssertHelpers.assertAlmostEqual(
            (await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address)).toString(),
            ethers.utils.parseEther("6.43828").toString()
          ) // SystemDebtEngine should receive 6.43828 ibDUMMY as treasury fee
          expect(
            await alpacaToken.balanceOf(aliceProxyWallet.address),
            "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
          ).to.not.equal(0)
        })
      }
    )

    context("safety buffer -20%, position collateral is fully liquidated because debt floor", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, WeiPerRay.mul(2))
        await bookKeeper.setDebtFloor(COLLATERAL_POOL_ID, ethers.utils.parseEther("500").mul(WeiPerRay))

        // 2. Alice open a new position with 1000 ibDUMMY and draw 1000 AUSD
        const lockedCollateralAmount = ethers.utils.parseEther("1000")
        const drawStablecoinAmount = ethers.utils.parseEther("1000")
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(100000000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)

        // Set stability fee rate to 0.5% APR
        await stabilityFeeCollector.setStabilityFeeRate(
          COLLATERAL_POOL_ID,
          BigNumber.from("1000000000158153903837946258")
        )

        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1000 ibDUMMY, because Alice locked 1000 ibDUMMY"
        ).to.be.equal(ethers.utils.parseEther("1000"))
        expect(alicePosition.debtShare, "debtShare should be 1000 AUSD, because Alice drew 1000 AUSD").to.be.equal(
          ethers.utils.parseEther("1000")
        )
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1000 AUSD from drawing 1000 AUSD").to.be.equal(
          ethers.utils.parseEther("1000")
        )
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. 1 year passed, ibDUMMY price drop to 0.80 USD
        await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("31536000")))
        await stabilityFeeCollector.collect(COLLATERAL_POOL_ID)
        const aliceDebtValueAfterOneYear = (
          await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        ).debtShare.mul((await bookKeeper.collateralPools(COLLATERAL_POOL_ID)).debtAccumulatedRate)
        AssertHelpers.assertAlmostEqual(
          aliceDebtValueAfterOneYear.toString(),
          ethers.utils.parseEther("1005").mul(WeiPerRay).toString()
        )
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, ethers.utils.parseEther("0.8").mul(1e9))
        await simplePriceFeedAsDeployer.setPrice(ethers.utils.parseEther("0.8"))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("500")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(10000))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          MaxUint256,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )

        // 5. Settle system bad debt
        await systemDebtEngine.settleSystemBadDebt(await bookKeeper.stablecoin(systemDebtEngine.address))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePositionAfterLiquidation.lockedCollateral,
          "lockedCollateral should be 0 AUSD, because full collateral liquidation was triggered"
        ).to.be.equal(0)
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 0 AUSD, because because full collateral liquidation was triggered"
        ).to.be.equal(0)

        // actualDebtValueToBeLiquidated = currentCollateralPrice * positionCollateralAmount * 10000 / liquidatorIncentiveBps
        // actualDebtValueToBeLiquidated = 0.8 * 1000 * 10000 / 10250
        // actualDebtValueToBeLiquidated = 780.48780488
        // systemBadDebt = positionDebtValue - actualDebtValueToBeLiquidated - accruedStabilityFee
        // systemBadDebt = 1005 - 780.48780488 - 5 = 219.51219512
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.systemBadDebt(systemDebtEngine.address)).toString(),
          ethers.utils.parseEther("219.51219512").mul(WeiPerRay).toString()
        )

        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress),
          "Bob should receive 990 ibDUMMY"
        ).to.be.equal(ethers.utils.parseEther("990"))

        // actualDebtValueToBeLiquidated = currentCollateralPrice * positionCollateralAmount * 10000 / liquidatorIncentiveBps
        // actualDebtValueToBeLiquidated = 0.8 * 1000 * 10000 / 10250
        // actualDebtValueToBeLiquidated = 780.48780488
        // Bob should pay 502.5 AUSD for this liquidation
        AssertHelpers.assertAlmostEqual(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation).toString(),
          ethers.utils.parseEther("780.48780488").mul(WeiPerRay).toString()
        )

        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address),
          "SystemDebtEngine should receive 10 ibDUMMY as treasury fee"
        ).to.be.equal(ethers.utils.parseEther("10"))

        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)
      })
    })

    context("safety buffer -13%, position debt is fully liquidated because debt floor", async () => {
      it("should success", async () => {
        // 1. Set priceWithSafetyMargin for ibDUMMY to 2 USD with 75% collateral factor
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, ethers.utils.parseEther("1.5").mul(WeiPerRay))
        await bookKeeper.setDebtFloor(COLLATERAL_POOL_ID, ethers.utils.parseEther("600").mul(WeiPerRay))

        // 2. Alice open a new position with 1000 ibDUMMY and draw 1000 AUSD
        const lockedCollateralAmount = ethers.utils.parseEther("1000")
        const drawStablecoinAmount = ethers.utils.parseEther("1000")
        const openPositionCall = alpacaStablecoinProxyActions.interface.encodeFunctionData("openLockTokenAndDraw", [
          positionManager.address,
          stabilityFeeCollector.address,
          ibTokenAdapter.address,
          stablecoinAdapter.address,
          COLLATERAL_POOL_ID,
          lockedCollateralAmount,
          drawStablecoinAmount,
          true,
          ethers.utils.defaultAbiCoder.encode(["address"], [aliceAddress]),
        ])
        await ibDUMMYasAlice.approve(aliceProxyWallet.address, WeiPerWad.mul(100000000))
        await aliceProxyWallet["execute(address,bytes)"](alpacaStablecoinProxyActions.address, openPositionCall)

        // Set stability fee rate to 0.5% APR
        await stabilityFeeCollector.setStabilityFeeRate(
          COLLATERAL_POOL_ID,
          BigNumber.from("1000000000158153903837946258")
        )

        const alicePositionAddress = await positionManager.positions(1)
        const alpacaStablecoinBalance = await alpacaStablecoin.balanceOf(aliceAddress)
        const alicePosition = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        expect(
          alicePosition.lockedCollateral,
          "lockedCollateral should be 1000 ibDUMMY, because Alice locked 1000 ibDUMMY"
        ).to.be.equal(ethers.utils.parseEther("1000"))
        expect(alicePosition.debtShare, "debtShare should be 1000 AUSD, because Alice drew 1000 AUSD").to.be.equal(
          ethers.utils.parseEther("1000")
        )
        expect(
          await bookKeeper.collateralToken(COLLATERAL_POOL_ID, alicePositionAddress),
          "collateralToken inside Alice's position address should be 0 ibDUMMY, because Alice locked all ibDUMMY into the position"
        ).to.be.equal(0)
        expect(alpacaStablecoinBalance, "Alice should receive 1000 AUSD from drawing 1000 AUSD").to.be.equal(
          ethers.utils.parseEther("1000")
        )
        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have 0 ALPACA, as Alice has not harvest any rewards from her position"
        ).to.be.equal(0)

        // 3. 1 year passed, ibDUMMY price drop to 1.30 USD
        await TimeHelpers.increase(TimeHelpers.duration.seconds(ethers.BigNumber.from("31536000")))
        await stabilityFeeCollector.collect(COLLATERAL_POOL_ID)
        const aliceDebtValueAfterOneYear = (
          await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)
        ).debtShare.mul((await bookKeeper.collateralPools(COLLATERAL_POOL_ID)).debtAccumulatedRate)
        AssertHelpers.assertAlmostEqual(
          aliceDebtValueAfterOneYear.toString(),
          ethers.utils.parseEther("1005").mul(WeiPerRay).toString()
        )
        await bookKeeper.setPriceWithSafetyMargin(COLLATERAL_POOL_ID, ethers.utils.parseEther("0.975").mul(1e9))
        await simplePriceFeedAsDeployer.setPrice(ethers.utils.parseEther("1.3"))

        // 4. Bob liquidate Alice's position up to full close factor successfully
        const debtShareToRepay = ethers.utils.parseEther("500")
        await bookKeeperAsBob.whitelist(liquidationEngine.address)
        await bookKeeperAsBob.whitelist(fixedSpreadLiquidationStrategy.address)
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, bobAddress, WeiPerRad.mul(10000))
        const bobStablecoinBeforeLiquidation = await bookKeeper.stablecoin(bobAddress)
        await liquidationEngineAsBob.liquidate(
          COLLATERAL_POOL_ID,
          alicePositionAddress,
          debtShareToRepay,
          MaxUint256,
          bobAddress,
          ethers.utils.defaultAbiCoder.encode(["address", "bytes"], [bobAddress, []])
        )

        // 5. Settle system bad debt
        await systemDebtEngine.settleSystemBadDebt(await bookKeeper.systemBadDebt(systemDebtEngine.address))

        const bobStablecoinAfterLiquidation = await bookKeeper.stablecoin(bobAddress)

        const alicePositionAfterLiquidation = await bookKeeper.positions(COLLATERAL_POOL_ID, alicePositionAddress)

        // collateralAmountToBeLiquidated = actualDebtValueToBeLiquidated * liquidatorIncentiveBps / 10000 / currentCollateralPrice
        // collateralAmountToBeLiquidated = 1005 * 10250 / 10000 / 1.3 = 792.40384615
        // lockedCollateral = 1000 - 792.40384615 = 207.59615385
        // lockedCollateral should be 207.59615385 AUSD, because full debt liquidation was triggered
        AssertHelpers.assertAlmostEqual(
          alicePositionAfterLiquidation.lockedCollateral.toString(),
          ethers.utils.parseEther("207.59615385").toString()
        )
        expect(
          alicePositionAfterLiquidation.debtShare,
          "debtShare should be 0 AUSD, because because full collateral liquidation was triggered"
        ).to.be.equal(0)

        expect(await bookKeeper.systemBadDebt(systemDebtEngine.address), "System bad debt should be 0").to.be.equal(0)

        // collateralAmountToBeLiquidated = 792.40384615
        // Bob should receive = collateralAmountToBeLiquidated * (1 - treasuryFeesBps) = 792.40384615 * (1-0.01) = 784.47980769
        // Bob should receive 784.47980769 ibDUMMY
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.collateralToken(COLLATERAL_POOL_ID, bobAddress)).toString(),
          ethers.utils.parseEther("784.47980769").toString()
        )

        // Bob should pay 1005 AUSD for this liquidation
        AssertHelpers.assertAlmostEqual(
          bobStablecoinBeforeLiquidation.sub(bobStablecoinAfterLiquidation).toString(),
          ethers.utils.parseEther("1005").mul(WeiPerRay).toString()
        )

        // collateralAmountToBeLiquidated = 792.40384615
        // = 792.40384615 * 0.01 = 7.92403846
        // SystemDebtEngine should receive 7.92403846 ibDUMMY as treasury fee
        AssertHelpers.assertAlmostEqual(
          (await bookKeeper.collateralToken(COLLATERAL_POOL_ID, systemDebtEngine.address)).toString(),
          ethers.utils.parseEther("7.92403846").toString()
        )

        expect(
          await alpacaToken.balanceOf(aliceProxyWallet.address),
          "Alice's proxy wallet should have more than 0 ALPACA, because the liquidation process will distribute the pending ALPACA rewards to the position owner"
        ).to.not.equal(0)
      })
    })
  })
})
