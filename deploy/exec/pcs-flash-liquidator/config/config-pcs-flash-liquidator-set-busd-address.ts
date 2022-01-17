import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/types"
import { ethers, network } from "hardhat"
import { ConfigEntity } from "../../../entities"
import { PCSFlashLiquidator__factory } from "../../../../typechain"

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

  const BUSD_ADDR = "0xe9e7cea3dedca5984780bafc599bd69add087d56"
  const config = ConfigEntity.getConfig()

  const FLASH_LIQUIDATOR_ADDR = config.FlashLiquidator.PCSFlashLiquidator.address

  const pcsFlashLiquidator = PCSFlashLiquidator__factory.connect(FLASH_LIQUIDATOR_ADDR, (await ethers.getSigners())[0])
  console.log(`>> BUSD address: ${BUSD_ADDR}`)
  await pcsFlashLiquidator.setBUSDAddress(BUSD_ADDR)
  console.log("✅ Done")
}

export default func
func.tags = ["PCSFlashLiquidatorSetBUSDAddress"]
