import { ethers, upgrades, waffle } from "hardhat"
import { Signer, BigNumber, Wallet } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  BookKeeper__factory,
  CDPManager,
  CDPManager__factory,
  BookKeeper,
  ExponentialDecrease__factory,
  ExponentialDecrease,
} from "../../../typechain"
import { smockit, MockContract } from "@eth-optimism/smock"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import { Console } from "console"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { parseEther, formatBytes32String } = ethers.utils

type fixture = {
  exponentialDecrease: ExponentialDecrease
}

const loadFixtureHandler = async (maybeWallets?: Wallet[], maybeProvider?: MockProvider): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy ExponentialDecrease
  const ExponentialDecrease = (await ethers.getContractFactory(
    "ExponentialDecrease",
    deployer
  )) as ExponentialDecrease__factory
  const exponentialDecrease = await ExponentialDecrease.deploy()

  return { exponentialDecrease }
}

describe("ExponentialDecrease", () => {
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
  let exponentialDecrease: ExponentialDecrease
  let exponentialDecreaseAsAlice: ExponentialDecrease
  let exponentialDecreaseAsBob: ExponentialDecrease

  beforeEach(async () => {
    ;({ exponentialDecrease } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob, dev] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress, devAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      dev.getAddress(),
    ])

    exponentialDecreaseAsAlice = ExponentialDecrease__factory.connect(
      exponentialDecrease.address,
      alice
    ) as ExponentialDecrease
    exponentialDecreaseAsBob = ExponentialDecrease__factory.connect(
      exponentialDecrease.address,
      bob
    ) as ExponentialDecrease
  })

  describe("#price()", () => {
    // context("when starting price is 50 and 0 second", () => {
    //   it("should revert", async () => {
    //     const price = await exponentialDecrease.price(WeiPerWad.mul(50), 0)
    //     expect(price).to.be.equal(WeiPerWad.mul(50))
    //   })
    // })

    // context("when starting price is 50 and 1 second", () => {
    //   it("should revert", async () => {
    //     await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.mul(1))
    //     const price = await exponentialDecrease.price(WeiPerWad.mul(50), 1)
    //     expect(price).to.be.equal(WeiPerWad.mul(50))
    //   })
    // })

    context("when starting price is 50 and 2 second", () => {
      it("should revert", async () => {
        await exponentialDecrease.file(formatBytes32String("cut"), WeiPerRay.mul(1).sub(parseEther("0.1")))
        const price = await exponentialDecrease.price(WeiPerWad.mul(5), 4)
        expect(price).to.be.equal(WeiPerWad.mul(50))
      })
    })
  })
})
