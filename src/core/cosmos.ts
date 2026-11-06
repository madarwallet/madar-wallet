import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";
import {
  cosmosAddress, cosmosAddressOf, cosmosBalances, CosmosError, cosmosFetch, cosmosKey, cosmosTxUrl, formatCosmos, isCosmosAddress, MICRO_MAX, parseCosmos,
  type CosmosChain,
} from "./cosmosbase";
import type { PendingPayment } from "./store";
import { bigOf, concat, kitErr, uleb, type KitEnd, type KitSubmit, type SendKit } from "./sendkit";
export * from "./cosmosbase";

export const COSMOS_TIMEOUT_BLOCKS = 300n;
const U64_MAX = (1n << 64n) - 1n;
const enc = (s: string) => new TextEncoder().encode(s);

const tag = (f: number, w: number) => uleb((f << 3) | w);
const pbBytes = (f: number, b: Uint8Array | number[]) => (b.length ? [...tag(f, 2), ...uleb(b.length), ...b] : []);
const pbStr = (f: number, s: string) => pbBytes(f, enc(s));
const pbVar = (f: number, v: bigint | number) => (BigInt(v) ? [...tag(f, 0), ...uleb(v)] : []);
const coin = (denom: string, amount: bigint) => [...pbStr(1, denom), ...pbStr(2, amount.toString())];
const any = (typeUrl: string, value: number[]) => [...pbStr(1, typeUrl), ...pbBytes(2, value)];

export interface CosmosTransfer {
  chain: CosmosChain; from: string; to: string; amount: bigint; memo: string; timeoutHeight: bigint;
  pub: Uint8Array; sequence: bigint; accountNumber: bigint; gasLimit: bigint; fee: bigint;
}

export function cosmosParts(t: CosmosTransfer): { body: Uint8Array; auth: Uint8Array } {
  const c = t.chain;
  if (!isCosmosAddress(c, t.from) || !isCosmosAddress(c, t.to) || t.amount <= 0n || t.amount > MICRO_MAX || t.pub.length !== 33) throw kitErr("ERR_UNSAFE");
  if (t.gasLimit <= 0n || t.gasLimit > U64_MAX || t.fee < 0n || t.fee > c.maxFee || t.sequence < 0n || t.sequence > U64_MAX || t.timeoutHeight <= 0n || t.memo.length > 256) throw kitErr("ERR_UNSAFE");
  const msg = [...pbStr(1, t.from), ...pbStr(2, t.to), ...pbBytes(3, coin(c.denom, t.amount))];
  const body = Uint8Array.from([...pbBytes(1, any("/cosmos.bank.v1beta1.MsgSend", msg)), ...pbStr(2, t.memo), ...pbVar(3, t.timeoutHeight)]);
  const signer = [...pbBytes(1, any("/cosmos.crypto.secp256k1.PubKey", pbBytes(1, t.pub))), ...pbBytes(2, pbBytes(1, pbVar(1, 1))), ...pbVar(3, t.sequence)];
  const fee = [...(t.fee ? pbBytes(1, coin(c.denom, t.fee)) : []), ...pbVar(2, t.gasLimit)];
  const auth = Uint8Array.from([...pbBytes(1, signer), ...pbBytes(2, fee)]);
  return { body, auth };
}
export const cosmosSignDoc = (c: CosmosChain, body: Uint8Array, auth: Uint8Array, accountNumber: bigint) =>
  Uint8Array.from([...pbBytes(1, body), ...pbBytes(2, auth), ...pbStr(3, c.chainId), ...pbVar(4, accountNumber)]);
export const cosmosTxRaw = (body: Uint8Array, auth: Uint8Array, sig: Uint8Array) =>
  Uint8Array.from([...pbBytes(1, body), ...pbBytes(2, auth), ...tag(3, 2), ...uleb(sig.length), ...sig]);
export const cosmosTxHash = (raw: Uint8Array) => bytesToHex(sha256(raw)).toUpperCase();

export function signCosmos(t: CosmosTransfer, priv: Uint8Array): { raw: Uint8Array; hash: string } {
  const pub = secp256k1.getPublicKey(priv, true);
  if (bytesToHex(pub) !== bytesToHex(t.pub) || cosmosAddressOf(t.chain.prefix, pub) !== t.from) throw kitErr("ERR_UNSAFE");
  const { body, auth } = cosmosParts(t);
  const h = sha256(cosmosSignDoc(t.chain, body, auth, t.accountNumber));
  const sig = secp256k1.sign(h, priv, { prehash: false, lowS: true });
  if (sig.length !== 64 || !secp256k1.verify(sig, h, pub, { prehash: false, lowS: true })) throw kitErr("ERR_UNSAFE");
  const raw = cosmosTxRaw(body, auth, sig);
  return { raw, hash: cosmosTxHash(raw) };
}

export interface CosmosAccount { exists: boolean; accountNumber: bigint; sequence: bigint; pubKey: string | null }

export function readCosmosAccount(res: unknown): CosmosAccount {
  const a = (res as { account?: Record<string, unknown> })?.account;
  const base = (a?.base_account ?? (a?.base_vesting_account as Record<string, unknown> | undefined)?.base_account ?? a) as { account_number?: unknown; sequence?: unknown; pub_key?: { key?: unknown } | null } | undefined;
  const n = bigOf(base?.account_number, U64_MAX), s = bigOf(base?.sequence, U64_MAX);
  if (n == null || s == null) throw kitErr("ERR_PROVIDER");
  const k = base?.pub_key?.key;
  return { exists: true, accountNumber: n, sequence: s, pubKey: typeof k === "string" ? k : null };
}
export async function cosmosAccount(c: CosmosChain, address: string, hosts?: string[]): Promise<CosmosAccount> {
  try { return readCosmosAccount(await cosmosFetch(c, `/cosmos/auth/v1beta1/accounts/${address}`, {}, { hosts })); }
  catch (e) { if (e instanceof CosmosError && (e.status === 404 || e.code === 5 || e.code === 22)) return { exists: false, accountNumber: 0n, sequence: 0n, pubKey: null }; throw e; }
}
export async function cosmosHeight(c: CosmosChain): Promise<bigint> {
  const h = bigOf((await cosmosFetch<{ block?: { header?: { height?: unknown; chain_id?: unknown } } }>(c, "/cosmos/base/tendermint/v1beta1/blocks/latest")).block?.header?.height, U64_MAX);
  if (h == null || h <= 0n) throw kitErr("ERR_PROVIDER");
  return h;
}

export function priceOf(v: unknown): bigint | null {
  if (typeof v !== "string" || !/^\d{1,6}(\.\d{1,30})?$/.test(v)) return null;
  const [i, f = ""] = v.split(".");
  const six = BigInt(i) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  return /[1-9]/.test(f.slice(6)) ? six + 1n : six;
}

export async function cosmosGasPrice(c: CosmosChain): Promise<bigint> {
  if (!c.priceUrl) return c.minPrice;
  const r = await cosmosFetch<{ price?: { amount?: unknown }; base_fee?: unknown }>(c, c.priceUrl).catch(() => null);
  const live = priceOf(r?.price?.amount ?? r?.base_fee);
  return live != null && live * 2n > c.minPrice ? live * 2n : c.minPrice;
}

export function cosmosGasOf(c: CosmosChain, res: unknown, price: bigint): { gasLimit: bigint; fee: bigint } {
  const used = bigOf((res as { gas_info?: { gas_used?: unknown } })?.gas_info?.gas_used, U64_MAX);
  if (used == null || used <= 0n) throw kitErr("ERR_PROVIDER");
  const gasLimit = used + used / 2n + 5_000n;
  const fee = (gasLimit * price + 999_999n) / 1_000_000n;
  if (fee > c.maxFee) throw kitErr("ERR_FEE_HIGH", { fee });
  return { gasLimit, fee };
}

export interface CosmosQuote { from: string; to: string; amount: bigint; fee: bigint; memo: string; gasLimit: bigint; chainId: string }

export function checkCosmosFunds(amount: bigint, fee: bigint, spendable: bigint): void {
  if (amount <= 0n) throw kitErr("ERR_ZERO");
  if (amount + fee > spendable) { const max = spendable - fee; throw kitErr("ERR_FUNDS", { max: max > 0n ? max : 0n }); }
}
export function cosmosMemo(m: string | undefined): string {
  const v = String(m ?? "").trim();
  if (v.length > 256 || /[\u0000-\u001f\u007f]/.test(v)) throw kitErr("ERR_KIT_MEMO");
  return v;
}
async function mine(c: CosmosChain, phrase: string, index: number) {
  const k = cosmosKey(phrase, index), from = cosmosAddressOf(c.prefix, k.pub);
  const acct = await cosmosAccount(c, from);
  if (!acct.exists) throw kitErr("ERR_KIT_INACTIVE");
  if (acct.pubKey && acct.pubKey !== base64.encode(k.pub)) throw kitErr("ERR_KIT_KEY");
  return { ...k, from, acct };
}
async function gasFor(c: CosmosChain, t: Omit<CosmosTransfer, "gasLimit" | "fee">, price: bigint) {
  const { body, auth } = cosmosParts({ ...t, gasLimit: 400_000n, fee: 0n });
  const sim = cosmosTxRaw(body, auth, new Uint8Array(0));
  try { return cosmosGasOf(c, await cosmosFetch(c, "/cosmos/tx/v1beta1/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tx_bytes: base64.encode(sim) }) }), price); }
  catch (e) { if (e instanceof CosmosError) throw kitErr("ERR_KIT_SIM", { code: e.detail.slice(0, 120) }); throw e; }
}
export function cosmosRecipient(c: CosmosChain, input: string): string {
  const v = String(input ?? "").trim();
  if (isCosmosAddress(c, v)) return v;
  if (isCosmosAddress(c, v.toLowerCase())) return v.toLowerCase();
  throw kitErr("ERR_ADDRESS");
}
export async function quoteCosmosSend(c: CosmosChain, phrase: string, index: number, toInput: string, amountText: string, memoText?: string): Promise<CosmosQuote> {
  const to = cosmosRecipient(c, toInput), amount = parseCosmos(amountText), memo = cosmosMemo(memoText);
  if (amount <= 0n) throw kitErr("ERR_ZERO");
  const { pub, from, acct } = await mine(c, phrase, index);
  if (to === from) throw kitErr("ERR_SELF");
  const [bal, price, height] = await Promise.all([cosmosBalances(c, from), cosmosGasPrice(c), cosmosHeight(c)]);
  if (amount >= bal.spendable) throw kitErr("ERR_FUNDS", { max: bal.spendable > c.maxFee ? bal.spendable - c.maxFee : 0n });
  const g = await gasFor(c, { chain: c, from, to, amount, memo, timeoutHeight: height + COSMOS_TIMEOUT_BLOCKS, pub, sequence: acct.sequence, accountNumber: acct.accountNumber }, price);
  checkCosmosFunds(amount, g.fee, bal.spendable);
  return { from, to, amount, fee: g.fee, memo, gasLimit: g.gasLimit, chainId: c.chainId };
}
export async function cosmosSpendable(c: CosmosChain, phrase: string, index: number): Promise<bigint> {
  const k = cosmosKey(phrase, index), from = cosmosAddressOf(c.prefix, k.pub);
  const bal = await cosmosBalances(c, from);

  return bal.spendable > c.maxFee ? bal.spendable - c.maxFee : 0n;
}

export interface CosmosSigned {
  from: string; to: string; amount: bigint; fee: bigint; memo: string; hash: string; raw: string; sequence: string; timeoutHeight: string; chainId: string;
  accountNumber: string; gasLimit: string;  pub: string;
}
export async function signCosmosSend(c: CosmosChain, phrase: string, index: number, q: CosmosQuote): Promise<CosmosSigned> {
  const { priv, pub, from, acct } = await mine(c, phrase, index);
  if (from !== q.from || q.chainId !== c.chainId || q.fee > c.maxFee || q.amount <= 0n || q.to === q.from || !isCosmosAddress(c, q.to)) throw kitErr("ERR_UNSAFE");
  const [bal, height] = await Promise.all([cosmosBalances(c, from), cosmosHeight(c)]);
  checkCosmosFunds(q.amount, q.fee, bal.spendable);
  const t: CosmosTransfer = { chain: c, from, to: q.to, amount: q.amount, memo: cosmosMemo(q.memo), timeoutHeight: height + COSMOS_TIMEOUT_BLOCKS, pub, sequence: acct.sequence, accountNumber: acct.accountNumber, gasLimit: q.gasLimit, fee: q.fee };
  const s = signCosmos(t, priv);
  return { from, to: q.to, amount: q.amount, fee: q.fee, memo: t.memo, hash: s.hash, raw: base64.encode(s.raw), sequence: acct.sequence.toString(), timeoutHeight: t.timeoutHeight.toString(), chainId: c.chainId,
    accountNumber: acct.accountNumber.toString(), gasLimit: q.gasLimit.toString(), pub: bytesToHex(pub) };
}

const MAYBE_IN = new Set([19, 32]);
type TxResp = { code?: unknown; txhash?: unknown; raw_log?: unknown; codespace?: unknown; height?: unknown };

export function readBroadcast(res: unknown, hash: string): { kind: "accepted" } | { kind: "refused"; code: string } | { kind: "unclear" } {
  const r = (res as { tx_response?: TxResp })?.tx_response;
  const code = Number(r?.code);
  if (!r || !Number.isInteger(code)) return { kind: "unclear" };
  if (typeof r.txhash === "string" && r.txhash.toUpperCase() !== hash) throw kitErr("ERR_UNSAFE");
  if (code === 0) return { kind: "accepted" };
  if (MAYBE_IN.has(code) && (r.codespace === "sdk" || r.codespace == null)) return { kind: "unclear" };
  return { kind: "refused", code: `${r.codespace ?? ""} ${code}: ${String(r.raw_log ?? "")}`.trim().slice(0, 120) };
}

export function readCosmosTx(res: unknown, hash: string): KitEnd {
  const r = (res as { tx_response?: TxResp })?.tx_response;
  if (!r || typeof r.txhash !== "string" || r.txhash.toUpperCase() !== hash) throw kitErr("ERR_UNSAFE");
  const code = Number(r.code);
  if (!Number.isInteger(code)) throw kitErr("ERR_PROVIDER");
  return code === 0 ? { state: "ok" } : { state: "failed", code: `${r.codespace ?? ""} ${code}`.trim() };
}
type Look = { kind: "found"; end: KitEnd } | { kind: "missing" } | { kind: "error" };
async function look(c: CosmosChain, host: string, s: CosmosSigned): Promise<Look> {
  try { return { kind: "found", end: readCosmosTx(await cosmosFetch(c, `/cosmos/tx/v1beta1/txs/${s.hash}`, {}, { hosts: [host] }), s.hash) }; }
  catch (e) { return e instanceof CosmosError && (e.status === 404 || e.code === 5 || /not found/i.test(e.detail)) ? { kind: "missing" } : { kind: "error" }; }
}

export function judgeCosmos(looks: Look[], s: Pick<CosmosSigned, "sequence" | "timeoutHeight">, height: bigint | null, sequence: bigint | null): KitEnd | null {
  const fin = looks.find((l): l is { kind: "found"; end: KitEnd } => l.kind === "found");
  if (fin) return fin.end;
  if (looks.filter((l) => l.kind === "missing").length < 2 || height == null || sequence == null) return null;
  if (height > BigInt(s.timeoutHeight) + 2n && sequence <= BigInt(s.sequence)) return { state: "dropped" };
  return null;
}
export async function submitCosmos(c: CosmosChain, s: CosmosSigned): Promise<KitSubmit> {
  let unclear = false;
  for (const h of c.rest) {
    try {
      const b = readBroadcast(await cosmosFetch(c, "/cosmos/tx/v1beta1/txs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tx_bytes: s.raw, mode: "BROADCAST_MODE_SYNC" }) }, { hosts: [h], timeoutMs: 20_000 }), s.hash);
      if (b.kind === "accepted") break;
      if (b.kind === "refused") { if (!unclear) return { state: "refused", code: b.code }; break; }
      unclear = true;
    } catch { unclear = true; }
  }
  const end = await waitCosmos(c, s, Date.now(), { maxMs: 20_000, everyMs: 3_000 });
  return end.state === "ok" ? { state: "ok" } : end.state === "failed" ? end : { state: "unknown" };
}
export async function waitCosmos(c: CosmosChain, s: CosmosSigned, _at: number, o: { maxMs?: number; everyMs?: number } = {}): Promise<KitEnd> {
  const until = Date.now() + (o.maxMs ?? 30_000), every = o.everyMs ?? 3_000;
  for (;;) {
    const looks = await Promise.all(c.rest.map((h) => look(c, h, s)));
    let end = judgeCosmos(looks, s, null, null);
    if (!end && looks.every((l) => l.kind === "missing")) {
      const [height, acct] = await Promise.all([cosmosHeight(c).catch(() => null), cosmosAccount(c, s.from).catch(() => null)]);
      if (acct?.exists) end = judgeCosmos(await Promise.all(c.rest.map((h) => look(c, h, s))), s, height, acct.sequence);
    }
    if (end) return end;
    if (Date.now() + every > until) return { state: "pending" };
    await new Promise((r) => setTimeout(r, every));
  }
}

export const cosmosPendingOf = (c: CosmosChain, s: CosmosSigned): Omit<PendingPayment, "at"> => ({
  networkId: c.id, from: s.from, hash: s.hash,
  data: { to: s.to, amount: s.amount.toString(), fee: s.fee.toString(), memo: s.memo, raw: s.raw, sequence: s.sequence, timeoutHeight: s.timeoutHeight, chainId: s.chainId,
    accountNumber: s.accountNumber, gasLimit: s.gasLimit, pub: s.pub },
});

export function splitTxRaw(raw: Uint8Array): { body: Uint8Array; auth: Uint8Array; sig: Uint8Array } | null {
  const f: Uint8Array[] = [];
  let i = 0;
  for (const want of [0x0a, 0x12, 0x1a]) {
    if (raw[i] !== want) return null;
    let len = 0, shift = 0, b = 0;
    i++;
    do { if (i >= raw.length || shift > 28) return null; b = raw[i++]; len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    if (i + len > raw.length) return null;
    f.push(raw.slice(i, i + len)); i += len;
  }
  return i === raw.length ? { body: f[0], auth: f[1], sig: f[2] } : null;
}

export function cosmosSignedOf(c: CosmosChain, p: PendingPayment | null): CosmosSigned | null {
  if (!p || p.networkId !== c.id) return null;
  const d = p.data;
  try {
    const s: CosmosSigned = { from: String(p.from), to: String(d.to), amount: BigInt(String(d.amount)), fee: BigInt(String(d.fee)), memo: String(d.memo ?? ""), hash: String(p.hash),
      raw: String(d.raw), sequence: String(d.sequence), timeoutHeight: String(d.timeoutHeight), chainId: String(d.chainId), accountNumber: String(d.accountNumber), gasLimit: String(d.gasLimit), pub: String(d.pub) };
    if (s.chainId !== c.chainId) return null;
    const raw = base64.decode(s.raw), parts = splitTxRaw(raw), pub = hexToBytes(s.pub);
    if (!parts || cosmosTxHash(raw) !== s.hash || cosmosAddressOf(c.prefix, pub) !== s.from) return null;
    const { body, auth } = cosmosParts({ chain: c, from: s.from, to: s.to, amount: s.amount, memo: s.memo, timeoutHeight: BigInt(s.timeoutHeight), pub, sequence: BigInt(s.sequence), accountNumber: BigInt(s.accountNumber), gasLimit: BigInt(s.gasLimit), fee: s.fee });
    if (bytesToHex(body) !== bytesToHex(parts.body) || bytesToHex(auth) !== bytesToHex(parts.auth)) return null;
    const h = sha256(cosmosSignDoc(c, body, auth, BigInt(s.accountNumber)));
    return parts.sig.length === 64 && secp256k1.verify(parts.sig, h, pub, { prehash: false, lowS: true }) ? s : null;
  } catch { return null; }
}

export function cosmosKit(c: CosmosChain): SendKit<CosmosQuote, CosmosSigned> {
  return {
    id: c.id, name: c.name, symbol: c.symbol, decimals: c.decimals, family: c.family, placeholder: `${c.prefix}1…`, memo: true,
    address: (p, i) => cosmosAddress(c, p, i), format: formatCosmos,
    quote: (p, i, to, a, m) => quoteCosmosSend(c, p, i, to, a, m), spendable: (p, i) => cosmosSpendable(c, p, i), sign: (p, i, q) => signCosmosSend(c, p, i, q),
    submit: (s) => submitCosmos(c, s), wait: (s, at, o) => waitCosmos(c, s, at, o), pendingOf: (s) => cosmosPendingOf(c, s), signedOf: (p) => cosmosSignedOf(c, p),
    txUrl: (h) => cosmosTxUrl(c, h),
  };
}
