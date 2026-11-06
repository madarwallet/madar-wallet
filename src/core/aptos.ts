import { ed25519 } from "@noble/curves/ed25519.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  APT, aptAccount, aptAddress, aptAddressOf, aptBalance, AptError, aptFetch, APT_NODES, aptPublicKey, aptSecret, aptTxUrl, formatApt, isAptAddress, OCTA_MAX, parseApt,
} from "./aptosbase";
import type { PendingPayment } from "./store";
import { bigOf, concat, kitErr, leU, sameBytes, uleb, type KitEnd, type KitSubmit, type SendKit } from "./sendkit";
export * from "./aptosbase";

export const MAX_APT_FEE = 5_000_000n;
export const APT_EXPIRY_SECS = 600;
export const APT_CHAIN_ID = 1;
const U64_MAX = (1n << 64n) - 1n;
const enc = (s: string) => new TextEncoder().encode(s);
const str = (s: string) => { const b = enc(s); return [...uleb(b.length), ...b]; };
const addr32 = (a: string) => { if (!isAptAddress(a)) throw kitErr("ERR_UNSAFE"); return hexToBytes(a.slice(2)); };

export interface AptTransfer { sender: string; sequence: bigint; to: string; amount: bigint; maxGas: bigint; price: bigint; expiry: bigint }

export function serializeAptTransfer(t: AptTransfer): Uint8Array {
  if (t.amount <= 0n || t.amount > OCTA_MAX || t.maxGas <= 0n || t.price <= 0n || t.expiry <= 0n || t.sequence < 0n || t.sequence >= U64_MAX) throw kitErr("ERR_UNSAFE");
  return concat(
    addr32(t.sender), leU(t.sequence, 8),
    [2], new Uint8Array(31), [1], str("aptos_account"), str("transfer"),
    uleb(0), uleb(2), [...uleb(32), ...addr32(t.to)], [...uleb(8), ...leU(t.amount, 8)],
    leU(t.maxGas, 8), leU(t.price, 8), leU(t.expiry, 8), [APT_CHAIN_ID],
  );
}
const PREFIX_RAW = sha3_256(enc("APTOS::RawTransaction")), PREFIX_TX = sha3_256(enc("APTOS::Transaction"));
export const aptSigningMessage = (raw: Uint8Array) => concat(PREFIX_RAW, raw);
export const aptSignedBytes = (raw: Uint8Array, pub: Uint8Array, sig: Uint8Array) => concat(raw, [0], uleb(32), pub, uleb(64), sig);
export const aptTxHash = (signed: Uint8Array) => "0x" + bytesToHex(sha3_256(concat(PREFIX_TX, [0], signed)));

export function signAptRaw(raw: Uint8Array, sender: string, secret: Uint8Array): { signed: Uint8Array; hash: string } {
  const pub = aptPublicKey(secret);
  if (aptAddressOf(pub) !== sender) throw kitErr("ERR_UNSAFE");
  const msg = aptSigningMessage(raw), sig = ed25519.sign(msg, secret);
  if (sig.length !== 64 || !ed25519.verify(sig, msg, pub)) throw kitErr("ERR_UNSAFE");
  const signed = aptSignedBytes(raw, pub, sig);
  return { signed, hash: aptTxHash(signed) };
}

const BCS = { "Content-Type": "application/x.aptos.signed_transaction+bcs" };
type Sim = { success?: unknown; vm_status?: unknown; gas_used?: unknown; gas_unit_price?: unknown };

export function aptGasOf(res: unknown): { maxGas: bigint; price: bigint; fee: bigint } {
  const s = (Array.isArray(res) ? res[0] : null) as Sim | null;
  const used = bigOf(s?.gas_used, U64_MAX), price = bigOf(s?.gas_unit_price, 1_000_000n);
  if (!s || used == null || price == null || price <= 0n) throw kitErr("ERR_PROVIDER");
  if (s.success !== true) throw kitErr("ERR_KIT_SIM", { code: String(s.vm_status ?? "").slice(0, 120) });
  const g = used + used / 2n, maxGas = g < 20n ? 20n : g, fee = maxGas * price;
  if (fee > MAX_APT_FEE) throw kitErr("ERR_FEE_HIGH", { fee });
  return { maxGas, price, fee };
}
async function gasPrice(): Promise<bigint> {
  const p = bigOf((await aptFetch<{ gas_estimate?: unknown }>("/estimate_gas_price"))?.gas_estimate, 10_000n);
  if (p == null || p <= 0n) throw kitErr("ERR_PROVIDER");
  return p;
}
async function simulate(from: string, pub: Uint8Array, seq: bigint, to: string, amount: bigint, room: bigint) {

  const price = await gasPrice();
  const ceil = (room < MAX_APT_FEE ? room : MAX_APT_FEE) / price;
  if (ceil < 20n) throw kitErr("ERR_FUNDS", { max: 0n });
  const raw = serializeAptTransfer({ sender: from, sequence: seq, to, amount, maxGas: ceil, price, expiry: BigInt(Math.floor(Date.now() / 1000) + APT_EXPIRY_SECS) });
  const body = aptSignedBytes(raw, pub, new Uint8Array(64));
  return aptGasOf(await aptFetch("/transactions/simulate", { method: "POST", headers: BCS, body }));
}

export interface AptQuote { from: string; to: string; amount: bigint; fee: bigint; maxGas: bigint; price: bigint; newAccount: boolean }
export function aptRecipient(input: string): string {
  const v = String(input ?? "").trim().toLowerCase();
  if (!isAptAddress(v)) throw kitErr("ERR_ADDRESS");
  return v;
}

export function checkAptFunds(amount: bigint, fee: bigint, balance: bigint): void {
  if (amount <= 0n) throw kitErr("ERR_ZERO");
  if (amount + fee > balance) { const max = balance - fee; throw kitErr("ERR_FUNDS", { max: max > 0n ? max : 0n }); }
}
async function myAccount(phrase: string, index: number) {
  const secret = aptSecret(phrase, index), pub = aptPublicKey(secret), from = aptAddressOf(pub);
  const acct = await aptAccount(from);
  if (acct.authKey !== from) throw kitErr("ERR_KIT_KEY");
  return { secret, pub, from, acct };
}
export async function quoteAptSend(phrase: string, index: number, toInput: string, amountText: string): Promise<AptQuote> {
  const to = aptRecipient(toInput), amount = parseApt(amountText);
  if (amount <= 0n) throw kitErr("ERR_ZERO");
  const { pub, from, acct } = await myAccount(phrase, index);
  if (to === from) throw kitErr("ERR_SELF");
  const bal = await aptBalance(from);
  if (bal === 0n) throw kitErr("ERR_KIT_INACTIVE");
  if (amount >= bal) throw kitErr("ERR_FUNDS", { max: bal > MAX_APT_FEE ? bal - MAX_APT_FEE : 0n });
  const g = await simulate(from, pub, acct.sequence, to, amount, bal - amount);
  checkAptFunds(amount, g.fee, bal);
  return { from, to, amount, fee: g.fee, maxGas: g.maxGas, price: g.price, newAccount: false };
}
export async function aptSpendable(phrase: string, index: number): Promise<bigint> {
  const { pub, from, acct } = await myAccount(phrase, index);
  const bal = await aptBalance(from);
  if (bal <= MAX_APT_FEE / 100n) return 0n;
  const g = await simulate(from, pub, acct.sequence, "0x" + "5".repeat(64), 1n, bal - 1n);
  return bal > g.fee ? bal - g.fee : 0n;
}

export interface AptSigned { from: string; to: string; amount: bigint; fee: bigint; hash: string; signed: string; sequence: string; expiry: number }
export async function signAptSend(phrase: string, index: number, q: AptQuote): Promise<AptSigned> {
  const { secret, from, acct } = await myAccount(phrase, index);
  if (from !== q.from || q.fee > MAX_APT_FEE || q.fee !== q.maxGas * q.price || q.amount <= 0n || q.to === q.from || !isAptAddress(q.to)) throw kitErr("ERR_UNSAFE");
  checkAptFunds(q.amount, q.fee, await aptBalance(from));
  const expiry = Math.floor(Date.now() / 1000) + APT_EXPIRY_SECS;
  const raw = serializeAptTransfer({ sender: from, sequence: acct.sequence, to: q.to, amount: q.amount, maxGas: q.maxGas, price: q.price, expiry: BigInt(expiry) });
  const s = signAptRaw(raw, from, secret);
  return { from, to: q.to, amount: q.amount, fee: q.fee, hash: s.hash, signed: bytesToHex(s.signed), sequence: acct.sequence.toString(), expiry };
}

type TxView = { type?: unknown; hash?: unknown; sender?: unknown; success?: unknown; vm_status?: unknown; sequence_number?: unknown };

export function readAptOutcome(res: unknown, s: Pick<AptSigned, "hash" | "from" | "sequence">): KitEnd {
  const t = res as TxView;
  if (t?.hash !== s.hash || t.sender !== s.from || String(t.sequence_number) !== s.sequence) throw kitErr("ERR_UNSAFE");
  if (t.type === "pending_transaction") return { state: "pending" };
  if (t.type !== "user_transaction") throw kitErr("ERR_UNSAFE");
  return t.success === true ? { state: "ok" } : { state: "failed", code: String(t.vm_status ?? "FAILED").slice(0, 120) };
}
type Look = { kind: "found"; end: KitEnd } | { kind: "missing" } | { kind: "error" };
async function look(host: string, s: AptSigned): Promise<Look> {
  try { return { kind: "found", end: readAptOutcome(await aptFetch(`/transactions/by_hash/${s.hash}`, {}, { hosts: [host] }), s) }; }
  catch (e) { return e instanceof AptError && e.status === 404 ? { kind: "missing" } : { kind: "error" }; }
}

export function judgeApt(looks: Look[], expiry: number, now = Date.now()): KitEnd | null {
  const fin = looks.find((l): l is { kind: "found"; end: KitEnd } => l.kind === "found" && l.end.state !== "pending");
  if (fin) return fin.end;
  if (looks.filter((l) => l.kind === "missing").length >= 2 && !looks.some((l) => l.kind === "found") && now / 1000 > expiry + 30) return { state: "dropped" };
  return null;
}

const refusalOf = (e: unknown) => (e instanceof AptError && e.status === 400 && !/SEQUENCE_NUMBER_TOO_OLD|ALREADY|EXISTS|duplicate/i.test(e.code + " " + e.detail) ? (e.detail || e.code).slice(0, 120) : null);
export async function submitApt(s: AptSigned): Promise<KitSubmit> {
  let unclear = false;
  for (const h of APT_NODES) {
    try {
      const r = await aptFetch<{ hash?: unknown }>("/transactions", { method: "POST", headers: BCS, body: hexToBytes(s.signed) }, { hosts: [h], timeoutMs: 20_000 });
      if (r?.hash !== s.hash) throw kitErr("ERR_UNSAFE");
      break;
    } catch (e) {
      const why = refusalOf(e);
      if (why && !unclear) return { state: "refused", code: why };
      if (why) break;
      unclear = true;
    }
  }
  const end = await waitApt(s, Date.now(), { maxMs: 15_000, everyMs: 2_000 });
  return end.state === "ok" ? { state: "ok" } : end.state === "failed" ? end : { state: "unknown" };
}
export async function waitApt(s: AptSigned, _signedAt: number, o: { maxMs?: number; everyMs?: number } = {}): Promise<KitEnd> {
  const until = Date.now() + (o.maxMs ?? 30_000), every = o.everyMs ?? 3_000;
  for (;;) {
    const looks = await Promise.all(APT_NODES.map((h) => look(h, s)));
    const end = judgeApt(looks, s.expiry);
    if (end) return end;
    if (Date.now() + every > until) return { state: "pending" };
    await new Promise((r) => setTimeout(r, every));
  }
}

export const aptPendingOf = (s: AptSigned): Omit<PendingPayment, "at"> => ({
  networkId: APT.id, from: s.from, hash: s.hash,
  data: { to: s.to, amount: s.amount.toString(), fee: s.fee.toString(), signed: s.signed, sequence: s.sequence, expiry: s.expiry },
});

export function aptSignedOf(p: PendingPayment | null): AptSigned | null {
  if (!p || p.networkId !== APT.id) return null;
  const d = p.data;
  try {
    const s: AptSigned = { from: String(p.from), to: String(d.to), amount: BigInt(String(d.amount)), fee: BigInt(String(d.fee)), hash: String(p.hash), signed: String(d.signed), sequence: String(d.sequence), expiry: Number(d.expiry) };
    const b = hexToBytes(s.signed);
    if (!Number.isSafeInteger(s.expiry) || b.length < 99 + 32) return null;
    const raw = b.slice(0, b.length - 99), pub = b.slice(b.length - 97, b.length - 65), sig = b.slice(b.length - 64);
    if (b[b.length - 99] !== 0 || b[b.length - 98] !== 32 || b[b.length - 65] !== 64) return null;
    if (aptAddressOf(pub) !== s.from || aptTxHash(b) !== s.hash || !ed25519.verify(sig, aptSigningMessage(raw), pub)) return null;

    const want = serializeAptTransfer({ sender: s.from, sequence: BigInt(s.sequence), to: s.to, amount: s.amount, maxGas: 1n, price: 1n, expiry: BigInt(s.expiry) });
    if (raw.length !== want.length || !sameBytes(raw.slice(0, raw.length - 25), want.slice(0, want.length - 25)) || !sameBytes(raw.slice(raw.length - 9), want.slice(want.length - 9))) return null;
    const gas = raw.slice(raw.length - 25, raw.length - 9);
    let mg = 0n, pr = 0n;
    for (let i = 7; i >= 0; i--) { mg = (mg << 8n) | BigInt(gas[i]); pr = (pr << 8n) | BigInt(gas[8 + i]); }
    if (mg * pr !== s.fee || s.fee > MAX_APT_FEE) return null;
    return s;
  } catch { return null; }
}

export const APT_KIT: SendKit<AptQuote, AptSigned> = {
  id: APT.id, name: APT.name, symbol: APT.symbol, decimals: APT.decimals, family: "aptos", placeholder: "0x…",
  address: aptAddress, format: formatApt, quote: quoteAptSend, spendable: aptSpendable, sign: signAptSend, submit: submitApt,
  wait: waitApt, pendingOf: aptPendingOf, signedOf: aptSignedOf, txUrl: aptTxUrl,
};
