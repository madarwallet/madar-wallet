import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  decodeClassic, dropsOf, formatXrp, parseXrp, reserveOf, xrpAccount, xrpAddressOfKey, xrpKeys, xrpLedger, xrpRecipient, xrpRpc, XrplError, XRP_RPCS,
  type XrpAccountInfo, type XrpLedger,
} from "./xrpbase";
export * from "./xrpbase";

export const MAX_XRP_FEE = 10_000n;
export const TF_FULLY_CANONICAL_SIG = 0x80000000;

export const XRP_LEDGER_WINDOW = 20;
const AMOUNT_MAX = 100_000_000_000n * 1_000_000n;

export interface XrpPayment { account: string; destination: string; amount: bigint; fee: bigint; sequence: number; lastLedger?: number; tag: number | null; flags: number; signingPubKey: Uint8Array }
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const u32 = (n: number) => { if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error("ERR_UNSAFE"); return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]; };

export function xrpAmountBytes(drops: bigint): number[] {
  if (drops < 0n || drops > AMOUNT_MAX) throw new Error("ERR_UNSAFE");
  const v = drops | 0x4000000000000000n;
  return Array.from({ length: 8 }, (_, i) => Number((v >> BigInt(56 - 8 * i)) & 0xffn));
}
const vl = (b: Uint8Array) => { if (b.length > 192) throw new Error("ERR_UNSAFE"); return [b.length, ...b]; };

export function serializePayment(p: XrpPayment, signature?: Uint8Array): Uint8Array {
  if (p.signingPubKey.length !== 33) throw new Error("ERR_UNSAFE");
  if (p.tag != null && (!Number.isInteger(p.tag) || p.tag < 0 || p.tag > 0xffffffff)) throw new Error("ERR_UNSAFE");
  const out: number[] = [
    0x12, ...u16(0),
    0x22, ...u32(p.flags),
    0x24, ...u32(p.sequence),
    ...(p.tag != null ? [0x2e, ...u32(p.tag)] : []),
    ...(p.lastLedger != null ? [0x20, 0x1b, ...u32(p.lastLedger)] : []),
    0x61, ...xrpAmountBytes(p.amount),
    0x68, ...xrpAmountBytes(p.fee),
    0x73, ...vl(p.signingPubKey),
    ...(signature ? [0x74, ...vl(signature)] : []),
    0x81, ...vl(decodeClassic(p.account)),
    0x83, ...vl(decodeClassic(p.destination)),
  ];
  return Uint8Array.from(out);
}
const PREFIX_SIGN = [0x53, 0x54, 0x58, 0x00], PREFIX_TXID = [0x54, 0x58, 0x4e, 0x00];
export const sha512Half = (b: Uint8Array) => sha512(b).slice(0, 32);
export const signingHash = (p: XrpPayment) => sha512Half(Uint8Array.from([...PREFIX_SIGN, ...serializePayment(p)]));
export const txHashOf = (signed: Uint8Array) => bytesToHex(sha512Half(Uint8Array.from([...PREFIX_TXID, ...signed]))).toUpperCase();

export function signPayment(p: XrpPayment, privateKey: Uint8Array): { blob: string; hash: string; signature: Uint8Array } {
  if (bytesToHex(secp256k1.getPublicKey(privateKey, true)) !== bytesToHex(p.signingPubKey)) throw new Error("ERR_UNSAFE");
  if (xrpAddressOfKey(p.signingPubKey) !== p.account) throw new Error("ERR_UNSAFE");
  const h = signingHash(p);
  const signature = secp256k1.sign(h, privateKey, { prehash: false, lowS: true, format: "der" });
  if (!secp256k1.verify(signature, h, p.signingPubKey, { prehash: false, lowS: true, format: "der" })) throw new Error("ERR_UNSAFE");
  const signed = serializePayment(p, signature);
  return { blob: bytesToHex(signed).toUpperCase(), hash: txHashOf(signed), signature };
}

export interface XrpSnapshot { ledger: XrpLedger; me: XrpAccountInfo;  minSeq: number }

export const MAX_LEDGER_GAP = 5;
export function agreeSnapshots(snaps: { ledger: XrpLedger; me: XrpAccountInfo }[]): XrpSnapshot {
  if (!snaps.length) throw err("ERR_NET");
  if (snaps.length > 1) {
    const [a, b] = snaps;
    if (a.me.exists !== b.me.exists || a.me.sequence !== b.me.sequence || a.me.ownerCount !== b.me.ownerCount) throw err("ERR_HOSTS");
    if (Math.abs(a.ledger.seq - b.ledger.seq) > MAX_LEDGER_GAP || a.ledger.reserveBase !== b.ledger.reserveBase || a.ledger.reserveInc !== b.ledger.reserveInc) throw err("ERR_HOSTS");
  }
  const seqs = snaps.map((s) => s.ledger.seq);
  const low = snaps.reduce((x, y) => (y.me.balance < x.me.balance ? y : x));
  const fee = snaps.reduce((f, s) => (s.ledger.baseFee > f ? s.ledger.baseFee : f), 0n);
  return { ledger: { ...snaps[0].ledger, baseFee: fee, seq: Math.max(...seqs) }, me: { ...low.me }, minSeq: Math.min(...seqs) };
}

export async function xrpSnapshot(address: string, read = async (h: string) => ({ ledger: await xrpLedger([h]), me: await xrpAccount(address, "current", [h]) })): Promise<XrpSnapshot> {
  const got = await Promise.allSettled(XRP_RPCS.map((h) => read(h)));
  const ok = got.flatMap((g) => (g.status === "fulfilled" ? [g.value] : []));
  if (!ok.length) throw (got[0] as PromiseRejectedResult).reason;
  return agreeSnapshots(ok);
}

export interface XrpQuote {
  from: string; to: string; tag: number | null; amount: bigint; fee: bigint;
   sequence: number; lastLedger: number;

  newAccount: boolean;
  reserveBase: bigint; reserve: bigint; balance: bigint;

  spendable: bigint;

  x: boolean;
}

export async function recipientInfo(address: string, read = (h: string) => xrpAccount(address, "validated", [h])): Promise<XrpAccountInfo> {
  const got = await Promise.allSettled(XRP_RPCS.map((h) => read(h)));
  const ok = got.flatMap((g) => (g.status === "fulfilled" ? [g.value] : []));
  if (!ok.length) throw (got[0] as PromiseRejectedResult).reason;
  const sig = (a: XrpAccountInfo) => [a.exists, a.requireTag, a.disallowXrp, a.depositAuth].join(",");
  if (ok.length === 2 && sig(ok[0]) !== sig(ok[1])) throw new Error("ERR_HOSTS");

  return ok.reduce((a, b) => ({ ...a, requireTag: a.requireTag || b.requireTag, disallowXrp: a.disallowXrp || b.disallowXrp, depositAuth: a.depositAuth || b.depositAuth }));
}

export function feeFrom(res: unknown, ledger: Pick<XrpLedger, "baseFee">): bigint {
  const d = (res as { drops?: Record<string, unknown> })?.drops;
  const open = dropsOf(d?.open_ledger_fee), base = dropsOf(d?.base_fee), min = dropsOf(d?.minimum_fee);
  if (open == null) throw new Error("ERR_XRPL");
  let f = ledger.baseFee;
  for (const v of [open, base, min]) if (v != null && v > f) f = v;
  if (f > MAX_XRP_FEE) throw new Error("ERR_FEE_HIGH");
  return f;
}
const err = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(code), extra);

export function checkXrpPayment(o: { from: string; to: string; tag: number | null; amount: bigint; fee: bigint; me: XrpAccountInfo; dest: XrpAccountInfo; ledger: XrpLedger; depositOk?: boolean }): { reserve: bigint; spendable: bigint } {
  if (o.to === o.from) throw err("ERR_SELF");
  if (o.amount <= 0n) throw err("ERR_ZERO");
  if (!o.me.exists) throw err("ERR_XRP_INACTIVE", { need: o.ledger.reserveBase });
  if (!o.dest.exists && o.amount < o.ledger.reserveBase) throw err("ERR_XRP_ACTIVATE", { need: o.ledger.reserveBase });
  if (o.dest.exists && o.dest.requireTag && o.tag == null) throw err("ERR_TAG_REQUIRED");
  if (o.dest.exists && o.dest.disallowXrp) throw err("ERR_XRP_DISALLOWED");
  if (o.dest.exists && o.dest.depositAuth && o.depositOk !== true) throw err("ERR_DEPOSIT_AUTH");
  return fundsLeft(o);
}
function fundsLeft(o: { amount: bigint; fee: bigint; me: XrpAccountInfo; ledger: Pick<XrpLedger, "reserveBase" | "reserveInc"> }): { reserve: bigint; spendable: bigint } {
  const reserve = reserveOf(o.ledger, o.me.ownerCount);
  const spendable = o.me.balance - reserve - o.fee;
  if (o.amount > spendable) throw err("ERR_FUNDS", { max: spendable > 0n ? spendable : 0n, reserve });
  return { reserve, spendable };
}

export async function quoteXrpSend(phrase: string, index: number, toInput: string, tagText: string, amountText: string): Promise<XrpQuote> {
  const { publicKey } = xrpKeys(phrase, index);
  const from = xrpAddressOfKey(publicKey);
  const r = xrpRecipient(toInput, tagText);
  const amount = parseXrp(amountText);
  if (amount <= 0n) throw err("ERR_ZERO");
  if (r.address === from) throw err("ERR_SELF");
  const snap = await xrpSnapshot(from);
  const dest = await recipientInfo(r.address);
  let depositOk: boolean | undefined;
  if (dest.exists && dest.depositAuth) {
    const d = await xrpRpc<{ deposit_authorized?: boolean; source_account?: string; destination_account?: string }>("deposit_authorized", { source_account: from, destination_account: r.address, ledger_index: "validated" });
    depositOk = d.source_account === from && d.destination_account === r.address && d.deposit_authorized === true;
  }
  const fee = feeFrom(await xrpRpc("fee", {}), snap.ledger);
  const c = checkXrpPayment({ from, to: r.address, tag: r.tag, amount, fee, me: snap.me, dest, ledger: snap.ledger, depositOk });
  return { from, to: r.address, tag: r.tag, amount, fee, sequence: snap.me.sequence, lastLedger: snap.ledger.seq + XRP_LEDGER_WINDOW, newAccount: !dest.exists,
    reserveBase: snap.ledger.reserveBase, reserve: c.reserve, balance: snap.me.balance, spendable: c.spendable, x: r.x };
}

export async function xrpSpendable(phrase: string, index: number): Promise<bigint> {
  const from = xrpAddressOfKey(xrpKeys(phrase, index).publicKey);
  const snap = await xrpSnapshot(from);
  if (!snap.me.exists) return 0n;
  const fee = feeFrom(await xrpRpc("fee", {}), snap.ledger);
  const left = snap.me.balance - reserveOf(snap.ledger, snap.me.ownerCount) - fee;
  return left > 0n ? left : 0n;
}

export interface XrpSigned {
  from: string; to: string; tag: number | null; amount: bigint; fee: bigint; sequence: number; lastLedger: number;
   minLedger: number;
  hash: string; blob: string;
}
export const paymentOf = (q: Pick<XrpQuote, "from" | "to" | "amount" | "fee" | "sequence" | "lastLedger" | "tag">, signingPubKey: Uint8Array): XrpPayment => ({
  account: q.from, destination: q.to, amount: q.amount, fee: q.fee, sequence: q.sequence, lastLedger: q.lastLedger, tag: q.tag, flags: TF_FULLY_CANONICAL_SIG, signingPubKey,
});

export async function signXrpSend(phrase: string, index: number, q: XrpQuote, snapshot: (a: string) => Promise<XrpSnapshot> = xrpSnapshot): Promise<XrpSigned> {
  const k = xrpKeys(phrase, index);
  if (xrpAddressOfKey(k.publicKey) !== q.from) throw err("ERR_UNSAFE");
  if (q.fee > MAX_XRP_FEE || q.amount <= 0n) throw err("ERR_UNSAFE");
  const s = await snapshot(q.from);
  if (!s.me.exists) throw err("ERR_XRP_INACTIVE", { need: s.ledger.reserveBase });
  fundsLeft({ amount: q.amount, fee: q.fee, me: s.me, ledger: s.ledger });
  const fresh = { ...q, sequence: s.me.sequence, lastLedger: s.ledger.seq + XRP_LEDGER_WINDOW };
  const signed = signPayment(paymentOf(fresh, k.publicKey), k.privateKey);
  return { from: q.from, to: q.to, tag: q.tag, amount: q.amount, fee: q.fee, sequence: fresh.sequence, lastLedger: fresh.lastLedger, minLedger: s.minSeq, hash: signed.hash, blob: signed.blob };
}

export type XrpSubmit = "accepted" | "unknown" | "refused";

export type SubmitAnswer = { code: string } | { error: string };

export function submitVerdict(answers: SubmitAnswer[], found = false): XrpSubmit {
  if (found) return "accepted";
  const codes = answers.flatMap((a) => ("code" in a ? [a.code] : []));
  if (codes.some((c) => c === "tesSUCCESS" || c === "terQUEUED" || c === "tefALREADY" || /^tec/.test(c))) return "accepted";

  const definite = (c: string) => /^tem/.test(c) || c === "tefMAX_LEDGER" || c === "rpc:invalidTransaction";
  if (answers.length > 0 && codes.length === answers.length && codes.every(definite)) return "refused";
  return "unknown";
}

export async function submitOne(h: string, s: XrpSigned): Promise<SubmitAnswer> {
  try {
    const r = await xrpRpc<{ engine_result?: string; tx_json?: { hash?: string } }>("submit", { tx_blob: s.blob }, { hosts: [h], timeoutMs: 20_000 });
    if (r.tx_json?.hash && String(r.tx_json.hash).toUpperCase() !== s.hash) return { error: "other hash" };
    return { code: String(r.engine_result ?? "") };
  } catch (e) { return e instanceof XrplError ? { code: `rpc:${e.code}` } : { error: String((e as Error)?.message ?? e) }; }
}

export async function submitXrp(s: XrpSigned, o: { submit?: (h: string, s: XrpSigned) => Promise<SubmitAnswer>; look?: (h: string, s: XrpSigned) => Promise<XrpLook> } = {}): Promise<{ state: XrpSubmit; code: string | null }> {
  const send = o.submit ?? submitOne, look = o.look ?? lookupXrp;
  const answers = await Promise.all(XRP_RPCS.map((h) => send(h, s).catch((e): SubmitAnswer => ({ error: String((e as Error)?.message ?? e) }))));
  let state = submitVerdict(answers);
  if (state === "unknown") {
    const looks = await Promise.all(XRP_RPCS.map((h) => look(h, s).catch((): XrpLook => ({ kind: "error" }))));
    if (looks.some((l) => l.kind === "found")) state = "accepted";
  }
  return { state, code: answers.flatMap((a) => ("code" in a && a.code ? [a.code] : []))[0] ?? null };
}

type TxAnswer = { validated?: boolean; hash?: string; Account?: string; Destination?: string; Amount?: unknown; Fee?: string; Sequence?: number; DestinationTag?: number; TransactionType?: string; meta?: { TransactionResult?: string; delivered_amount?: unknown }; tx_json?: Record<string, unknown> };

export function readTxAnswer(a: TxAnswer, q: Pick<XrpQuote, "from" | "to" | "amount" | "fee" | "sequence" | "tag">, hash: string): { validated: boolean; result: string; delivered: bigint | null } {
  const t = (a.tx_json ?? a) as TxAnswer;
  const h = String(a.hash ?? t.hash ?? "").toUpperCase();
  if (h !== hash.toUpperCase()) throw err("ERR_UNSAFE");
  if (t.TransactionType !== "Payment" || t.Account !== q.from || t.Destination !== q.to || dropsOf(t.Fee) !== q.fee || t.Sequence !== q.sequence) throw err("ERR_UNSAFE");
  if ((t.DestinationTag ?? null) !== q.tag) throw err("ERR_UNSAFE");
  const amt = dropsOf((t as { DeliverMax?: unknown }).DeliverMax ?? t.Amount);
  if (amt !== q.amount) throw err("ERR_UNSAFE");
  return { validated: a.validated === true, result: String(a.meta?.TransactionResult ?? ""), delivered: dropsOf(a.meta?.delivered_amount) };
}

export type XrpLook = { kind: "found"; validated: boolean; result: string; delivered: bigint | null } | { kind: "missing"; searchedAll: boolean } | { kind: "error" };
export async function lookupXrp(host: string, s: XrpSigned): Promise<XrpLook> {
  try {
    const a = await xrpRpc<TxAnswer>("tx", { transaction: s.hash, binary: false, min_ledger: s.minLedger, max_ledger: s.lastLedger }, { hosts: [host] });
    return { kind: "found", ...readTxAnswer(a, s, s.hash) };
  } catch (e) {
    if (e instanceof XrplError && e.code === "txnNotFound") return { kind: "missing", searchedAll: e.result.searched_all === true };
    return { kind: "error" };
  }
}
export type XrpEnd = { state: "ok" } | { state: "failed"; code: string } | { state: "dropped" } | { state: "check"; code: string | null } | { state: "pending" };

export function judgeXrp(looks: XrpLook[], amount: bigint): XrpEnd | null {
  if (looks.length < 2) return null;
  const [a, b] = looks;
  if (a.kind === "found" && b.kind === "found" && a.validated && b.validated) {
    if (a.result !== b.result) return { state: "check", code: a.result };
    if (a.result !== "tesSUCCESS") return { state: "failed", code: a.result };
    if ((a.delivered != null && a.delivered !== amount) || (b.delivered != null && b.delivered !== amount)) return { state: "check", code: a.result };
    return { state: "ok" };
  }
  if (a.kind === "missing" && b.kind === "missing" && a.searchedAll && b.searchedAll) return { state: "dropped" };
  return null;
}

export async function waitXrp(s: XrpSigned, o: { maxMs?: number; everyMs?: number; look?: (h: string, s: XrpSigned) => Promise<XrpLook> } = {}): Promise<XrpEnd> {
  const until = Date.now() + (o.maxMs ?? 60_000), every = o.everyMs ?? 4_000, look = o.look ?? lookupXrp;
  let seen: string | null = null;
  for (;;) {
    const looks = await Promise.all(XRP_RPCS.map((h) => look(h, s).catch((): XrpLook => ({ kind: "error" }))));
    const end = judgeXrp(looks, s.amount);
    if (end) return end;
    for (const l of looks) if (l.kind === "found" && l.validated) seen ??= l.result;
    if (Date.now() + every > until) return seen != null ? { state: "check", code: seen } : { state: "pending" };
    await new Promise((r) => setTimeout(r, every));
  }
}

export const xrpPendingOf = (s: XrpSigned) => ({
  networkId: "xrp", from: s.from, hash: s.hash, at: Date.now(),
  data: { to: s.to, tag: s.tag, amount: s.amount.toString(), fee: s.fee.toString(), sequence: s.sequence, lastLedger: s.lastLedger, minLedger: s.minLedger, blob: s.blob },
});

export function xrpSignedOf(p: { from: string; hash: string; data: Record<string, string | number | null> } | null): XrpSigned | null {
  if (!p) return null;
  const d = p.data;
  try {
    const s: XrpSigned = { from: p.from, to: String(d.to), tag: d.tag == null ? null : Number(d.tag), amount: BigInt(String(d.amount)), fee: BigInt(String(d.fee)),
      sequence: Number(d.sequence), lastLedger: Number(d.lastLedger), minLedger: Number(d.minLedger), hash: String(p.hash), blob: String(d.blob) };
    if (!/^[0-9A-F]{64}$/.test(s.hash) || !/^[0-9A-F]+$/.test(s.blob) || txHashOf(bytesOf(s.blob)) !== s.hash || !Number.isSafeInteger(s.lastLedger) || !Number.isSafeInteger(s.minLedger)) return null;
    return s;
  } catch { return null; }
}

export const formatDrops = formatXrp;
export const hexOf = (b: Uint8Array) => bytesToHex(b);
export const bytesOf = (h: string) => hexToBytes(h);
