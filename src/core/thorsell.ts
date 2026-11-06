import { THOR_AFFILIATES, THOR_FEE_BPS, THOR_NODES, type ThorFetcher } from "../dapp/thordecode";
import { FEE_BPS_INVITE, feeBps } from "./swap";
import { isBtcAddress } from "./btcbase";
import type { ThorState } from "./thorbuy";
import { DOGE, isUtxoAddress, LTC } from "./utxobase";
import { isTronAddress, TRON, TRON_USDT } from "./tronbase";

export type ThorSellCoin = "BTC" | "LTC" | "DOGE" | "TRX";

export const THOR_SELL_FROM: Readonly<Record<ThorSellCoin, { asset: string; chain: string; netId: string }>> = {
  BTC: { asset: "BTC.BTC", chain: "BTC", netId: "bitcoin" },
  LTC: { asset: "LTC.LTC", chain: "LTC", netId: "litecoin" },
  DOGE: { asset: "DOGE.DOGE", chain: "DOGE", netId: "dogecoin" },
  TRX: { asset: "TRON.TRX", chain: "TRON", netId: TRON.id },
};

export const thorIn8 = (coin: ThorSellCoin, v: bigint) => (coin === "TRX" ? v * 100n : v);

export const thorFrom8In = (coin: ThorSellCoin, v8: bigint) => (coin === "TRX" ? (v8 + 99n) / 100n : v8);
export const thorSellCoinOf = (netId: string): ThorSellCoin | null =>
  (Object.keys(THOR_SELL_FROM) as ThorSellCoin[]).find((c) => THOR_SELL_FROM[c].netId === netId) ?? null;

export interface ThorSellTarget { netId: string; token: string; short: string; full: string; chain: string; dec: number }
const T = (netId: string, token: string, short: string, dec: number): ThorSellTarget =>
  ({ netId, token, short, full: `${short}-${token.toUpperCase()}`, chain: short.slice(0, short.indexOf(".")), dec });

export const THOR_SELL_TO: readonly ThorSellTarget[] = [
  T("ethereum", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "ETH.USDC", 6),
  T("ethereum", "0xdac17f958d2ee523a2206206994597c13d831ec7", "ETH.USDT", 6),
  T("bsc", "0x55d398326f99059ff775485246999027b3197955", "BSC.USDT", 18),
  T("bsc", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", "BSC.USDC", 18),
  T("base", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "BASE.USDC", 6),
  T("avalanche", "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", "AVAX.USDC", 6),
  T("avalanche", "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7", "AVAX.USDT", 6),

  T("tron", TRON_USDT, "TRON.USDT", 6),
];

export const thorSellTarget = (netId: string, token: string): ThorSellTarget | null =>
  THOR_SELL_TO.find((t) => t.netId === netId && (netId === TRON.id ? t.token === String(token) : t.token === String(token).toLowerCase())) ?? null;

export const thorSellDestOk = (to: ThorSellTarget, dest: unknown): dest is string =>
  to.netId === TRON.id ? typeof dest === "string" && dest.startsWith("T") && isTronAddress(dest) : evmAddr(dest);

export const thorFetch: ThorFetcher = (url) => fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: AbortSignal.timeout(15_000) });
const unsafe = (why: string) => Object.assign(new Error("ERR_UNSAFE"), { why });
function evmAddr(a: unknown): a is string { return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a); }
const from8 = (v: bigint, dec: number) => (dec >= 8 ? v * 10n ** BigInt(dec - 8) : v / 10n ** BigInt(8 - dec));

export function thorVaultOk(coin: ThorSellCoin, a: unknown): a is string {
  if (typeof a !== "string" || a !== a.trim()) return false;
  if (coin === "TRX") return isTronAddress(a) && a.startsWith("T");
  return coin === "BTC" ? isBtcAddress(a) && (!/^bc1/i.test(a) || a === a.toLowerCase()) : isUtxoAddress(coin === "LTC" ? LTC : DOGE, a);
}

export interface ThorSellQuote {
   out8: bigint; amountOut: bigint;
   outFee: bigint | null;
  feeBps: number | null; secs: number | null;
   minIn: bigint;
   gasRate: number | null;
   vault: string;
}
type Answer = { expected_amount_out?: string; fees?: { asset?: string; outbound?: string; total_bps?: number }; inbound_address?: string; recommended_min_amount_in?: string;
  dust_threshold?: string; total_swap_seconds?: number; recommended_gas_rate?: string; error?: string; message?: string };

export function thorSellError(j: Answer | null, coin: ThorSellCoin = "BTC"): Error & { sell: true; thorsell: true; kind: "small" | "route"; minSats: bigint | null } {
  const msg = String(j?.message ?? j?.error ?? "");
  let minSats: bigint | null = null;
  try { minSats = j?.recommended_min_amount_in ? thorFrom8In(coin, BigInt(j.recommended_min_amount_in)) : null; } catch { minSats = null; }
  const small = /less than|not enough|dust|recommended min|too small|minimum/i.test(msg);
  return Object.assign(new Error(small ? "ERR_SMALL" : "ERR_ROUTE"), { sell: true as const, thorsell: true as const, kind: (small ? "small" : "route") as "small" | "route", minSats });
}

export function readThorSellQuote(j: Answer | null, coin: ThorSellCoin, to: ThorSellTarget): ThorSellQuote {
  if (!j || !j.expected_amount_out || !/^\d{1,30}$/.test(j.expected_amount_out)) throw unsafe("thor sell quote");
  const out8 = BigInt(j.expected_amount_out);
  if (out8 <= 0n) throw unsafe("thor sell quote");
  if (String(j.fees?.asset ?? "").toUpperCase() !== to.full.toUpperCase()) throw unsafe("thor sell asset");
  if (!thorVaultOk(coin, j.inbound_address)) throw unsafe("thor sell vault");
  let outFee: bigint | null = null;
  try { outFee = j.fees?.outbound && /^\d{1,30}$/.test(j.fees.outbound) ? from8(BigInt(j.fees.outbound), to.dec) : null; } catch { outFee = null; }
  const num = (s: unknown) => (typeof s === "string" && /^\d{1,30}$/.test(s) ? BigInt(s) : 0n);
  const dust = num(j.dust_threshold), rec = num(j.recommended_min_amount_in);
  const bps = Number(j.fees?.total_bps);
  const gas = Number(j.recommended_gas_rate);
  return { out8, amountOut: from8(out8, to.dec), outFee, feeBps: Number.isFinite(bps) && bps >= 0 ? bps : null, secs: Number(j.total_swap_seconds) || null, minIn: rec > dust ? rec : dust + 1n,
    gasRate: Number.isSafeInteger(gas) && gas > 0 ? gas : null, vault: j.inbound_address as string };
}

const getJson = async (fetcher: ThorFetcher, url: string): Promise<Answer | null> => {
  const r = await fetcher(url);
  const j = (await r.json().catch(() => null)) as Answer | null;
  if (!r.ok && !j) throw Object.assign(new Error("thornode"), { api: true });
  return j;
};

export async function thorSellQuote(coin: ThorSellCoin, sats: bigint, to: ThorSellTarget, dest: string, fetcher: ThorFetcher = thorFetch, both = false): Promise<ThorSellQuote> {
  if (!THOR_SELL_TO.includes(to) || !thorSellDestOk(to, dest) || sats <= 0n) throw unsafe("thor sell request");

  const p = new URLSearchParams({ from_asset: THOR_SELL_FROM[coin].asset, to_asset: to.short, amount: thorIn8(coin, sats).toString(), destination: dest, affiliate: THOR_AFFILIATES[0], affiliate_bps: String(feeBps()) });
  const got = await Promise.allSettled(THOR_NODES.map((n) => getJson(fetcher, `${n}/thorchain/quote/swap?${p}`)));
  const ok: ThorSellQuote[] = [];
  let refusal: Answer | null = null;
  for (const g of got) {
    if (g.status !== "fulfilled") continue;
    try { ok.push(readThorSellQuote(g.value, coin, to)); } catch (e) { if ((e as { why?: string }).why === "thor sell asset") throw e; refusal ??= g.value; }
  }
  if (!ok.length) {
    if (refusal && (refusal.error || refusal.message)) throw thorSellError(refusal, coin);
    throw Object.assign(new Error("ERR_NET"), { sell: true, thorsell: true, kind: "busy" as const, minSats: null });
  }

  if (both && ok.length < 2) throw Object.assign(new Error("ERR_NET"), { sell: true, thorsell: true, kind: "busy" as const, minSats: null });
  if (ok.length === 2) {
    const [a, b] = ok;
    const hi = a.out8 > b.out8 ? a.out8 : b.out8, lo = a.out8 > b.out8 ? b.out8 : a.out8;
    if ((hi - lo) * 100n > hi * 3n) throw unsafe("thor nodes disagree");
  }

  const minIn = thorFrom8In(coin, ok.reduce((m, x) => (x.minIn > m ? x.minIn : m), 0n));
  if (sats < minIn) throw Object.assign(thorSellError({ message: "amount less than recommended min" }), { minSats: minIn });
  const gasRate = ok.reduce<number | null>((m, x) => (x.gasRate != null && (m == null || x.gasRate > m) ? x.gasRate : m), null);
  return { ...ok.reduce((x, y) => (y.out8 < x.out8 ? y : x)), minIn, gasRate };
}

export const thorSellSlippageBps = (coin: ThorSellCoin) => (coin === "BTC" ? 200n : 100n);
export const thorSellLimit = (out8: bigint, coin: ThorSellCoin) => (out8 * (10000n - thorSellSlippageBps(coin))) / 10000n;

export const thorSellTo8 = (v: bigint, dec: number) => (dec >= 8 ? (v + 10n ** BigInt(dec - 8) - 1n) / 10n ** BigInt(dec - 8) : v * 10n ** BigInt(8 - dec));

export const thorSellFeeRate = (coin: ThorSellCoin, normal: number, gasRate: number | null, clamp: (r: number) => number) =>
  clamp(coin !== "DOGE" && gasRate != null && gasRate > normal ? gasRate : normal);

export function thorSellMemo(to: ThorSellTarget, dest: string, limit8: bigint): string {
  if (!THOR_SELL_TO.includes(to) || !thorSellDestOk(to, dest) || limit8 <= 0n) throw unsafe("thor sell memo");
  const m = `=:${to.short}:${dest}:${limit8}:${THOR_AFFILIATES[0]}:${feeBps()}`;
  if (new TextEncoder().encode(m).length > 80) throw unsafe("thor sell memo length");
  return m;
}

export function readThorSellMemo(m: string): { to: ThorSellTarget; dest: string; limit8: bigint } | null {
  const x = /^=:([A-Z]{2,5}\.[A-Z]{3,5}):(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}):(\d{1,20}):([a-z0-9]{1,30}):(\d{1,4})$/.exec(m);

  if (!x || x[4] !== THOR_AFFILIATES[0] || (Number(x[5]) !== THOR_FEE_BPS && Number(x[5]) !== FEE_BPS_INVITE)) return null;
  const to = THOR_SELL_TO.find((t) => t.short === x[1]);
  return to && thorSellDestOk(to, x[2]) ? { to, dest: x[2], limit8: BigInt(x[3]) } : null;
}

interface Inbound { chain?: string; address?: string; halted?: boolean; chain_trading_paused?: boolean; global_trading_paused?: boolean; dust_threshold?: string }
export class ThorSellCheck extends Error { constructor(public why: "nodes" | "disagree" | "vault" | "paused") { super(`THORChain sale check: ${why}`); } }

export async function thorSellVault(coin: ThorSellCoin, to: ThorSellTarget, sats: bigint, fetcher: ThorFetcher = thorFetch): Promise<string> {
  const lists = await Promise.all(THOR_NODES.map(async (n) => {
    try { const r = await fetcher(`${n}/thorchain/inbound_addresses`); const j = r.ok ? await r.json() : null; return Array.isArray(j) ? (j as Inbound[]) : null; } catch { return null; }
  }));
  if (!lists[0] || !lists[1]) throw new ThorSellCheck("nodes");
  const from = THOR_SELL_FROM[coin].chain;
  const pick = (l: Inbound[], c: string) => l.find((x) => x && x.chain === c);
  const a = pick(lists[0], from), b = pick(lists[1], from), da = pick(lists[0], to.chain), db = pick(lists[1], to.chain);
  if (!a || !b || !da || !db) throw new ThorSellCheck("nodes");
  if (a.address !== b.address) throw new ThorSellCheck("disagree");
  if (!thorVaultOk(coin, a.address)) throw new ThorSellCheck("vault");
  for (const x of [a, b, da, db]) if (x.halted || x.chain_trading_paused || x.global_trading_paused) throw new ThorSellCheck("paused");

  const dust = [a, b].reduce((m, x) => { const d = /^\d{1,30}$/.test(String(x.dust_threshold ?? "")) ? BigInt(x.dust_threshold!) : 0n; return d > m ? d : m; }, 0n);
  if (thorIn8(coin, sats) <= dust) throw Object.assign(thorSellError({ message: "amount less than dust threshold" }), { minSats: thorFrom8In(coin, dust + 1n) });
  return a.address!;
}

type StatusAnswer = { stages?: Record<string, { completed?: boolean }>; out_txs?: { memo?: string }[] };

export function readThorSellStatus(j: StatusAnswer | null): { state: ThorState; step: 1 | 2 | 3 | 4 } {
  const s = j?.stages ?? {}, out = (j?.out_txs ?? [])[0];
  if (s.outbound_signed?.completed || (out && s.swap_finalised?.completed)) return { state: out && /^REFUND/i.test(String(out.memo ?? "")) ? "refunded" : "done", step: 4 };
  if (s.swap_finalised?.completed) return { state: "pending", step: 3 };
  return { state: "pending", step: s.inbound_observed?.completed ? 2 : 1 };
}

export const thorSellUnseenMs = (coin: ThorSellCoin) => (coin === "BTC" ? 6 : 2) * 3_600_000;

export async function thorSellStatus(txid: string, fetcher: ThorFetcher = thorFetch): Promise<{ state: ThorState; step: 1 | 2 | 3 | 4 } | null> {
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) return null;
  for (const n of THOR_NODES) {
    try { const r = await fetcher(`${n}/thorchain/tx/status/${txid.toUpperCase()}`); if (r.ok) return readThorSellStatus((await r.json()) as StatusAnswer); } catch {  }
  }
  return null;
}
