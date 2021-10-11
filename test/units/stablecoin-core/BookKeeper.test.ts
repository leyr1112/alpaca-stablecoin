import { ethers, upgrades, waffle } from "hardhat"
import { Signer } from "ethers"
import chai from "chai"
import { solidity } from "ethereum-waffle"
import "@openzeppelin/test-helpers"
import {
  BookKeeper__factory,
  BookKeeper,
  CollateralPoolConfig__factory,
  CollateralPoolConfig,
  SimplePriceFeed__factory,
  SimplePriceFeed,
  TokenAdapter__factory,
  TokenAdapter,
  BEP20__factory,
  BEP20,
} from "../../../typechain"
import { WeiPerRad, WeiPerRay, WeiPerWad } from "../../helper/unit"

chai.use(solidity)
const { expect } = chai
const { formatBytes32String } = ethers.utils
const { AddressZero } = ethers.constants

type fixture = {
  bookKeeper: BookKeeper
  collateralPoolConfig: CollateralPoolConfig
  simplePriceFeed: SimplePriceFeed
  tokenAdapter: TokenAdapter
}

const loadFixtureHandler = async (): Promise<fixture> => {
  const [deployer] = await ethers.getSigners()

  const CollateralPoolConfig = (await ethers.getContractFactory(
    "CollateralPoolConfig",
    deployer
  )) as CollateralPoolConfig__factory
  const collateralPoolConfig = (await upgrades.deployProxy(CollateralPoolConfig, [])) as CollateralPoolConfig

  // Deploy mocked BookKeeper
  const BookKeeper = (await ethers.getContractFactory("BookKeeper", deployer)) as BookKeeper__factory
  const bookKeeper = (await upgrades.deployProxy(BookKeeper, [collateralPoolConfig.address])) as BookKeeper
  await bookKeeper.deployed()

  await collateralPoolConfig.grantRole(await collateralPoolConfig.BOOK_KEEPER_ROLE(), bookKeeper.address)

  const SimplePriceFeed = (await ethers.getContractFactory("SimplePriceFeed", deployer)) as SimplePriceFeed__factory
  const simplePriceFeed = (await upgrades.deployProxy(SimplePriceFeed, [])) as SimplePriceFeed
  await simplePriceFeed.deployed()

  // Deploy mocked BEP20
  const BEP20 = (await ethers.getContractFactory("BEP20", deployer)) as BEP20__factory
  const dummyToken = await BEP20.deploy("dummy", "DUMP")
  await dummyToken.deployed()

  const TokenAdapter = (await ethers.getContractFactory("TokenAdapter", deployer)) as TokenAdapter__factory
  const tokenAdapter = (await upgrades.deployProxy(TokenAdapter, [
    bookKeeper.address,
    formatBytes32String("BNB"),
    dummyToken.address,
  ])) as TokenAdapter
  await tokenAdapter.deployed()

  return { bookKeeper, collateralPoolConfig, simplePriceFeed, tokenAdapter }
}

describe("BookKeeper", () => {
  // Accounts
  let deployer: Signer
  let alice: Signer
  let bob: Signer

  // Account Addresses
  let deployerAddress: string
  let aliceAddress: string
  let bobAddress: string

  // Contracts

  let bookKeeper: BookKeeper
  let bookKeeperAsAlice: BookKeeper
  let bookKeeperAsBob: BookKeeper

  let collateralPoolConfig: CollateralPoolConfig
  let collateralPoolConfigAsAlice: CollateralPoolConfig
  let collateralPoolConfigAsBob: CollateralPoolConfig

  let simplePriceFeed: SimplePriceFeed
  let tokenAdapter: TokenAdapter

  beforeEach(async () => {
    ;({ bookKeeper, collateralPoolConfig, simplePriceFeed, tokenAdapter } = await waffle.loadFixture(
      loadFixtureHandler
    ))
    ;[deployer, alice, bob] = await ethers.getSigners()
    ;[deployerAddress, aliceAddress, bobAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
    ])

    bookKeeperAsAlice = BookKeeper__factory.connect(bookKeeper.address, alice) as BookKeeper
    bookKeeperAsBob = BookKeeper__factory.connect(bookKeeper.address, bob) as BookKeeper

    collateralPoolConfigAsAlice = CollateralPoolConfig__factory.connect(
      collateralPoolConfig.address,
      alice
    ) as CollateralPoolConfig
    collateralPoolConfigAsBob = CollateralPoolConfig__factory.connect(
      collateralPoolConfig.address,
      bob
    ) as CollateralPoolConfig
  })

  describe("#init", () => {
    context("when the caller is not the owner", () => {
      it("should revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )
        ).to.be.revertedWith("!ownerRole")
      })
    })

    context("when the caller is the owner", () => {
      context("when initialize BNB collateral pool", async () => {
        it("should be success", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          await collateralPoolConfig.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )
          const pool = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
          expect(pool.debtAccumulatedRate).equal(WeiPerRay)
        })
      })

      context("when collateral pool already init", () => {
        it("should be revert", async () => {
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          // first initialize BNB colleteral pool
          await collateralPoolConfig.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )
          // second initialize BNB colleteral pool
          await expect(
            collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
          ).to.be.revertedWith("CollateralPoolConfig/collateral-pool-already-init")
        })
      })

      context("when role can't authentication", () => {
        it("should be revert", async () => {
          await expect(
            collateralPoolConfigAsAlice.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
          ).to.be.revertedWith("!ownerRole")
        })
      })
    })
  })

  describe("#addCollateral", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          bookKeeperAsAlice.addCollateral(formatBytes32String("BNB"), deployerAddress, WeiPerWad)
        ).to.be.revertedWith("!adapterRole")
      })
    })

    context("when the caller is the owner", async () => {
      context("when collateral to add is positive", () => {
        it("should be able to call addCollateral", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
          // init BNB collateral pool
          await collateralPoolConfig.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )

          const collateralTokenBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), deployerAddress)
          expect(collateralTokenBefore).to.be.equal(0)

          await bookKeeper.addCollateral(formatBytes32String("BNB"), deployerAddress, WeiPerWad)

          const collateralTokenAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), deployerAddress)
          expect(collateralTokenAfter).to.be.equal(WeiPerWad)
        })
      })

      context("when collateral to add is negative", () => {
        it("should be able to call addCollateral", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
          await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)

          // init BNB collateral pool
          await collateralPoolConfig.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )

          // add collateral 1 BNB
          await bookKeeper.addCollateral(formatBytes32String("BNB"), deployerAddress, WeiPerWad)

          const collateralTokenBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), deployerAddress)
          expect(collateralTokenBefore).to.be.equal(WeiPerWad)

          // add collateral -1 BNB
          await bookKeeper.addCollateral(formatBytes32String("BNB"), deployerAddress, WeiPerWad.mul(-1))

          const collateralTokenAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), deployerAddress)
          expect(collateralTokenAfter).to.be.equal(0)
        })
      })
    })
  })

  describe("#moveCollateral", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        // bob call move collateral from alice to bob
        await await expect(
          bookKeeperAsBob.moveCollateral(formatBytes32String("BNB"), aliceAddress, bobAddress, WeiPerWad)
        ).to.be.revertedWith("BookKeeper/not-allowed")
      })

      context("when alice allow bob to move collateral", () => {
        it("should be able to call moveCollateral", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)

          // add collateral 1 BNB to alice
          await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad)

          const collateralTokenAliceBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), aliceAddress)
          expect(collateralTokenAliceBefore).to.be.equal(WeiPerWad)
          const collateralTokenBobBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
          expect(collateralTokenBobBefore).to.be.equal(0)

          // alice allow bob to move collateral
          await bookKeeperAsAlice.whitelist(bobAddress)

          // bob call move collateral from alice to bob
          await bookKeeperAsBob.moveCollateral(formatBytes32String("BNB"), aliceAddress, bobAddress, WeiPerWad)

          const collateralTokenAliceAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), aliceAddress)
          expect(collateralTokenAliceAfter).to.be.equal(0)
          const collateralTokenBobAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
          expect(collateralTokenBobAfter).to.be.equal(WeiPerWad)
        })
      })
    })

    context("when the caller is the owner", () => {
      context("when alice doesn't have enough collateral", () => {
        it("shold be revert", async () => {
          // alice call move collateral from alice to bob
          await expect(
            bookKeeperAsAlice.moveCollateral(formatBytes32String("BNB"), aliceAddress, bobAddress, WeiPerWad)
          ).to.be.reverted
        })
      })
      context("when alice has enough collateral", () => {
        it("should be able to call moveCollateral", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
          await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)

          // add collateral 1 BNB to alice
          await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad)

          const collateralTokenAliceBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), aliceAddress)
          expect(collateralTokenAliceBefore).to.be.equal(WeiPerWad)
          const collateralTokenBobBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
          expect(collateralTokenBobBefore).to.be.equal(0)

          // move collateral 1 BNB from alice to bob
          await bookKeeperAsAlice.moveCollateral(formatBytes32String("BNB"), aliceAddress, bobAddress, WeiPerWad)

          const collateralTokenAliceAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), aliceAddress)
          expect(collateralTokenAliceAfter).to.be.equal(0)
          const collateralTokenBobAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
          expect(collateralTokenBobAfter).to.be.equal(WeiPerWad)
        })
      })
    })
  })

  describe("#moveStablecoin", () => {
    context("when the caller is not the owner", () => {
      it("should be revert", async () => {
        // bob call move stablecoin from alice to bob
        await await expect(bookKeeperAsBob.moveStablecoin(aliceAddress, bobAddress, WeiPerRad)).to.be.revertedWith(
          "BookKeeper/not-allowed"
        )
      })

      context("when alice allow bob to move collateral", () => {
        it("should be able to call moveStablecoin", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.MINTABLE_ROLE(), deployerAddress)

          // mint 1 rad to alice
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, aliceAddress, WeiPerRad)

          const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceBefore).to.be.equal(WeiPerRad)
          const stablecoinBobBefore = await bookKeeper.stablecoin(bobAddress)
          expect(stablecoinBobBefore).to.be.equal(0)

          // alice allow bob to move stablecoin
          await bookKeeperAsAlice.whitelist(bobAddress)

          // bob call move stablecoin from alice to bob
          await bookKeeperAsBob.moveStablecoin(aliceAddress, bobAddress, WeiPerRad)

          const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceAfter).to.be.equal(0)
          const stablecoinBobAfter = await bookKeeper.stablecoin(bobAddress)
          expect(stablecoinBobAfter).to.be.equal(WeiPerRad)
        })
      })
    })

    context("when the caller is the owner", () => {
      context("when alice doesn't have enough stablecoin", () => {
        it("shold be revert", async () => {
          // alice call move stablecoin from alice to bob
          await expect(bookKeeperAsAlice.moveStablecoin(aliceAddress, bobAddress, WeiPerRad)).to.be.reverted
        })
      })
      context("when alice has enough stablecoin", () => {
        it("should be able to call moveStablecoin", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.MINTABLE_ROLE(), deployerAddress)

          // mint 1 rad to alice
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, aliceAddress, WeiPerRad)

          const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceBefore).to.be.equal(WeiPerRad)
          const stablecoinBobBefore = await bookKeeper.stablecoin(bobAddress)
          expect(stablecoinBobBefore).to.be.equal(0)

          // alice call move stablecoin from alice to bob
          await bookKeeperAsAlice.moveStablecoin(aliceAddress, bobAddress, WeiPerRad)

          const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceAfter).to.be.equal(0)
          const stablecoinBobAfter = await bookKeeper.stablecoin(bobAddress)
          expect(stablecoinBobAfter).to.be.equal(WeiPerRad)
        })
      })
    })
  })

  describe("#adjustPosition", () => {
    context("when bookkeeper does not live", () => {
      it("should be revert", async () => {
        // grant role access
        await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
        bookKeeper.cage()

        await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), deployerAddress)
        await expect(
          bookKeeper.adjustPosition(
            formatBytes32String("BNB"),
            deployerAddress,
            deployerAddress,
            deployerAddress,
            WeiPerWad,
            0
          )
        ).to.be.revertedWith("BookKeeper/not-live")
      })
    })

    context("when collateral pool not init", () => {
      it("should be revert", async () => {
        await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), deployerAddress)
        await expect(
          bookKeeper.adjustPosition(
            formatBytes32String("BNB"),
            deployerAddress,
            deployerAddress,
            deployerAddress,
            WeiPerWad,
            0
          )
        ).to.be.revertedWith("BookKeeper/collateralPool-not-init")
      })
    })

    context("when call adjustPosition(lock, free)", () => {
      context("when call adjustPosition(lock)", () => {
        context("when alice call but bob is collateral owner", () => {
          it("should be revert", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )

            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)
            await expect(
              bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                aliceAddress,
                WeiPerWad.mul(10),
                0
              )
            ).to.be.revertedWith("BookKeeper/not-allowed-collateral-owner")
          })
          context("when bob allow alice to move collateral", () => {
            context("when bob doesn't have enough collateral", () => {
              it("should be revert", async () => {
                // grant role access
                await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
                await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

                // initialize BNB colleteral pool
                await collateralPoolConfig.initCollateralPool(
                  formatBytes32String("BNB"),
                  0,
                  0,
                  simplePriceFeed.address,
                  0,
                  WeiPerRay,
                  tokenAdapter.address,
                  0,
                  0,
                  0,
                  AddressZero
                )

                // alice allow bob to move stablecoin
                await bookKeeperAsBob.whitelist(aliceAddress)

                await expect(
                  bookKeeperAsAlice.adjustPosition(
                    formatBytes32String("BNB"),
                    aliceAddress,
                    bobAddress,
                    aliceAddress,
                    WeiPerWad.mul(10),
                    0
                  )
                ).to.be.reverted
              })
            })

            context("when bob has enough collateral", () => {
              it("should be able to call adjustPosition(lock)", async () => {
                // grant role access
                await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
                await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
                await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

                // initialize BNB colleteral pool
                await collateralPoolConfig.initCollateralPool(
                  formatBytes32String("BNB"),
                  0,
                  0,
                  simplePriceFeed.address,
                  0,
                  WeiPerRay,
                  tokenAdapter.address,
                  0,
                  0,
                  0,
                  AddressZero
                )

                // add collateral to bob 10 BNB
                await bookKeeper.addCollateral(formatBytes32String("BNB"), bobAddress, WeiPerWad.mul(10))

                // alice allow bob to move stablecoin
                await bookKeeperAsBob.whitelist(aliceAddress)

                const positionBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
                expect(positionBefore.lockedCollateral).to.be.equal(0)

                // lock collateral
                await bookKeeperAsAlice.adjustPosition(
                  formatBytes32String("BNB"),
                  aliceAddress,
                  bobAddress,
                  aliceAddress,
                  WeiPerWad.mul(10),
                  0
                )

                const positionAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
                expect(positionAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(10))
              })
            })
          })
        })
        context("when alice call and alice is collateral owner", () => {
          context("when alice doesn't have enough collateral", () => {
            it("should be revert", async () => {
              // grant role access
              await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

              // initialize BNB colleteral pool
              await collateralPoolConfig.initCollateralPool(
                formatBytes32String("BNB"),
                0,
                0,
                simplePriceFeed.address,
                0,
                WeiPerRay,
                tokenAdapter.address,
                0,
                0,
                0,
                AddressZero
              )

              await expect(
                bookKeeperAsAlice.adjustPosition(
                  formatBytes32String("BNB"),
                  aliceAddress,
                  aliceAddress,
                  aliceAddress,
                  WeiPerWad.mul(10),
                  0
                )
              ).to.be.reverted
            })
          })

          context("when alice has enough collateral", () => {
            it("should be able to call adjustPosition(lock)", async () => {
              // grant role access
              await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

              // initialize BNB colleteral pool
              await collateralPoolConfig.initCollateralPool(
                formatBytes32String("BNB"),
                0,
                0,
                simplePriceFeed.address,
                0,
                WeiPerRay,
                tokenAdapter.address,
                0,
                0,
                0,
                AddressZero
              )

              // add collateral to bob 10 BNB
              await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

              const positionBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionBefore.lockedCollateral).to.be.equal(0)

              // lock collateral
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                WeiPerWad.mul(10),
                0
              )

              const positionAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(10))
            })
          })
        })
      })
      context("when call adjustPosition(free)", () => {
        context("when alice call and alice is collateral owner", () => {
          context("when alice doesn't have enough lock collateral in position", () => {
            it("should be revert", async () => {
              // grant role access
              await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

              // initialize BNB colleteral pool
              await collateralPoolConfig.initCollateralPool(
                formatBytes32String("BNB"),
                0,
                0,
                simplePriceFeed.address,
                0,
                WeiPerRay,
                tokenAdapter.address,
                0,
                0,
                0,
                AddressZero
              )

              // free collateral
              await expect(
                bookKeeperAsAlice.adjustPosition(
                  formatBytes32String("BNB"),
                  aliceAddress,
                  aliceAddress,
                  aliceAddress,
                  WeiPerWad.mul(-1),
                  0
                )
              ).to.be.reverted
            })
          })
          context("when alice has enough lock collateral in position", () => {
            it("should be able to call adjustPosition(free)", async () => {
              // grant role access
              await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

              // initialize BNB colleteral pool
              await collateralPoolConfig.initCollateralPool(
                formatBytes32String("BNB"),
                0,
                0,
                simplePriceFeed.address,
                0,
                WeiPerRay,
                tokenAdapter.address,
                0,
                0,
                0,
                AddressZero
              )

              // add collateral to alice 10 BNB
              await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

              // lock collateral
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                WeiPerWad.mul(10),
                0
              )

              const positionAliceBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionAliceBefore.lockedCollateral).to.be.equal(WeiPerWad.mul(10))
              const collateralTokenAliceBefore = await bookKeeper.collateralToken(
                formatBytes32String("BNB"),
                aliceAddress
              )
              expect(collateralTokenAliceBefore).to.be.equal(0)

              // free collateral
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                WeiPerWad.mul(-1),
                0
              )

              const positionAliceAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionAliceAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(9))
              const collateralTokenAliceAfter = await bookKeeper.collateralToken(
                formatBytes32String("BNB"),
                aliceAddress
              )
              expect(collateralTokenAliceAfter).to.be.equal(WeiPerWad)
            })
          })
        })
        context("when alice call but bob is collateral owner", () => {
          context("when alice doesn't have enough lock collateral in position", () => {
            it("should be revert", async () => {
              // grant role access
              await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

              // initialize BNB colleteral pool
              await collateralPoolConfig.initCollateralPool(
                formatBytes32String("BNB"),
                0,
                0,
                simplePriceFeed.address,
                0,
                WeiPerRay,
                tokenAdapter.address,
                0,
                0,
                0,
                AddressZero
              )

              // free collateral
              await expect(
                bookKeeperAsAlice.adjustPosition(
                  formatBytes32String("BNB"),
                  aliceAddress,
                  bobAddress,
                  aliceAddress,
                  WeiPerWad.mul(-1),
                  0
                )
              ).to.be.reverted
            })
          })
          context("when alice has enough lock collateral in position", () => {
            it("should be able to call adjustPosition(free)", async () => {
              // grant role access
              await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

              // initialize BNB colleteral pool
              await collateralPoolConfig.initCollateralPool(
                formatBytes32String("BNB"),
                0,
                0,
                simplePriceFeed.address,
                0,
                WeiPerRay,
                tokenAdapter.address,
                0,
                0,
                0,
                AddressZero
              )

              // add collateral to alice 10 BNB
              await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

              // lock collateral
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                WeiPerWad.mul(10),
                0
              )

              const positionAliceBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionAliceBefore.lockedCollateral).to.be.equal(WeiPerWad.mul(10))
              const collateralTokenBobBefore = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
              expect(collateralTokenBobBefore).to.be.equal(0)

              // free collateral
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                aliceAddress,
                WeiPerWad.mul(-1),
                0
              )

              const positionAliceAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
              expect(positionAliceAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(9))
              const collateralTokenBobAfter = await bookKeeper.collateralToken(formatBytes32String("BNB"), bobAddress)
              expect(collateralTokenBobAfter).to.be.equal(WeiPerWad)
            })
          })
        })
      })
    })

    context("when call adjustPosition(draw, wipe)", () => {
      context("when debt ceilings are exceeded", () => {
        context("when pool debt ceiling are exceeded", () => {
          it("should be revert", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), deployerAddress)

            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 1 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad)

            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            await expect(
              bookKeeper.adjustPosition(
                formatBytes32String("BNB"),
                deployerAddress,
                deployerAddress,
                deployerAddress,
                0,
                WeiPerWad.mul(10)
              )
            ).to.be.revertedWith("BookKeeper/ceiling-exceeded")
          })
        })
        context("when total debt ceiling are exceeded", () => {
          it("should be revert", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), deployerAddress)
            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))

            // set total debt ceiling 1 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad)

            await expect(
              bookKeeper.adjustPosition(
                formatBytes32String("BNB"),
                deployerAddress,
                deployerAddress,
                deployerAddress,
                0,
                WeiPerWad.mul(10)
              )
            ).to.be.revertedWith("BookKeeper/ceiling-exceeded")
          })
        })
      })
      context("when position is not safe", () => {
        it("should be revert", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
          await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), deployerAddress)
          // initialize BNB colleteral pool
          await collateralPoolConfig.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )
          // set pool debt ceiling 10 rad
          await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
          // set price with safety margin 1 ray
          await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)

          // set total debt ceiling 10 rad
          await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

          await expect(
            bookKeeper.adjustPosition(
              formatBytes32String("BNB"),
              deployerAddress,
              deployerAddress,
              deployerAddress,
              0,
              WeiPerWad.mul(10)
            )
          ).to.be.revertedWith("BookKeeper/not-safe")
        })
      })
      context("when call adjustPosition(draw)", () => {
        context("when alice call but bob is position owner", () => {
          it("should be revert", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), bobAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)

            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), bobAddress, WeiPerWad.mul(10))

            // bob lock collateral 10 BNB
            await bookKeeperAsBob.adjustPosition(
              formatBytes32String("BNB"),
              bobAddress,
              bobAddress,
              bobAddress,
              WeiPerWad.mul(10),
              0
            )

            await expect(
              bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                bobAddress,
                bobAddress,
                bobAddress,
                0,
                WeiPerWad.mul(10)
              )
            ).to.be.revertedWith("BookKeeper/not-allowed-position-address")
          })
          context("when bob allow alice to manage position", () => {
            it("should be able to call adjustPosition(draw)", async () => {
              // grant role access
              await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
              await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
              await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), bobAddress)
              await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

              // initialize BNB colleteral pool
              await collateralPoolConfig.initCollateralPool(
                formatBytes32String("BNB"),
                0,
                0,
                simplePriceFeed.address,
                0,
                WeiPerRay,
                tokenAdapter.address,
                0,
                0,
                0,
                AddressZero
              )
              // set pool debt ceiling 10 rad
              await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
              // set price with safety margin 1 ray
              await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)

              // set total debt ceiling 10 rad
              await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

              // add collateral to 10 BNB
              await bookKeeper.addCollateral(formatBytes32String("BNB"), bobAddress, WeiPerWad.mul(10))

              // bob lock collateral 10 BNB
              await bookKeeperAsBob.adjustPosition(
                formatBytes32String("BNB"),
                bobAddress,
                bobAddress,
                bobAddress,
                WeiPerWad.mul(10),
                0
              )

              // bob allow alice
              await bookKeeperAsBob.whitelist(aliceAddress)

              const positionBobBefore = await bookKeeper.positions(formatBytes32String("BNB"), bobAddress)
              expect(positionBobBefore.debtShare).to.be.equal(0)
              const BNBPoolBefore = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
              expect(BNBPoolBefore.totalDebtShare).to.be.equal(0)
              const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
              expect(stablecoinAliceBefore).to.be.equal(0)

              // alice draw
              await bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                bobAddress,
                bobAddress,
                aliceAddress,
                0,
                WeiPerWad.mul(10)
              )

              const positionBobAfter = await bookKeeper.positions(formatBytes32String("BNB"), bobAddress)
              expect(positionBobAfter.debtShare).to.be.equal(WeiPerWad.mul(10))
              const BNBPoolAfter = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
              expect(BNBPoolAfter.totalDebtShare).to.be.equal(WeiPerWad.mul(10))
              const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
              expect(stablecoinAliceAfter).to.be.equal(WeiPerRad.mul(10))
            })
          })
        })
        context("when alice call and alice is position owner", () => {
          it("should be able to call adjustPosition(draw)", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)

            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              0
            )

            const positionaliceBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionaliceBefore.debtShare).to.be.equal(0)
            const BNBPoolBefore = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
            expect(BNBPoolBefore.totalDebtShare).to.be.equal(0)
            const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
            expect(stablecoinAliceBefore).to.be.equal(0)

            // alice draw
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              0,
              WeiPerWad.mul(10)
            )

            const positionaliceAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionaliceAfter.debtShare).to.be.equal(WeiPerWad.mul(10))
            const BNBPoolAfter = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
            expect(BNBPoolAfter.totalDebtShare).to.be.equal(WeiPerWad.mul(10))
            const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
            expect(stablecoinAliceAfter).to.be.equal(WeiPerRad.mul(10))
          })
        })
        context("when position debt value < debt floor", () => {
          it("should be revert", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 20 rad
            await collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(20))

            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              0
            )

            // alice draw
            await expect(
              bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                0,
                WeiPerWad.mul(10)
              )
            ).to.be.revertedWith("BookKeeper/debt-floor")
          })
        })
      })
      context("when call adjustPosition(wipe)", () => {
        context("when alice call and alice is position owner", () => {
          it("should be able to call adjustPosition(wipe)", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)

            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              0
            )

            // alice draw
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              0,
              WeiPerWad.mul(10)
            )

            const positionaliceBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionaliceBefore.debtShare).to.be.equal(WeiPerWad.mul(10))
            const BNBPoolBefore = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
            expect(BNBPoolBefore.totalDebtShare).to.be.equal(WeiPerWad.mul(10))
            const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
            expect(stablecoinAliceBefore).to.be.equal(WeiPerRad.mul(10))

            // alice wipe
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              0,
              WeiPerWad.mul(-10)
            )

            const positionaliceAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionaliceAfter.debtShare).to.be.equal(0)
            const BNBPoolAfter = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
            expect(BNBPoolAfter.totalDebtShare).to.be.equal(0)
            const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
            expect(stablecoinAliceAfter).to.be.equal(0)
          })
        })
        context("when position debt value < debt floor", () => {
          it("should be revert", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 5 rad
            await collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(5))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              0
            )

            // alice draw
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              0,
              WeiPerWad.mul(10)
            )

            // alice wipe
            await expect(
              bookKeeperAsAlice.adjustPosition(
                formatBytes32String("BNB"),
                aliceAddress,
                aliceAddress,
                aliceAddress,
                0,
                WeiPerWad.mul(-9)
              )
            ).to.be.revertedWith("BookKeeper/debt-floor")
          })
        })
      })
    })
  })

  describe("#movePosition", () => {
    context("when alice move position to bob", () => {
      context("when alice and bob don't allow anyone else to manage the position", () => {
        it("should be revert", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
          await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
          await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

          // initialize BNB colleteral pool
          await collateralPoolConfig.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )
          // set pool debt ceiling 10 rad
          await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
          // set price with safety margin 1 ray
          await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
          // set position debt floor 1 rad
          await collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
          // set total debt ceiling 10 rad
          await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

          // add collateral to 10 BNB
          await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

          // alice lock collateral 10 BNB
          await bookKeeperAsAlice.adjustPosition(
            formatBytes32String("BNB"),
            aliceAddress,
            aliceAddress,
            aliceAddress,
            WeiPerWad.mul(10),
            WeiPerWad.mul(2)
          )

          await expect(
            bookKeeperAsAlice.movePosition(
              formatBytes32String("BNB"),
              aliceAddress,
              bobAddress,
              WeiPerWad.mul(5),
              WeiPerWad.mul(1)
            )
          ).to.be.revertedWith("BookKeeper/not-allowed")
        })
      })
      context("when bob allow alice to manage a position", () => {
        context("when after moving alice position was not safe", () => {
          it("should be revert", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              WeiPerWad.mul(2)
            )

            // bob allow alice to manage a position
            await bookKeeperAsBob.whitelist(aliceAddress)

            await expect(
              bookKeeperAsAlice.movePosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                WeiPerWad.mul(10),
                WeiPerWad.mul(0)
              )
            ).to.be.revertedWith("BookKeeper/not-safe-src")
          })
        })
        context("when after moving bob position was not safe", () => {
          it("should be revert", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              WeiPerWad.mul(2)
            )

            // bob allow alice to manage a position
            await bookKeeperAsBob.whitelist(aliceAddress)

            await expect(
              bookKeeperAsAlice.movePosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                WeiPerWad.mul(0),
                WeiPerWad.mul(2)
              )
            ).to.be.revertedWith("BookKeeper/not-safe-dst")
          })
        })
        context("when after moving alice position was not enough debt", () => {
          it("should be revert", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(2))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              WeiPerWad.mul(2)
            )

            // bob allow alice to manage a position
            await bookKeeperAsBob.whitelist(aliceAddress)

            await expect(
              bookKeeperAsAlice.movePosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                WeiPerWad.mul(5),
                WeiPerWad.mul(1)
              )
            ).to.be.revertedWith("BookKeeper/debt-floor-src")
          })
        })
        context("when after moving bob position was not enough debt", () => {
          it("should be revert", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(2))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              WeiPerWad.mul(3)
            )

            // bob allow alice to manage a position
            await bookKeeperAsBob.whitelist(aliceAddress)

            await expect(
              bookKeeperAsAlice.movePosition(
                formatBytes32String("BNB"),
                aliceAddress,
                bobAddress,
                WeiPerWad.mul(5),
                WeiPerWad.mul(1)
              )
            ).to.be.revertedWith("BookKeeper/debt-floor-dst")
          })
        })
        context("when alice and bob positions are safe", () => {
          it("should be able to call movePosition", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

            // initialize BNB colleteral pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 10 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(10))

            // alice lock collateral 10 BNB
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(10),
              WeiPerWad.mul(2)
            )

            // bob allow alice to manage a position
            await bookKeeperAsBob.whitelist(aliceAddress)

            const positionAliceBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionAliceBefore.lockedCollateral).to.be.equal(WeiPerWad.mul(10))
            expect(positionAliceBefore.debtShare).to.be.equal(WeiPerWad.mul(2))

            const positionBobBefore = await bookKeeper.positions(formatBytes32String("BNB"), bobAddress)
            expect(positionBobBefore.lockedCollateral).to.be.equal(0)
            expect(positionBobBefore.debtShare).to.be.equal(0)

            await bookKeeperAsAlice.movePosition(
              formatBytes32String("BNB"),
              aliceAddress,
              bobAddress,
              WeiPerWad.mul(5),
              WeiPerWad.mul(1)
            )

            const positionAliceAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionAliceAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(5))
            expect(positionAliceAfter.debtShare).to.be.equal(WeiPerWad.mul(1))

            const positionBobAfter = await bookKeeper.positions(formatBytes32String("BNB"), bobAddress)
            expect(positionBobAfter.lockedCollateral).to.be.equal(WeiPerWad.mul(5))
            expect(positionBobAfter.debtShare).to.be.equal(WeiPerWad.mul(1))
          })
        })
      })
    })
  })

  describe("#confiscatePosition", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          bookKeeperAsAlice.confiscatePosition(
            formatBytes32String("BNB"),
            aliceAddress,
            deployerAddress,
            deployerAddress,
            WeiPerWad.mul(-1),
            WeiPerWad.mul(-1)
          )
        ).to.be.revertedWith("!liquidationEngineRole")
      })
    })
    context("when the caller is the owner", async () => {
      context("when start liquidation", () => {
        context("when liquidating all in position", () => {
          it("should be able to call confiscatePosition", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.LIQUIDATION_ENGINE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)

            // init BNB pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
            // set total debt ceiling 1 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad)

            // add collateral to 1 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad)
            // adjust position
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad,
              WeiPerWad
            )

            const positionBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionBefore.lockedCollateral).to.be.equal(WeiPerWad)
            expect(positionBefore.debtShare).to.be.equal(WeiPerWad)
            const collateralPoolBefore = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
            expect(collateralPoolBefore.totalDebtShare).to.be.equal(WeiPerWad)
            const collateralTokenCreditorBefore = await bookKeeper.collateralToken(
              formatBytes32String("BNB"),
              deployerAddress
            )
            expect(collateralTokenCreditorBefore).to.be.equal(0)
            const systemBadDebtDebtorBefore = await bookKeeper.systemBadDebt(deployerAddress)
            expect(systemBadDebtDebtorBefore).to.be.equal(0)
            const totalUnbackedStablecoinBefore = await bookKeeper.totalUnbackedStablecoin()
            expect(totalUnbackedStablecoinBefore).to.be.equal(0)

            // confiscate position
            await bookKeeper.confiscatePosition(
              formatBytes32String("BNB"),
              aliceAddress,
              deployerAddress,
              deployerAddress,
              WeiPerWad.mul(-1),
              WeiPerWad.mul(-1)
            )

            const positionAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionAfter.lockedCollateral).to.be.equal(0)
            expect(positionAfter.debtShare).to.be.equal(0)
            const collateralPoolAfter = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
            expect(collateralPoolAfter.totalDebtShare).to.be.equal(0)
            const collateralTokenCreditorAfter = await bookKeeper.collateralToken(
              formatBytes32String("BNB"),
              deployerAddress
            )
            expect(collateralTokenCreditorAfter).to.be.equal(WeiPerWad)
            const systemBadDebtDebtorAfter = await bookKeeper.systemBadDebt(deployerAddress)
            expect(systemBadDebtDebtorAfter).to.be.equal(WeiPerRad)
            const totalUnbackedStablecoinAfter = await bookKeeper.totalUnbackedStablecoin()
            expect(totalUnbackedStablecoinAfter).to.be.equal(WeiPerRad)
          })
        })
        context("when liquidating some in position", () => {
          it("should be able to call confiscatePosition", async () => {
            // grant role access
            await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
            await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.LIQUIDATION_ENGINE_ROLE(), deployerAddress)
            await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), aliceAddress)
            // init BNB pool
            await collateralPoolConfig.initCollateralPool(
              formatBytes32String("BNB"),
              0,
              0,
              simplePriceFeed.address,
              0,
              WeiPerRay,
              tokenAdapter.address,
              0,
              0,
              0,
              AddressZero
            )
            // set pool debt ceiling 10 rad
            await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
            // set price with safety margin 1 ray
            await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
            // set position debt floor 1 rad
            await collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
            // set total debt ceiling 10 rad
            await bookKeeper.setTotalDebtCeiling(WeiPerRad.mul(10))

            // add collateral to 2 BNB
            await bookKeeper.addCollateral(formatBytes32String("BNB"), aliceAddress, WeiPerWad.mul(2))
            // adjust position
            await bookKeeperAsAlice.adjustPosition(
              formatBytes32String("BNB"),
              aliceAddress,
              aliceAddress,
              aliceAddress,
              WeiPerWad.mul(2),
              WeiPerWad.mul(2)
            )

            const positionBefore = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionBefore.lockedCollateral).to.be.equal(WeiPerWad.mul(2))
            expect(positionBefore.debtShare).to.be.equal(WeiPerWad.mul(2))
            const collateralPoolBefore = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
            expect(collateralPoolBefore.totalDebtShare).to.be.equal(WeiPerWad.mul(2))
            const collateralTokenCreditorBefore = await bookKeeper.collateralToken(
              formatBytes32String("BNB"),
              deployerAddress
            )
            expect(collateralTokenCreditorBefore).to.be.equal(0)
            const systemBadDebtDebtorBefore = await bookKeeper.systemBadDebt(deployerAddress)
            expect(systemBadDebtDebtorBefore).to.be.equal(0)
            const totalUnbackedStablecoinBefore = await bookKeeper.totalUnbackedStablecoin()
            expect(totalUnbackedStablecoinBefore).to.be.equal(0)

            // confiscate position
            await bookKeeper.confiscatePosition(
              formatBytes32String("BNB"),
              aliceAddress,
              deployerAddress,
              deployerAddress,
              WeiPerWad.mul(-1),
              WeiPerWad.mul(-1)
            )

            const positionAfter = await bookKeeper.positions(formatBytes32String("BNB"), aliceAddress)
            expect(positionAfter.lockedCollateral).to.be.equal(WeiPerWad)
            expect(positionAfter.debtShare).to.be.equal(WeiPerWad)
            const collateralPoolAfter = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
            expect(collateralPoolAfter.totalDebtShare).to.be.equal(WeiPerWad)
            const collateralTokenCreditorAfter = await bookKeeper.collateralToken(
              formatBytes32String("BNB"),
              deployerAddress
            )
            expect(collateralTokenCreditorAfter).to.be.equal(WeiPerWad)
            const systemBadDebtDebtorAfter = await bookKeeper.systemBadDebt(deployerAddress)
            expect(systemBadDebtDebtorAfter).to.be.equal(WeiPerRad)
            const totalUnbackedStablecoinAfter = await bookKeeper.totalUnbackedStablecoin()
            expect(totalUnbackedStablecoinAfter).to.be.equal(WeiPerRad)
          })
        })
      })
    })
  })

  describe("#mintUnbackedStablecoin", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          bookKeeperAsAlice.mintUnbackedStablecoin(deployerAddress, aliceAddress, WeiPerRad)
        ).to.be.revertedWith("!mintableRole")
      })
    })
    context("when the caller is the owner", async () => {
      context("when mint unbacked stable coin", () => {
        it("should be able to call mintUnbackedStablecoin", async () => {
          const systemBadDebtBefore = await bookKeeper.systemBadDebt(deployerAddress)
          expect(systemBadDebtBefore).to.be.equal(0)
          const stablecoinAliceBefore = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceBefore).to.be.equal(0)
          const totalUnbackedStablecoinBefore = await bookKeeper.totalUnbackedStablecoin()
          expect(totalUnbackedStablecoinBefore).to.be.equal(0)
          const totalStablecoinIssuedBefore = await bookKeeper.totalStablecoinIssued()
          expect(totalStablecoinIssuedBefore).to.be.equal(0)

          // grant role access
          await bookKeeper.grantRole(await bookKeeper.MINTABLE_ROLE(), deployerAddress)

          //  mint 1 rad to alice
          await bookKeeper.mintUnbackedStablecoin(deployerAddress, aliceAddress, WeiPerRad)

          const systemBadDebtAfter = await bookKeeper.systemBadDebt(deployerAddress)
          expect(systemBadDebtAfter).to.be.equal(WeiPerRad)
          const stablecoinAliceAfter = await bookKeeper.stablecoin(aliceAddress)
          expect(stablecoinAliceAfter).to.be.equal(WeiPerRad)
          const totalUnbackedStablecoinAfter = await bookKeeper.totalUnbackedStablecoin()
          expect(totalUnbackedStablecoinAfter).to.be.equal(WeiPerRad)
          const totalStablecoinIssuedAfter = await bookKeeper.totalStablecoinIssued()
          expect(totalStablecoinIssuedAfter).to.be.equal(WeiPerRad)
        })
      })
    })
  })

  describe("#settleSystemBadDebt", () => {
    context("when settle system bad debt", () => {
      it("should be able to call settleSystemBadDebt", async () => {
        // grant role access
        await bookKeeper.grantRole(await bookKeeper.MINTABLE_ROLE(), deployerAddress)

        //  mint 1 rad to deployer
        await bookKeeper.mintUnbackedStablecoin(deployerAddress, deployerAddress, WeiPerRad)

        const systemBadDebtBefore = await bookKeeper.systemBadDebt(deployerAddress)
        expect(systemBadDebtBefore).to.be.equal(WeiPerRad)
        const stablecoinDeployerBefore = await bookKeeper.stablecoin(deployerAddress)
        expect(stablecoinDeployerBefore).to.be.equal(WeiPerRad)
        const totalUnbackedStablecoinBefore = await bookKeeper.totalUnbackedStablecoin()
        expect(totalUnbackedStablecoinBefore).to.be.equal(WeiPerRad)
        const totalStablecoinIssuedBefore = await bookKeeper.totalStablecoinIssued()
        expect(totalStablecoinIssuedBefore).to.be.equal(WeiPerRad)

        // settle system bad debt 1 rad
        await bookKeeper.settleSystemBadDebt(WeiPerRad)

        const systemBadDebtAfter = await bookKeeper.systemBadDebt(deployerAddress)
        expect(systemBadDebtAfter).to.be.equal(0)
        const stablecoinDeployerAfter = await bookKeeper.stablecoin(deployerAddress)
        expect(stablecoinDeployerAfter).to.be.equal(0)
        const totalUnbackedStablecoinAfter = await bookKeeper.totalUnbackedStablecoin()
        expect(totalUnbackedStablecoinAfter).to.be.equal(0)
        const totalStablecoinIssuedAfter = await bookKeeper.totalStablecoinIssued()
        expect(totalStablecoinIssuedAfter).to.be.equal(0)
      })
    })
  })

  describe("#accrueStabilityFee", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          bookKeeperAsAlice.accrueStabilityFee(formatBytes32String("BNB"), deployerAddress, WeiPerRay)
        ).to.be.revertedWith("!stabilityFeeCollectorRole")
      })
    })
    context("when the caller is the owner", async () => {
      context("when bookkeeper does not live", () => {
        it("should be revert", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          await bookKeeper.grantRole(await bookKeeper.STABILITY_FEE_COLLECTOR_ROLE(), deployerAddress)

          bookKeeper.cage()

          await expect(
            bookKeeper.accrueStabilityFee(formatBytes32String("BNB"), deployerAddress, WeiPerRay)
          ).to.be.revertedWith("BookKeeper/not-live")
        })
      })
      context("when bookkeeper is live", () => {
        it("should be able to call accrueStabilityFee", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
          await bookKeeper.grantRole(await bookKeeper.ADAPTER_ROLE(), deployerAddress)
          await bookKeeper.grantRole(await bookKeeper.STABILITY_FEE_COLLECTOR_ROLE(), deployerAddress)
          await bookKeeper.grantRole(await bookKeeper.POSITION_MANAGER_ROLE(), deployerAddress)
          // init BNB pool
          await collateralPoolConfig.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )
          // set pool debt ceiling 10 rad
          await collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRad.mul(10))
          // set price with safety margin 1 ray
          await collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
          // set position debt floor 1 rad
          await collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRad.mul(1))
          // set total debt ceiling 1 rad
          await bookKeeper.setTotalDebtCeiling(WeiPerRad)

          // add collateral to 1 BNB
          await bookKeeper.addCollateral(formatBytes32String("BNB"), deployerAddress, WeiPerWad)
          // adjust position
          await bookKeeper.adjustPosition(
            formatBytes32String("BNB"),
            deployerAddress,
            deployerAddress,
            deployerAddress,
            WeiPerWad,
            WeiPerWad
          )

          const poolBefore = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
          expect(poolBefore.debtAccumulatedRate).to.be.equal(WeiPerRay)
          const stablecoinDeployerBefore = await bookKeeper.stablecoin(deployerAddress)
          expect(stablecoinDeployerBefore).to.be.equal(WeiPerRad)
          const totalStablecoinIssuedBefore = await bookKeeper.totalStablecoinIssued()
          expect(totalStablecoinIssuedBefore).to.be.equal(WeiPerRad)

          await bookKeeper.accrueStabilityFee(formatBytes32String("BNB"), deployerAddress, WeiPerRay)

          const poolAfter = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
          expect(poolAfter.debtAccumulatedRate).to.be.equal(WeiPerRay.mul(2))
          const stablecoinDeployerAfter = await bookKeeper.stablecoin(deployerAddress)
          expect(stablecoinDeployerAfter).to.be.equal(WeiPerRad.mul(2))
          const totalStablecoinIssuedAfter = await bookKeeper.totalStablecoinIssued()
          expect(totalStablecoinIssuedAfter).to.be.equal(WeiPerRad.mul(2))
        })
      })
    })
  })

  describe("#setTotalDebtCeiling", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(bookKeeperAsAlice.setTotalDebtCeiling(WeiPerRad)).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", async () => {
      context("when bookkeeper does not live", () => {
        it("should be revert", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)

          bookKeeper.cage()

          await expect(bookKeeper.setTotalDebtCeiling(WeiPerRad)).to.be.revertedWith("BookKeeper/not-live")
        })
      })
      context("when bookkeeper is live", () => {
        it("should be able to call setTotalDebtCeiling", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          // init BNB pool
          await collateralPoolConfig.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )
          // set total debt ceiling 1 rad
          await expect(bookKeeper.setTotalDebtCeiling(WeiPerRad))
            .to.emit(bookKeeper, "SetTotalDebtCeiling")
            .withArgs(deployerAddress, WeiPerRad)
        })
      })
    })
  })

  describe("#setPriceWithSafetyMargin", () => {
    context("when role can't access", async () => {
      it("should revert", async () => {
        await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
        await expect(
          collateralPoolConfigAsAlice.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay)
        ).to.be.revertedWith("!priceOracleRole")
      })
    })
    context("when role can access", async () => {
      context("when bookkeeper is live", () => {
        it("should be able to call setPriceWithSafetyMargin", async () => {
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          // init BNB pool
          await collateralPoolConfig.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )

          await collateralPoolConfig.grantRole(await bookKeeper.PRICE_ORACLE_ROLE(), deployerAddress)
          // set total debt ceiling 1 rad
          await expect(collateralPoolConfig.setPriceWithSafetyMargin(formatBytes32String("BNB"), WeiPerRay))
            .to.emit(collateralPoolConfig, "LogSetPriceWithSafetyMargin")
            .withArgs(deployerAddress, formatBytes32String("BNB"), WeiPerRay)
        })
      })
    })
  })

  describe("#setDebtCeiling", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.setDebtCeiling(formatBytes32String("BNB"), WeiPerRay)
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", async () => {
      context("when bookkeeper is live", () => {
        it("should be able to call setDebtCeiling", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          // init BNB pool
          await collateralPoolConfig.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )
          // set total debt ceiling 1 rad
          await expect(collateralPoolConfig.setDebtCeiling(formatBytes32String("BNB"), WeiPerRay))
            .to.emit(collateralPoolConfig, "LogSetDebtCeiling")
            .withArgs(deployerAddress, formatBytes32String("BNB"), WeiPerRay)
        })
      })
    })
  })

  describe("#setDebtFloor", () => {
    context("when the caller is not the owner", async () => {
      it("should revert", async () => {
        await expect(
          collateralPoolConfigAsAlice.setDebtFloor(formatBytes32String("BNB"), WeiPerRay)
        ).to.be.revertedWith("!ownerRole")
      })
    })
    context("when the caller is the owner", async () => {
      context("when bookkeeper is live", () => {
        it("should be able to call setDebtFloor", async () => {
          // grant role access
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          // init BNB pool
          await collateralPoolConfig.initCollateralPool(
            formatBytes32String("BNB"),
            0,
            0,
            simplePriceFeed.address,
            0,
            WeiPerRay,
            tokenAdapter.address,
            0,
            0,
            0,
            AddressZero
          )
          // set total debt ceiling 1 rad
          await expect(collateralPoolConfig.setDebtFloor(formatBytes32String("BNB"), WeiPerRay))
            .to.emit(collateralPoolConfig, "LogSetDebtFloor")
            .withArgs(deployerAddress, formatBytes32String("BNB"), WeiPerRay)
        })
      })
    })
  })

  describe("#pause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(bookKeeperAsAlice.pause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          await bookKeeper.pause()
        })
      })

      context("and role is gov role", () => {
        it("should be success", async () => {
          await bookKeeper.grantRole(await bookKeeper.GOV_ROLE(), deployerAddress)
          await bookKeeper.pause()
        })
      })
    })
  })

  describe("#unpause", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(bookKeeperAsAlice.unpause()).to.be.revertedWith("!(ownerRole or govRole)")
      })
    })

    context("when role can access", () => {
      context("and role is owner role", () => {
        it("should be success", async () => {
          await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)
          await bookKeeper.pause()
          await bookKeeper.unpause()
        })
      })

      context("and role is gov role", () => {
        it("should be success", async () => {
          await bookKeeper.grantRole(await bookKeeper.GOV_ROLE(), deployerAddress)
          await bookKeeper.pause()
          await bookKeeper.unpause()
        })
      })
    })

    context("when unpause contract", () => {
      it("should be success", async () => {
        await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), deployerAddress)

        // pause contract
        await bookKeeper.pause()

        // unpause contract
        await bookKeeper.unpause()

        await collateralPoolConfig.initCollateralPool(
          formatBytes32String("BNB"),
          0,
          0,
          simplePriceFeed.address,
          0,
          WeiPerRay,
          tokenAdapter.address,
          0,
          0,
          0,
          AddressZero
        )
        const pool = await collateralPoolConfig.collateralPools(formatBytes32String("BNB"))
        expect(pool.debtAccumulatedRate).equal(WeiPerRay)
      })
    })
  })

  describe("#cage", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(bookKeeperAsAlice.cage()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })

    context("when owner role can access", () => {
      it("should be success", async () => {
        // grant role access
        await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), aliceAddress)

        expect(await bookKeeperAsAlice.live()).to.be.equal(1)

        await expect(bookKeeperAsAlice.cage()).to.emit(bookKeeperAsAlice, "Cage").withArgs()

        expect(await bookKeeperAsAlice.live()).to.be.equal(0)
      })
    })

    context("when show stopper role can access", () => {
      it("should be success", async () => {
        // grant role access
        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), aliceAddress)

        expect(await bookKeeperAsAlice.live()).to.be.equal(1)

        await expect(bookKeeperAsAlice.cage()).to.emit(bookKeeperAsAlice, "Cage").withArgs()

        expect(await bookKeeperAsAlice.live()).to.be.equal(0)
      })
    })
  })

  describe("#uncage", () => {
    context("when role can't access", () => {
      it("should revert", async () => {
        await expect(bookKeeperAsAlice.uncage()).to.be.revertedWith("!(ownerRole or showStopperRole)")
      })
    })

    context("when owner role can access", () => {
      it("should be success", async () => {
        // grant role access
        await bookKeeper.grantRole(await bookKeeper.OWNER_ROLE(), aliceAddress)

        expect(await bookKeeperAsAlice.live()).to.be.equal(1)

        await bookKeeperAsAlice.cage()

        expect(await bookKeeperAsAlice.live()).to.be.equal(0)

        await expect(bookKeeperAsAlice.uncage()).to.emit(bookKeeperAsAlice, "Uncage").withArgs()

        expect(await bookKeeperAsAlice.live()).to.be.equal(1)
      })
    })

    context("when show stopper role can access", () => {
      it("should be success", async () => {
        // grant role access
        await bookKeeper.grantRole(await bookKeeper.SHOW_STOPPER_ROLE(), aliceAddress)

        expect(await bookKeeperAsAlice.live()).to.be.equal(1)

        await bookKeeperAsAlice.cage()

        expect(await bookKeeperAsAlice.live()).to.be.equal(0)

        await expect(bookKeeperAsAlice.uncage()).to.emit(bookKeeperAsAlice, "Uncage").withArgs()

        expect(await bookKeeperAsAlice.live()).to.be.equal(1)
      })
    })
  })
})
