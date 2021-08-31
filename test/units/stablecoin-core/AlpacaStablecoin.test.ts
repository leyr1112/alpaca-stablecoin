import { ethers, upgrades, waffle } from "hardhat"
import { Signer } from "ethers"
import chai from "chai"
import { MockProvider, solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import { AlpacaStablecoin__factory, AlpacaStablecoin } from "../../../typechain"
import { signDaiPermit } from "eth-permit"

import * as TimeHelpers from "../../helper/time"
import * as AssertHelpers from "../../helper/assert"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"
import { zeroAddress } from "ethereumjs-util"

chai.use(solidity)
const { expect } = chai
const { AddressZero } = ethers.constants
const { formatBytes32String } = ethers.utils

type fixture = {
  alpacaStablecoin: AlpacaStablecoin
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  // Deploy mocked BookKeeper
  const AlpacaStablecoin = (await ethers.getContractFactory("AlpacaStablecoin", deployer)) as AlpacaStablecoin__factory
  const alpacaStablecoin = (await upgrades.deployProxy(AlpacaStablecoin, [31337])) as AlpacaStablecoin
  await alpacaStablecoin.deployed()

  return { alpacaStablecoin }
}

describe("AlpacaStablecoin", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let bob: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string
  let bobAddress: string

  // Contracts
  let alpacaStablecoin: AlpacaStablecoin
  let alpacaStablecoinAsAlice: AlpacaStablecoin

  beforeEach(async () => {
    ;({ alpacaStablecoin } = await waffle.loadFixture(loadFixtureHandler))
    ;[deployer, alice, bob] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
    ])

    alpacaStablecoinAsAlice = AlpacaStablecoin__factory.connect(alpacaStablecoin.address, alice) as AlpacaStablecoin
  })

  context("#transferFrom", () => {
    context("when alice transfer to bob", () => {
      context("when alice doesn't have enough token", () => {
        it("should be revert", async () => {
          await expect(
            alpacaStablecoinAsAlice.transferFrom(aliceAddress, bobAddress, WeiPerWad.mul(100))
          ).to.be.revertedWith("AlpacaStablecoin/insufficient-balance")
        })
      })
      context("when alice has enough token", () => {
        context("when the caller is not the owner", async () => {
          it("should revert", async () => {
            await alpacaStablecoin.mint(aliceAddress, WeiPerWad.mul(100))
            await expect(
              alpacaStablecoin.transferFrom(aliceAddress, bobAddress, WeiPerWad.mul(100))
            ).to.be.revertedWith("AlpacaStablecoin/insufficient-allowance")
          })
          context("when Alice set allowance", () => {
            context("when allowance is not enough", () => {
              it("should revert", async () => {
                await alpacaStablecoin.mint(aliceAddress, WeiPerWad.mul(100))
                await alpacaStablecoinAsAlice.approve(deployerAddress, WeiPerWad)
                await expect(
                  alpacaStablecoin.transferFrom(aliceAddress, bobAddress, WeiPerWad.mul(100))
                ).to.be.revertedWith("AlpacaStablecoin/insufficient-allowance")
              })
            })
            context("when allowance is enough", () => {
              it("should be able to call transferFrom", async () => {
                await alpacaStablecoin.mint(aliceAddress, WeiPerWad.mul(100))
                await alpacaStablecoinAsAlice.approve(deployerAddress, WeiPerWad.mul(100))

                const allowanceDeployerAliceBefore = await alpacaStablecoin.allowance(aliceAddress, deployerAddress)
                expect(allowanceDeployerAliceBefore).to.be.equal(WeiPerWad.mul(100))
                const alpacaStablecoinAliceBefore = await alpacaStablecoin.balanceOf(aliceAddress)
                expect(alpacaStablecoinAliceBefore).to.be.equal(WeiPerWad.mul(100))
                const alpacaStablecoinBobBefore = await alpacaStablecoin.balanceOf(bobAddress)
                expect(alpacaStablecoinBobBefore).to.be.equal(WeiPerWad.mul(0))

                await expect(alpacaStablecoin.transferFrom(aliceAddress, bobAddress, WeiPerWad.mul(10)))
                  .to.emit(alpacaStablecoin, "Transfer")
                  .withArgs(aliceAddress, bobAddress, WeiPerWad.mul(10))

                const allowanceDeployerAliceAfter = await alpacaStablecoin.allowance(aliceAddress, deployerAddress)
                expect(allowanceDeployerAliceAfter).to.be.equal(WeiPerWad.mul(90))
                const alpacaStablecoinAliceAfter = await alpacaStablecoin.balanceOf(aliceAddress)
                expect(alpacaStablecoinAliceAfter).to.be.equal(WeiPerWad.mul(90))
                const alpacaStablecoinBobAfter = await alpacaStablecoin.balanceOf(bobAddress)
                expect(alpacaStablecoinBobAfter).to.be.equal(WeiPerWad.mul(10))
              })
            })
          })
        })
        context("when the caller is the owner", () => {
          it("should be able to call transferFrom", async () => {
            await alpacaStablecoin.mint(aliceAddress, WeiPerWad.mul(100))

            const alpacaStablecoinAliceBefore = await alpacaStablecoin.balanceOf(aliceAddress)
            expect(alpacaStablecoinAliceBefore).to.be.equal(WeiPerWad.mul(100))
            const alpacaStablecoinBobBefore = await alpacaStablecoin.balanceOf(bobAddress)
            expect(alpacaStablecoinBobBefore).to.be.equal(WeiPerWad.mul(0))

            await expect(alpacaStablecoinAsAlice.transferFrom(aliceAddress, bobAddress, WeiPerWad.mul(10)))
              .to.emit(alpacaStablecoin, "Transfer")
              .withArgs(aliceAddress, bobAddress, WeiPerWad.mul(10))

            const alpacaStablecoinAliceAfter = await alpacaStablecoin.balanceOf(aliceAddress)
            expect(alpacaStablecoinAliceAfter).to.be.equal(WeiPerWad.mul(90))
            const alpacaStablecoinBobAfter = await alpacaStablecoin.balanceOf(bobAddress)
            expect(alpacaStablecoinBobAfter).to.be.equal(WeiPerWad.mul(10))
          })
        })
      })
    })
  })

  context("#approve", () => {
    it("should be able call approve", async () => {
      const allowanceDeployerAliceBefore = await alpacaStablecoin.allowance(aliceAddress, deployerAddress)
      expect(allowanceDeployerAliceBefore).to.be.equal(0)

      await expect(alpacaStablecoinAsAlice.approve(deployerAddress, WeiPerWad))
        .to.emit(alpacaStablecoin, "Approval")
        .withArgs(aliceAddress, deployerAddress, WeiPerWad)

      const allowanceDeployerAliceAfter = await alpacaStablecoin.allowance(aliceAddress, deployerAddress)
      expect(allowanceDeployerAliceAfter).to.be.equal(WeiPerWad)
    })
  })

  context("#mint", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(alpacaStablecoinAsAlice.mint(aliceAddress, WeiPerWad.mul(100))).to.be.revertedWith(
          "AlpacaStablecoin/not-authorized"
        )
      })
    })
    context("when the caller is the owner", async () => {
      it("should be able to call mint", async () => {
        const alpacaStablecoinAliceBefore = await alpacaStablecoin.balanceOf(aliceAddress)
        expect(alpacaStablecoinAliceBefore).to.be.equal(0)
        const totalSupplyBefore = await alpacaStablecoin.totalSupply()
        expect(totalSupplyBefore).to.be.equal(0)

        // mint 100 AUSD
        await expect(alpacaStablecoin.mint(aliceAddress, WeiPerWad.mul(100)))
          .to.emit(alpacaStablecoin, "Transfer")
          .withArgs(AddressZero, aliceAddress, WeiPerWad.mul(100))

        const alpacaStablecoinAliceAfter = await alpacaStablecoin.balanceOf(aliceAddress)
        expect(alpacaStablecoinAliceAfter).to.be.equal(WeiPerWad.mul(100))
        const totalSupplyAfter = await alpacaStablecoin.totalSupply()
        expect(totalSupplyAfter).to.be.equal(WeiPerWad.mul(100))
      })
    })
  })

  context("#burn", () => {
    context("when alice doesn't have enough token", () => {
      it("should be revert", async () => {
        await expect(alpacaStablecoinAsAlice.burn(aliceAddress, WeiPerWad.mul(100))).to.be.revertedWith(
          "AlpacaStablecoin/insufficient-balance"
        )
      })
    })
    context("when alice has enough token", () => {
      context("when the caller is not the owner", async () => {
        it("should revert", async () => {
          await alpacaStablecoin.mint(aliceAddress, WeiPerWad.mul(100))
          await expect(alpacaStablecoin.burn(aliceAddress, WeiPerWad.mul(100))).to.be.revertedWith(
            "AlpacaStablecoin/insufficient-allowance"
          )
        })
        context("when Alice set allowance", () => {
          context("when allowance is not enough", () => {
            it("should revert", async () => {
              await alpacaStablecoin.mint(aliceAddress, WeiPerWad.mul(100))
              await alpacaStablecoinAsAlice.approve(deployerAddress, WeiPerWad)
              await expect(alpacaStablecoin.burn(aliceAddress, WeiPerWad.mul(100))).to.be.revertedWith(
                "AlpacaStablecoin/insufficient-allowance"
              )
            })
          })
          context("when allowance is enough", () => {
            it("should be able to call burn", async () => {
              await alpacaStablecoin.mint(aliceAddress, WeiPerWad.mul(100))
              await alpacaStablecoinAsAlice.approve(deployerAddress, WeiPerWad.mul(100))

              const allowanceDeployerAliceBefore = await alpacaStablecoin.allowance(aliceAddress, deployerAddress)
              expect(allowanceDeployerAliceBefore).to.be.equal(WeiPerWad.mul(100))
              const alpacaStablecoinAliceBefore = await alpacaStablecoin.balanceOf(aliceAddress)
              expect(alpacaStablecoinAliceBefore).to.be.equal(WeiPerWad.mul(100))
              const totalSupplyBefore = await alpacaStablecoin.totalSupply()
              expect(totalSupplyBefore).to.be.equal(WeiPerWad.mul(100))

              await expect(alpacaStablecoin.burn(aliceAddress, WeiPerWad.mul(10)))
                .to.emit(alpacaStablecoin, "Transfer")
                .withArgs(aliceAddress, AddressZero, WeiPerWad.mul(10))

              const allowanceDeployerAliceAfter = await alpacaStablecoin.allowance(aliceAddress, deployerAddress)
              expect(allowanceDeployerAliceAfter).to.be.equal(WeiPerWad.mul(90))
              const alpacaStablecoinAliceAfter = await alpacaStablecoin.balanceOf(aliceAddress)
              expect(alpacaStablecoinAliceAfter).to.be.equal(WeiPerWad.mul(90))
              const totalSupplyAfter = await alpacaStablecoin.totalSupply()
              expect(totalSupplyAfter).to.be.equal(WeiPerWad.mul(90))
            })
          })
        })
      })
      context("when the caller is the owner", () => {
        it("should be able to call burn", async () => {
          await alpacaStablecoin.mint(aliceAddress, WeiPerWad.mul(100))

          const alpacaStablecoinAliceBefore = await alpacaStablecoin.balanceOf(aliceAddress)
          expect(alpacaStablecoinAliceBefore).to.be.equal(WeiPerWad.mul(100))
          const totalSupplyBefore = await alpacaStablecoin.totalSupply()
          expect(totalSupplyBefore).to.be.equal(WeiPerWad.mul(100))

          await expect(alpacaStablecoinAsAlice.burn(aliceAddress, WeiPerWad.mul(10)))
            .to.emit(alpacaStablecoin, "Transfer")
            .withArgs(aliceAddress, AddressZero, WeiPerWad.mul(10))

          const alpacaStablecoinAliceAfter = await alpacaStablecoin.balanceOf(aliceAddress)
          expect(alpacaStablecoinAliceAfter).to.be.equal(WeiPerWad.mul(90))
          const totalSupplyAfter = await alpacaStablecoin.totalSupply()
          expect(totalSupplyAfter).to.be.equal(WeiPerWad.mul(90))
        })
      })
    })
  })

  context("#permit", () => {
    context("when holder is address0", () => {
      it("should be revert", async () => {
        await expect(
          alpacaStablecoinAsAlice.permit(
            AddressZero,
            aliceAddress,
            0,
            0,
            true,
            0,
            formatBytes32String(""),
            formatBytes32String("")
          )
        ).to.be.revertedWith("AlpacaStablecoin/invalid-address-0")
      })
    })
    context("", () => {
      it("should be revert", async () => {
        const result = await signDaiPermit(alice, alpacaStablecoin.address, aliceAddress, bobAddress)
        await alpacaStablecoinAsAlice.permit(result.holder, result.spender, result.nonce, result.expiry, true, result.v, result.r, result.s)
      })
    })
  })
})
