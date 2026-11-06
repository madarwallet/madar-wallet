import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base58xrp, bech32 } from "@scure/base";
import { decodeFunctionData, getAddress, parseAbi, type Abi, type Hex } from "viem";
import { isBtcAddress } from "../core/btcbase";

export const THOR_ROUTERS: Readonly<Record<number, string>> = {
  1: "0xd37bbe5744d730a1d98d8dc97c42f0ca46ad7146",
  56: "0xb30ec53f98ff5947ede720d32ac2da7e52a5f56b",
  8453: "0x00dc6100103bc402d490aee3f9a5560cbd91f1d4",
};

export const THOR_NODES = ["https://gateway.liquify.com/chain/thorchain_api", "https://thorchain-thornode-lb-1.thorwallet.org"] as const;
export const THOR_CHAIN_NAME: Readonly<Record<number, string>> = { 1: "ETH", 56: "BSC", 8453: "BASE" };

export const THOR_PAY_TOKENS: Readonly<Record<number, readonly string[]>> = {
  1: ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "0xdac17f958d2ee523a2206206994597c13d831ec7"],
  56: ["0x55d398326f99059ff775485246999027b3197955", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"],
  8453: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"],
};

export const THOR_AFFILIATES: readonly string[] = ["madar"];

export const THOR_FEE_BPS = 50;

export const THOR_MAX_EXPIRY_S = 3600;

export type ThorEvmCoin = "ETH.ETH" | "ETH.USDC" | "ETH.USDT" | "BSC.BNB" | "BSC.USDT" | "BSC.USDC" | "BASE.ETH" | "BASE.USDC" | "AVAX.AVAX" | "AVAX.USDC" | "AVAX.USDT";
export type ThorCoin = "DOGE" | "XRP" | "LTC" | "BTC" | ThorEvmCoin;

export const thorChainOf = (c: ThorCoin) => (c.includes(".") ? c.slice(0, c.indexOf(".")) : c);
export const isThorEvmCoin = (c: string): c is ThorEvmCoin => c.includes(".");
const ABI = parseAbi(["function depositWithExpiry(address vault, address asset, uint256 amount, string memo, uint256 expiration)"]) as Abi;
const COINS: Record<string, { coin: ThorCoin; dec: number }> = {
  d: { coin: "DOGE", dec: 8 }, x: { coin: "XRP", dec: 6 }, l: { coin: "LTC", dec: 8 }, "doge.doge": { coin: "DOGE", dec: 8 }, "xrp.xrp": { coin: "XRP", dec: 6 }, "ltc.ltc": { coin: "LTC", dec: 8 },
  b: { coin: "BTC", dec: 8 }, "btc.btc": { coin: "BTC", dec: 8 },

  "eth.eth": { coin: "ETH.ETH", dec: 18 }, "eth.usdc": { coin: "ETH.USDC", dec: 6 }, "eth.usdt": { coin: "ETH.USDT", dec: 6 },
  "bsc.bnb": { coin: "BSC.BNB", dec: 18 }, "bsc.usdt": { coin: "BSC.USDT", dec: 18 }, "bsc.usdc": { coin: "BSC.USDC", dec: 18 },
  "base.eth": { coin: "BASE.ETH", dec: 18 }, "base.usdc": { coin: "BASE.USDC", dec: 6 },
  "avax.avax": { coin: "AVAX.AVAX", dec: 18 }, "avax.usdc": { coin: "AVAX.USDC", dec: 6 }, "avax.usdt": { coin: "AVAX.USDT", dec: 6 },
};

export interface ThorCall {
  vault: string; tokenIn: string | null; amountIn: string; coin: ThorCoin; dest: string;

  destOk: boolean;

  minOut: string | null; outDecimals: number; expiry: number; affiliate: string | null; affiliateBps: number | null; memo: string;
}

const same4 = (a: Uint8Array, b: Uint8Array) => a.length === 4 && b.length === 4 && a.every((x, i) => x === b[i]);
const checksumOk = (b: Uint8Array) => b.length === 25 && same4(sha256(sha256(b.slice(0, 21))).slice(0, 4), b.slice(21));

export function validDoge(a: unknown): boolean {
  if (typeof a !== "string" || !/^[DA9][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) return false;
  let b: Uint8Array;
  try { b = base58.decode(a); } catch { return false; }
  return b.length === 25 && (b[0] === 0x1e || b[0] === 0x16) && checksumOk(b);
}

export function validXrp(a: unknown): boolean {
  if (typeof a !== "string" || !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a)) return false;
  let b: Uint8Array;
  try { b = base58xrp.decode(a); } catch { return false; }
  return b.length === 25 && b[0] === 0 && checksumOk(b);
}

export function validLtc(a: unknown): boolean {
  if (typeof a !== "string") return false;
  if (/^ltc1q[02-9ac-hj-np-z]{38}$/.test(a) || /^ltc1q[02-9ac-hj-np-z]{58}$/.test(a)) {
    try { const d = bech32.decode(a as `${string}1${string}`); const p = bech32.fromWords(d.words.slice(1)); return d.prefix === "ltc" && d.words[0] === 0 && (p.length === 20 || p.length === 32); } catch { return false; }
  }
  if (!/^[LM][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) return false;
  let b: Uint8Array;
  try { b = base58.decode(a); } catch { return false; }
  return b.length === 25 && b[0] === (a[0] === "L" ? 0x30 : 0x32) && checksumOk(b);
}

const validBtcDest = (a: string) => isBtcAddress(a) && (!/^bc1/i.test(a) || a === a.toLowerCase());
export const validThorDest = (coin: string, a: string) => (coin === "DOGE" ? validDoge(a) : coin === "XRP" ? validXrp(a) : coin === "LTC" ? validLtc(a) : coin === "BTC" ? validBtcDest(a)
  : isThorEvmCoin(coin) ? /^0x[0-9a-fA-F]{40}$/.test(a) : false);

export const SITE_THOR_COINS: readonly string[] = ["DOGE", "XRP", "LTC"];
export function decodeThorSite(chainId: number, to: string, value: bigint, data: Hex, own = false): ThorCall | null {
  if (THOR_ROUTERS[chainId] !== to.toLowerCase()) return null;
  let d: { functionName: string; args: readonly unknown[] };
  try { d = decodeFunctionData({ abi: ABI, data }) as never; } catch { return null; }
  const [vault, asset, amount, memo, expiry] = d.args as [string, string, bigint, string, bigint];
  const native = /^0x0{40}$/i.test(asset);
  if (native ? value !== amount : value !== 0n) return null;

  const m = /^(?:=|s|swap):([a-z.]+):([A-Za-z0-9]{20,64}):(\d{0,30})(?:\/\d+\/\d+)?(?::([a-z0-9-_+]{1,30}):(\d{1,4}))?$/i.exec(String(memo));
  if (!m || !COINS[m[1].toLowerCase()]) return null;
  const c = COINS[m[1].toLowerCase()];
  if (!own && !SITE_THOR_COINS.includes(c.coin)) return null;
  const lim = m[3] ? BigInt(m[3]) : 0n;
  const minOut = lim === 0n ? null : (c.dec >= 8 ? lim * 10n ** BigInt(c.dec - 8) : lim / 10n ** BigInt(8 - c.dec)).toString();
  return {
    vault: getAddress(vault), tokenIn: native ? null : getAddress(asset), amountIn: amount.toString(), coin: c.coin, dest: m[2], destOk: validThorDest(c.coin, m[2]),
    minOut, outDecimals: c.dec, expiry: expiry > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(expiry),
    affiliate: m[4] ?? null, affiliateBps: m[5] != null ? Number(m[5]) : null, memo: String(memo),
  };
}

export class ThorCheckError extends Error {
  constructor(public why: "nodes" | "disagree" | "router" | "paused") { super(`THORChain check: ${why}`); }
}
export type ThorFetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
interface Inbound { chain?: string; address?: string; router?: string; halted?: boolean; chain_trading_paused?: boolean; global_trading_paused?: boolean }

export async function thorInbound(chainId: number, coin: ThorCoin, fetcher: ThorFetcher): Promise<{ vault: string; router: string }> {
  const name = THOR_CHAIN_NAME[chainId];
  if (!name || !THOR_ROUTERS[chainId]) throw new ThorCheckError("router");
  const lists = await Promise.all(THOR_NODES.map(async (n) => {
    try { const r = await fetcher(`${n}/thorchain/inbound_addresses`); const j = r.ok ? await r.json() : null; return Array.isArray(j) ? (j as Inbound[]) : null; } catch { return null; }
  }));
  if (!lists[0] || !lists[1]) throw new ThorCheckError("nodes");
  const pick = (l: Inbound[], c: string) => l.find((x) => x && x.chain === c);
  const pa = pick(lists[0], name), pb = pick(lists[1], name), da = pick(lists[0], thorChainOf(coin)), db = pick(lists[1], thorChainOf(coin));
  if (!pa || !pb || !da || !db) throw new ThorCheckError("nodes");
  const low = (s: unknown) => String(s ?? "").toLowerCase();
  if (low(pa.address) !== low(pb.address) || low(pa.router) !== low(pb.router)) throw new ThorCheckError("disagree");
  if (!/^0x[0-9a-f]{40}$/.test(low(pa.address)) || low(pa.router) !== THOR_ROUTERS[chainId]) throw new ThorCheckError("router");
  for (const x of [pa, pb, da, db]) if (x.halted || x.chain_trading_paused || x.global_trading_paused) throw new ThorCheckError("paused");
  return { vault: low(pa.address), router: THOR_ROUTERS[chainId] };
}
