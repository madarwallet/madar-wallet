import type { PendingPayment } from "./store";
import { checkSellPayment, sellAddrOk, sellFeeTooHigh } from "./nearsell";
import { formatUtxo, quoteUtxoSend, utxoSignedOf, utxoTxStatus, type UtxoCoin, type UtxoId, type UtxoQuote } from "./utxo";
import { feeFrom, MAX_XRP_FEE, reserveOf, waitXrp, xrpAddress, xrpRpc, xrpSignedOf, xrpSnapshot, type XrpSigned, type XrpSnapshot } from "./xrp";
import { adaPaymentState, adaSignedOf, quoteAdaSend, type AdaQuote } from "./ada";
import { ADA, formatAda } from "./adabase";
import { trc20Balance, TRON_USDT, tronAccount, tronAddress, tronFee, tronPrices, tronResource, type TronAccount, type TronPrices, type TronQuote, type TronResource } from "./tron";
import { bech32 } from "@scure/base";
import {
  MAX_NEAR_FEE, NEAR, nearAccessKey, nearAccount, nearFeeOf, nearGasPrice, nearImplicitOf, nearPublicKey, nearReserveOf, nearSecret, nearSignedOf, NEW_IMPLICIT_MIN, waitNear,
  type NearAccount, type NearKey, type NearSigned,
} from "./near";

const err = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(code), extra);

export const SELL_PROBE: Readonly<Record<UtxoId, string>> = {
  dogecoin: "D596YFweJQuHY1BbjazZYmAbt8jJPbKehC",
  litecoin: "ltc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp9ysmq",
};
export interface UtxoSaleReview { amount: bigint; fee: bigint; feeRate: number;  waiting: bigint; skipped: bigint }

export function utxoSaleReviewOf(q: UtxoQuote): UtxoSaleReview {
  if (q.to !== SELL_PROBE[q.coin]) throw err("ERR_UNSAFE");
  return { amount: q.amount, fee: q.fee, feeRate: q.feeRate, waiting: q.waiting, skipped: q.skipped };
}

export async function reviewUtxoSale(c: UtxoCoin, phrase: string, index: number, amount: bigint, feeRate: number, own: readonly string[], quote: typeof quoteUtxoSend = quoteUtxoSend, memo?: Uint8Array): Promise<UtxoSaleReview> {
  return utxoSaleReviewOf(await quote(c, phrase, index, SELL_PROBE[c.id], formatUtxo(amount), feeRate, own, memo));
}

export function checkUtxoSellPayment(p: Pick<UtxoQuote, "coin" | "to" | "amount" | "fee" | "feeRate">, c: UtxoCoin, deposit: string, amount: bigint, reviewed: { fee: bigint; feeRate: number }): void {
  if (p.coin !== c.id || deposit === SELL_PROBE[c.id]) throw err("ERR_UNSAFE");
  checkSellPayment(p, deposit, amount, reviewed);
}

export interface PendingStore {
  get: (networkId: string, from: string) => Promise<PendingPayment | null>;
  clear: (networkId: string, from: string, hash: string) => Promise<void>;
  remove: (hash: string) => Promise<void>;
}

export async function utxoSalePending(c: UtxoCoin, from: string, s: Pick<PendingStore, "get" | "clear">, status: typeof utxoTxStatus = utxoTxStatus): Promise<{ txid: string; amount: bigint } | null> {
  const p = utxoSignedOf(await s.get(c.id, from).catch(() => null));
  if (!p) return null;
  if (!(await status(c, p.txid).catch(() => null))) return { txid: p.txid, amount: p.amount };
  await s.clear(c.id, from, p.txid);
  return null;
}

export interface XrpSaleReview { amount: bigint; fee: bigint; reserve: bigint; reserveBase: bigint; spendable: bigint }

export function xrpSaleReviewOf(snap: XrpSnapshot, feeAnswer: unknown, amount: bigint): XrpSaleReview {
  if (amount <= 0n) throw err("ERR_ZERO");
  if (!snap.me.exists) throw err("ERR_XRP_INACTIVE", { need: snap.ledger.reserveBase });
  const fee = feeFrom(feeAnswer, snap.ledger);
  if (amount < snap.ledger.reserveBase) throw err("ERR_XRP_ACTIVATE", { need: snap.ledger.reserveBase });
  const reserve = reserveOf(snap.ledger, snap.me.ownerCount), spendable = snap.me.balance - reserve - fee;
  if (amount > spendable) throw err("ERR_FUNDS", { max: spendable > 0n ? spendable : 0n, reserve });
  return { amount, fee, reserve, reserveBase: snap.ledger.reserveBase, spendable };
}

export async function reviewXrpSale(phrase: string, index: number, amount: bigint, o: { snapshot?: typeof xrpSnapshot; fee?: () => Promise<unknown> } = {}): Promise<XrpSaleReview> {
  const snap = await (o.snapshot ?? xrpSnapshot)(xrpAddress(phrase, index));
  return xrpSaleReviewOf(snap, await (o.fee ?? (() => xrpRpc("fee", {})))(), amount);
}

export function checkXrpSellPayment(p: { from: string; to: string; tag: number | null; amount: bigint; fee: bigint; newAccount?: boolean; reserveBase?: bigint; balance?: bigint; reserve?: bigint },
  me: string, deposit: string, amount: bigint): void {
  if (p.from !== me || p.to !== deposit || p.amount !== amount || p.tag != null) throw err("ERR_UNSAFE");
  if (p.fee <= 0n || p.fee > MAX_XRP_FEE) throw err("ERR_FEE_HIGH");
  if (sellFeeTooHigh(p.amount, p.fee)) throw err("ERR_FEE_SHARE", { fee: p.fee });
  if (p.newAccount && (p.reserveBase == null || p.amount < p.reserveBase)) throw err("ERR_XRP_ACTIVATE", { need: p.reserveBase ?? 0n });
  if (p.balance != null && p.reserve != null && p.amount + p.fee > p.balance - p.reserve) {
    const max = p.balance - p.reserve - p.fee;
    throw err("ERR_FUNDS", { max: max > 0n ? max : 0n, reserve: p.reserve });
  }
}

export async function xrpSalePending(from: string, s: PendingStore, wait: typeof waitXrp = waitXrp): Promise<XrpSigned | null> {
  const open = xrpSignedOf(await s.get("xrp", from).catch(() => null));
  if (!open || open.from !== from) return null;
  const end = await wait(open, { maxMs: 0 });
  if (end.state !== "ok" && end.state !== "failed" && end.state !== "dropped") return open;
  await s.clear("xrp", open.from, open.hash);
  if (end.state === "dropped") await s.remove(open.hash);
  return null;
}

export const ADA_SELL_PROBE = bech32.encode("addr", bech32.toWords(Uint8Array.from([0x01, ...new Uint8Array(56)])), 1023);

export const ADA_FEE_SLACK = 10_000n;
export interface AdaSaleReview { amount: bigint; fee: bigint }

export async function reviewAdaSale(phrase: string, index: number, amount: bigint, busy: readonly string[] = [], quote: typeof quoteAdaSend = quoteAdaSend): Promise<AdaSaleReview> {
  const q = await quote(phrase, index, ADA_SELL_PROBE, formatAda(amount), busy);
  if (q.to !== ADA_SELL_PROBE || q.amount !== amount) throw err("ERR_UNSAFE");
  return { amount: q.amount, fee: q.fee };
}

export function checkAdaSellPayment(q: Pick<AdaQuote, "to" | "amount" | "fee">, deposit: string, amount: bigint, reviewed: { fee: bigint }): void {
  if (q.to !== deposit || deposit === ADA_SELL_PROBE || q.amount !== amount) throw err("ERR_UNSAFE");
  if (q.fee > reviewed.fee + ADA_FEE_SLACK) throw err("ERR_MOVED");
  if (sellFeeTooHigh(q.amount, q.fee)) throw err("ERR_FEE_SHARE", { fee: q.fee });
}

export async function adaSalePending(from: string, s: PendingStore, state: typeof adaPaymentState = adaPaymentState): Promise<{ txid: string; amount: bigint; ins: string[] } | null> {
  const p = adaSignedOf(await s.get(ADA.id, from).catch(() => null));
  if (!p) return null;
  const st = await state(p).catch(() => "waiting" as const);
  if (st === "waiting") return { txid: p.hash, amount: p.amount, ins: p.ins };
  await s.clear(ADA.id, from, p.hash);
  if (st === "dropped") await s.remove(p.hash);
  return null;
}

export const TRX_SALE_BANDWIDTH = 270;

export const TRX_FEE_SLACK = 100_000n;
export interface TrxSaleReview { amount: bigint; fee: bigint }

export function trxSaleReviewOf(me: TronAccount, res: TronResource, prices: TronPrices, amount: bigint, memoLen = 0, newAccount = true): TrxSaleReview {
  if (amount <= 0n) throw err("ERR_ZERO");

  const f = tronFee({ bandwidth: TRX_SALE_BANDWIDTH + (memoLen ? memoLen + 2 : 0), energy: 0, newAccount, memo: memoLen > 0, res, prices });
  if (me.sun < amount + f.need) { const max = me.sun - f.need; throw err("ERR_FUNDS", { max: max > 0n ? max : 0n }); }
  return { amount, fee: f.fee };
}
const trxReads = async (phrase: string, index: number) => { const me = tronAddress(phrase, index); return Promise.all([tronAccount(me), tronResource(me), tronPrices()]); };

export async function reviewTrxSale(phrase: string, index: number, amount: bigint, memoLen = 0, newAccount = true): Promise<TrxSaleReview> {
  const [me, res, prices] = await trxReads(phrase, index);
  return trxSaleReviewOf(me, res, prices, amount, memoLen, newAccount);
}

export const TRX_KEEP_FOR_USDT = 15_000_000n;

export const TRX_MEMO_ROOM = 82;

export function trxSaleMaxOf(me: TronAccount, res: TronResource, prices: TronPrices, usdt: bigint, intoTronUsdt = false): bigint {
  const keep = usdt > 0n || intoTronUsdt ? TRX_KEEP_FOR_USDT : 0n;

  const left = me.sun - tronFee({ bandwidth: TRX_SALE_BANDWIDTH + TRX_MEMO_ROOM, energy: 0, newAccount: true, memo: true, res, prices }).need - keep;
  return left > 0n ? left : 0n;
}

export async function trxSaleMax(phrase: string, index: number, intoTronUsdt = false): Promise<bigint> {
  const [[me, res, prices], usdt] = await Promise.all([trxReads(phrase, index), trc20Balance(tronAddress(phrase, index), TRON_USDT)]);
  return trxSaleMaxOf(me, res, prices, usdt, intoTronUsdt);
}

export function checkTrxSellPayment(q: Pick<TronQuote, "kind" | "to" | "amount" | "fee" | "token" | "memo">, deposit: string, amount: bigint, reviewed: { fee: bigint }, memo?: string): void {
  if (q.kind !== "trx" || q.token || q.to !== deposit || q.amount !== amount) throw err("ERR_UNSAFE");

  if ((q.memo ?? "") !== (memo ?? "").toLowerCase()) throw err("ERR_UNSAFE");
  if (q.fee > reviewed.fee + TRX_FEE_SLACK) throw err("ERR_MOVED");
  if (sellFeeTooHigh(q.amount, q.fee)) throw err("ERR_FEE_SHARE", { fee: q.fee });
}

export const NEAR_FEE_SLACK = 10n ** 20n;
export interface NearSaleReview { amount: bigint; fee: bigint; reserve: bigint; spendable: bigint }

export function nearSaleReviewOf(me: NearAccount, gasAnswer: unknown, amount: bigint): NearSaleReview {
  if (amount <= 0n) throw err("ERR_ZERO");
  if (!me.exists) throw err("ERR_NEAR_INACTIVE", { need: NEW_IMPLICIT_MIN });
  const fee = nearFeeOf(gasAnswer, true);
  if (amount < NEW_IMPLICIT_MIN) throw err("ERR_NEAR_MIN", { need: NEW_IMPLICIT_MIN });
  const reserve = nearReserveOf(me), spendable = me.amount - reserve - fee;
  if (amount > spendable) throw err("ERR_FUNDS", { max: spendable > 0n ? spendable : 0n, reserve });
  return { amount, fee, reserve, spendable };
}

export async function reviewNearSale(phrase: string, index: number, amount: bigint,
  o: { account?: (id: string) => Promise<NearAccount>; gas?: () => Promise<unknown>; key?: (id: string, pub: Uint8Array) => Promise<NearKey | null> } = {}): Promise<NearSaleReview> {
  const pub = nearPublicKey(nearSecret(phrase, index)), me = nearImplicitOf(pub);
  const rv = nearSaleReviewOf(await (o.account ?? nearAccount)(me), await (o.gas ?? nearGasPrice)(), amount);
  const key = await (o.key ?? nearAccessKey)(me, pub);
  if (!key || !key.fullAccess) throw err("ERR_NEAR_KEY");
  return rv;
}

export function checkNearSellPayment(p: { from: string; to: string; amount: bigint; fee: bigint }, me: string, deposit: string, amount: bigint, reviewed: { fee: bigint }): void {
  if (amount <= 0n || p.from !== me || p.to !== deposit || deposit === me || !sellAddrOk("NEAR", deposit) || p.amount !== amount) throw err("ERR_UNSAFE");
  if (p.fee <= 0n || p.fee > MAX_NEAR_FEE) throw err("ERR_FEE_HIGH");
  if (p.fee > reviewed.fee + NEAR_FEE_SLACK) throw err("ERR_MOVED");
  if (sellFeeTooHigh(p.amount, p.fee)) throw err("ERR_FEE_SHARE", { fee: p.fee });
}

export async function nearSalePending(from: string, s: PendingStore, wait: typeof waitNear = waitNear): Promise<NearSigned | null> {
  const p = await s.get(NEAR.id, from).catch(() => null);
  const open = nearSignedOf(p);
  if (!open || !p || open.from !== from) return null;
  const end = await wait(open, p.at, { maxMs: 0 });
  if (end.state === "pending") return open;
  await s.clear(NEAR.id, open.from, open.hash);
  if (end.state === "dropped") await s.remove(open.hash);
  return null;
}
