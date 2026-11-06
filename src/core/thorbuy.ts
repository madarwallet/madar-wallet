import { encodeFunctionData, parseAbi, type Address, type Hash, type Hex } from "viem";
import type { Network } from "./chains";
import { feeFields, perGas, publicClient, type GasFees } from "./chainops";
import { evmAllowance, evmApprove, EVM_NATIVE, feeBps, sendFees, wallet } from "./swap";
import { decodeThorSite, isThorEvmCoin, THOR_AFFILIATES, THOR_CHAIN_NAME, THOR_MAX_EXPIRY_S, THOR_NODES, THOR_PAY_TOKENS, THOR_ROUTERS, thorInbound, validThorDest, type ThorCoin, type ThorEvmCoin, type ThorFetcher } from "../dapp/thordecode";

export const THOR_AFFILIATE = THOR_AFFILIATES[0];

export const THOR_COIN: Readonly<Record<ThorCoin, { asset: string; short: string; dec: number }>> = {
  DOGE: { asset: "DOGE.DOGE", short: "d", dec: 8 }, XRP: { asset: "XRP.XRP", short: "x", dec: 6 }, LTC: { asset: "LTC.LTC", short: "l", dec: 8 },
  BTC: { asset: "BTC.BTC", short: "b", dec: 8 },

  "ETH.ETH": { asset: "ETH.ETH", short: "ETH.ETH", dec: 18 },
  "ETH.USDC": { asset: "ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48", short: "ETH.USDC", dec: 6 },
  "ETH.USDT": { asset: "ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7", short: "ETH.USDT", dec: 6 },
  "BSC.BNB": { asset: "BSC.BNB", short: "BSC.BNB", dec: 18 },
  "BSC.USDT": { asset: "BSC.USDT-0X55D398326F99059FF775485246999027B3197955", short: "BSC.USDT", dec: 18 },
  "BSC.USDC": { asset: "BSC.USDC-0X8AC76A51CC950D9822D68B83FE1AD97B32CD580D", short: "BSC.USDC", dec: 18 },
  "BASE.ETH": { asset: "BASE.ETH", short: "BASE.ETH", dec: 18 },
  "BASE.USDC": { asset: "BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913", short: "BASE.USDC", dec: 6 },
  "AVAX.AVAX": { asset: "AVAX.AVAX", short: "AVAX.AVAX", dec: 18 },
  "AVAX.USDC": { asset: "AVAX.USDC-0XB97EF9EF8734C71904D8002F8B6BC66DD9C48A6E", short: "AVAX.USDC", dec: 6 },
  "AVAX.USDT": { asset: "AVAX.USDT-0X9702230A8EA53601F5CD2DC00FDBC13D4DF4A8C7", short: "AVAX.USDT", dec: 6 },
};

const THOR_EVM_OF: Readonly<Record<string, ThorEvmCoin>> = {
  "ethereum:native": "ETH.ETH", "ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "ETH.USDC", "ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7": "ETH.USDT",
  "bsc:native": "BSC.BNB", "bsc:0x55d398326f99059ff775485246999027b3197955": "BSC.USDT", "bsc:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": "BSC.USDC",
  "base:native": "BASE.ETH", "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "BASE.USDC",
  "avalanche:native": "AVAX.AVAX", "avalanche:0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": "AVAX.USDC", "avalanche:0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7": "AVAX.USDT",
};
export function thorEvmCoin(netId: string, token: string): ThorEvmCoin | null {
  const native = String(token).toLowerCase() === EVM_NATIVE.toLowerCase();
  return THOR_EVM_OF[`${netId}:${native ? "native" : String(token).toLowerCase()}`] ?? null;
}

const POOLS: Readonly<Record<string, { chainId: number; pool: string }>> = {
  "ethereum:native": { chainId: 1, pool: "ETH.ETH" },
  "ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { chainId: 1, pool: "ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48" },
  "ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7": { chainId: 1, pool: "ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7" },
  "bsc:native": { chainId: 56, pool: "BSC.BNB" },
  "bsc:0x55d398326f99059ff775485246999027b3197955": { chainId: 56, pool: "BSC.USDT-0X55D398326F99059FF775485246999027B3197955" },
  "bsc:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": { chainId: 56, pool: "BSC.USDC-0X8AC76A51CC950D9822D68B83FE1AD97B32CD580D" },
  "base:native": { chainId: 8453, pool: "BASE.ETH" },
  "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { chainId: 8453, pool: "BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913" },
};
export interface ThorPay { netId: string; chainId: number; pool: string; native: boolean; token: string }

export function thorPay(netId: string, token: string): ThorPay | null {
  const native = String(token).toLowerCase() === EVM_NATIVE.toLowerCase();
  const key = `${netId}:${native ? "native" : String(token).toLowerCase()}`;
  const p = POOLS[key];
  if (!p || !THOR_ROUTERS[p.chainId] || (!native && !THOR_PAY_TOKENS[p.chainId]?.includes(String(token).toLowerCase()))) return null;
  return { netId, chainId: p.chainId, pool: p.pool, native, token: native ? EVM_NATIVE : String(token).toLowerCase() };
}

export const THOR_SLIPPAGE_BPS = 100n;
export const THOR_EXPIRY_S = 15 * 60;
const unsafe = (why: string) => Object.assign(new Error("ERR_UNSAFE"), { why });
const to8 = (v: bigint, dec: number) => (dec >= 8 ? v / 10n ** BigInt(dec - 8) : v * 10n ** BigInt(8 - dec));
const from8 = (v: bigint, dec: number) => (dec >= 8 ? v * 10n ** BigInt(dec - 8) : v / 10n ** BigInt(8 - dec));

const from8Up = (v: bigint, dec: number) => (dec >= 8 ? v * 10n ** BigInt(dec - 8) : (v + 10n ** BigInt(8 - dec) - 1n) / 10n ** BigInt(8 - dec));

export interface ThorBuyQuote {
   out8: bigint; amountOut: bigint;
   outFee: bigint | null;
   feeBps: number | null;
  secs: number | null; vault: string; router: string;
}
type QuoteAnswer = { expected_amount_out?: string; fees?: { asset?: string; outbound?: string; total_bps?: number }; inbound_address?: string; router?: string; total_swap_seconds?: number; recommended_min_amount_in?: string; error?: string; message?: string };

export function thorError(j: QuoteAnswer | null, payDecimals: number): Error & { thorbuy: true; kind: "small" | "route" | "busy"; minIn: bigint | null } {
  const msg = String(j?.message ?? j?.error ?? "");
  let minIn: bigint | null = null;
  try { minIn = j?.recommended_min_amount_in ? from8Up(BigInt(j.recommended_min_amount_in), payDecimals) : null; } catch { minIn = null; }
  const small = /less than|not enough|dust|recommended min|too small|minimum/i.test(msg);

  const halted = !small && /halt|paused/i.test(msg);
  return Object.assign(new Error(small ? "ERR_SMALL" : halted ? "ERR_BUSY" : "ERR_ROUTE"), { thorbuy: true as const, kind: (small ? "small" : halted ? "busy" : "route") as "small" | "route" | "busy", minIn });
}

export function readThorQuote(j: QuoteAnswer | null, chainId: number, coin: ThorCoin): Omit<ThorBuyQuote, "vault" | "router"> & { vault: string; minIn8: bigint } {
  if (!j || !j.expected_amount_out) throw unsafe("thor quote");
  let out8: bigint;
  try { out8 = BigInt(j.expected_amount_out); } catch { throw unsafe("thor quote"); }
  if (out8 <= 0n) throw unsafe("thor quote");
  if (String(j.router ?? "").toLowerCase() !== THOR_ROUTERS[chainId] || !/^0x[0-9a-fA-F]{40}$/.test(String(j.inbound_address ?? ""))) throw unsafe("thor quote router");
  if (isThorEvmCoin(coin) && String(j.fees?.asset ?? "").toUpperCase() !== THOR_COIN[coin].asset) throw unsafe("thor quote asset");
  let outFee: bigint | null = null;
  try { outFee = j.fees?.outbound ? from8(BigInt(j.fees.outbound), THOR_COIN[coin].dec) : null; } catch { outFee = null; }
  const bps = Number(j.fees?.total_bps);
  let minIn8 = 0n;
  try { minIn8 = j.recommended_min_amount_in ? BigInt(j.recommended_min_amount_in) : 0n; } catch { throw unsafe("thor quote"); }
  if (minIn8 < 0n) throw unsafe("thor quote");
  return { minIn8, out8, amountOut: from8(out8, THOR_COIN[coin].dec), outFee, feeBps: Number.isFinite(bps) && bps >= 0 ? bps : null, secs: Number(j.total_swap_seconds) || null, vault: String(j.inbound_address).toLowerCase() };
}

const getJson = async (fetcher: ThorFetcher, url: string): Promise<QuoteAnswer | null> => {
  const r = await fetcher(url);
  const j = (await r.json().catch(() => null)) as QuoteAnswer | null;
  if (!r.ok && !j) throw Object.assign(new Error("thornode"), { api: true });
  return j;
};
export const thorFetch: ThorFetcher = (url) => fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: AbortSignal.timeout(15_000) });

export async function thorBuyQuote(pay: ThorPay, payDecimals: number, coin: ThorCoin, amount: bigint, dest: string, fetcher: ThorFetcher = thorFetch): Promise<ThorBuyQuote> {
  if (!validThorDest(coin, dest)) throw unsafe("thor dest");
  const amt8 = to8(amount, payDecimals);
  if (amt8 <= 0n) throw thorError({ message: "amount too small" }, payDecimals);
  const p = new URLSearchParams({ from_asset: pay.pool, to_asset: isThorEvmCoin(coin) ? THOR_COIN[coin].short : THOR_COIN[coin].asset, amount: amt8.toString(), destination: dest, affiliate: THOR_AFFILIATE, affiliate_bps: String(feeBps()) });
  const got = await Promise.allSettled(THOR_NODES.map((n) => getJson(fetcher, `${n}/thorchain/quote/swap?${p}`)));
  const ok: ReturnType<typeof readThorQuote>[] = [];
  let refusal: QuoteAnswer | null = null;
  for (const g of got) {
    if (g.status !== "fulfilled") continue;
    try { ok.push(readThorQuote(g.value, pay.chainId, coin)); } catch (e) { const w = (e as { why?: string }).why; if (w === "thor quote router" || w === "thor quote asset") throw e; refusal ??= g.value; }
  }
  if (!ok.length) {
    if (refusal) throw thorError(refusal, payDecimals);
    throw Object.assign(new Error("ERR_NET"), { thorbuy: true, kind: "busy" as const, minIn: null });
  }
  if (ok.length === 2) {
    const [a, b] = ok;
    const hi = a.out8 > b.out8 ? a.out8 : b.out8, lo = a.out8 > b.out8 ? b.out8 : a.out8;
    if ((hi - lo) * 100n > hi * 3n) throw unsafe("thor nodes disagree");
  }
  const minIn8 = ok.reduce((m, x) => (x.minIn8 > m ? x.minIn8 : m), 0n);
  if (amt8 < minIn8) throw thorError({ message: "amount less than recommended min", recommended_min_amount_in: minIn8.toString() }, payDecimals);
  const { minIn8: _m, ...best } = ok.reduce((x, y) => (y.out8 < x.out8 ? y : x));
  void _m;
  return { ...best, router: THOR_ROUTERS[pay.chainId] };
}

export function thorBuyMemo(coin: ThorCoin, dest: string, limit8: bigint): string {
  if (!validThorDest(coin, dest) || limit8 <= 0n) throw unsafe("thor memo");
  return `=:${THOR_COIN[coin].short}:${dest}:${limit8}:${THOR_AFFILIATE}:${feeBps()}`;
}
const ABI = parseAbi(["function depositWithExpiry(address vault, address asset, uint256 amount, string memo, uint256 expiration)"]);

export function thorBuyTx(pay: ThorPay, coin: ThorCoin, amount: bigint, dest: string, q: Pick<ThorBuyQuote, "out8">, vault: string, nowSec: number): { to: Address; data: Hex; value: bigint; memo: string; limit8: bigint; expiry: number } {
  if (amount <= 0n || q.out8 <= 0n || !/^0x[0-9a-f]{40}$/.test(vault)) throw unsafe("thor tx");
  const limit8 = (q.out8 * (10000n - THOR_SLIPPAGE_BPS)) / 10000n;
  const memo = thorBuyMemo(coin, dest, limit8);
  const expiry = nowSec + THOR_EXPIRY_S;
  const router = THOR_ROUTERS[pay.chainId] as Address;
  const data = encodeFunctionData({ abi: ABI, functionName: "depositWithExpiry", args: [vault as Address, (pay.native ? "0x0000000000000000000000000000000000000000" : pay.token) as Address, amount, memo, BigInt(expiry)] });
  const tx = { to: router, data, value: pay.native ? amount : 0n, memo, limit8, expiry };
  checkThorBuyTx(tx, pay, coin, amount, dest, vault, limit8, nowSec);
  return tx;
}

export function checkThorBuyTx(tx: { to: string; data: Hex; value: bigint }, pay: ThorPay, coin: ThorCoin, amount: bigint, dest: string, vault: string, limit8: bigint, nowSec: number): void {
  const d = decodeThorSite(pay.chainId, tx.to, tx.value, tx.data, true);
  if (!d) throw unsafe("thor decode");
  const minOut = from8(limit8, THOR_COIN[coin].dec);
  if (d.vault.toLowerCase() !== vault || (pay.native ? d.tokenIn !== null : d.tokenIn?.toLowerCase() !== pay.token) || d.amountIn !== amount.toString()) throw unsafe("thor fields");
  if (d.coin !== coin || d.dest !== dest || !d.destOk || d.minOut !== minOut.toString() || d.affiliate !== THOR_AFFILIATE || d.affiliateBps !== feeBps() || d.memo !== thorBuyMemo(coin, dest, limit8)) throw unsafe("thor memo");
  if (d.expiry <= nowSec || d.expiry > nowSec + THOR_MAX_EXPIRY_S) throw unsafe("thor expiry");
}

export async function thorBuySend(n: Network, phrase: string, index: number, me: string, pay: ThorPay, payDecimals: number, coin: ThorCoin, amount: bigint, dest: string,
  shown: { out: bigint }, reviewed: GasFees | undefined, hooks: { approving?: () => void; sending?: () => void } = {}, fetcher: ThorFetcher = thorFetch, nowSec = () => Math.floor(Date.now() / 1000)): Promise<Hash> {
  if (pay.netId !== n.id || THOR_CHAIN_NAME[pay.chainId] == null || n.chain.id !== pay.chainId) throw unsafe("thor network");
  const q = await thorBuyQuote(pay, payDecimals, coin, amount, dest, fetcher);
  if (q.amountOut * 10000n < shown.out * 9950n) throw new Error("ERR_MOVED");
  const router = THOR_ROUTERS[pay.chainId];
  await thorInbound(pay.chainId, coin, fetcher);
  const c = publicClient(n);
  if (!pay.native) {
    const bal = (await c.readContract({ address: pay.token as Address, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [me as Address] })) as bigint;
    if (bal < amount) throw new Error("ERR_FUNDS");
    const allowance = await evmAllowance(n, phrase, index, pay.token, router);
    if (allowance < amount) { hooks.approving?.(); await evmApprove(n, phrase, index, pay.token, amount, allowance, router, reviewed); }
  }
  hooks.sending?.();

  const { vault, router: r2 } = await thorInbound(pay.chainId, coin, fetcher);
  if (r2 !== router) throw unsafe("thor vault");
  const tx = thorBuyTx(pay, coin, amount, dest, q, vault, nowSec());
  const gas = ((await c.estimateGas({ account: me as Address, to: tx.to, data: tx.data, value: tx.value })) * 12n) / 10n;
  const fees = await sendFees(n, reviewed, true);
  if (pay.native) {
    const bal = await c.getBalance({ address: me as Address });
    if (bal < amount + gas * perGas(fees)) throw new Error("ERR_FUNDS");
  }
  return wallet(n, phrase, index).sendTransaction({ to: tx.to, data: tx.data, value: tx.value, gas, ...feeFields(fees) } as never);
}

export type ThorState = "pending" | "done" | "refunded";
type StatusAnswer = { tx?: { memo?: string }; stages?: Record<string, { completed?: boolean; remaining_delay_seconds?: number }>; out_txs?: { id?: string; memo?: string; to_address?: string }[] };

export function readThorStatus(j: StatusAnswer | null): { state: ThorState; step: 2 | 3 | 4 } {
  if (!j || typeof j !== "object") return { state: "pending", step: 2 };
  const s = j.stages ?? {}, out = (j.out_txs ?? [])[0];
  if (s.outbound_signed?.completed || (out && s.swap_finalised?.completed && !s.outbound_delay?.remaining_delay_seconds)) {
    return { state: out && /^REFUND/i.test(String(out.memo ?? "")) ? "refunded" : "done", step: 4 };
  }
  return { state: "pending", step: s.swap_finalised?.completed ? 3 : 2 };
}

export async function thorBuyStatus(hash: string, fetcher: ThorFetcher = thorFetch): Promise<{ state: ThorState; step: 2 | 3 | 4 } | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  for (const n of THOR_NODES) {
    try { const r = await fetcher(`${n}/thorchain/tx/status/${hash.slice(2).toUpperCase()}`); if (r.ok) return readThorStatus((await r.json()) as StatusAnswer); } catch {  }
  }
  return null;
}
export const thorTrack = (hash: string) => `https://track.ninerealms.com/${hash.replace(/^0x/, "")}`;
