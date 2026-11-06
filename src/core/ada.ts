import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";
import {
  ADA, adaAccount, adaAddress, adaKeys, adaParams, adaPubOf, adaTip, formatAda, keyHash, KOIOS, koiosPost, localSlot, LOVELACE_MAX, parseAda, parseAdaAddress, SLOT_SKEW,
  type AdaAsset, type AdaParams, type AdaUtxo, type AdaXprv,
} from "./adabase";
import { HostBusy, hostFetch } from "./hostgate";

const err = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(code), extra);
const cat = (...xs: Uint8Array[]) => { const o = new Uint8Array(xs.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };

export class CMap { constructor(public entries: [Cbor, Cbor][]) {} }
export class CTag { constructor(public tag: number, public value: Cbor) {} }
export type Cbor = bigint | number | Uint8Array | Cbor[] | CMap | CTag | boolean | null;

function head(major: number, n: bigint): number[] {
  if (n < 0n) throw new Error("cbor: negative");
  const m = major << 5;
  if (n < 24n) return [m | Number(n)];
  if (n < 0x100n) return [m | 24, Number(n)];
  if (n < 0x10000n) return [m | 25, Number(n >> 8n), Number(n & 0xffn)];
  if (n < 0x100000000n) return [m | 26, ...[24n, 16n, 8n, 0n].map((s) => Number((n >> s) & 0xffn))];
  if (n < 1n << 64n) return [m | 27, ...[56n, 48n, 40n, 32n, 24n, 16n, 8n, 0n].map((s) => Number((n >> s) & 0xffn))];
  throw new Error("cbor: too big");
}

export function cbor(v: Cbor): Uint8Array {
  const out: number[] = [];
  const put = (x: Cbor): void => {
    if (typeof x === "number") { if (!Number.isSafeInteger(x)) throw new Error("cbor: number"); out.push(...head(0, BigInt(x))); }
    else if (typeof x === "bigint") out.push(...head(0, x));
    else if (x instanceof Uint8Array) { out.push(...head(2, BigInt(x.length))); for (const b of x) out.push(b); }
    else if (Array.isArray(x)) { out.push(...head(4, BigInt(x.length))); x.forEach(put); }
    else if (x instanceof CMap) { out.push(...head(5, BigInt(x.entries.length))); for (const [k, w] of x.entries) { put(k); put(w); } }
    else if (x instanceof CTag) { out.push(...head(6, BigInt(x.tag))); put(x.value); }
    else if (x === true) out.push(0xf5);
    else if (x === false) out.push(0xf4);
    else if (x === null) out.push(0xf6);
    else throw new Error("cbor: type");
  };
  put(v);
  return Uint8Array.from(out);
}

export function uncbor(buf: Uint8Array, pos = 0): { v: Cbor; end: number } {
  const need = (n: number) => { if (pos + n > buf.length) throw new Error("cbor: short"); };
  need(1);
  const ib = buf[pos++], major = ib >> 5, info = ib & 31;
  if (major === 7) {
    if (info === 20) return { v: false, end: pos };
    if (info === 21) return { v: true, end: pos };
    if (info === 22) return { v: null, end: pos };
    throw new Error("cbor: simple");
  }
  let n: bigint;
  if (info < 24) n = BigInt(info);
  else if (info >= 24 && info <= 27) {
    const len = 1 << (info - 24);
    need(len);
    n = 0n;
    for (let i = 0; i < len; i++) n = (n << 8n) | BigInt(buf[pos++]);
    if (n < (info === 24 ? 24n : 1n << BigInt(4 * len))) throw new Error("cbor: not minimal");
  } else throw new Error("cbor: indefinite");
  switch (major) {
    case 0: return { v: n, end: pos };
    case 2: { const len = Number(n); need(len); return { v: buf.slice(pos, pos + len), end: pos + len }; }
    case 4: { const a: Cbor[] = []; for (let i = 0n; i < n; i++) { const r = uncbor(buf, pos); a.push(r.v); pos = r.end; } return { v: a, end: pos }; }
    case 5: { const e: [Cbor, Cbor][] = []; for (let i = 0n; i < n; i++) { const k = uncbor(buf, pos); const w = uncbor(buf, k.end); e.push([k.v, w.v]); pos = w.end; } return { v: new CMap(e), end: pos }; }
    case 6: { const r = uncbor(buf, pos); return { v: new CTag(Number(n), r.v), end: r.end }; }
    default: throw new Error("cbor: major");
  }
}

export function mergeAssets(xs: AdaAsset[]): AdaAsset[] {
  const m = new Map<string, AdaAsset>();
  for (const a of xs) { const k = `${a.policy}.${a.name}`; const c = m.get(k); m.set(k, { ...a, qty: (c?.qty ?? 0n) + a.qty }); }
  return [...m.values()].filter((a) => a.qty > 0n).sort((a, b) => a.policy < b.policy ? -1 : a.policy > b.policy ? 1 : a.name.length - b.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
function multiasset(assets: AdaAsset[]): CMap {
  const byPolicy = new Map<string, AdaAsset[]>();
  for (const a of mergeAssets(assets)) byPolicy.set(a.policy, [...(byPolicy.get(a.policy) ?? []), a]);
  return new CMap([...byPolicy].map(([p, as]) => [hexToBytes(p), new CMap(as.map((a) => [hexToBytes(a.name), a.qty]))]));
}
export interface AdaOut { address: Uint8Array; lovelace: bigint; assets: AdaAsset[] }

export const outCbor = (o: AdaOut): Cbor => [o.address, o.assets.length ? [o.lovelace, multiasset(o.assets)] : o.lovelace];

export function minAda(o: Omit<AdaOut, "lovelace">, coinsPerByte: bigint): bigint {
  let v = 1_000_000n;
  for (let i = 0; i < 4; i++) {
    const need = (160n + BigInt(cbor(outCbor({ ...o, lovelace: v })).length)) * coinsPerByte;
    if (need === v) break;
    v = need;
  }
  return v;
}

export interface AdaInput { txHash: string; index: number }
export interface AdaBody { inputs: AdaInput[]; outputs: AdaOut[]; fee: bigint; ttl: number }
const sortInputs = (xs: AdaInput[]) => [...xs].sort((a, b) => a.txHash < b.txHash ? -1 : a.txHash > b.txHash ? 1 : a.index - b.index);

export function bodyCbor(b: AdaBody): Uint8Array {
  return cbor(new CMap([
    [0, new CTag(258, sortInputs(b.inputs).map((i) => [hexToBytes(i.txHash), i.index]))],
    [1, b.outputs.map(outCbor)],
    [2, b.fee],
    [3, b.ttl],
  ]));
}
export const txHashOf = (body: Uint8Array) => bytesToHex(blake2b(body, { dkLen: 32 }));

export function txCbor(body: Uint8Array, witnesses: { vkey: Uint8Array; sig: Uint8Array }[]): Uint8Array {
  const wit = cbor(new CMap([[0, new CTag(258, witnesses.map((w) => [w.vkey, w.sig]))]]));
  return cat(Uint8Array.of(0x84), body, wit, Uint8Array.of(0xf5, 0xf6));
}

export function signExtended(k: AdaXprv, msg: Uint8Array): Uint8Array {
  const L = ed25519.Point.Fn.ORDER, le = (b: Uint8Array) => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; };
  const A = adaPubOf(k.kL);
  const r = le(sha512(cat(k.kR, msg))) % L;
  const R = ed25519.Point.BASE.multiply(r).toBytes();
  const h = le(sha512(cat(R, A, msg))) % L;
  const s = (r + h * (le(k.kL) % L)) % L;
  const S = new Uint8Array(32);
  let x = s;
  for (let i = 0; i < 32; i++) { S[i] = Number(x & 0xffn); x >>= 8n; }
  return cat(R, S);
}

const signedSize = (b: AdaBody) => txCbor(bodyCbor(b), [{ vkey: new Uint8Array(32), sig: new Uint8Array(64) }]).length;
export const feeOf = (b: AdaBody, p: AdaParams) => p.feeA * BigInt(signedSize(b)) + p.feeB;

export const MAX_ADA_FEE = 1_000_000n;
export const MAX_INPUTS = 120;

export const MAX_VALUE_SIZE = 5000;

export const FOLD_MAX = 20_000n;
const valueSize = (o: AdaOut) => cbor(o.assets.length ? [o.lovelace, multiasset(o.assets)] : o.lovelace).length;

export const TTL_SLOTS = 7200;

export interface AdaPlan { body: AdaBody; fee: bigint; change: bigint; keptAssets: AdaAsset[]; size: number }
const sum = (us: AdaUtxo[]) => us.reduce((s, u) => s + u.lovelace, 0n);

function priced(inputs: AdaUtxo[], first: AdaOut, change: Uint8Array | null, p: AdaParams, ttl: number): { body: AdaBody; fee: bigint; changeAda: bigint } {
  const assets = mergeAssets(inputs.flatMap((u) => u.assets)), inAda = sum(inputs);
  let fee = 0n, body: AdaBody = { inputs, outputs: [first], fee, ttl };
  for (let i = 0; i < 6; i++) {
    const changeAda = inAda - first.lovelace - fee;
    const outputs = change ? [first, { address: change, lovelace: changeAda > 0n ? changeAda : 0n, assets }] : [first];
    body = { inputs, outputs, fee, ttl };
    const f = feeOf(body, p);
    if (f === fee) break;
    fee = f;
  }
  const changeAda = inAda - first.lovelace - fee;
  return { body: { ...body, fee, outputs: change ? [first, { address: change, lovelace: changeAda, assets }] : [first] }, fee, changeAda };
}

export function planAda(utxos: AdaUtxo[], p: AdaParams, a: { to: Uint8Array; amount: bigint | "all"; change: Uint8Array; ttl: number }): AdaPlan {
  const usable = utxos.filter((u) => !u.refScript);
  const plain = usable.filter((u) => !u.assets.length).sort((x, y) => (y.lovelace > x.lovelace ? 1 : y.lovelace < x.lovelace ? -1 : 0));
  const tokened = usable.filter((u) => u.assets.length).sort((x, y) => (y.lovelace > x.lovelace ? 1 : y.lovelace < x.lovelace ? -1 : 0));
  const pool = [...plain, ...tokened].slice(0, MAX_INPUTS);
  const minTo = minAda({ address: a.to, assets: [] }, p.coinsPerByte);
  const done = (r: { body: AdaBody; fee: bigint }, keptAssets: AdaAsset[], change: bigint): AdaPlan => {
    if (r.fee > MAX_ADA_FEE) throw err("ERR_FEE_HIGH");
    if (feeOf(r.body, p) > r.fee) throw err("ERR_UNSAFE");
    const size = signedSize(r.body);
    if (size > p.maxTxSize) throw err("ERR_ADA_INPUTS");
    if (r.body.outputs.some((o) => valueSize(o) > MAX_VALUE_SIZE)) throw err("ERR_ADA_INPUTS");
    return { body: r.body, fee: r.fee, change, keptAssets, size };
  };

  const tryDone = (r: { body: AdaBody; fee: bigint }, keptAssets: AdaAsset[], change: bigint): AdaPlan | null => {
    try { return done(r, keptAssets, change); } catch { return null; }
  };
  if (a.amount === "all") {

    const tries: AdaPlan[] = [];
    if (plain.length) {
      const ins = plain.slice(0, MAX_INPUTS);
      const fee = feeOf({ inputs: ins, outputs: [{ address: a.to, lovelace: sum(ins), assets: [] }], fee: 1_000_000n, ttl: a.ttl }, p);
      const amt = sum(ins) - fee;
      const t = amt >= minTo ? tryDone({ body: { inputs: ins, outputs: [{ address: a.to, lovelace: amt, assets: [] }], fee, ttl: a.ttl }, fee }, [], 0n) : null;
      if (t) tries.push(t);
    }
    if (tokened.length) {
      const ins = pool, assets = mergeAssets(ins.flatMap((u) => u.assets));
      const keep = minAda({ address: a.change, assets }, p.coinsPerByte);
      const fee = feeOf({ inputs: ins, outputs: [{ address: a.to, lovelace: sum(ins), assets: [] }, { address: a.change, lovelace: keep, assets }], fee: 1_000_000n, ttl: a.ttl }, p);
      const amt = sum(ins) - keep - fee;
      const t = amt >= minTo ? tryDone({ body: { inputs: ins, outputs: [{ address: a.to, lovelace: amt, assets: [] }, { address: a.change, lovelace: keep, assets }], fee, ttl: a.ttl }, fee }, assets, keep) : null;
      if (t) tries.push(t);
    }
    if (!tries.length) throw err("ERR_FUNDS", { max: 0n });
    return tries.reduce((x, y) => (y.body.outputs[0].lovelace > x.body.outputs[0].lovelace ? y : x));
  }
  const amount = a.amount;
  if (amount <= 0n) throw err("ERR_ZERO");
  if (amount < minTo) throw err("ERR_ADA_MIN", { min: minTo });
  const first: AdaOut = { address: a.to, lovelace: amount, assets: [] };
  let short: { exact: bigint } | null = null, folded: AdaPlan | null = null;
  for (let k = 1; k <= pool.length; k++) {
    const ins = pool.slice(0, k);
    const withChange = priced(ins, first, a.change, p, a.ttl);
    const assets = mergeAssets(ins.flatMap((u) => u.assets));
    const least = minAda({ address: a.change, assets }, p.coinsPerByte);
    if (withChange.changeAda >= least) { const t = tryDone(withChange, assets, withChange.changeAda); if (t) return t; continue; }
    if (!assets.length) {
      const exact = priced(ins, first, null, p, a.ttl);
      const rest = sum(ins) - amount - exact.fee;
      if (rest === 0n) { const t = tryDone(exact, [], 0n); if (t) return t; }

      if (rest > 0n && rest <= FOLD_MAX && !folded) { const fee = exact.fee + rest; folded = tryDone({ body: { ...exact.body, fee }, fee }, [], 0n); }
      if (rest >= 0n) short = { exact: least };
    }
  }
  if (folded) return folded;
  const max = spendableOf(utxos, p, a);
  if (short && max >= amount) throw err("ERR_ADA_CHANGE", { keep: short.exact, max });
  throw err("ERR_FUNDS", { max });
}

export function spendableOf(utxos: AdaUtxo[], p: AdaParams, a: { to: Uint8Array; change: Uint8Array; ttl: number }): bigint {
  try { return planAda(utxos, p, { ...a, amount: "all" }).body.outputs[0].lovelace; } catch { return 0n; }
}

export interface AdaQuote {
  from: string; to: string; amount: bigint; fee: bigint; change: bigint; keptAssets: number; inputs: AdaInput[];
  body: AdaBody; balance: bigint; size: number;
}
const toBytes = (addr: string) => { const x = parseAdaAddress(addr); if (!x) throw err("ERR_ADDRESS"); return x.bytes; };

export async function quoteAdaSend(phrase: string, index: number, to: string, amount: string | "all", busy: readonly string[] = [],
  o: { account?: typeof adaAccount; params?: typeof adaParams; tip?: typeof adaTip; now?: () => number } = {}): Promise<AdaQuote> {
  const dest = parseAdaAddress(to);
  if (!dest) throw err("ERR_ADDRESS");

  if (dest.script) throw err("ERR_ADA_SCRIPT");
  const from = adaAddress(phrase, index);

  if (bytesToHex(dest.payment) === bytesToHex(keyHash(adaKeys(phrase, index).payPub))) throw err("ERR_SELF");
  const lovelace = amount === "all" ? "all" : parseAda(amount);
  if (lovelace == null) throw err("ERR_AMOUNT");
  const [acct, p, tip] = await Promise.all([(o.account ?? adaAccount)(from), (o.params ?? adaParams)(), (o.tip ?? adaTip)()]);
  const skip = new Set(busy);
  const utxos = acct.utxos.filter((u) => !skip.has(`${u.txHash}#${u.index}`));

  const plan = planAda(utxos, p, { to: dest.bytes, amount: lovelace, change: toBytes(from), ttl: Math.min(tip.slot, (o.now ? localSlot(o.now()) : localSlot())) + TTL_SLOTS });
  return { from, to: to.trim(), amount: plan.body.outputs[0].lovelace, fee: plan.fee, change: plan.change, keptAssets: plan.keptAssets.length,
    inputs: plan.body.inputs.map((i) => ({ txHash: i.txHash, index: i.index })), body: plan.body, balance: acct.lovelace, size: plan.size };
}

export function checkAdaSigned(tx: Uint8Array, q: Pick<AdaQuote, "from" | "to" | "amount" | "fee" | "body">, payPub: Uint8Array): { hash: string } {
  let top: { v: Cbor; end: number };
  try { top = uncbor(tx); } catch { throw err("ERR_UNSAFE"); }
  if (top.end !== tx.length || !Array.isArray(top.v) || top.v.length !== 4 || top.v[2] !== true || top.v[3] !== null) throw err("ERR_UNSAFE");
  const bodyEnd = uncbor(tx, 1).end, body = tx.slice(1, bodyEnd);
  if (bytesToHex(body) !== bytesToHex(bodyCbor(q.body))) throw err("ERR_UNSAFE");
  const b = top.v[0] as CMap;
  if (!(b instanceof CMap) || b.entries.map(([k]) => Number(k)).join(",") !== "0,1,2,3") throw err("ERR_UNSAFE");
  const get = (k: number) => b.entries.find(([x]) => Number(x) === k)![1];
  if (get(2) !== q.fee || q.fee > MAX_ADA_FEE) throw err("ERR_UNSAFE");
  const outs = get(1) as Cbor[], to = toBytes(q.to), me = toBytes(q.from);
  if (!Array.isArray(outs) || !outs.length || outs.length > 2) throw err("ERR_UNSAFE");
  const [o0, o1] = outs as Cbor[][];
  if (bytesToHex(o0[0] as Uint8Array) !== bytesToHex(to) || o0[1] !== q.amount) throw err("ERR_UNSAFE");
  if (o1 && bytesToHex(o1[0] as Uint8Array) !== bytesToHex(me)) throw err("ERR_UNSAFE");
  const w = top.v[1] as CMap;
  if (!(w instanceof CMap) || w.entries.length !== 1 || Number(w.entries[0][0]) !== 0) throw err("ERR_UNSAFE");
  const set = w.entries[0][1] instanceof CTag ? (w.entries[0][1] as CTag).value : w.entries[0][1];
  if (!Array.isArray(set) || set.length !== 1) throw err("ERR_UNSAFE");
  const [vkey, sig] = set[0] as Uint8Array[];
  const hash = txHashOf(body);
  if (bytesToHex(vkey) !== bytesToHex(payPub) || !ed25519.verify(sig, hexToBytes(hash), payPub)) throw err("ERR_UNSAFE");
  return { hash };
}

export function signAdaPayment(phrase: string, index: number, q: AdaQuote): { hash: string; cbor: string } {
  const k = adaKeys(phrase, index);
  if (adaAddress(phrase, index) !== q.from) throw err("ERR_UNSAFE");
  const body = bodyCbor(q.body), msg = blake2b(body, { dkLen: 32 });
  const tx = txCbor(body, [{ vkey: k.payPub, sig: signExtended(k.pay, msg) }]);
  const { hash } = checkAdaSigned(tx, q, k.payPub);
  return { hash, cbor: bytesToHex(tx) };
}

export async function submitAda(txHex: string, hash: string, o: { status?: typeof adaTxStatus; fetcher?: typeof hostFetch } = {}): Promise<"sent" | "unknown"> {
  let r: Response;
  try { r = await (o.fetcher ?? hostFetch)(`${KOIOS}/submittx`, { method: "POST", headers: { "content-type": "application/cbor" }, body: hexToBytes(txHex) as BodyInit }, 30_000); }
  catch (e) {
    if (e instanceof HostBusy) throw err("ERR_BUSY", { notSent: true });
    return "unknown";
  }
  const text = await r.text().catch(() => "");
  if (r.ok) return text.replace(/"/g, "").trim() === hash ? "sent" : "unknown";
  if ([403, 404, 405, 415, 429].includes(r.status)) throw err("ERR_BUSY", { notSent: true });

  if (/All inputs are spent|BadInputsUTxO/.test(text)) {
    const n = await (o.status ?? adaTxStatus)(hash).catch(() => null);
    if (n != null) return "sent";
    throw err("ERR_BROADCAST", { reasons: [text.slice(0, 300)], spent: true });
  }
  if (r.status === 400 || /ValueNotConserved|OutsideValidityInterval|FeeTooSmall|OutputTooSmall|ShelleyTxValidationError/.test(text)) throw err("ERR_BROADCAST", { reasons: [text.slice(0, 300)] });
  return "unknown";
}

export async function adaTxStatus(hash: string): Promise<number | null> {
  const r = await koiosPost<{ tx_hash?: string; num_confirmations?: unknown }[]>("/tx_status", { _tx_hashes: [hash] });
  const row = Array.isArray(r) ? r.find((x) => x?.tx_hash === hash) : null;
  const n = row?.num_confirmations;
  return n == null ? null : Number.isSafeInteger(Number(n)) && Number(n) >= 0 ? Number(n) : null;
}

export function adaPendingOf(q: AdaQuote, s: { hash: string; cbor: string }) {
  return { networkId: ADA.id, from: q.from, hash: s.hash, data: { cbor: s.cbor, to: q.to, amount: q.amount.toString(), ttl: q.body.ttl, ins: q.inputs.map((i) => `${i.txHash}#${i.index}`).join(",") } };
}

export function adaSignedOf(p: { hash: string; at?: number; from?: string; data: Record<string, string | number | null> } | null): { cbor: string; hash: string; to: string; amount: bigint; ttl: number; ins: string[]; at: number; from: string } | null {
  if (!p) return null;
  try {
    const h = String(p.data.cbor ?? "").toLowerCase();
    if (!/^[0-9a-f]+$/.test(h) || h.length % 2) return null;
    const tx = hexToBytes(h);
    if (tx[0] !== 0x84) return null;
    if (txHashOf(tx.slice(1, uncbor(tx, 1).end)) !== p.hash) return null;
    const ins = String(p.data.ins ?? "").split(",").filter((x) => /^[0-9a-f]{64}#\d+$/.test(x));
    return { cbor: h, hash: p.hash, to: String(p.data.to ?? ""), amount: BigInt(String(p.data.amount ?? "0")), ttl: Number(p.data.ttl) || 0, ins, at: Number(p.at) || 0, from: String(p.from ?? "") };
  } catch { return null; }
}

export async function adaPaymentState(s: { hash: string; ttl: number; ins?: readonly string[]; from?: string },
  o: { status?: typeof adaTxStatus; tip?: typeof adaTip; account?: typeof adaAccount; now?: () => number } = {}): Promise<"ok" | "dropped" | "waiting"> {
  const n = await (o.status ?? adaTxStatus)(s.hash);
  if (n != null) return "ok";
  const tip = await (o.tip ?? adaTip)();
  const past = Math.min(tip.slot, o.now ? localSlot(o.now()) : localSlot()) > s.ttl + 60 + SLOT_SKEW;
  if (!past || !s.from || !s.ins?.length) return "waiting";
  const have = new Set((await (o.account ?? adaAccount)(s.from)).utxos.map((u) => `${u.txHash}#${u.index}`));
  return s.ins.every((x) => have.has(x)) ? "dropped" : "waiting";
}

export async function adaSpendable(phrase: string, index: number, busy: readonly string[] = [], to?: string): Promise<bigint> {
  const from = adaAddress(phrase, index);
  const [acct, p, tip] = await Promise.all([adaAccount(from), adaParams(), adaTip()]);
  const skip = new Set(busy), me = toBytes(from), dest = to ? parseAdaAddress(to) : null;
  return spendableOf(acct.utxos.filter((u) => !skip.has(`${u.txHash}#${u.index}`)), p, { to: dest && !dest.script ? dest.bytes : me, change: me, ttl: Math.min(tip.slot, localSlot()) + TTL_SLOTS });
}
export { formatAda, LOVELACE_MAX, bech32 };
