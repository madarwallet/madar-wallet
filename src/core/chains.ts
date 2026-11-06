import type { Address } from "viem";
import { arbitrum, avalanche, base, berachain, blast, bsc, celo, cronos, flare, gnosis, hyperEvm, ink, kaia, kava, linea, mainnet, mantle, opBNB, optimism, polygon, rootstock, scroll, sei, sonic, unichain, worldchain, zksync, type Chain } from "viem/chains";

export interface Token {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  coingecko?: string;
  verified: boolean;
}

export interface Network {
  id: string;
  name: string;
  chain: Chain;
  rpcs: string[];
  explorer: string;
  native: { symbol: string; name: string; coingecko: string };
  cgPlatform: string;
  tokens: Token[];
  defaultTokens: string[];

  swap?: { kyber?: string; lifi?: boolean; from?: boolean; to?: boolean };
}

const t = (symbol: string, name: string, address: Address, decimals: number, coingecko?: string): Token => ({ symbol, name, address, decimals, coingecko, verified: true });
const STABLE = ["USDC", "USDT"];

export const NETWORKS: Network[] = [
  {
    id: "base", name: "Base", chain: base, explorer: "https://basescan.org", cgPlatform: "base",
    rpcs: ["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://1rpc.io/base", "https://swap.madarwallet.app/evmrpc/base"],
    native: { symbol: "ETH", name: "Ether", coingecko: "ethereum" },
    tokens: [
      t("USDC", "USD Coin", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6, "usd-coin"),
      t("USDT", "Tether USD", "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", 6, "tether"),
      t("DAI", "Dai", "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", 18, "dai"),
      t("cbBTC", "Coinbase Wrapped BTC", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", 8, "coinbase-wrapped-btc"),
      t("WETH", "Wrapped Ether", "0x4200000000000000000000000000000000000006", 18, "weth"),
      t("LINK", "Chainlink", "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196", 18, "chainlink"),
      t("AAVE", "Aave", "0x63706e401c06ac8513145b7687A14804d17f814b", 18, "aave"),
      t("AERO", "Aerodrome", "0x940181a94A35A4569E4529A3CDfB74e38FD98631", 18, "aerodrome-finance"),
      t("VVV", "Venice Token", "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf", 18, "venice-token"),
      t("wstETH", "Wrapped stETH", "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", 18, "wrapped-steth"),
      t("cbETH", "Coinbase Wrapped Staked ETH", "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", 18, "coinbase-wrapped-staked-eth"),
      t("DEGEN", "Degen", "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", 18, "degen-base"),
      t("BRETT", "Brett", "0x532f27101965dd16442E59d40670FaF5eBB142E4", 18, "based-brett"),
      t("VIRTUAL", "Virtuals Protocol", "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b", 18, "virtual-protocol"),
      t("TOSHI", "Toshi", "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4", 18, "toshi"),
      t("USDe", "Ethena USDe", "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", 18, "ethena-usde"),
    ],
    defaultTokens: STABLE,
  },
  {
    id: "ethereum", name: "Ethereum", chain: mainnet, explorer: "https://etherscan.io", cgPlatform: "ethereum",
    rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://1rpc.io/eth", "https://swap.madarwallet.app/evmrpc/ethereum"],
    native: { symbol: "ETH", name: "Ether", coingecko: "ethereum" },
    tokens: [
      t("USDC", "USD Coin", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6, "usd-coin"),
      t("USDT", "Tether USD", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6, "tether"),
      t("DAI", "Dai", "0x6B175474E89094C44Da98b954EedeAC495271d0F", 18, "dai"),
      t("WBTC", "Wrapped BTC", "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8, "wrapped-bitcoin"),
      t("WETH", "Wrapped Ether", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18, "weth"),
      t("LINK", "Chainlink", "0x514910771AF9Ca656af840dff83E8264EcF986CA", 18, "chainlink"),
      t("UNI", "Uniswap", "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", 18, "uniswap"),
      t("AAVE", "Aave", "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", 18, "aave"),
      t("WLD", "Worldcoin", "0x163f8C2467924be0ae7B5347228CABF260318753", 18, "worldcoin-wld"),
      t("CRV", "Curve DAO Token", "0xD533a949740bb3306d119CC777fa900bA034cd52", 18, "curve-dao-token"),
      t("FET", "Fetch.ai", "0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85", 18, "fetch-ai"),
      t("PENDLE", "Pendle", "0x808507121B80c02388fAd14726482e061B8da827", 18, "pendle"),
      t("LDO", "Lido DAO Token", "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32", 18, "lido-dao"),
      t("IMX", "Immutable", "0xF57e7e7C23978C3cAEC3C3548E3D615c346e79fF", 18, "immutable-x"),
      t("ENS", "Ethereum Name Service", "0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72", 18, "ethereum-name-service"),
      t("COMP", "Compound", "0xc00e94Cb662C3520282E6f5717214004A7f26888", 18, "compound-governance-token"),
      t("APE", "ApeCoin", "0x4d224452801ACEd8B2F0aebE155379bb5D594381", 18, "apecoin"),
      t("SAND", "SAND", "0x3845badAde8e6dFF049820680d1F14bD3903a5d0", 18, "the-sandbox"),
      t("ENA", "Ethena", "0x57e114B691Db790C35207b2e685D4A43181e6061", 18, "ethena"),
      t("ONDO", "Ondo", "0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3", 18, "ondo-finance"),
      t("PAXG", "PAX Gold", "0x45804880De22913dAFE09f4980848ECE6EcbAf78", 18, "pax-gold"),
      t("ZRO", "LayerZero", "0x6985884C4392D348587B19cb9eAAf157F13271cd", 18, "layerzero"),
      t("PEPE", "PEPE", "0x6982508145454Ce325dDbE47a25d4ec3d2311933", 18, "pepe"),
      t("GRT", "The Graph", "0xc944E90C64B2c07662A292be6244BDf05Cda44a7", 18, "the-graph"),
      t("SKY", "Sky", "0x56072C95FAA701256059aa122697B133aDEd9279", 18, "sky"),
      t("QNT", "Quant", "0x4a220E6096B25EADb88358cb44068A3248254675", 18, "quant-network"),
      t("SNX", "Synthetix", "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F", 18, "havven"),
      t("BAT", "Basic Attention Token", "0x0D8775F648430679A709E98d2b0Cb6250d2887EF", 18, "basic-attention-token"),
      t("MANA", "Decentraland", "0x0F5D2fB29fb7d3CFeE444a200298f468908cC942", 18, "decentraland"),
      t("AXS", "Axie Infinity", "0xBB0E17EF65F82Ab018d8EDd776e8DD940327B28b", 18, "axie-infinity"),
      t("CHZ", "Chiliz", "0x3506424F91fD33084466F402d5D97f05F8e3b4AF", 18, "chiliz"),
      t("stETH", "Lido Staked Ether", "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", 18, "staked-ether"),
      t("wstETH", "Wrapped stETH", "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", 18, "wrapped-steth"),
      t("USDe", "Ethena USDe", "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3", 18, "ethena-usde"),
      t("PYUSD", "PayPal USD", "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", 6, "paypal-usd"),
      t("cbETH", "Coinbase Wrapped Staked ETH", "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704", 18, "coinbase-wrapped-staked-eth"),
      t("ARB", "Arbitrum", "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1", 18, "arbitrum"),
      t("SHIB", "Shiba Inu", "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", 18, "shiba-inu"),
      t("FLOKI", "Floki", "0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E", 9, "floki"),
    ],
    defaultTokens: STABLE,
  },
  {
    id: "arbitrum", name: "Arbitrum", chain: arbitrum, explorer: "https://arbiscan.io", cgPlatform: "arbitrum-one",
    rpcs: ["https://arbitrum-one-rpc.publicnode.com", "https://arbitrum.drpc.org", "https://1rpc.io/arb", "https://swap.madarwallet.app/evmrpc/arbitrum"],
    native: { symbol: "ETH", name: "Ether", coingecko: "ethereum" },
    tokens: [
      t("USDC", "USD Coin", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6, "usd-coin"),
      t("USDT", "Tether USD (USDT0)", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6, "tether"),
      t("USDC.e", "USD Coin (bridged)", "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", 6, "usd-coin-ethereum-bridged"),
      t("DAI", "Dai", "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", 18, "dai"),
      t("WBTC", "Wrapped BTC", "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", 8, "wrapped-bitcoin"),
      t("WETH", "Wrapped Ether", "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", 18, "weth"),
      t("ARB", "Arbitrum", "0x912CE59144191C1204E64559FE8253a0e49E6548", 18, "arbitrum"),
      t("LINK", "Chainlink", "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", 18, "chainlink"),
      t("UNI", "Uniswap", "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0", 18, "uniswap"),
      t("GMX", "GMX", "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", 18, "gmx"),
      t("GRT", "The Graph", "0x9623063377AD1B27544C965cCd7342f7EA7e88C7", 18, "the-graph"),
      t("wstETH", "Wrapped stETH", "0x5979D7b546E38E414F7E9822514be443A4800529", 18, "wrapped-steth"),
      t("USDe", "Ethena USDe", "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", 18, "ethena-usde"),
      t("PENDLE", "Pendle", "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8", 18, "pendle"),
      t("JOE", "JOE", "0x371c7ec6D8039ff7933a2AA28EB827Ffe1F52f07", 18, "joe"),
    ],
    defaultTokens: STABLE,
  },
  {
    id: "optimism", name: "Optimism", chain: optimism, explorer: "https://optimistic.etherscan.io", cgPlatform: "optimistic-ethereum",
    rpcs: ["https://optimism-rpc.publicnode.com", "https://1rpc.io/op", "https://optimism.drpc.org", "https://swap.madarwallet.app/evmrpc/optimism"],
    native: { symbol: "ETH", name: "Ether", coingecko: "ethereum" },
    tokens: [
      t("USDC", "USD Coin", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", 6, "usd-coin"),
      t("USDT", "Tether USD", "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", 6, "tether"),
      t("USDC.e", "USD Coin (bridged)", "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", 6, "bridged-usd-coin-optimism"),
      t("DAI", "Dai", "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", 18, "dai"),
      t("WBTC", "Wrapped BTC", "0x68f180fcCe6836688e9084f035309E29Bf0A2095", 8, "wrapped-bitcoin"),
      t("WETH", "Wrapped Ether", "0x4200000000000000000000000000000000000006", 18, "weth"),
      t("OP", "Optimism", "0x4200000000000000000000000000000000000042", 18, "optimism"),
      t("LINK", "Chainlink", "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6", 18, "chainlink"),
      t("wstETH", "Wrapped stETH", "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb", 18, "wrapped-steth"),
      t("VELO", "Velodrome", "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db", 18, "velodrome-finance"),
      t("UNI", "Uniswap", "0x6fd9d7AD17242c41f7131d257212c54A0e816691", 18, "uniswap"),
    ],
    defaultTokens: STABLE,
  },
  {
    id: "polygon", name: "Polygon", chain: polygon, explorer: "https://polygonscan.com", cgPlatform: "polygon-pos",
    rpcs: ["https://polygon.drpc.org", "https://1rpc.io/matic", "https://polygon-bor-rpc.publicnode.com", "https://swap.madarwallet.app/evmrpc/polygon"],
    native: { symbol: "POL", name: "Polygon", coingecko: "polygon-ecosystem-token" },
    tokens: [
      t("USDC", "USD Coin", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6, "usd-coin"),
      t("USDT", "Tether USD (USDT0)", "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6, "tether"),
      t("USDC.e", "USD Coin (bridged)", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", 6, "bridged-usdc-polygon-pos-bridge"),
      t("DAI", "Dai", "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", 18, "dai"),
      t("WBTC", "Wrapped BTC", "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", 8, "wrapped-bitcoin"),
      t("WETH", "Wrapped Ether", "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", 18, "weth"),
      t("LINK", "Chainlink", "0xb0897686c545045aFc77CF20eC7A532E3120E0F1", 18, "chainlink"),
      t("AAVE", "Aave", "0xD6DF932A45C0f255f85145f286eA0b292B21C90B", 18, "aave"),
      t("UNI", "Uniswap", "0xb33EaAd8d922B1083446DC23f610c2567fB5180f", 18, "uniswap"),
      t("GHST", "Aavegotchi", "0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7", 18, "aavegotchi"),
      t("SAND", "SAND", "0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683", 18, "the-sandbox"),
      t("MANA", "Decentraland", "0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4", 18, "decentraland"),
    ],
    defaultTokens: STABLE,
  },
  {
    id: "bsc", name: "BNB Chain", chain: bsc, explorer: "https://bscscan.com", cgPlatform: "binance-smart-chain",
    rpcs: ["https://bsc-rpc.publicnode.com", "https://1rpc.io/bnb", "https://bsc.drpc.org", "https://swap.madarwallet.app/evmrpc/bsc"],
    native: { symbol: "BNB", name: "BNB", coingecko: "binancecoin" },
    tokens: [
      t("USDT", "Tether USD", "0x55d398326f99059fF775485246999027B3197955", 18, "tether"),
      t("USDC", "USD Coin", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18, "usd-coin"),
      t("DAI", "Dai", "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", 18, "dai"),
      t("BTCB", "Bitcoin BEP2 (BTCB)", "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", 18, "binance-bitcoin"),
      t("ETH", "Ethereum (Binance-Peg)", "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", 18, "ethereum"),
      t("CAKE", "PancakeSwap", "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", 18, "pancakeswap-token"),
      t("LINK", "Chainlink", "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD", 18, "chainlink"),
      t("UNI", "Uniswap", "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1", 18, "uniswap"),
      t("TWT", "Trust Wallet", "0x4B0F1812e5Df2A09796481Ff14017e6005508003", 18, "trust-wallet-token"),
      t("XVS", "Venus", "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63", 18, "venus"),
    ],
    defaultTokens: STABLE,
  },
  {
    id: "avalanche", name: "Avalanche", chain: avalanche, explorer: "https://snowtrace.io", cgPlatform: "avalanche",
    rpcs: ["https://avalanche-c-chain-rpc.publicnode.com", "https://avalanche.drpc.org", "https://1rpc.io/avax/c", "https://swap.madarwallet.app/evmrpc/avalanche"],
    native: { symbol: "AVAX", name: "Avalanche", coingecko: "avalanche-2" },
    tokens: [
      t("USDC", "USD Coin", "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", 6, "usd-coin"),
      t("USDT", "Tether USD", "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", 6, "tether"),
      t("USDC.e", "USD Coin (bridged)", "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664", 6, "usd-coin-avalanche-bridged-usdc-e"),
      t("DAI.e", "Dai (bridged)", "0xd586E7F844cEa2F87f50152665BCbc2C279D8d70", 18, "dai"),
      t("BTC.b", "Bitcoin (bridged)", "0x152b9d0FdC40C096757F570A51E494bd4b943E50", 8, "bitcoin-avalanche-bridged-btc-b"),
      t("WETH.e", "Wrapped Ether (bridged)", "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", 18, "weth"),
      t("LINK.e", "Chainlink (bridged)", "0x5947BB275c521040051D82396192181b413227A3", 18, "chainlink"),
      t("GMX", "GMX", "0x62edc0692BD897D2295872a9FFCac5425011c661", 18, "gmx"),
      t("JOE", "JOE", "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd", 18, "joe"),
    ],
    defaultTokens: STABLE,
  },
];

export const POPULAR: Network[] = [
  {
    id: "linea", name: "Linea", chain: linea, explorer: "https://lineascan.build", cgPlatform: "linea",
    rpcs: ["https://linea-rpc.publicnode.com", "https://linea.drpc.org"],
    native: { symbol: "ETH", name: "Ether", coingecko: "ethereum" },
    tokens: [
      t("USDC", "USD Coin", "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", 6, "usd-coin"),
      t("USDT", "Tether USD", "0xA219439258ca9da29E9Cc4cE5596924745e12B93", 6, "tether"),
    ],
    defaultTokens: STABLE, swap: { kyber: "linea", to: true },
  },
  {
    id: "zksync", name: "ZKsync Era", chain: zksync, explorer: "https://explorer.zksync.io", cgPlatform: "zksync",
    rpcs: ["https://zksync.drpc.org", "https://mainnet.era.zksync.io"],
    native: { symbol: "ETH", name: "Ether", coingecko: "ethereum" },
    tokens: [
      t("USDC", "USD Coin", "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4", 6, "usd-coin"),
      t("USDT", "Tether USD (bridged)", "0x493257fD37EDB34451f62EDf8D2a0C418852bA4C", 6, "tether"),
      t("USDC.e", "USD Coin (bridged)", "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4", 6, "zksync-bridged-usdc-zksync"),
    ],
    defaultTokens: STABLE, swap: {},
  },
  {
    id: "scroll", name: "Scroll", chain: scroll, explorer: "https://scrollscan.com", cgPlatform: "scroll",
    rpcs: ["https://scroll-rpc.publicnode.com", "https://scroll.drpc.org"],
    native: { symbol: "ETH", name: "Ether", coingecko: "ethereum" },
    tokens: [
      t("USDC", "USD Coin", "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4", 6, "usd-coin"),
      t("USDT", "Tether USD", "0xf55BEC9cafDbE8730f096Aa55dad6D22d44099Df", 6, "tether"),
    ],
    defaultTokens: STABLE, swap: { lifi: true },
  },
  {
    id: "unichain", name: "Unichain", chain: unichain, explorer: "https://uniscan.xyz", cgPlatform: "unichain",
    rpcs: ["https://unichain-rpc.publicnode.com", "https://unichain.drpc.org"],
    native: { symbol: "ETH", name: "Ether", coingecko: "ethereum" },
    tokens: [
      t("USDC", "USD Coin", "0x078D782b760474a361dDA0AF3839290b0EF57AD6", 6, "usd-coin"),
      t("USDT", "Tether USD (USDT0)", "0x9151434b16b9763660705744891fA906F660EcC5", 6, "tether"),
    ],
    defaultTokens: STABLE, swap: { kyber: "unichain", to: true },
  },
  {
    id: "sonic", name: "Sonic", chain: sonic, explorer: "https://sonicscan.org", cgPlatform: "sonic",
    rpcs: ["https://sonic-rpc.publicnode.com", "https://sonic.drpc.org"],
    native: { symbol: "S", name: "Sonic", coingecko: "sonic-3" },
    tokens: [
      t("USDC", "USD Coin", "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", 6, "usd-coin"),
      t("USDT", "Tether USD (bridged)", "0x6047828dc181963ba44974801FF68e538dA5eaF9", 6, "tether"),
    ],
    defaultTokens: STABLE, swap: { kyber: "sonic", lifi: true },
  },
  {
    id: "mantle", name: "Mantle", chain: mantle, explorer: "https://mantlescan.xyz", cgPlatform: "mantle",
    rpcs: ["https://mantle-rpc.publicnode.com", "https://mantle.drpc.org"],
    native: { symbol: "MNT", name: "Mantle", coingecko: "mantle" },
    tokens: [
      t("USDC", "USD Coin (bridged)", "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9", 6, "usd-coin"),
      t("USDT", "Tether USD (USDT0)", "0x779Ded0c9e1022225f8E0630b35a9b54bE713736", 6, "tether"),
    ],
    defaultTokens: STABLE, swap: {},
  },
  {
    id: "gnosis", name: "Gnosis", chain: gnosis, explorer: "https://gnosisscan.io", cgPlatform: "xdai",
    rpcs: ["https://gnosis-rpc.publicnode.com", "https://gnosis.drpc.org"],
    native: { symbol: "xDAI", name: "xDAI", coingecko: "xdai" },
    tokens: [

      t("USDC.e", "USD Coin (bridged)", "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0", 6, "bridged-usdc-gnosis"),
      t("USDC", "USD Coin (old bridge)", "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83", 6, "usd-coin"),
      t("USDT", "Tether USD (bridged)", "0x4ECaBa5870353805a9F068101A40E0f32ed605C6", 6, "tether"),
    ],
    defaultTokens: ["USDC.e", "USDC", "USDT"], swap: { lifi: true },
  },
  {
    id: "celo", name: "Celo", chain: celo, explorer: "https://celoscan.io", cgPlatform: "celo",
    rpcs: ["https://celo-rpc.publicnode.com", "https://celo.drpc.org"],
    native: { symbol: "CELO", name: "Celo", coingecko: "celo" },
    tokens: [
      t("USDC", "USD Coin", "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", 6, "usd-coin"),
      t("USDT", "Tether USD", "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", 6, "tether"),
    ],
    defaultTokens: STABLE, swap: {},
  },
  {
    id: "berachain", name: "Berachain", chain: berachain, explorer: "https://berascan.com", cgPlatform: "berachain",
    rpcs: ["https://berachain-rpc.publicnode.com", "https://berachain.drpc.org"],
    native: { symbol: "BERA", name: "Berachain", coingecko: "berachain-bera" },
    tokens: [
      t("USDC.e", "USD Coin (bridged)", "0x549943e04f40284185054145c6E4e9568C1D3241", 6, "stargate-bridged-usdc"),
      t("USDT", "Tether USD (USDT0)", "0x779Ded0c9e1022225f8E0630b35a9b54bE713736", 6, "tether"),
    ],
    defaultTokens: ["USDC.e", "USDT"], swap: { kyber: "berachain" },
  },
  {
    id: "opbnb", name: "opBNB", chain: opBNB, explorer: "https://opbnbscan.com", cgPlatform: "opbnb",
    rpcs: ["https://opbnb-rpc.publicnode.com", "https://opbnb.drpc.org"],
    native: { symbol: "BNB", name: "BNB", coingecko: "binancecoin" },
    tokens: [
      t("USDT", "Tether USD (bridged)", "0x9e5AAC1Ba1a2e6aEd6b32689DFcF62A509Ca96f3", 18, "tether"),
    ],
    defaultTokens: ["USDT"], swap: {},
  },
  {
    id: "blast", name: "Blast", chain: blast, explorer: "https://blastscan.io", cgPlatform: "blast",

    rpcs: ["https://rpc.blast.io", "https://blast-rpc.publicnode.com", "https://blast.drpc.org"],
    native: { symbol: "ETH", name: "Ether", coingecko: "ethereum" },
    tokens: [
      t("USDB", "USDB", "0x4300000000000000000000000000000000000003", 18, "usdb"),
    ],
    defaultTokens: ["USDB"], swap: {},
  },

  {
    id: "sei", name: "Sei", chain: sei, explorer: "https://seiscan.io", cgPlatform: "sei-v2",
    rpcs: ["https://sei-evm-rpc.publicnode.com", "https://sei.drpc.org"],
    native: { symbol: "SEI", name: "Sei", coingecko: "sei-network" },
    tokens: [
      t("USDC", "USD Coin", "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392", 6, "usd-coin"),
      t("USDT", "USDT0", "0x9151434b16b9763660705744891fA906F660EcC5", 6, "usdt0"),
    ],
    defaultTokens: STABLE, swap: {},
  },
  {
    id: "cronos", name: "Cronos", chain: cronos, explorer: "https://explorer.cronos.org", cgPlatform: "cronos",
    rpcs: ["https://cronos-evm-rpc.publicnode.com", "https://cronos.drpc.org"],
    native: { symbol: "CRO", name: "Cronos", coingecko: "crypto-com-chain" },
    tokens: [
      t("USDC", "USD Coin", "0x3D7F2C478aAfdB65542BCB44bCeeC05849999d2D", 6, "usd-coin"),
    ],
    defaultTokens: ["USDC"], swap: {},
  },
  {
    id: "ink", name: "Ink", chain: ink, explorer: "https://explorer.inkonchain.com", cgPlatform: "ink",
    rpcs: ["https://ink-rpc.publicnode.com", "https://ink.drpc.org"],
    native: { symbol: "ETH", name: "Ether", coingecko: "ethereum" },
    tokens: [
      t("USDC", "USD Coin", "0x2D270e6886d130D724215A266106e6832161EAEd", 6, "usd-coin"),
      t("USDT", "USDT0", "0x0200C29006150606B650577BBE7B6248F58470c1", 6, "usdt0"),
    ],
    defaultTokens: STABLE, swap: {},
  },
  {
    id: "worldchain", name: "World Chain", chain: worldchain, explorer: "https://worldscan.org", cgPlatform: "world-chain",
    rpcs: ["https://worldchain.drpc.org", "https://swap.madarwallet.app/evmrpc/worldchain"],
    native: { symbol: "ETH", name: "Ether", coingecko: "ethereum" },
    tokens: [
      t("USDC", "USD Coin", "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", 6, "usd-coin"),
    ],
    defaultTokens: ["USDC"], swap: {},
  },
  {
    id: "hyperevm", name: "HyperEVM", chain: hyperEvm, explorer: "https://hyperevmscan.io", cgPlatform: "hyperevm",
    rpcs: ["https://hyperliquid.drpc.org", "https://swap.madarwallet.app/evmrpc/hyperevm"],
    native: { symbol: "HYPE", name: "Hyperliquid", coingecko: "hyperliquid" },
    tokens: [
      t("USDC", "USD Coin", "0xb88339CB7199b77E23DB6E890353E22632Ba630f", 6, "usd-coin"),
      t("USDT", "USDT0", "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", 6, "usdt0"),
    ],

    defaultTokens: STABLE, swap: { kyber: "hyperevm" },
  },
  {
    id: "flare", name: "Flare", chain: flare, explorer: "https://flare-explorer.flare.network", cgPlatform: "flare-network",
    rpcs: ["https://flare.drpc.org", "https://swap.madarwallet.app/evmrpc/flare"],
    native: { symbol: "FLR", name: "Flare", coingecko: "flare-networks" },
    tokens: [
      t("USDT", "USDT0", "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", 6, "usdt0"),
    ],
    defaultTokens: ["USDT"], swap: {},
  },
  {
    id: "rootstock", name: "Rootstock", chain: rootstock, explorer: "https://explorer.rsk.co", cgPlatform: "rootstock",
    rpcs: ["https://rootstock.drpc.org", "https://swap.madarwallet.app/evmrpc/rootstock"],
    native: { symbol: "RBTC", name: "Rootstock Bitcoin", coingecko: "rootstock" },
    tokens: [
      t("USDT", "USDT0", "0x779Ded0c9e1022225f8E0630b35a9b54bE713736", 6, "usdt0"),
    ],
    defaultTokens: ["USDT"], swap: {},
  },
  {
    id: "kava", name: "Kava", chain: kava, explorer: "https://kavascan.com", cgPlatform: "kava",
    rpcs: ["https://kava-evm-rpc.publicnode.com", "https://kava.drpc.org"],
    native: { symbol: "KAVA", name: "Kava", coingecko: "kava" },
    tokens: [], defaultTokens: [], swap: {},
  },
  {
    id: "kaia", name: "Kaia", chain: kaia, explorer: "https://kaiascan.io", cgPlatform: "klay-token",
    rpcs: ["https://kaia.drpc.org", "https://swap.madarwallet.app/evmrpc/kaia"],
    native: { symbol: "KAIA", name: "Kaia", coingecko: "kaia" },
    tokens: [], defaultTokens: [], swap: {},
  },
];

export const ALL_NETWORKS: readonly Network[] = [...NETWORKS, ...POPULAR];
export const networkById = (id: string) => ALL_NETWORKS.find((n) => n.id === id);

export function activeNetworks(s: { networksOn?: readonly string[] } | null | undefined): Network[] {
  const on = s?.networksOn;
  return on?.length ? [...NETWORKS, ...POPULAR.filter((n) => on.includes(n.id))] : NETWORKS;
}

export const isActive = (s: { networksOn?: readonly string[] } | null | undefined, id: string) => NETWORKS.some((n) => n.id === id) || (!!s?.networksOn?.includes(id) && POPULAR.some((n) => n.id === id));

export function networksOnPatch(s: { networksOn?: readonly string[]; networkId: string }, id: string, on: boolean): { networksOn: string[]; networkId?: string } | null {
  if (!POPULAR.some((n) => n.id === id)) return null;
  const cur = (s.networksOn ?? []).filter((x) => POPULAR.some((n) => n.id === x));
  if (cur.includes(id) === on) return null;
  const next = on ? POPULAR.map((n) => n.id).filter((x) => x === id || cur.includes(x)) : cur.filter((x) => x !== id);
  return on || s.networkId !== id ? { networksOn: next } : { networksOn: next, networkId: "all" };
}

export const swapsOn = (n: Network) => !n.swap || !!n.swap.kyber || !!n.swap.lifi;
export const lifiSwapsOn = (n: Network) => !n.swap || !!n.swap.lifi;

export const crossFrom = (n: Network) => !n.swap || !!n.swap.from;
export const crossTo = (n: Network) => !n.swap || !!n.swap.to;

export function withTokenOn(n: { id: string; tokens: readonly Token[]; defaultTokens: readonly string[] }, enabled: Record<string, string[]>, address: string): Record<string, string[]> | null {
  const a = address.toLowerCase();
  if (!n.tokens.some((tk) => tk.address.toLowerCase() === a)) return null;
  const on = enabled[n.id] ?? n.tokens.filter((tk) => n.defaultTokens.includes(tk.symbol)).map((tk) => tk.address.toLowerCase());
  return on.includes(a) ? null : { ...enabled, [n.id]: [...on, a] };
}

export function visibleTokens(n: { id: string; tokens: readonly Token[]; defaultTokens: readonly string[] }, enabled: Record<string, string[]>, custom: { networkId: string; address: Address; symbol: string; name: string; decimals: number }[]): Token[] {
  const on = enabled[n.id] ?? n.tokens.filter((tk) => n.defaultTokens.includes(tk.symbol)).map((tk) => tk.address.toLowerCase());

  const listed = new Set(n.tokens.map((tk) => tk.address.toLowerCase()));
  const mineAll = custom.filter((ct) => ct.networkId === n.id);
  const upgraded = new Set(mineAll.filter((ct) => listed.has(ct.address.toLowerCase())).map((ct) => ct.address.toLowerCase()));
  const mine = mineAll.filter((ct) => !upgraded.has(ct.address.toLowerCase())).map((ct) => ({ ...ct, verified: false }) as Token);
  return [...n.tokens.filter((tk) => on.includes(tk.address.toLowerCase()) || upgraded.has(tk.address.toLowerCase())), ...mine];
}
