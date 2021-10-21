import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, upgrades } from "hardhat"
import { DexPriceOracle__factory, StrictAlpacaOraclePriceFeed__factory } from "../../../../typechain"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  /*
  ░██╗░░░░░░░██╗░█████╗░██████╗░███╗░░██╗██╗███╗░░██╗░██████╗░
  ░██║░░██╗░░██║██╔══██╗██╔══██╗████╗░██║██║████╗░██║██╔════╝░
  ░╚██╗████╗██╔╝███████║██████╔╝██╔██╗██║██║██╔██╗██║██║░░██╗░
  ░░████╔═████║░██╔══██║██╔══██╗██║╚████║██║██║╚████║██║░░╚██╗
  ░░╚██╔╝░╚██╔╝░██║░░██║██║░░██║██║░╚███║██║██║░╚███║╚██████╔╝
  ░░░╚═╝░░░╚═╝░░╚═╝░░╚═╝╚═╝░░╚═╝╚═╝░░╚══╝╚═╝╚═╝░░╚══╝░╚═════╝░
  Check all variables below before execute the deployment script
  */

  const PRIMARY_ALPACA_ORACLE = ""
  const PRIMARY_TOKEN_0 = ""
  const PRIMARY_TOKEN_1 = ""
  const SECONDARY_ALPACA_ORACLE = ""
  const SECONDARY_TOKEN_0 = ""
  const SECONDARY_TOKEN_1 = ""
  const ACCESS_CONTROL_CONFIG = ""

  console.log(">> Deploying an upgradable StrictAlpacaOraclePriceFeed contract")
  const StrictAlpacaOraclePriceFeed = (await ethers.getContractFactory(
    "StrictAlpacaOraclePriceFeed",
    (
      await ethers.getSigners()
    )[0]
  )) as StrictAlpacaOraclePriceFeed__factory
  const strictAlpacaOraclePriceFeed = await upgrades.deployProxy(StrictAlpacaOraclePriceFeed, [
    PRIMARY_ALPACA_ORACLE,
    PRIMARY_TOKEN_0,
    PRIMARY_TOKEN_1,
    SECONDARY_ALPACA_ORACLE,
    SECONDARY_TOKEN_0,
    SECONDARY_TOKEN_1,
    ACCESS_CONTROL_CONFIG,
  ])
  await strictAlpacaOraclePriceFeed.deployed()
  console.log(`>> Deployed at ${strictAlpacaOraclePriceFeed.address}`)
}

export default func
func.tags = ["StrictAlpacaOraclePriceFeed"]
