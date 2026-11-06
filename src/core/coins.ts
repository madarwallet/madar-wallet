export const COIN_NAMES: Readonly<Record<string, string>> = {
  BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", BNB: "BNB", POL: "Polygon", AVAX: "Avalanche",
  USDC: "USD Coin", "USDC.e": "Bridged USD Coin", USDT: "Tether", DAI: "Dai", "DAI.e": "Dai",
  WETH: "Wrapped Ether", "WETH.e": "Wrapped Ether", WBTC: "Wrapped Bitcoin", cbBTC: "Coinbase Wrapped BTC", BTCB: "Wrapped Bitcoin", "BTC.b": "Wrapped Bitcoin",
  LINK: "Chainlink", "LINK.e": "Chainlink", UNI: "Uniswap", AAVE: "Aave", CAKE: "PancakeSwap", ARB: "Arbitrum", OP: "Optimism",
  JUP: "Jupiter", RAY: "Raydium", PYTH: "Pyth", JTO: "Jito",

  WLD: "Worldcoin", CRV: "Curve", FET: "Fetch AI", PENDLE: "Pendle", LDO: "Lido DAO", IMX: "Immutable", ENS: "Ethereum Name Service", COMP: "Compound",
  APE: "ApeCoin", SAND: "The Sandbox", ENA: "Ethena", ONDO: "Ondo", PAXG: "PAX Gold", ZRO: "LayerZero", PEPE: "Pepe", GMX: "GMX", AERO: "Aerodrome",
  VVV: "Venice", TRUMP: "Official Trump", PENGU: "Pudgy Penguins", GRASS: "Grass", USELESS: "Useless Coin", RENDER: "Render", PUMP: "Pump Fun", FARTCOIN: "Fartcoin", BONK: "Bonk",

  S: "Sonic", MNT: "Mantle", xDAI: "xDAI", CELO: "Celo", BERA: "Berachain", USDB: "USDB",

  DOGE: "Dogecoin", LTC: "Litecoin", XRP: "XRP",
  ADA: "Cardano",
  NEAR: "NEAR Protocol",
  SUI: "Sui", APT: "Aptos", ATOM: "Cosmos Hub", OSMO: "Osmosis", TIA: "Celestia", DOT: "Polkadot",

  SEI: "Sei", CRO: "Cronos", HYPE: "Hyperliquid", FLR: "Flare", RBTC: "Rootstock Bitcoin", KAVA: "Kava", KAIA: "Kaia",

  GRT: "The Graph", SKY: "Sky", QNT: "Quant", SNX: "Synthetix", BAT: "Basic Attention Token", MANA: "Decentraland", AXS: "Axie Infinity", CHZ: "Chiliz", stETH: "Lido Staked Ether", wstETH: "Wrapped stETH", USDe: "Ethena USDe", PYUSD: "PayPal USD", cbETH: "Coinbase Wrapped Staked ETH", SHIB: "Shiba Inu", FLOKI: "Floki", JOE: "JOE", DEGEN: "Degen", BRETT: "Brett", VIRTUAL: "Virtuals Protocol", TOSHI: "Toshi", VELO: "Velodrome", GHST: "Aavegotchi", TWT: "Trust Wallet", XVS: "Venus",
};

export function coinName(symbol: string, name: string, verified: boolean): string {
  if (verified && Object.prototype.hasOwnProperty.call(COIN_NAMES, symbol)) return COIN_NAMES[symbol];
  return name || symbol;
}
