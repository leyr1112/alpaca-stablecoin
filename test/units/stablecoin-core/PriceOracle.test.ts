import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { PriceOracle, PriceOracle__factory } from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"

import * as TimeHelpers from "../../helper/time"
import * as AssertHelpers from "../../helper/assert"
import * as UnitHelpers from "../../helper/unit"
import { formatBytes32BigNumber } from "../../helper/format"
import { WeiPerRay } from "../../helper/unit"

chai.use(solidity)
const { expect } = chai
const { One } = ethers.constants
const { formatBytes32String } = ethers.utils

type fixture = {
  priceOracle: PriceOracle
  mockedBookKeeper: MockContract
  mockedPriceFeed: MockContract
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const mockedBookKeeper = await smockit(await ethers.getContractFactory("BookKeeper", deployer))

  // Deploy mocked PriceFeed
  const mockedPriceFeed = await smockit(await ethers.getContractFactory("MockPriceFeed", deployer))

  // Deploy PriceOracle
  const PriceOracle = (await ethers.getContractFactory("PriceOracle", deployer)) as PriceOracle__factory
  const priceOracle = (await upgrades.deployProxy(PriceOracle, [mockedBookKeeper.address])) as PriceOracle
  await priceOracle.deployed()

  return { priceOracle, mockedBookKeeper, mockedPriceFeed }
}

describe("PriceOracle", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string

  // Contracts
  let mockedBookKeeper: MockContract
  let mockedPriceFeed: MockContract

  let priceOracle: PriceOracle
  let priceOracleAsAlice: PriceOracle

  beforeEach(async () => {
    ;({ priceOracle, mockedBookKeeper, mockedPriceFeed } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()])

    priceOracleAsAlice = PriceOracle__factory.connect(priceOracle.address, alice) as PriceOracle
  })

  describe("#setPrice()", () => {
    context("when price from price feed is 1", () => {
      context("and price with safety margin is 0", () => {
        it("should be success", async () => {
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(One), false])
          await priceOracle.setPriceFeed(formatBytes32String("BNB"), mockedPriceFeed.address)

          mockedBookKeeper.smocked.setPriceWithSafetyMargin.will.return.with()
          await expect(priceOracle.setPrice(formatBytes32String("BNB")))
            .to.emit(priceOracle, "SetPrice")
            .withArgs(formatBytes32String("BNB"), formatBytes32BigNumber(One), 0)

          const { calls: peek } = mockedPriceFeed.smocked.peek
          const { calls: setPriceWithSafetyMargin } = mockedBookKeeper.smocked.setPriceWithSafetyMargin
          expect(peek.length).to.be.equal(1)

          expect(setPriceWithSafetyMargin.length).to.be.equal(1)
          expect(setPriceWithSafetyMargin[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
          expect(setPriceWithSafetyMargin[0]._data).to.be.equal(BigNumber.from("0"))
        })
      })

      context("and price with safety margin is 10^43", () => {
        it("should be success", async () => {
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(One), true])
          await priceOracle.setPriceFeed(formatBytes32String("BNB"), mockedPriceFeed.address)

          await priceOracle.setLiquidationRatio(formatBytes32String("BNB"), 10 ** 10)

          await priceOracle.setStableCoinReferencePrice(10 ** 10)

          mockedBookKeeper.smocked.setPriceWithSafetyMargin.will.return.with()
          await expect(priceOracle.setPrice(formatBytes32String("BNB")))
            .to.emit(priceOracle, "SetPrice")
            .withArgs(formatBytes32String("BNB"), formatBytes32BigNumber(One), BigNumber.from("10").pow("43"))

          const { calls: peek } = mockedPriceFeed.smocked.peek
          const { calls: setPriceWithSafetyMargin } = mockedBookKeeper.smocked.setPriceWithSafetyMargin
          expect(peek.length).to.be.equal(1)

          expect(setPriceWithSafetyMargin.length).to.be.equal(1)
          expect(setPriceWithSafetyMargin[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
          expect(setPriceWithSafetyMargin[0]._data).to.be.equal(BigNumber.from("10").pow("43"))
        })
      })

      context("and price with safety margin is 9.31322574615478515625 * 10^53", () => {
        it("should be success", async () => {
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(One), true])
          await priceOracle.setPriceFeed(formatBytes32String("BNB"), mockedPriceFeed.address)

          await priceOracle.setLiquidationRatio(formatBytes32String("BNB"), 4 ** 10)

          await priceOracle.setStableCoinReferencePrice(2 ** 10)

          mockedBookKeeper.smocked.setPriceWithSafetyMargin.will.return.with()
          await expect(priceOracle.setPrice(formatBytes32String("BNB")))
            .to.emit(priceOracle, "SetPrice")
            .withArgs(
              formatBytes32String("BNB"),
              formatBytes32BigNumber(One),
              BigNumber.from("931322574615478515625").mul(BigNumber.from("10").pow("33"))
            )

          const { calls: peek } = mockedPriceFeed.smocked.peek
          const { calls: setPriceWithSafetyMargin } = mockedBookKeeper.smocked.setPriceWithSafetyMargin
          expect(peek.length).to.be.equal(1)

          expect(setPriceWithSafetyMargin.length).to.be.equal(1)
          expect(setPriceWithSafetyMargin[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
          expect(setPriceWithSafetyMargin[0]._data).to.be.equal(
            BigNumber.from("931322574615478515625").mul(BigNumber.from("10").pow("33"))
          )
        })
      })
    })

    context("when price from price feed is 7 * 10^11", () => {
      context("and price with safety margin is 0", () => {
        it("should be success", async () => {
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(BigNumber.from("700000000000")), false])
          await priceOracle.setPriceFeed(formatBytes32String("BNB"), mockedPriceFeed.address)

          mockedBookKeeper.smocked.setPriceWithSafetyMargin.will.return.with()
          await expect(priceOracle.setPrice(formatBytes32String("BNB")))
            .to.emit(priceOracle, "SetPrice")
            .withArgs(formatBytes32String("BNB"), formatBytes32BigNumber(BigNumber.from("700000000000")), 0)

          const { calls: peek } = mockedPriceFeed.smocked.peek
          const { calls: setPriceWithSafetyMargin } = mockedBookKeeper.smocked.setPriceWithSafetyMargin
          expect(peek.length).to.be.equal(1)

          expect(setPriceWithSafetyMargin.length).to.be.equal(1)
          expect(setPriceWithSafetyMargin[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
          expect(setPriceWithSafetyMargin[0]._data).to.be.equal(BigNumber.from("0"))
        })
      })

      context("and price with safety margin is 7 * 10^54", () => {
        it("should be success", async () => {
          mockedPriceFeed.smocked.peek.will.return.with([formatBytes32BigNumber(BigNumber.from("700000000000")), true])
          await priceOracle.setPriceFeed(formatBytes32String("BNB"), mockedPriceFeed.address)

          await priceOracle.setLiquidationRatio(formatBytes32String("BNB"), 10 ** 10)

          await priceOracle.setStableCoinReferencePrice(10 ** 10)

          mockedBookKeeper.smocked.setPriceWithSafetyMargin.will.return.with()
          await expect(priceOracle.setPrice(formatBytes32String("BNB")))
            .to.emit(priceOracle, "SetPrice")
            .withArgs(
              formatBytes32String("BNB"),
              formatBytes32BigNumber(BigNumber.from("700000000000")),
              BigNumber.from("7").mul(BigNumber.from("10").pow("54"))
            )

          const { calls: peek } = mockedPriceFeed.smocked.peek
          const { calls: setPriceWithSafetyMargin } = mockedBookKeeper.smocked.setPriceWithSafetyMargin
          expect(peek.length).to.be.equal(1)

          expect(setPriceWithSafetyMargin.length).to.be.equal(1)
          expect(setPriceWithSafetyMargin[0]._collateralPoolId).to.be.equal(formatBytes32String("BNB"))
          expect(setPriceWithSafetyMargin[0]._data).to.be.equal(BigNumber.from("7").mul(BigNumber.from("10").pow("54")))
        })
      })
    })
  })

  describe("#setPriceFeed", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          priceOracleAsAlice.setPriceFeed(formatBytes32String("BNB"), mockedPriceFeed.address)
        ).to.be.revertedWith("Spotter/not-authorized")
      })
    })
    context("when the caller is the owner", async () => {
      context("when priceOracle does not live", () => {
        it("should be revert", async () => {
          priceOracle.cage()

          await expect(
            priceOracle.setPriceFeed(formatBytes32String("BNB"), mockedPriceFeed.address)
          ).to.be.revertedWith("Spotter/not-live")
        })
      })
      context("when priceOracle is live", () => {
        it("should be able to call setPriceFeed", async () => {
          await expect(priceOracle.setPriceFeed(formatBytes32String("BNB"), mockedPriceFeed.address))
            .to.emit(priceOracle, "SetPriceFeed")
            .withArgs(deployerAddress, formatBytes32String("BNB"), mockedPriceFeed.address)
        })
      })
    })
  })

  describe("#setLiquidationRatio", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(priceOracleAsAlice.setLiquidationRatio(formatBytes32String("BNB"), 10 ** 10)).to.be.revertedWith(
          "Spotter/not-authorized"
        )
      })
    })
    context("when the caller is the owner", async () => {
      context("when priceOracle does not live", () => {
        it("should be revert", async () => {
          priceOracle.cage()

          await expect(priceOracle.setLiquidationRatio(formatBytes32String("BNB"), 10 ** 10)).to.be.revertedWith(
            "Spotter/not-live"
          )
        })
      })
      context("when priceOracle is live", () => {
        it("should be able to call setLiquidationRatio", async () => {
          await expect(priceOracle.setLiquidationRatio(formatBytes32String("BNB"), 10 ** 10))
            .to.emit(priceOracle, "SetLiquidationRatio")
            .withArgs(deployerAddress, formatBytes32String("BNB"), 10 ** 10)
        })
      })
    })
  })

  describe("#setStableCoinReferencePrice", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(priceOracleAsAlice.setStableCoinReferencePrice(10 ** 10)).to.be.revertedWith(
          "Spotter/not-authorized"
        )
      })
    })
    context("when the caller is the owner", async () => {
      context("when priceOracle does not live", () => {
        it("should be revert", async () => {
          priceOracle.cage()

          await expect(priceOracle.setStableCoinReferencePrice(10 ** 10)).to.be.revertedWith("Spotter/not-live")
        })
      })
      context("when priceOracle is live", () => {
        it("should be able to call setStableCoinReferencePrice", async () => {
          await expect(priceOracle.setStableCoinReferencePrice(10 ** 10))
            .to.emit(priceOracle, "SetStableCoinReferencePrice")
            .withArgs(deployerAddress, 10 ** 10)
        })
      })
    })
  })
})
