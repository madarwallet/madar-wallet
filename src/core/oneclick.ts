import { feeBps as madarFeeBps } from "./swap";
import { decodeFunctionData, encodeFunctionData, erc20Abi, isAddress, type Address, type Hash, type Hex } from "viem";
import { isBtcAddress } from "./btcbase";
import type { Network } from "./chains";
import { feeFields, perGas, publicClient, type GasFees } from "./chainops";
import { LIFI_DIAMOND, MADAR_FEE_WALLET } from "./lifi";
import { depositState, NEAR_FEE_ACCOUNT, ONECLICK, type SellState } from "./nearsell";
import { formatUnitsStr, isSolAddress, quoteSolSend, sendSol, SOL } from "./sol";
import { EVM_NATIVE, sendFees, SLIPPAGE_BPS, SOL_MINT as SOL_NATIVE_MINT, wallet } from "./swap";
import { isTronAddress, quoteTronSend, sendTron, TRON, TRON_USDT, tronUserAddrOk } from "./tron";
import { decodeUtxoAddress, DOGE, LTC } from "./utxobase";
import { isXrpClassic } from "./xrpbase";
import { parseAdaAddress } from "./adabase";
import { isNearAddress } from "./nearbase";

export type OneDest = "BTC" | "DOGE" | "LTC" | "XRP" | "ADA" | "TRX" | "NEAR";

export const ONE_DEST: Readonly<Record<OneDest, string>> = {
  BTC: "nep141:btc.omft.near", DOGE: "nep141:doge.omft.near", LTC: "nep141:ltc.omft.near", XRP: "nep141:xrp.omft.near",
  ADA: "nep141:cardano.omft.near",
  TRX: "nep141:tron.omft.near",

  NEAR: "nep141:wrap.near",
};
export const DEST_DECIMALS: Readonly<Record<OneDest, number>> = { BTC: 8, DOGE: 8, LTC: 8, XRP: 6, ADA: 6, TRX: 6, NEAR: 24 };

export function destOk(d: OneDest, a: unknown): boolean {
  if (typeof a !== "string" || a !== a.trim() || !a) return false;
  if (d === "BTC") return isBtcAddress(a) && (!/^bc1/i.test(a) || a === a.toLowerCase());
  if (d === "XRP") return isXrpClassic(a);
  if (d === "ADA") return !!parseAdaAddress(a);
  if (d === "TRX") return tronUserAddrOk(a);

  if (d === "NEAR") return isNearAddress(a) && !/^0{64}$/.test(a);
  try {
    decodeUtxoAddress(d === "DOGE" ? DOGE : LTC, a);
    return !/^ltc1/i.test(a) || a === a.toLowerCase();
  } catch { return false; }
}

export type PayKind = "evm" | "sol" | "tron";

export interface OnePay { netId: string; token: string; asset: string; kind: PayKind; decimals: number }
const evmPay = (netId: string, token: string, asset: string, decimals = 6): OnePay => ({ netId, token, asset, kind: "evm", decimals });
export const ONE_PAY: readonly OnePay[] = [
  evmPay("ethereum", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near"),
  evmPay("ethereum", "0xdac17f958d2ee523a2206206994597c13d831ec7", "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near"),
  evmPay("ethereum", EVM_NATIVE.toLowerCase(), "nep141:eth.omft.near", 18),
  evmPay("arbitrum", "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near"),
  evmPay("arbitrum", "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", "nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near"),
  evmPay("arbitrum", EVM_NATIVE.toLowerCase(), "nep141:arb.omft.near", 18),
  evmPay("base", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"),
  evmPay("base", EVM_NATIVE.toLowerCase(), "nep141:base.omft.near", 18),
  evmPay("polygon", "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", "nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L"),
  evmPay("polygon", "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", "nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr"),
  evmPay("bsc", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", "nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r", 18),
  evmPay("bsc", "0x55d398326f99059ff775485246999027b3197955", "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g", 18),
  { netId: "solana", token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", kind: "sol", decimals: 6 },
  { netId: "solana", token: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", asset: "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near", kind: "sol", decimals: 6 },
  { netId: "tron", token: TRON_USDT, asset: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", kind: "tron", decimals: 6 },

  evmPay("optimism", EVM_NATIVE.toLowerCase(), "nep245:v2_1.omni.hot.tg:10_11111111111111111111", 18),
  evmPay("optimism", "0x0b2c639c533813f4aa9d7837caf62653d097ff85", "nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ"),
  evmPay("optimism", "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", "nep245:v2_1.omni.hot.tg:10_359RPSJVdTxwTJT9TyGssr2rFoWo"),
  evmPay("avalanche", EVM_NATIVE.toLowerCase(), "nep245:v2_1.omni.hot.tg:43114_11111111111111111111", 18),
  evmPay("avalanche", "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", "nep245:v2_1.omni.hot.tg:43114_3atVJH3r5c4GqiSYmg9fECvjc47o"),
  evmPay("avalanche", "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7", "nep245:v2_1.omni.hot.tg:43114_372BeH7ENZieCaabwkbWkBiTTgXp"),
  evmPay("polygon", EVM_NATIVE.toLowerCase(), "nep245:v2_1.omni.hot.tg:137_11111111111111111111", 18),
  evmPay("bsc", EVM_NATIVE.toLowerCase(), "nep245:v2_1.omni.hot.tg:56_11111111111111111111", 18),
  { netId: "solana", token: SOL_NATIVE_MINT, asset: "nep141:sol.omft.near", kind: "sol", decimals: 9 },

  evmPay("gnosis", EVM_NATIVE.toLowerCase(), "nep141:gnosis.omft.near", 18),
  evmPay("gnosis", "0x2a22f9c3b484c3629090feed35f17ff8f88f76f0", "nep141:gnosis-0x2a22f9c3b484c3629090feed35f17ff8f88f76f0.omft.near"),
  evmPay("gnosis", "0x4ecaba5870353805a9f068101a40e0f32ed605c6", "nep141:gnosis-0x4ecaba5870353805a9f068101a40e0f32ed605c6.omft.near"),
  evmPay("scroll", EVM_NATIVE.toLowerCase(), "nep245:v2_1.omni.hot.tg:534352_11111111111111111111", 18),
  evmPay("scroll", "0xf55bec9cafdbe8730f096aa55dad6d22d44099df", "nep245:v2_1.omni.hot.tg:534352_4RG3Q2wFsMQmd45m5m89RjsLfupA"),
  evmPay("berachain", EVM_NATIVE.toLowerCase(), "nep141:bera.omft.near", 18),
  evmPay("berachain", "0x779ded0c9e1022225f8e0630b35a9b54be713736", "nep141:bera-0x779ded0c9e1022225f8e0630b35a9b54be713736.omft.near"),
];

export type OneTarget = OneDest | OnePay;
const isCoin = (d: OneTarget): d is OneDest => typeof d === "string";

export function oneTarget(netId: string, token: string): OnePay | null {
  const p = onePay(netId, token);
  return p && (p.kind !== "tron" || p.token === TRON_USDT) ? p : null;
}
const targetAsset = (d: OneTarget): string | null => (isCoin(d) ? ONE_DEST[d] ?? null
  : ONE_PAY.find((p) => p.asset === d.asset && p.netId === d.netId && p.token === d.token && p.kind === d.kind && (p.kind !== "tron" || p.token === TRON_USDT))?.asset ?? null);

export function onePay(netId: string, token: string): OnePay | null {
  return ONE_PAY.find((p) => p.netId === netId && (p.kind === "evm" ? p.token === String(token).toLowerCase() : p.token === token)) ?? null;
}
export const isEvmNative = (p: OnePay) => p.kind === "evm" && p.token === EVM_NATIVE.toLowerCase();

export const ONE_WINDOW_MS = 3600_000;
const TOLERANCE_BPS = 10n;
const unsafe = (why: string) => Object.assign(new Error("ERR_UNSAFE"), { why });
const evm = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
const refundOk = (k: PayKind, a: unknown) => (k === "evm" ? evm(a) : k === "sol" ? typeof a === "string" && isSolAddress(a) && a === a.trim() : typeof a === "string" && isTronAddress(a) && a === a.trim());

export interface OneReq { pay: OnePay; dest: OneTarget; amount: bigint; recipient: string; refundTo: string; fee: boolean; dry: boolean }
export type OneBody = ReturnType<typeof oneBody>;
export function oneBody(r: OneReq, nowMs = Date.now()) {
  const pinned = ONE_PAY.find((p) => p.asset === r.pay.asset && p.netId === r.pay.netId && p.token === r.pay.token && p.kind === r.pay.kind);
  const dest = targetAsset(r.dest);

  const toOk = isCoin(r.dest) ? destOk(r.dest, r.recipient) : r.dest.kind === "tron" ? tronUserAddrOk(r.recipient) : refundOk(r.dest.kind, r.recipient);
  if (!pinned || !dest || dest === pinned.asset || r.amount <= 0n || !toOk || !refundOk(r.pay.kind, r.refundTo)) throw unsafe("buy request");
  return {
    dry: r.dry, swapType: "EXACT_INPUT", slippageTolerance: SLIPPAGE_BPS, originAsset: pinned.asset, depositType: "ORIGIN_CHAIN", destinationAsset: dest,
    amount: r.amount.toString(), refundTo: r.refundTo, refundType: "ORIGIN_CHAIN", recipient: r.recipient, recipientType: "DESTINATION_CHAIN",
    deadline: new Date(nowMs + ONE_WINDOW_MS).toISOString(),
    ...(r.fee && NEAR_FEE_ACCOUNT ? { appFees: [{ recipient: NEAR_FEE_ACCOUNT, fee: madarFeeBps() }] } : {}),
  };
}

export function oneError(j: any): Error & { onebuy: true; kind: "small" | "big" | "route"; minIn: bigint | null; minUsd: number | null } {
  const msg = String(j?.message ?? ""), min = /try at least (\d{1,40})/i.exec(msg), usd = /minimum swap amount is \$\s?([\d,]{1,9}(?:\.\d{1,2})?)/i.exec(msg);
  const kind = /minimum|too (low|small)|at least/i.test(msg) ? "small" : /max(imum)? amount|too (high|large|big)|liquidity|exceeds/i.test(msg) ? "big" : "route";
  return Object.assign(new Error(kind === "small" ? "ERR_SMALL" : kind === "big" ? "ERR_BIG" : "ERR_ROUTE"),
    { onebuy: true as const, kind: kind as "small" | "big" | "route", minIn: min ? BigInt(min[1]) : null, minUsd: usd ? Number(usd[1].replace(/,/g, "")) : null });
}

export interface OneQuote {
  amountOut: bigint; minOut: bigint; deposit: string | null; secs: number | null;
   feeBps: number;
  usdIn: number | null; usdOut: number | null;
   outFee: bigint | null;
}

function depositOk(k: PayKind, d: unknown, body: OneBody, notTo: readonly string[]): string {
  if (k === "evm") {
    if (typeof d !== "string" || !evm(d) || !isAddress(d) || /^0x0{40}$/i.test(d)) throw unsafe("deposit address");
    const low = d.toLowerCase();
    if (low === body.refundTo.toLowerCase() || body.originAsset.includes(low.slice(2)) || [...notTo, LIFI_DIAMOND, MADAR_FEE_WALLET].some((x) => x.toLowerCase() === low)) throw unsafe("deposit address");
    return low;
  }
  const ok = k === "sol" ? typeof d === "string" && isSolAddress(d) && d === d.trim() : typeof d === "string" && isTronAddress(d) && d === d.trim();
  if (!ok || d === body.refundTo || [...notTo, TRON_USDT].includes(d as string)) throw unsafe("deposit address");
  return d as string;
}

export function checkOneAnswer(j: any, body: OneBody, kind: PayKind, o: { shown?: { out: bigint; min: bigint }; notTo?: readonly string[]; nowMs?: number } = {}): OneQuote {
  const q = j?.quote, r = j?.quoteRequest;
  if (!q || !r) throw oneError(j);
  if (r.dry !== body.dry) throw unsafe("answer dry");
  if (r.recipient !== body.recipient || r.refundTo !== body.refundTo || r.originAsset !== body.originAsset || r.destinationAsset !== body.destinationAsset) throw unsafe("answer addresses");
  if (r.recipientType !== "DESTINATION_CHAIN" || r.refundType !== "ORIGIN_CHAIN" || r.depositType !== "ORIGIN_CHAIN" || r.swapType !== body.swapType) throw unsafe("answer types");
  if (String(r.amount) !== body.amount || String(q.amountIn) !== body.amount) throw unsafe("answer amount");
  const fees: unknown = r.appFees ?? [];
  if (!Array.isArray(fees)) throw unsafe("answer fee");
  let feeBps = 0;
  for (const f of fees as { recipient?: unknown; fee?: unknown }[]) {
    const n = Number(f?.fee);
    if (!Number.isInteger(n) || n < 0) throw unsafe("answer fee");
    feeBps += n;
  }
  if (feeBps > madarFeeBps()) throw unsafe("answer fee");
  if (body.appFees && !(fees as { recipient?: unknown; fee?: unknown }[]).some((f) => f?.recipient === NEAR_FEE_ACCOUNT && Number(f.fee) > 0)) throw unsafe("answer fee");
  let amountOut: bigint, minOut: bigint;
  try { amountOut = BigInt(q.amountOut ?? 0); minOut = BigInt(q.minAmountOut ?? 0); } catch { throw unsafe("answer out"); }
  if (amountOut <= 0n || minOut <= 0n || minOut > amountOut) throw unsafe("answer out");
  if ((minOut + 1n) * 10000n < amountOut * BigInt(10000 - SLIPPAGE_BPS)) throw unsafe("answer min");
  if (o.shown) {
    if (amountOut * 100n > o.shown.out * 105n) throw unsafe("answer above shown");
    if (amountOut * 10000n < o.shown.out * BigInt(10000 - SLIPPAGE_BPS) || minOut * 10000n < o.shown.min * (10000n - TOLERANCE_BPS)) throw new Error("ERR_MOVED");
  }
  let deposit: string | null = null;
  if (!body.dry) {
    deposit = depositOk(kind, q.depositAddress, body, o.notTo ?? []);
    const dl = Date.parse(String(q.deadline ?? ""));
    if (!(dl > (o.nowMs ?? Date.now()) + 15 * 60_000)) throw unsafe("deposit deadline");
  }
  let outFee: bigint | null = null;
  try { outFee = q.withdrawFee != null ? BigInt(q.withdrawFee) : null; } catch { outFee = null; }
  const usd = (v: unknown) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) && n > 0 ? n : null; };
  return { amountOut, minOut, deposit, secs: Number(q.timeEstimate) || null, feeBps, usdIn: usd(q.amountInUsd), usdOut: usd(q.amountOutUsd), outFee: outFee != null && outFee >= 0n && outFee < amountOut ? outFee : null };
}

async function postQuote(body: OneBody, fetcher: typeof fetch): Promise<unknown> {
  const res = await fetcher(`${ONECLICK}/v0/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw Object.assign(new Error("ERR_BUSY"), { onebuy: true, kind: "busy" });
  return res.json().catch(() => null);
}

export async function oneQuote(r: Omit<OneReq, "dry">, fetcher: typeof fetch = fetch): Promise<OneQuote> {
  const body = oneBody({ ...r, dry: true });
  return checkOneAnswer(await postQuote(body, fetcher), body, r.pay.kind);
}

export async function checkOneDeposit(deposit: string, body: OneBody, kind: PayKind, minOut: bigint, fetcher: typeof fetch = fetch): Promise<true> {
  let j: any;
  try { j = await (await fetcher(`${ONECLICK}/v0/status?depositAddress=${encodeURIComponent(deposit)}`, { referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) })).json(); } catch { throw unsafe("deposit status"); }
  const rq = j?.quoteResponse?.quoteRequest, qt = j?.quoteResponse?.quote;
  if (!rq || !qt || j.status !== "PENDING_DEPOSIT") throw unsafe("deposit status");
  if (rq.dry !== false || rq.recipient !== body.recipient || rq.refundTo !== body.refundTo || rq.originAsset !== body.originAsset || rq.destinationAsset !== body.destinationAsset) throw unsafe("deposit record");
  if (rq.recipientType !== "DESTINATION_CHAIN" || rq.refundType !== "ORIGIN_CHAIN" || rq.depositType !== "ORIGIN_CHAIN" || rq.swapType !== body.swapType) throw unsafe("deposit record");
  const same = kind === "evm" ? String(qt.depositAddress ?? "").toLowerCase() === deposit.toLowerCase() : qt.depositAddress === deposit;
  if (!same) throw unsafe("deposit record");
  if (String(rq.amount) !== body.amount || String(qt.amountIn) !== body.amount) throw unsafe("deposit amount");
  let min: bigint;
  try { min = BigInt(qt.minAmountOut); } catch { throw unsafe("deposit min out"); }
  if (min < minOut) throw unsafe("deposit min out");
  return true;
}

export async function oneDeposit(r: Omit<OneReq, "dry">, shown: { out: bigint; min: bigint }, notTo: readonly string[], fetcher: typeof fetch = fetch): Promise<{ deposit: string; quote: OneQuote; body: OneBody }> {
  const body = oneBody({ ...r, dry: false });
  const quote = checkOneAnswer(await postQuote(body, fetcher), body, r.pay.kind, { shown, notTo });
  await checkOneDeposit(quote.deposit!, body, r.pay.kind, quote.minOut, fetcher);
  return { deposit: quote.deposit!, quote, body };
}

export function onePayment(p: OnePay, deposit: string, amount: bigint): { to: Address; data: Hex; value: bigint } {
  if (p.kind !== "evm" || !evm(deposit) || amount <= 0n) throw unsafe("payment");
  if (isEvmNative(p)) return { to: deposit as Address, data: "0x", value: amount };
  return { to: p.token as Address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [deposit as Address, amount] }), value: 0n };
}

export function checkOnePayment(tx: { to: string; data: Hex; value: bigint }, p: OnePay, deposit: string, amount: bigint): void {
  if (isEvmNative(p)) {
    if (tx.to.toLowerCase() !== deposit.toLowerCase() || tx.value !== amount || tx.data !== "0x") throw unsafe("payment");
    return;
  }
  let d;
  try { d = decodeFunctionData({ abi: erc20Abi, data: tx.data }); } catch { throw unsafe("payment"); }
  const [to, v] = (d.args ?? []) as unknown as [string, bigint];
  if (tx.to.toLowerCase() !== p.token || tx.value !== 0n || d.functionName !== "transfer" || to.toLowerCase() !== deposit.toLowerCase() || v !== amount) throw unsafe("payment");
  if (tx.data.length !== 2 + 8 + 128) throw unsafe("payment");
}

export async function oneSendEvm(n: Network, phrase: string, index: number, me: string, r: Omit<OneReq, "dry">, shown: { out: bigint; min: bigint }, reviewed?: GasFees, fetcher: typeof fetch = fetch): Promise<{ hash: Hash; deposit: string; quote: OneQuote }> {
  if (r.pay.kind !== "evm" || r.pay.netId !== n.id || me.toLowerCase() !== r.refundTo.toLowerCase()) throw unsafe("sender");
  const { deposit, quote } = await oneDeposit(r, shown, [me, ...n.tokens.map((t) => t.address)], fetcher);
  const c = publicClient(n);
  let code: Hex | undefined;
  try { code = await c.getCode({ address: deposit as Address }); } catch { throw new Error("ERR_NET"); }
  if (code && code !== "0x") throw unsafe("deposit contract");
  const tx = onePayment(r.pay, deposit, r.amount);
  checkOnePayment(tx, r.pay, deposit, r.amount);
  if (!isEvmNative(r.pay)) {
    const bal = (await c.readContract({ address: r.pay.token as Address, abi: erc20Abi, functionName: "balanceOf", args: [me as Address] })) as bigint;
    if (bal < r.amount) throw new Error("ERR_FUNDS");
  }
  const gasEst = ((await c.estimateGas({ account: me as Address, to: tx.to, data: tx.data, value: tx.value })) * 12n) / 10n;
  const fees = await sendFees(n, reviewed, true);
  if (isEvmNative(r.pay)) {
    const bal = await c.getBalance({ address: me as Address });
    if (bal < r.amount + gasEst * perGas(fees)) throw new Error("ERR_FUNDS");
  }
  const hash = await wallet(n, phrase, index).sendTransaction({ to: tx.to, data: tx.data === "0x" ? undefined : tx.data, value: tx.value, gas: gasEst, ...feeFields(fees) } as never);
  return { hash, deposit, quote };
}

export async function oneSendSol(phrase: string, index: number, me: string, r: Omit<OneReq, "dry">, shown: { out: bigint; min: bigint }, fetcher: typeof fetch = fetch): Promise<{ sig: string; deposit: string; quote: OneQuote }> {
  if (r.pay.kind !== "sol" || r.refundTo !== me) throw unsafe("sender");
  const native = r.pay.token === SOL_NATIVE_MINT;
  const token = native ? undefined : SOL.tokens.find((t) => t.address === r.pay.token);
  if (!native && !token) throw unsafe("token");
  const { deposit, quote } = await oneDeposit(r, shown, [me, SOL_NATIVE_MINT, ...SOL.tokens.map((t) => t.address)], fetcher);
  const sq = await quoteSolSend(phrase, index, deposit, formatUnitsStr(r.amount, native ? 9 : token!.decimals), token);
  if (sq.to !== deposit || sq.amount !== r.amount || (native ? sq.kind !== "sol" : sq.kind !== "token" || sq.token?.address !== token!.address)) throw unsafe("payment");
  return { sig: await sendSol(phrase, index, sq), deposit, quote };
}

export async function oneSendTron(phrase: string, index: number, me: string, r: Omit<OneReq, "dry">, shown: { out: bigint; min: bigint }, fetcher: typeof fetch = fetch): Promise<{ txid: string; deposit: string; quote: OneQuote }> {
  if (r.pay.kind !== "tron" || r.refundTo !== me || r.pay.token !== TRON_USDT) throw unsafe("sender");
  const token = TRON.tokens[0];
  const { deposit, quote } = await oneDeposit(r, shown, [me], fetcher);
  const tq = await quoteTronSend(phrase, index, deposit, formatUnitsStr(r.amount, token.decimals), token);
  if (tq.to !== deposit || tq.amount !== r.amount || tq.kind !== "token") throw unsafe("payment");
  return { txid: await sendTron(phrase, index, tq), deposit, quote };
}

export async function oneStatus(deposit: string, fetcher: typeof fetch = fetch): Promise<{ state: SellState }> {
  if (!(evm(deposit) || isSolAddress(deposit) || isTronAddress(deposit))) throw unsafe("deposit");
  return depositState(deposit, fetcher);
}

export function oneSummary(q: OneQuote): { amountOut: bigint; minOut: bigint; feePct: number; outFee: bigint | null; secs: number | null; costPct: number } {
  const feePct = q.feeBps / 100;
  const costPct = q.usdIn && q.usdOut && q.usdOut <= q.usdIn ? ((q.usdIn - q.usdOut) / q.usdIn) * 100 : feePct;
  return { amountOut: q.amountOut, minOut: q.minOut, feePct, outFee: q.outFee, secs: q.secs, costPct };
}
