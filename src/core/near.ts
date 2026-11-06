import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { base58, base64 } from "@scure/base";
import {
  isNearAddress, isNearEthImplicit, isNearImplicit, nearAccount, NearError, nearImplicitOf, nearKeyString, nearPublicKey, nearReserveOf, nearRpc,
  nearSecret, NEAR, NEAR_RPCS, parseNear, STORAGE_PER_BYTE, yoctoOf, type NearAccount,
} from "./nearbase";
export * from "./nearbase";

export const MAX_NEAR_FEE = 10n ** 22n;

export const NEAR_TRANSFER_GAS = 450_000_000_000n;

export const NEAR_NEW_IMPLICIT_GAS = 900_000_000_000n;

export const NEAR_FEE_FACTOR = 2n;

export const NEW_IMPLICIT_MIN = 182n * STORAGE_PER_BYTE;

export const NEAR_VALIDITY_BLOCKS = 86_400;

export const NEAR_LOOKUP_KEEP_MS = 48 * 3600_000;
const U64_MAX = (1n << 64n) - 1n, U128_MAX = (1n << 128n) - 1n;
const err = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(code), extra);

const u32 = (n: number) => { if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw err("ERR_UNSAFE"); return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; };
const uLE = (v: bigint, bytes: number, max: bigint) => { if (v < 0n || v > max) throw err("ERR_UNSAFE"); return Array.from({ length: bytes }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn)); };
const str = (s: string) => { const b = new TextEncoder().encode(s); return [...u32(b.length), ...b]; };

export interface NearTransfer { signerId: string; publicKey: Uint8Array; nonce: bigint; receiverId: string; blockHash: Uint8Array; deposit: bigint }

export function serializeTransfer(t: NearTransfer): Uint8Array {
  if (!isNearAddress(t.signerId) || !isNearAddress(t.receiverId) || t.signerId !== t.signerId.trim() || t.receiverId !== t.receiverId.trim()) throw err("ERR_UNSAFE");
  if (t.publicKey.length !== 32 || t.blockHash.length !== 32) throw err("ERR_UNSAFE");
  return Uint8Array.from([
    ...str(t.signerId),
    0, ...t.publicKey,
    ...uLE(t.nonce, 8, U64_MAX),
    ...str(t.receiverId),
    ...t.blockHash,
    ...u32(1),
    3, ...uLE(t.deposit, 16, U128_MAX),
  ]);
}
export const nearTxHash = (tx: Uint8Array) => base58.encode(sha256(tx));

export function signTransfer(t: NearTransfer, secret: Uint8Array): { signed: Uint8Array; signedBase64: string; hash: string; signature: Uint8Array } {
  const pub = nearPublicKey(secret);
  if (bytesToHex(pub) !== bytesToHex(t.publicKey) || nearImplicitOf(pub) !== t.signerId) throw err("ERR_UNSAFE");
  const tx = serializeTransfer(t), h = sha256(tx);
  const signature = ed25519.sign(h, secret);
  if (signature.length !== 64 || !ed25519.verify(signature, h, pub)) throw err("ERR_UNSAFE");
  const signed = Uint8Array.from([...tx, 0, ...signature]);
  return { signed, signedBase64: base64.encode(signed), hash: base58.encode(h), signature };
}

export interface NearKey { nonce: bigint; blockHash: Uint8Array; blockHeight: number; fullAccess: boolean }

export function readAccessKey(res: unknown): NearKey {
  const r = res as { nonce?: unknown; permission?: unknown; block_hash?: unknown; block_height?: unknown };
  const n = typeof r?.nonce === "number" && Number.isSafeInteger(r.nonce) && r.nonce >= 0 ? BigInt(r.nonce) : typeof r?.nonce === "string" && /^\d{1,20}$/.test(r.nonce) ? BigInt(r.nonce) : null;
  const h = Number(r?.block_height);
  let blockHash: Uint8Array;
  try { blockHash = base58.decode(String(r?.block_hash ?? "")); } catch { throw new Error("ERR_NEAR"); }
  if (n == null || n >= U64_MAX || blockHash.length !== 32 || !Number.isSafeInteger(h) || h <= 0) throw new Error("ERR_NEAR");
  return { nonce: n, blockHash, blockHeight: h, fullAccess: r.permission === "FullAccess" };
}

export async function nearAccessKey(account: string, pub: Uint8Array, hosts?: string[]): Promise<NearKey | null> {
  try { return readAccessKey(await nearRpc("query", { request_type: "view_access_key", finality: "final", account_id: account, public_key: nearKeyString(pub) }, { hosts })); }
  catch (e) { if (e instanceof NearError && (e.code === "UNKNOWN_ACCESS_KEY" || e.code === "UNKNOWN_ACCOUNT")) return null; throw e; }
}

export function nearFeeOf(res: unknown, newImplicit: boolean): bigint {
  const p = yoctoOf((res as { gas_price?: unknown })?.gas_price);
  if (p == null || p <= 0n) throw new Error("ERR_NEAR");
  const fee = NEAR_FEE_FACTOR * p * (newImplicit ? NEAR_NEW_IMPLICIT_GAS : NEAR_TRANSFER_GAS);
  if (fee > MAX_NEAR_FEE) throw err("ERR_FEE_HIGH", { fee });
  return fee;
}
export const nearGasPrice = () => nearRpc<{ gas_price?: unknown }>("gas_price", [null]);

export function nearRecipient(input: string): { id: string; implicit: boolean } {
  const v = String(input ?? "").trim();
  if (isNearEthImplicit(v.toLowerCase())) throw err("ERR_NEAR_ETH");
  if (isNearAddress(v)) return { id: v, implicit: isNearImplicit(v) };
  if (v !== v.toLowerCase() && isNearAddress(v.toLowerCase())) throw err("ERR_NEAR_CASE");
  throw err("ERR_ADDRESS");
}
export interface NearQuote {
  from: string; to: string; amount: bigint; fee: bigint;
   newAccount: boolean;
  implicit: boolean; balance: bigint; reserve: bigint;
   spendable: bigint;
}

export function checkNearTransfer(o: { from: string; to: string; implicit: boolean; amount: bigint; fee: bigint; me: NearAccount; dest: NearAccount }): { reserve: bigint; spendable: bigint } {
  if (o.to === o.from) throw err("ERR_SELF");
  if (o.amount <= 0n) throw err("ERR_ZERO");
  if (o.fee > MAX_NEAR_FEE) throw err("ERR_FEE_HIGH", { fee: o.fee });
  if (!o.me.exists) throw err("ERR_NEAR_INACTIVE", { need: NEW_IMPLICIT_MIN });
  if (!o.dest.exists && !o.implicit) throw err("ERR_NO_ACCOUNT");
  if (!o.dest.exists && o.amount < NEW_IMPLICIT_MIN) throw err("ERR_NEAR_MIN", { need: NEW_IMPLICIT_MIN });
  return nearFundsLeft(o);
}
function nearFundsLeft(o: { amount: bigint; fee: bigint; me: NearAccount }): { reserve: bigint; spendable: bigint } {
  const reserve = nearReserveOf(o.me);
  const spendable = o.me.amount - reserve - o.fee;
  if (o.amount > spendable) throw err("ERR_FUNDS", { max: spendable > 0n ? spendable : 0n, reserve });
  return { reserve, spendable };
}

export async function quoteNearSend(phrase: string, index: number, toInput: string, amountText: string): Promise<NearQuote> {
  const pub = nearPublicKey(nearSecret(phrase, index));
  const from = nearImplicitOf(pub);
  const r = nearRecipient(toInput);
  const amount = parseNear(amountText);
  if (amount <= 0n) throw err("ERR_ZERO");
  if (r.id === from) throw err("ERR_SELF");
  const me = await nearAccount(from);
  const dest = await nearAccount(r.id);
  const fee = nearFeeOf(await nearGasPrice(), !dest.exists);
  const c = checkNearTransfer({ from, to: r.id, implicit: r.implicit, amount, fee, me, dest });

  const key = await nearAccessKey(from, pub);
  if (!key || !key.fullAccess) throw err("ERR_NEAR_KEY");
  return { from, to: r.id, amount, fee, newAccount: !dest.exists, implicit: r.implicit, balance: me.amount, reserve: c.reserve, spendable: c.spendable };
}

export async function nearSpendable(phrase: string, index: number): Promise<bigint> {
  const from = nearImplicitOf(nearPublicKey(nearSecret(phrase, index)));
  const me = await nearAccount(from);
  if (!me.exists) return 0n;
  const left = me.amount - nearReserveOf(me) - nearFeeOf(await nearGasPrice(), true);
  return left > 0n ? left : 0n;
}

export interface NearSigned {
  from: string; to: string; amount: bigint; fee: bigint; nonce: bigint;
   blockHeight: number;
  blockHash: string; publicKey: string; hash: string; signed: string;
}

export async function signNearSend(phrase: string, index: number, q: NearQuote,
  o: { account?: (id: string) => Promise<NearAccount>; key?: (id: string, pub: Uint8Array) => Promise<NearKey | null> } = {}): Promise<NearSigned> {
  const secret = nearSecret(phrase, index), pub = nearPublicKey(secret);
  if (nearImplicitOf(pub) !== q.from) throw err("ERR_UNSAFE");
  if (q.fee > MAX_NEAR_FEE || q.amount <= 0n || q.to === q.from || !isNearAddress(q.to)) throw err("ERR_UNSAFE");
  const me = await (o.account ?? nearAccount)(q.from);
  if (!me.exists) throw err("ERR_NEAR_INACTIVE", { need: NEW_IMPLICIT_MIN });
  nearFundsLeft({ amount: q.amount, fee: q.fee, me });
  const key = await (o.key ?? nearAccessKey)(q.from, pub);
  if (!key || !key.fullAccess) throw err("ERR_NEAR_KEY");
  const t: NearTransfer = { signerId: q.from, publicKey: pub, nonce: key.nonce + 1n, receiverId: q.to, blockHash: key.blockHash, deposit: q.amount };
  const s = signTransfer(t, secret);
  return { from: q.from, to: q.to, amount: q.amount, fee: q.fee, nonce: t.nonce, blockHeight: key.blockHeight, blockHash: base58.encode(key.blockHash), publicKey: nearKeyString(pub), hash: s.hash, signed: s.signedBase64 };
}

export type NearEnd = { state: "ok" } | { state: "failed"; code: string } | { state: "dropped" } | { state: "pending" };
type TxView = { status?: Record<string, unknown> | string; transaction?: { hash?: unknown; signer_id?: unknown; receiver_id?: unknown; nonce?: unknown; actions?: unknown } };

function failureKind(f: unknown): string {
  const a = (f as { ActionError?: { kind?: unknown } })?.ActionError?.kind;
  if (a && typeof a === "object") return Object.keys(a)[0] ?? "ActionError";
  if (typeof a === "string") return a;
  const i = (f as { InvalidTxError?: unknown })?.InvalidTxError;
  if (i && typeof i === "object") return Object.keys(i)[0] ?? "InvalidTxError";
  if (typeof i === "string") return i;
  return f && typeof f === "object" ? Object.keys(f)[0] ?? "Failure" : "Failure";
}

export function readNearOutcome(res: unknown, s: Pick<NearSigned, "hash" | "from" | "to" | "amount" | "nonce">): NearEnd {
  const r = res as TxView & { final_execution_status?: unknown };
  const t = r?.transaction;

  if (!t && typeof r?.final_execution_status === "string" && r.status == null) return { state: "pending" };
  if (!t || t.hash !== s.hash || t.signer_id !== s.from || t.receiver_id !== s.to) throw err("ERR_UNSAFE");
  const nonce = typeof t.nonce === "number" && Number.isSafeInteger(t.nonce) ? BigInt(t.nonce) : typeof t.nonce === "string" && /^\d{1,20}$/.test(t.nonce) ? BigInt(t.nonce) : null;
  if (nonce !== s.nonce) throw err("ERR_UNSAFE");
  const acts = t.actions as { Transfer?: { deposit?: unknown } }[] | undefined;
  if (!Array.isArray(acts) || acts.length !== 1 || yoctoOf(acts[0]?.Transfer?.deposit) !== s.amount) throw err("ERR_UNSAFE");
  const st = r.status;
  if (st && typeof st === "object") {
    if ("SuccessValue" in st) return { state: "ok" };
    if ("Failure" in st) return { state: "failed", code: failureKind(st.Failure) };
  }
  return { state: "pending" };
}

export type NearAnswer = { kind: "outcome"; end: NearEnd } | { kind: "refused"; code: string } | { kind: "unclear"; why: string };

export function invalidTxKind(data: unknown): string {
  const d = data as { TxExecutionError?: { InvalidTxError?: unknown }; InvalidTxError?: unknown } | null;
  const i = d?.TxExecutionError?.InvalidTxError ?? d?.InvalidTxError ?? d;
  if (i && typeof i === "object") return Object.keys(i)[0] ?? "InvalidTransaction";
  return typeof i === "string" ? i : "InvalidTransaction";
}

export function submitErrorOf(e: unknown): NearAnswer {
  if (e instanceof NearError && e.code === "INVALID_TRANSACTION") {
    const k = invalidTxKind(e.data);

    return /Nonce/i.test(k) ? { kind: "unclear", why: k } : { kind: "refused", code: k };
  }
  return { kind: "unclear", why: String((e as Error)?.message ?? e) };
}

export async function submitOne(host: string, s: NearSigned): Promise<NearAnswer> {
  const opt = { hosts: [host], timeoutMs: 30_000 };
  try {
    let res: unknown;
    try { res = await nearRpc("send_tx", { signed_tx_base64: s.signed, wait_until: "EXECUTED_OPTIMISTIC" }, opt); }
    catch (e) { if (e instanceof NearError && e.code === "METHOD_NOT_FOUND") res = await nearRpc("broadcast_tx_commit", [s.signed], opt); else throw e; }
    const end = readNearOutcome(res, s);
    return end.state === "pending" ? { kind: "unclear", why: "pending" } : { kind: "outcome", end };
  } catch (e) { return submitErrorOf(e); }
}

export type NearLook = { kind: "found"; end: NearEnd } | { kind: "missing" } | { kind: "error" };
export async function lookupNear(host: string, s: NearSigned): Promise<NearLook> {

  const p = { tx_hash: s.hash, sender_account_id: s.from, wait_until: "NONE" }, opt = { hosts: [host], timeoutMs: 15_000 };
  try {
    let res: unknown;
    try { res = await nearRpc("tx", p, opt); }
    catch (e) { if (e instanceof NearError && e.code === "METHOD_NOT_FOUND") res = await nearRpc("EXPERIMENTAL_tx_status", p, opt); else throw e; }
    return { kind: "found", end: readNearOutcome(res, s) };
  } catch (e) {
    if (e instanceof NearError && e.code === "UNKNOWN_TRANSACTION") return { kind: "missing" };
    return { kind: "error" };
  }
}
export type NearSubmit = { state: "ok" } | { state: "failed"; code: string } | { state: "refused"; code: string } | { state: "unknown" };

export async function submitNear(s: NearSigned, o: { submit?: (h: string, s: NearSigned) => Promise<NearAnswer>; look?: (h: string, s: NearSigned) => Promise<NearLook> } = {}): Promise<NearSubmit> {
  const send = o.submit ?? submitOne, look = o.look ?? lookupNear;
  let unclear = false;
  for (const h of NEAR_RPCS) {
    const a = await send(h, s).catch((e): NearAnswer => ({ kind: "unclear", why: String((e as Error)?.message ?? e) }));
    if (a.kind === "outcome") return a.end.state === "ok" ? { state: "ok" } : a.end.state === "failed" ? a.end : { state: "unknown" };
    if (a.kind === "refused") {
      if (!unclear) return { state: "refused", code: a.code };
      break;
    }
    unclear = true;
  }
  const looks = await Promise.all(NEAR_RPCS.map((h) => look(h, s).catch((): NearLook => ({ kind: "error" }))));
  const fin = looks.find((l): l is { kind: "found"; end: NearEnd } => l.kind === "found" && l.end.state !== "pending");
  if (fin) return fin.end.state === "ok" ? { state: "ok" } : fin.end.state === "failed" ? fin.end : { state: "unknown" };
  return { state: "unknown" };
}

export function judgeNear(looks: NearLook[], s: Pick<NearSigned, "nonce" | "blockHeight">, key: Pick<NearKey, "nonce" | "blockHeight"> | null, signedAt: number, now = Date.now()): NearEnd | null {
  const fin = looks.find((l): l is { kind: "found"; end: NearEnd } => l.kind === "found" && l.end.state !== "pending");
  if (fin) return fin.end;
  const missing = looks.filter((l) => l.kind === "missing").length;
  if (missing < 2 || looks.some((l) => l.kind === "found") || now - signedAt > NEAR_LOOKUP_KEEP_MS || !key) return null;
  if (key.nonce >= s.nonce || key.blockHeight > s.blockHeight + NEAR_VALIDITY_BLOCKS) return { state: "dropped" };
  return null;
}

export async function waitNear(s: NearSigned, signedAt: number, o: { maxMs?: number; everyMs?: number; look?: (h: string, s: NearSigned) => Promise<NearLook>; key?: (s: NearSigned) => Promise<Pick<NearKey, "nonce" | "blockHeight"> | null> } = {}): Promise<NearEnd> {
  const until = Date.now() + (o.maxMs ?? 30_000), every = o.everyMs ?? 3_000, look = o.look ?? lookupNear;
  const readKey = o.key ?? ((x: NearSigned) => nearAccessKey(x.from, base58.decode(x.publicKey.replace(/^ed25519:/, ""))));
  for (;;) {
    const key = await readKey(s).catch(() => null);
    const looks = await Promise.all(NEAR_RPCS.map((h) => look(h, s).catch((): NearLook => ({ kind: "error" }))));
    const end = judgeNear(looks, s, key, signedAt);
    if (end) return end;
    if (Date.now() + every > until) return { state: "pending" };
    await new Promise((r) => setTimeout(r, every));
  }
}

export const nearPendingOf = (s: NearSigned) => ({
  networkId: NEAR.id, from: s.from, hash: s.hash, at: Date.now(),
  data: { to: s.to, amount: s.amount.toString(), fee: s.fee.toString(), nonce: s.nonce.toString(), blockHeight: s.blockHeight, blockHash: s.blockHash, publicKey: s.publicKey, signed: s.signed },
});

export function nearSignedOf(p: { from: string; hash: string; data: Record<string, string | number | null> } | null): NearSigned | null {
  if (!p) return null;
  const d = p.data;
  try {
    const s: NearSigned = { from: String(p.from), to: String(d.to), amount: BigInt(String(d.amount)), fee: BigInt(String(d.fee)), nonce: BigInt(String(d.nonce)),
      blockHeight: Number(d.blockHeight), blockHash: String(d.blockHash), publicKey: String(d.publicKey), hash: String(p.hash), signed: String(d.signed) };
    if (!Number.isSafeInteger(s.blockHeight) || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.publicKey)) return null;
    const pub = base58.decode(s.publicKey.slice(8));
    const tx = serializeTransfer({ signerId: s.from, publicKey: pub, nonce: s.nonce, receiverId: s.to, blockHash: base58.decode(s.blockHash), deposit: s.amount });
    const signed = base64.decode(s.signed);
    if (signed.length !== tx.length + 65 || bytesToHex(signed.slice(0, tx.length)) !== bytesToHex(tx) || signed[tx.length] !== 0) return null;
    const h = sha256(tx);
    if (base58.encode(h) !== s.hash || !ed25519.verify(signed.slice(tx.length + 1), h, pub)) return null;
    return s;
  } catch { return null; }
}
