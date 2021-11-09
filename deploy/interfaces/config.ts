export interface Config {
  Timelock: string
  ProxyWalletFactory: ProxyWalletFactory
  ProxyWalletRegistry: ProxyWalletRegistry
  AlpacaStablecoinProxyActions: AlpacaStablecoinProxyActions
  AccessControlConfig: AccessControlConfig
  AlpacaStablecoin: AlpacaStablecoins
  CollateralPoolConfig: CollateralPoolConfig
  BookKeeper: BookKeeper
  FlashMintModule: FlashMintModule
  ShowStopper: ShowStopper
  PositionManager: PositionManager
  GetPositions: GetPositions
  IbTokenAdapters: IbTokenAdapter[]
  StablecoinAdapters: StablecoinAdapters
  PriceOracle: PriceOracle
  SystemDebtEngine: SystemDebtEngine
  LiquidationEngine: LiquidationEngine
}
export interface ProxyWalletFactory {
  address: string
  deployedBlock: number
}
export interface ProxyWalletRegistry {
  address: string
  deployedBlock: number
}
export interface AlpacaStablecoinProxyActions {
  address: string
  deployedBlock: number
}
export interface AccessControlConfig {
  address: string
  deployedBlock: number
}
export interface AlpacaStablecoins {
  AUSD: AlpacaStablecoin
}
export interface AlpacaStablecoin {
  address: string
  deployedBlock: number
}
export interface CollateralPool {
  collateralPoolId: string
  debtCeiling: string
  debtFloor: string
  priceFeed: string
  liquidationRatio: string
  stabilityFeeRate: string
  adapter: string
  closeFactorBps: number
  liquidatorIncentiveBps: number
  treasuryFeesBps: number
  strategy: string
}
export interface CollateralPoolConfig {
  address: string
  deployedBlock: number
  collateralPools: CollateralPool[]
}
export interface BookKeeper {
  address: string
  deployedBlock: number
}
export interface FlashMintModule {
  address: string
  deployedBlock: number
}
export interface PriceOracle {
  address: string
  deployedBlock: number
}
export interface ShowStopper {
  address: string
  deployedBlock: number
}
export interface PositionManager {
  address: string
  deployedBlock: number
}
export interface GetPositions {
  address: string
  deployedBlock: number
}
export interface IbTokenAdapter {
  address: string
  deployedBlock: number
  collateralToken: string
  rewardToken: string
  treasuryFeeBps: string
  treasuryAccount: string
}
export interface StablecoinAdapter {
  address: string
  deployedBlock: number
  alpacaStablecoin: string
}
export interface StablecoinAdapters {
  AUSD: StablecoinAdapter
}
export interface SystemDebtEngine {
  address: string
}
export interface LiquidationEngine {
  address: string
  deployedBlock: number
}