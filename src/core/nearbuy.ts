import { feeBps as madarFeeBps } from "./swap";
import { decodeFunctionData, encodeFunctionData, erc20Abi, isAddress, type Address, type Hash, type Hex } from "viem";
import { evmAddress } from "./account";
import { isBtcAddress } from "./btcbase";
import type { Network } from "./chains";
import { feeFields, publicClient, type GasFees } from "./chainops";
import { LIFI_DIAMOND, MADAR_FEE_WALLET } from "./lifi";
import { depositState, NEAR_FEE_ACCOUNT, ONECLICK, SELL_TO, type SellState } from "./nearsell";
import { sendFees, SLIPPAGE_BPS, wallet } from "./swap";

export const NEAR_BTC = "nep141:btc.omft.near";

const PREFIX: Readonly<Record<string, string>> = { arbitrum: "arb", base: "base", ethereum: "eth" };

export function buyAsset(netId: string, token: string): string | null {
  const p = PREFIX[netId];
  if (!p || !/^0x[0-9a-fA-F]{40}$/.test(token)) return null;
  const id = `nep141:${p}-${token.toLowerCase()}.omft.near`;
  return Object.entries(SELL_TO).some(([k, a]) => k.startsWith(`${netId}:`) && a === id) ? id : null;
}

export const BUY_WINDOW_MS = 3600_000;

const TOLERANCE_BPS = 10n;
const unsafe = (why: string) => Object.assign(new Error("ERR_UNSAFE"), { why });
const evm = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

export interface BuyReq { amount: bigint; asset: string; recipient: string; refundTo: string; fee: boolean; dry: boolean }
export interface BuyQuote {
  amountOut: bigint; minOut: bigint; deposit: string | null; secs: number | null;
   feeBps: number;
  usdIn: number | null; usdOut: number | null;  btcFee: bigint | null;
}
export type BuyBody = ReturnType<typeof buyBody>;

export function buyBody(r: BuyReq, nowMs = Date.now()) {
  const btcOk = isBtcAddress(r.recipient) && r.recipient === r.recipient.trim() && (!/^bc1/i.test(r.recipient) || r.recipient === r.recipient.toLowerCase());

  const evmDollar = Object.entries(SELL_TO).some(([k, a]) => a === r.asset && !!PREFIX[k.slice(0, k.indexOf(":"))]);
  if (r.amount <= 0n || !evm(r.refundTo) || !btcOk || !evmDollar) throw unsafe("buy request");
  return {
    dry: r.dry, swapType: "EXACT_INPUT", slippageTolerance: SLIPPAGE_BPS, originAsset: r.asset, depositType: "ORIGIN_CHAIN", destinationAsset: NEAR_BTC,
    amount: r.amount.toString(), refundTo: r.refundTo, refundType: "ORIGIN_CHAIN", recipient: r.recipient, recipientType: "DESTINATION_CHAIN",
    deadline: new Date(nowMs + BUY_WINDOW_MS).toISOString(),
    ...(r.fee && NEAR_FEE_ACCOUNT ? { appFees: [{ recipient: NEAR_FEE_ACCOUNT, fee: madarFeeBps() }] } : {}),
  };
}

export function buyApiError(j: any): Error & { btcbuy: true; kind: "small" | "big" | "route"; minIn: bigint | null } {
  const msg = String(j?.message ?? ""), min = /try at least (\d{1,40})/i.exec(msg);
  const kind = /minimum|too (low|small)|at least/i.test(msg) ? "small" : /max(imum)? amount|too (high|large|big)|liquidity|exceeds/i.test(msg) ? "big" : "route";
  return Object.assign(new Error(kind === "small" ? "ERR_SMALL" : kind === "big" ? "ERR_BIG" : "ERR_ROUTE"), { btcbuy: true as const, kind: kind as "small" | "big" | "route", minIn: min ? BigInt(min[1]) : null });
}

export function checkBuyAnswer(j: any, body: BuyBody, o: { shown?: { out: bigint; min: bigint }; notTo?: readonly string[]; nowMs?: number } = {}): BuyQuote {
  const q = j?.quote, r = j?.quoteRequest;
  if (!q || !r) throw buyApiError(j);
  if (r.dry !== body.dry) throw unsafe("answer dry");
  if (r.recipient !== body.recipient || r.refundTo !== body.refundTo || r.originAsset !== body.originAsset || r.destinationAsset !== NEAR_BTC) throw unsafe("answer addresses");
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
    const d = q.depositAddress;

    if (typeof d !== "string" || !evm(d) || !isAddress(d) || /^0x0{40}$/i.test(d)) throw unsafe("deposit address");
    const low = d.toLowerCase();
    if (low === body.refundTo.toLowerCase() || body.originAsset.includes(low.slice(2)) || [...(o.notTo ?? []), LIFI_DIAMOND, MADAR_FEE_WALLET].some((x) => x.toLowerCase() === low)) throw unsafe("deposit address");
    const dl = Date.parse(String(q.deadline ?? ""));
    if (!(dl > (o.nowMs ?? Date.now()) + 15 * 60_000)) throw unsafe("deposit deadline");
    deposit = low;
  }
  let btcFee: bigint | null = null;
  try { btcFee = q.withdrawFee != null ? BigInt(q.withdrawFee) : null; } catch { btcFee = null; }
  const usd = (v: unknown) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) && n > 0 ? n : null; };
  return { amountOut, minOut, deposit, secs: Number(q.timeEstimate) || null, feeBps, usdIn: usd(q.amountInUsd), usdOut: usd(q.amountOutUsd), btcFee: btcFee != null && btcFee >= 0n && btcFee < amountOut ? btcFee : null };
}

async function postQuote(body: BuyBody, fetcher: typeof fetch): Promise<unknown> {
  const res = await fetcher(`${ONECLICK}/v0/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw Object.assign(new Error("ERR_BUSY"), { btcbuy: true, kind: "busy" });
  return res.json().catch(() => null);
}

export async function buyQuote(r: BuyReq, fetcher: typeof fetch = fetch): Promise<BuyQuote> {
  const body = buyBody(r);
  return checkBuyAnswer(await postQuote(body, fetcher), body);
}

export async function checkBuyDeposit(deposit: string, body: BuyBody, minOut: bigint, fetcher: typeof fetch = fetch): Promise<true> {
  if (!evm(deposit)) throw unsafe("deposit");
  let j: any;
  try { j = await (await fetcher(`${ONECLICK}/v0/status?depositAddress=${deposit}`, { referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) })).json(); } catch { throw unsafe("deposit status"); }
  const rq = j?.quoteResponse?.quoteRequest, qt = j?.quoteResponse?.quote;
  if (!rq || !qt || j.status !== "PENDING_DEPOSIT") throw unsafe("deposit status");
  if (rq.dry !== false || rq.recipient !== body.recipient || rq.refundTo !== body.refundTo || rq.originAsset !== body.originAsset || rq.destinationAsset !== NEAR_BTC) throw unsafe("deposit record");
  if (rq.recipientType !== "DESTINATION_CHAIN" || rq.refundType !== "ORIGIN_CHAIN" || rq.depositType !== "ORIGIN_CHAIN" || rq.swapType !== body.swapType) throw unsafe("deposit record");
  if (String(qt.depositAddress ?? "").toLowerCase() !== deposit.toLowerCase()) throw unsafe("deposit record");
  if (String(rq.amount) !== body.amount || String(qt.amountIn) !== body.amount) throw unsafe("deposit amount");
  let min: bigint;
  try { min = BigInt(qt.minAmountOut); } catch { throw unsafe("deposit min out"); }
  if (min < minOut) throw unsafe("deposit min out");
  return true;
}

export function buyPayment(token: string, deposit: string, amount: bigint): { to: Address; data: Hex; value: 0n } {
  if (!evm(token) || !evm(deposit) || amount <= 0n) throw unsafe("payment");
  return { to: token as Address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [deposit as Address, amount] }), value: 0n };
}

export function checkBuyPayment(tx: { to: string; data: Hex; value: bigint }, token: string, deposit: string, amount: bigint): void {
  let d;
  try { d = decodeFunctionData({ abi: erc20Abi, data: tx.data }); } catch { throw unsafe("payment"); }
  const [to, v] = (d.args ?? []) as unknown as [string, bigint];
  if (tx.to.toLowerCase() !== token.toLowerCase() || tx.value !== 0n || d.functionName !== "transfer" || to.toLowerCase() !== deposit.toLowerCase() || v !== amount) throw unsafe("payment");
  if (tx.data.length !== 2 + 8 + 128) throw unsafe("payment");
}

export async function nearBuySend(n: Network, phrase: string, index: number, r: Omit<BuyReq, "dry">, token: string, shown: { out: bigint; min: bigint }, reviewed?: GasFees, fetcher: typeof fetch = fetch): Promise<{ hash: Hash; deposit: string; quote: BuyQuote }> {
  const me = evmAddress(phrase, index);
  if (me.toLowerCase() !== r.refundTo.toLowerCase()) throw unsafe("sender");
  if (buyAsset(n.id, token) !== r.asset) throw unsafe("asset");
  const body = buyBody({ ...r, dry: false });
  const q = checkBuyAnswer(await postQuote(body, fetcher), body, { shown, notTo: [me, token, ...n.tokens.map((t) => t.address)] });
  const deposit = q.deposit!;
  await checkBuyDeposit(deposit, body, q.minOut, fetcher);
  const c = publicClient(n);
  let code: Hex | undefined;
  try { code = await c.getCode({ address: deposit as Address }); } catch { throw new Error("ERR_NET"); }
  if (code && code !== "0x") throw unsafe("deposit contract");
  const tx = buyPayment(token, deposit, r.amount);
  checkBuyPayment(tx, token, deposit, r.amount);
  const bal = (await c.readContract({ address: token as Address, abi: erc20Abi, functionName: "balanceOf", args: [me] })) as bigint;
  if (bal < r.amount) throw new Error("ERR_FUNDS");
  const gas = ((await c.estimateGas({ account: me, to: tx.to, data: tx.data, value: 0n })) * 12n) / 10n;
  const fees = await sendFees(n, reviewed, true);
  const hash = await wallet(n, phrase, index).sendTransaction({ to: tx.to, data: tx.data, value: 0n, gas, ...feeFields(fees) } as never);
  return { hash, deposit, quote: q };
}

export async function buyStatus(deposit: string, fetcher: typeof fetch = fetch): Promise<{ state: SellState }> {
  if (!evm(deposit)) throw unsafe("deposit");
  return depositState(deposit, fetcher);
}

export function buySummary(q: BuyQuote): { amountOut: bigint; minOut: bigint; feePct: number; btcFee: bigint | null; secs: number | null; costPct: number } {
  const feePct = q.feeBps / 100;
  const costPct = q.usdIn && q.usdOut && q.usdOut <= q.usdIn ? ((q.usdIn - q.usdOut) / q.usdIn) * 100 : feePct;
  return { amountOut: q.amountOut, minOut: q.minOut, feePct, btcFee: q.btcFee, secs: q.secs, costPct };
}

export function pickBtcRoute(lifi: { amountOut: bigint } | null, direct: { amountOut: bigint } | null): "lifi" | "direct" | null {
  if (lifi && direct) return direct.amountOut > lifi.amountOut ? "direct" : "lifi";
  return lifi ? "lifi" : direct ? "direct" : null;
}

export type BtcBuyWhy = { why: "small" | "payWith" | "busy" | "big" | "net" | "none"; minIn: bigint | null };
export function btcBuyFailure(lifiErr: unknown, directErr: unknown, directOn: boolean): BtcBuyWhy {
  const l = lifiErr as { message?: string; api?: boolean } | undefined, d = directErr as { message?: string; btcbuy?: boolean; kind?: string; minIn?: bigint | null } | undefined;
  if (directOn && d?.btcbuy && d.kind === "small") return { why: "small", minIn: d.minIn ?? null };
  if (!directOn && l?.message === "ERR_UNSAFE") return { why: "payWith", minIn: null };
  if (directOn && d?.btcbuy && d.kind === "busy") return { why: "busy", minIn: null };
  if (directOn && d?.btcbuy && d.kind === "big") return { why: "big", minIn: null };
  const offline = (e: { message?: string; api?: boolean; btcbuy?: boolean } | undefined) => !!e && !e.api && !e.btcbuy && e.message !== "ERR_UNSAFE" && /fetch|network|timeout|abort|ERR_NET/i.test(e.message ?? "");
  if (offline(l) && (!directOn || offline(d))) return { why: "net", minIn: null };
  return { why: "none", minIn: null };
}
