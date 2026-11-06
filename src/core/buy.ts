export const CHANGELLY_REF = "";
export const CHANGELLY_WIDGET = "https://widget.changelly.com/";

export type BuyKind = "evm" | "sol" | "btc";
export interface BuyCoin { ticker: string; symbol: string; networkId: string; kind: BuyKind }

export const BUY_COINS: BuyCoin[] = [
  { ticker: "btc", symbol: "BTC", networkId: "bitcoin", kind: "btc" },
  { ticker: "eth", symbol: "ETH", networkId: "ethereum", kind: "evm" },
  { ticker: "usdc", symbol: "USDC", networkId: "ethereum", kind: "evm" },
  { ticker: "usdt20", symbol: "USDT", networkId: "ethereum", kind: "evm" },
  { ticker: "sol", symbol: "SOL", networkId: "solana", kind: "sol" },
  { ticker: "usdcsol", symbol: "USDC", networkId: "solana", kind: "sol" },
  { ticker: "usdtsol", symbol: "USDT", networkId: "solana", kind: "sol" },
  { ticker: "ethbase", symbol: "ETH", networkId: "base", kind: "evm" },
  { ticker: "usdcbase", symbol: "USDC", networkId: "base", kind: "evm" },
  { ticker: "bnbbsc", symbol: "BNB", networkId: "bsc", kind: "evm" },
  { ticker: "usdcbsc", symbol: "USDC", networkId: "bsc", kind: "evm" },
  { ticker: "usdtbsc", symbol: "USDT", networkId: "bsc", kind: "evm" },
  { ticker: "etharb", symbol: "ETH", networkId: "arbitrum", kind: "evm" },
  { ticker: "ethop", symbol: "ETH", networkId: "optimism", kind: "evm" },
  { ticker: "pol", symbol: "POL", networkId: "polygon", kind: "evm" },
  { ticker: "avaxc", symbol: "AVAX", networkId: "avalanche", kind: "evm" },
];

export const PREFERRED: Record<"USDC" | "USDT", string> = { USDC: "base", USDT: "bsc" };
export const STABLE_NETWORKS: Record<"USDC" | "USDT", string[]> = {
  USDC: ["base", "bsc", "solana", "ethereum"],
  USDT: ["bsc", "solana", "ethereum"],
};

export const FIATS = ["USD", "EUR", "GBP"] as const;
export const AMOUNT_PRESETS = [20, 50, 100, 250] as const;

export interface WidgetParams { coin: BuyCoin; address: string; fiat: string; amount?: number; ref?: string; color?: string }

export function widgetUrl({ coin, address, fiat, amount, ref = CHANGELLY_REF, color = "e9a23b" }: WidgetParams): string {
  const q = new URLSearchParams({
    type: "no-rev-share",
    from: fiat.toLowerCase(), fromDefault: fiat.toLowerCase(),
    to: coin.ticker, toDefault: coin.ticker,
    address, readOnlyDestinationAddress: "true",
    color: color.replace(/^#/, ""), v: "3",
  });
  if (amount && amount > 0) q.set("amount", String(amount));
  if (ref) q.set("merchant_id", ref);
  return `${CHANGELLY_WIDGET}?${q.toString()}`;
}
