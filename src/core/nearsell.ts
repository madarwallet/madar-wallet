import { feeBps as madarFeeBps } from "./swap";
import { isBtcAddress } from "./btcbase";
import { decodeUtxoAddress, DOGE, isLegacyLtcP2sh, LTC } from "./utxobase";
import { decodeClassic } from "./xrpbase";
import { parseAdaAddress } from "./adabase";
import { TRON, TRX_TOKEN, tronUserAddrOk } from "./tronbase";
import { isNearImplicit, NEAR } from "./nearbase";

export const ONECLICK = "https://1click.chaindefuser.com";

export const SELL_TRON_USDT = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";

export const SELL_TO: Readonly<Record<string, string>> = {
  "arbitrum:USDC": "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
  "arbitrum:USDT": "nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near",
  "base:USDC": "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  "ethereum:USDC": "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
  "ethereum:USDT": "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near",

  "tron:USDT": SELL_TRON_USDT,
};

export const sellRecipientOk = (asset: string, a: unknown): boolean => {
  const to = coinOfAsset(asset);
  if (to) return coinRecipientOk(to, a);
  return asset === SELL_TRON_USDT ? tronUserAddrOk(a) : typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
};
export const sellAsset = (netId: string, symbol: string) => SELL_TO[`${netId}:${symbol}`] ?? null;

export const SELL_NETS: readonly string[] = [...new Set(Object.keys(SELL_TO).map((k) => k.slice(0, k.indexOf(":"))))];

export const NEAR_FEE_ACCOUNT = "831b0fd35c3d7a1832032ea139f70c5fcffa2c5e8e2027294c4a52da76009bc9";
export const NEAR_FEE_BPS = 50;
const unsafe = (why: string) => Object.assign(new Error("ERR_UNSAFE"), { why });

export type SellCoin = "BTC" | "DOGE" | "LTC" | "XRP" | "ADA" | "TRX" | "NEAR";

export const SELL_FROM: Readonly<Record<SellCoin, { asset: string; decimals: number; netId: string }>> = {
  BTC: { asset: "nep141:btc.omft.near", decimals: 8, netId: "bitcoin" },
  DOGE: { asset: "nep141:doge.omft.near", decimals: 8, netId: "dogecoin" },
  LTC: { asset: "nep141:ltc.omft.near", decimals: 8, netId: "litecoin" },
  XRP: { asset: "nep141:xrp.omft.near", decimals: 6, netId: "xrp" },
  ADA: { asset: "nep141:cardano.omft.near", decimals: 6, netId: "cardano" },

  TRX: { asset: "nep141:tron.omft.near", decimals: 6, netId: TRON.id },

  NEAR: { asset: "nep141:wrap.near", decimals: 24, netId: NEAR.id },
};

export const SELL_COINS: readonly SellCoin[] = Object.keys(SELL_FROM) as SellCoin[];
const isSellCoin = (c: unknown): c is SellCoin => typeof c === "string" && Object.prototype.hasOwnProperty.call(SELL_FROM, c);

export const sellCoinOf = (netId: string, token?: string): SellCoin | null =>
  netId === TRON.id ? (token === TRX_TOKEN ? "TRX" : null) : SELL_COINS.find((c) => SELL_FROM[c].netId === netId) ?? null;

export const sellCoinByChain = (chainId: unknown, netId: unknown): SellCoin | null =>
  isSellCoin(chainId) && SELL_FROM[chainId].netId === netId ? chainId : null;
const coinOfAsset = (asset: unknown): SellCoin | null => SELL_COINS.find((c) => SELL_FROM[c].asset === asset) ?? null;

export const SELL_COIN_NETS: readonly string[] = SELL_COINS.map((c) => SELL_FROM[c].netId);

export function coinSwapTo(pay: { netId: string; token?: string }, get: { netId: string; token?: string }): SellCoin | null {
  const p = sellCoinOf(pay.netId, pay.token), g = sellCoinOf(get.netId, get.token);
  return p && g && p !== g ? g : null;
}

export function coinRecipientOk(coin: SellCoin, a: unknown): boolean {
  if (typeof a !== "string" || !a || a !== a.trim() || !isSellCoin(coin)) return false;
  if (coin === "BTC" && /^bc1/i.test(a) && a !== a.toLowerCase()) return false;
  return sellAddrOk(coin, a);
}

const zero = (b: Uint8Array) => b.every((x) => x === 0);

export function sellAddrOk(coin: SellCoin, a: unknown): boolean {
  if (typeof a !== "string") return false;
  if (coin === "BTC") return isBtcAddress(a);
  if (!a || a !== a.trim()) return false;
  if (coin === "XRP") {
    let id: Uint8Array;
    try { id = decodeClassic(a); } catch { return false; }
    return !zero(id) && !(zero(id.slice(0, 19)) && id[19] === 1);
  }
  if (coin === "ADA") {
    const x = parseAdaAddress(a);
    return !!x && !x.script && !zero(x.payment);
  }

  if (coin === "TRX") return tronUserAddrOk(a);

  if (coin === "NEAR") return isNearImplicit(a) && !/^0{64}$/.test(a);
  if (coin !== "DOGE" && coin !== "LTC") return false;
  const c = coin === "DOGE" ? DOGE : LTC;
  let d: ReturnType<typeof decodeUtxoAddress>;
  try { d = decodeUtxoAddress(c, a); } catch { return false; }
  if (zero(d.type === "tr" ? d.pubkey : d.hash)) return false;
  return !isLegacyLtcP2sh(c, a) && (!/^ltc1/i.test(a) || a === a.toLowerCase());
}

export interface SellReq { sats: bigint; asset: string; recipient: string; refundTo: string; dry: boolean; coin?: SellCoin }

export interface SellQuote { amountOut: bigint; minOut: bigint; deposit: string | null; secs: number | null; outFee?: bigint | null }

export function sellBody(r: SellReq, nowMs = Date.now()) {
  const coin = r.coin ?? "BTC", to = coinOfAsset(r.asset);
  const listed = to ? isSellCoin(coin) && to !== coin : Object.values(SELL_TO).includes(r.asset);
  if (!isSellCoin(coin) || r.sats <= 0n || !listed || !sellRecipientOk(r.asset, r.recipient) || !sellAddrOk(coin, r.refundTo)) throw unsafe("sell request");
  return {
    dry: r.dry, swapType: "FLEX_INPUT", slippageTolerance: 100, originAsset: SELL_FROM[coin].asset, depositType: "ORIGIN_CHAIN", destinationAsset: r.asset,
    amount: r.sats.toString(), refundTo: r.refundTo, refundType: "ORIGIN_CHAIN", recipient: r.recipient, recipientType: "DESTINATION_CHAIN",
    deadline: new Date(nowMs + 3 * 3600_000).toISOString(),
    ...(NEAR_FEE_ACCOUNT ? { appFees: [{ recipient: NEAR_FEE_ACCOUNT, fee: madarFeeBps() }] } : {}),
  };
}

export function sellApiError(j: any): Error & { sell: true; kind: "small" | "big" | "route"; minSats: bigint | null; minUsd: number | null } {
  const msg = String(j?.message ?? ""), min = /try at least (\d{1,40})/i.exec(msg), usd = /minimum swap amount is \$\s?([\d,]{1,9}(?:\.\d{1,2})?)/i.exec(msg);
  const kind = /minimum|too (low|small)|at least/i.test(msg) ? "small" : /max(imum)? amount|too (high|large|big)|liquidity|exceeds/i.test(msg) ? "big" : "route";
  return Object.assign(new Error(kind === "small" ? "ERR_SMALL" : kind === "big" ? "ERR_BIG" : "ERR_ROUTE"),
    { sell: true as const, kind: kind as "small" | "big" | "route", minSats: min ? BigInt(min[1]) : null, minUsd: usd ? Number(usd[1].replace(/,/g, "")) : null });
}

const DEPOSIT_MIN_MS = 15 * 60_000;
export function checkSellAnswer(j: any, body: ReturnType<typeof sellBody>, nowMs = Date.now()): SellQuote {
  const q = j?.quote, r = j?.quoteRequest;
  if (!q || !r) throw sellApiError(j);
  const coin = coinOfAsset(body.originAsset);
  if (!coin) throw unsafe("answer coin");
  if (r.recipient !== body.recipient || r.refundTo !== body.refundTo || r.destinationAsset !== body.destinationAsset) throw unsafe("answer addresses");

  const toCoin = coinOfAsset(body.destinationAsset);
  if (toCoin && (toCoin === coin || !coinRecipientOk(toCoin, r.recipient))) throw unsafe("answer addresses");

  const originOk = coin === "BTC" ? /btc/i.test(String(r.originAsset)) : r.originAsset === body.originAsset;
  if (r.recipientType !== "DESTINATION_CHAIN" || r.refundType !== "ORIGIN_CHAIN" || r.depositType !== "ORIGIN_CHAIN" || !originOk) throw unsafe("answer types");
  if (String(r.amount) !== body.amount || String(q.amountIn) !== body.amount) throw unsafe("answer amount");
  if (body.appFees && !(r.appFees ?? []).some((f: { recipient: string }) => f.recipient === NEAR_FEE_ACCOUNT)) throw unsafe("answer fee");
  const amountOut = BigInt(q.amountOut ?? 0), minOut = BigInt(q.minAmountOut ?? 0);
  if (amountOut <= 0n || minOut <= 0n || minOut > amountOut) throw unsafe("answer out");

  if (coin !== "BTC" || body.destinationAsset === SELL_TRON_USDT || toCoin) checkCoinAnswer(q, r, body, amountOut, minOut, nowMs);

  if (!body.dry && !(sellAddrOk(coin, q.depositAddress) && q.depositAddress !== body.refundTo)) throw unsafe("deposit address");
  let outFee: bigint | null = null;
  try { outFee = q.withdrawFee != null ? BigInt(q.withdrawFee) : null; } catch { outFee = null; }
  return { amountOut, minOut, deposit: body.dry ? null : q.depositAddress, secs: Number(q.timeEstimate) || null, outFee: outFee != null && outFee >= 0n && outFee < amountOut ? outFee : null };
}

function checkCoinAnswer(q: any, r: any, body: ReturnType<typeof sellBody>, amountOut: bigint, minOut: bigint, nowMs: number): void {
  if (r.dry !== body.dry || r.swapType !== body.swapType || Number(r.slippageTolerance) !== body.slippageTolerance) throw unsafe("answer types");
  const fees: unknown = r.appFees ?? [];
  if (!Array.isArray(fees)) throw unsafe("answer fee");
  let feeBps = 0;
  for (const f of fees as { fee?: unknown }[]) {
    const n = Number(f?.fee);
    if (!Number.isInteger(n) || n < 0) throw unsafe("answer fee");
    feeBps += n;
  }
  if (feeBps > madarFeeBps()) throw unsafe("answer fee");
  if (body.appFees && !(fees as { recipient?: unknown; fee?: unknown }[]).some((f) => f?.recipient === NEAR_FEE_ACCOUNT && Number(f.fee) > 0)) throw unsafe("answer fee");
  if ((minOut + 1n) * 10000n < amountOut * BigInt(10000 - body.slippageTolerance)) throw unsafe("answer min");
  if (body.dry) return;
  if (q.depositMemo != null && q.depositMemo !== "") throw unsafe("deposit memo");
  if (!(Date.parse(String(q.deadline ?? r.deadline ?? "")) > nowMs + DEPOSIT_MIN_MS)) throw unsafe("deposit deadline");
}
export async function sellQuote(r: SellReq, fetcher: typeof fetch = fetch): Promise<SellQuote> {
  const body = sellBody(r);
  const res = await fetcher(`${ONECLICK}/v0/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw Object.assign(new Error("ERR_BUSY"), { sell: true });
  const q = checkSellAnswer(await res.json().catch(() => null), body);
  if (!r.dry) await checkSellDeposit(q.deposit!, body, q.minOut, fetcher);
  return q;
}

export async function checkSellDeposit(deposit: string, body: ReturnType<typeof sellBody>, minOut: bigint, fetcher: typeof fetch = fetch): Promise<true> {
  let res: Response, j: any;
  try { res = await fetcher(`${ONECLICK}/v0/status?depositAddress=${encodeURIComponent(deposit)}`, { referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) }); } catch { throw unsafe("deposit status"); }

  const busy = () => Object.assign(new Error("ERR_BUSY"), { sell: true });
  if (res.status === 429 || res.status === 404 || res.status >= 500) throw busy();
  try { j = await res.json(); } catch { throw unsafe("deposit status"); }
  const rq = j?.quoteResponse?.quoteRequest, qt = j?.quoteResponse?.quote;
  if (!rq || !qt) throw busy();
  if (j.status !== "PENDING_DEPOSIT") throw unsafe("deposit status");
  if (qt.depositMemo != null && qt.depositMemo !== "") throw unsafe("deposit memo");

  const originOk = body.originAsset === SELL_FROM.BTC.asset ? /btc/i.test(String(rq.originAsset)) : rq.originAsset === body.originAsset;
  if (rq.dry !== false || !originOk || rq.recipient !== body.recipient || rq.refundTo !== body.refundTo || rq.destinationAsset !== body.destinationAsset) throw unsafe("deposit record");
  if (rq.recipientType !== "DESTINATION_CHAIN" || rq.refundType !== "ORIGIN_CHAIN" || rq.depositType !== "ORIGIN_CHAIN" || rq.swapType !== body.swapType || qt.depositAddress !== deposit) throw unsafe("deposit record");
  if (String(rq.amount) !== body.amount || String(qt.amountIn) !== body.amount) throw unsafe("deposit amount");
  let min: bigint;
  try { min = BigInt(qt.minAmountOut); } catch { throw unsafe("deposit min out"); }
  if (min < minOut) throw unsafe("deposit min out");
  return true;
}

export const sellFeeTooHigh = (amount: bigint, fee: bigint) => fee * 10n > amount;

export const SELL_FEE_SLACK_VB = 20n;

export function checkSellPayment(p: { to: string; amount: bigint; fee: bigint; feeRate: number }, deposit: string, sats: bigint, reviewed: { fee: bigint; feeRate: number }): void {
  if (p.to !== deposit || p.amount !== sats || p.feeRate !== reviewed.feeRate) throw new Error("ERR_UNSAFE");
  if (p.fee > reviewed.fee + SELL_FEE_SLACK_VB * BigInt(reviewed.feeRate)) throw new Error("ERR_MOVED");
  if (sellFeeTooHigh(p.amount, p.fee)) throw Object.assign(new Error("ERR_FEE_SHARE"), { fee: p.fee });
}

export type SellState = "wait" | "seen" | "incomplete" | "swapping" | "done" | "refunded" | "failed" | "unknown";
const STATES: Record<string, SellState> = { PENDING_DEPOSIT: "wait", KNOWN_DEPOSIT_TX: "seen", INCOMPLETE_DEPOSIT: "incomplete", PROCESSING: "swapping", SUCCESS: "done", REFUNDED: "refunded", FAILED: "failed" };

export async function sellStatus(deposit: string, fetcher: typeof fetch = fetch, coin: SellCoin = "BTC"): Promise<{ state: SellState }> {
  if (!isSellCoin(coin) || !sellAddrOk(coin, deposit)) throw unsafe("deposit");
  return depositState(deposit, fetcher);
}

export async function depositState(deposit: string, fetcher: typeof fetch = fetch): Promise<{ state: SellState }> {
  const r = await fetcher(`${ONECLICK}/v0/status?depositAddress=${encodeURIComponent(deposit)}`, { referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (r.status === 429 || r.status >= 500) throw Object.assign(new Error("busy"), { busy: true });
  const j = (await r.json().catch(() => ({}))) as { status?: unknown };
  return { state: (r.ok && STATES[String(j?.status ?? "")]) || "unknown" };
}

export function sellStage(s: SellState): { step: 1 | 2 | 3 | 4; end: "" | "ok" | "refunded" | "failed"; incomplete: boolean } {
  switch (s) {
    case "done": return { step: 4, end: "ok", incomplete: false };
    case "refunded": return { step: 4, end: "refunded", incomplete: false };
    case "failed": return { step: 3, end: "failed", incomplete: false };
    case "swapping": return { step: 3, end: "", incomplete: false };
    case "incomplete": return { step: 2, end: "", incomplete: true };
    default: return { step: 2, end: "", incomplete: false };
  }
}
