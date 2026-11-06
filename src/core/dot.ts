import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  compact, DOT, dotAccount, dotAddress, DotError, DOT_GENESIS, DOT_RPCS, dotPublicKey, dotRpc, dotSecret, dotSign, dotTransferable, dotTxUrl, dotVerify, formatDot,
  isDotAddress, parseDot, PLANCK_MAX, Scale, ss58Decode, ss58Of, twox128,
} from "./dotbase";
import type { PendingPayment } from "./store";
import { concat, kitErr, leU, type KitEnd, type KitSubmit, type SendKit } from "./sendkit";
export * from "./dotbase";

export const MAX_DOT_FEE = 1_000_000_000n;
export const DOT_ERA_PERIOD = 128;
const hex = (b: Uint8Array | number[]) => "0x" + bytesToHex(Uint8Array.from(b));
const unhex = (s: unknown) => { if (typeof s !== "string" || !/^0x([0-9a-f]{2})*$/i.test(s)) throw kitErr("ERR_PROVIDER"); return hexToBytes(s.slice(2)); };

type TDef =
  | { k: "comp"; f: { name: string | null; t: number }[] } | { k: "var"; v: { name: string; idx: number; f: { name: string | null; t: number }[] }[] }
  | { k: "seq"; t: number } | { k: "arr"; n: number; t: number } | { k: "tup"; t: number[] } | { k: "prim"; p: number } | { k: "cmp"; t: number } | { k: "bits"; store: number };
export interface DotMeta {
  types: Map<number, { path: string[]; d: TDef }>;
  pallets: { name: string; idx: number; calls: number | null; events: number | null; consts: Map<string, Uint8Array>; storage: Map<string, number> }[];
  exts: { id: string; extra: number; add: number }[];
}

export function parseMeta(bytes: Uint8Array): DotMeta {
  const s = new Scale(bytes);
  if (bytesToHex(s.bytes(4)) !== "6d657461" || s.u8() !== 14) throw kitErr("ERR_KIT_RUNTIME");
  const field = () => { const name = s.opt(() => s.str()); const t = s.num(); s.opt(() => s.str()); s.vec(() => s.str()); return { name, t }; };
  const types = new Map<number, { path: string[]; d: TDef }>();
  s.vec(() => {
    const id = s.num(), path = s.vec(() => s.str());
    s.vec(() => { s.str(); s.opt(() => s.num()); });
    const k = s.u8();
    let d: TDef;
    if (k === 0) d = { k: "comp", f: s.vec(field) };
    else if (k === 1) d = { k: "var", v: s.vec(() => { const name = s.str(), f = s.vec(field), idx = s.u8(); s.vec(() => s.str()); return { name, idx, f }; }) };
    else if (k === 2) d = { k: "seq", t: s.num() };
    else if (k === 3) { const n = Number(s.uint(4)); d = { k: "arr", n, t: s.num() }; }
    else if (k === 4) d = { k: "tup", t: s.vec(() => s.num()) };
    else if (k === 5) d = { k: "prim", p: s.u8() };
    else if (k === 6) d = { k: "cmp", t: s.num() };
    else if (k === 7) { const store = s.num(); s.num(); d = { k: "bits", store }; }
    else throw kitErr("ERR_KIT_RUNTIME");
    s.vec(() => s.str());
    types.set(id, { path, d });
  });
  const pallets = s.vec(() => {
    const name = s.str();
    const storage = new Map<string, number>();
    s.opt(() => {
      s.str();
      s.vec(() => {
        const n = s.str(); s.u8();
        const kind = s.u8();
        let value: number;
        if (kind === 0) value = s.num(); else { s.vec(() => s.u8()); s.num(); value = s.num(); }
        s.vec(() => s.u8()); s.vec(() => s.str());
        storage.set(n, value);
      });
    });
    const calls = s.opt(() => s.num()), events = s.opt(() => s.num());
    const consts = new Map<string, Uint8Array>();
    s.vec(() => { const n = s.str(); s.num(); const v = Uint8Array.from(s.vec(() => s.u8())); s.vec(() => s.str()); consts.set(n, v); });
    s.opt(() => s.num());
    const idx = s.u8();
    return { name, idx, calls, events, consts, storage };
  });
  s.num();
  if (s.u8() !== 4) throw kitErr("ERR_KIT_RUNTIME");
  const exts = s.vec(() => ({ id: s.str(), extra: s.num(), add: s.num() }));
  return { types, pallets, exts };
}
const PRIM_SIZE = [1, 4, -1, 1, 2, 4, 8, 16, 32, 1, 2, 4, 8, 16, 32];
function tdef(m: DotMeta, t: number): TDef { const x = m.types.get(t); if (!x) throw kitErr("ERR_KIT_RUNTIME"); return x.d; }

export function zeroSized(m: DotMeta, t: number, depth = 0): boolean {
  if (depth > 20) return false;
  const d = tdef(m, t);
  if (d.k === "comp") return d.f.every((f) => zeroSized(m, f.t, depth + 1));
  if (d.k === "tup") return d.t.every((x) => zeroSized(m, x, depth + 1));
  if (d.k === "arr") return d.n === 0 || zeroSized(m, d.t, depth + 1);
  return false;
}

export function shape(m: DotMeta, t: number, depth = 0): string {
  if (depth > 8) return "…";
  const x = m.types.get(t);
  if (!x) throw kitErr("ERR_KIT_RUNTIME");
  const d = x.d;
  if (d.k === "prim") return ["bool", "char", "str", "u8", "u16", "u32", "u64", "u128", "u256", "i8", "i16", "i32", "i64", "i128", "i256"][d.p] ?? "?";
  if (d.k === "cmp") return `compact<${shape(m, d.t, depth + 1)}>`;
  if (d.k === "arr") return `[${shape(m, d.t, depth + 1)};${d.n}]`;
  if (d.k === "seq") return `vec<${shape(m, d.t, depth + 1)}>`;
  if (d.k === "comp") return d.f.length === 1 ? shape(m, d.f[0].t, depth + 1) : `(${d.f.map((f) => shape(m, f.t, depth + 1)).join(",")})`;
  if (d.k === "tup") return `(${d.t.map((y) => shape(m, y, depth + 1)).join(",")})`;
  if (d.k === "var") return x.path.at(-1) === "Option" ? `Option<${d.v.find((v) => v.name === "Some")?.f.map((f) => shape(m, f.t, depth + 1)).join(",") ?? "?"}>` : `enum ${x.path.at(-1) ?? ""}`;
  return "bits";
}

export function skip(m: DotMeta, t: number, s: Scale, depth = 0): void {
  if (depth > 40) throw kitErr("ERR_PROVIDER");
  const d = tdef(m, t);
  if (d.k === "prim") { if (d.p === 2) s.bytes(s.num()); else s.bytes(PRIM_SIZE[d.p]); return; }
  if (d.k === "cmp") { s.compact(); return; }
  if (d.k === "comp") { for (const f of d.f) skip(m, f.t, s, depth + 1); return; }
  if (d.k === "tup") { for (const y of d.t) skip(m, y, s, depth + 1); return; }
  if (d.k === "arr") { const sz = fixedSize(m, d.t); if (sz != null) s.bytes(sz * d.n); else for (let i = 0; i < d.n; i++) skip(m, d.t, s, depth + 1); return; }
  if (d.k === "seq") { const n = s.num(); const sz = fixedSize(m, d.t); if (sz != null) s.bytes(sz * n); else for (let i = 0; i < n; i++) skip(m, d.t, s, depth + 1); return; }
  if (d.k === "var") { const i = s.u8(); const v = d.v.find((x) => x.idx === i); if (!v) throw kitErr("ERR_PROVIDER"); for (const f of v.f) skip(m, f.t, s, depth + 1); return; }
  const bits = s.num(); const st = tdef(m, d.store); const w = st.k === "prim" ? PRIM_SIZE[st.p] : 1; s.bytes(Math.ceil(bits / (8 * w)) * w);
}
function fixedSize(m: DotMeta, t: number): number | null { const d = tdef(m, t); return d.k === "prim" && d.p !== 2 ? PRIM_SIZE[d.p] : null; }

export interface DotPlan {
  pallet: number; call: number; ed: bigint; system: number; successIdx: number; failedIdx: number; eventsType: number;
  exts: { id: string; extra: "none" | "era" | "nonce" | "tip" | "assetTip" | "mode"; add: "none" | "spec" | "tx" | "genesis" | "eraHash" | "noHash" }[];
}
const KNOWN: Record<string, [DotPlan["exts"][number]["extra"], DotPlan["exts"][number]["add"], string | null, string | null]> = {

  CheckNonZeroSender: ["none", "none", null, null], CheckWeight: ["none", "none", null, null], AuthorizeCall: ["none", "none", null, null],
  CheckSpecVersion: ["none", "spec", null, "u32"], CheckTxVersion: ["none", "tx", null, "u32"], CheckGenesis: ["none", "genesis", null, "[u8;32]"],
  CheckMortality: ["era", "eraHash", "enum Era", "[u8;32]"], CheckEra: ["era", "eraHash", "enum Era", "[u8;32]"],
  CheckNonce: ["nonce", "none", "compact<u32>", null], ChargeTransactionPayment: ["tip", "none", "compact<u128>", null],
  ChargeAssetTxPayment: ["assetTip", "none", "(compact<u128>,Option<…>)", null], CheckMetadataHash: ["mode", "noHash", "enum Mode", "Option<[u8;32]>"],
};

export function planOf(m: DotMeta): DotPlan {
  const bal = m.pallets.find((p) => p.name === "Balances"), sys = m.pallets.find((p) => p.name === "System");
  if (!bal || bal.calls == null || !sys || sys.events == null) throw kitErr("ERR_KIT_RUNTIME");
  const calls = tdef(m, bal.calls);
  const c = calls.k === "var" ? calls.v.find((v) => v.name === "transfer_keep_alive") : undefined;
  if (!c || c.f.length !== 2 || c.f[0].name !== "dest" || c.f[1].name !== "value") throw kitErr("ERR_KIT_RUNTIME");
  const dest = tdef(m, c.f[0].t), id = dest.k === "var" ? dest.v.find((v) => v.name === "Id") : undefined;
  if (!id || id.idx !== 0 || id.f.length !== 1 || shape(m, id.f[0].t) !== "[u8;32]" || shape(m, c.f[1].t) !== "compact<u128>") throw kitErr("ERR_KIT_RUNTIME");
  const edB = bal.consts.get("ExistentialDeposit");
  if (!edB || edB.length !== 16) throw kitErr("ERR_KIT_RUNTIME");
  const ed = new Scale(edB).uint(16);
  const sysEv = tdef(m, sys.events);
  const succ = sysEv.k === "var" ? sysEv.v.find((v) => v.name === "ExtrinsicSuccess") : undefined, fail = sysEv.k === "var" ? sysEv.v.find((v) => v.name === "ExtrinsicFailed") : undefined;
  const eventsType = sys.storage.get("Events");
  if (!succ || !fail || eventsType == null) throw kitErr("ERR_KIT_RUNTIME");
  const exts = m.exts.map((e) => {
    const k = KNOWN[e.id];
    if (!k) { if (zeroSized(m, e.extra) && zeroSized(m, e.add)) return { id: e.id, extra: "none" as const, add: "none" as const }; throw kitErr("ERR_KIT_RUNTIME", { ext: e.id }); }
    const [extra, add, xs, as] = k;
    const okX = xs == null ? zeroSized(m, e.extra) : xs === "(compact<u128>,Option<…>)" ? /^\(compact<u128>,Option</.test(shape(m, e.extra)) : shape(m, e.extra) === xs;
    const okA = as == null ? zeroSized(m, e.add) : shape(m, e.add) === as;
    if (!okX || !okA) throw kitErr("ERR_KIT_RUNTIME", { ext: e.id });
    return { id: e.id, extra, add };
  });
  if (!exts.some((e) => e.extra === "nonce") || !exts.some((e) => e.add === "genesis") || !exts.some((e) => e.extra === "era")) throw kitErr("ERR_KIT_RUNTIME");
  return { pallet: bal.idx, call: c.idx, ed, system: sys.idx, successIdx: succ.idx, failedIdx: fail.idx, eventsType, exts };
}

export function mortalEra(period: number, current: number): number[] {
  if (period < 4 || period > 65536 || (period & (period - 1)) !== 0 || current < 0) throw kitErr("ERR_UNSAFE");
  const phase = current % period, q = Math.max(period >> 12, 1), tz = Math.log2(period);
  const v = Math.min(15, Math.max(1, tz - 1)) | (Math.floor(phase / q) << 4);
  return [v & 0xff, v >> 8];
}
export interface DotTransfer {
  plan: DotPlan; from: Uint8Array; to: Uint8Array; amount: bigint; nonce: number;
  spec: number; txVersion: number; genesis: string; birth: number; birthHash: string; period: number;
}

export function dotParts(t: DotTransfer): { call: Uint8Array; extra: Uint8Array; add: Uint8Array } {
  if (t.from.length !== 32 || t.to.length !== 32 || t.amount <= 0n || t.amount > PLANCK_MAX || !Number.isSafeInteger(t.nonce) || t.nonce < 0 || t.nonce > 0xffffffff) throw kitErr("ERR_UNSAFE");
  const call = concat([t.plan.pallet, t.plan.call, 0], t.to, compact(t.amount));
  const extra: number[] = [], add: number[] = [];
  for (const e of t.plan.exts) {
    if (e.extra === "era") extra.push(...mortalEra(t.period, t.birth));
    else if (e.extra === "nonce") extra.push(...compact(t.nonce));
    else if (e.extra === "tip") extra.push(0);
    else if (e.extra === "assetTip") extra.push(0, 0);
    else if (e.extra === "mode") extra.push(0);
    if (e.add === "spec") add.push(...leU(BigInt(t.spec), 4));
    else if (e.add === "tx") add.push(...leU(BigInt(t.txVersion), 4));
    else if (e.add === "genesis") add.push(...unhex(t.genesis));
    else if (e.add === "eraHash") add.push(...unhex(t.birthHash));
    else if (e.add === "noHash") add.push(0);
  }
  return { call, extra: Uint8Array.from(extra), add: Uint8Array.from(add) };
}
export const dotPayload = (p: { call: Uint8Array; extra: Uint8Array; add: Uint8Array }) => { const b = concat(p.call, p.extra, p.add); return b.length > 256 ? blake2b(b, { dkLen: 32 }) : b; };
export function dotExtrinsic(from: Uint8Array, sig: Uint8Array, p: { call: Uint8Array; extra: Uint8Array }): Uint8Array {
  const body = concat([0x84, 0], from, [1], sig, p.extra, p.call);
  return concat(compact(body.length), body);
}
export const dotHash = (ext: Uint8Array) => "0x" + bytesToHex(blake2b(ext, { dkLen: 32 }));

export interface DotChain { plan: DotPlan; meta: DotMeta; spec: number; txVersion: number; genesis: string }
let cached: { spec: number; chain: DotChain } | null = null;

export async function dotChain(): Promise<DotChain> {
  const [rv, genesis] = await Promise.all([dotRpc<{ specVersion?: unknown; transactionVersion?: unknown; specName?: unknown }>("state_getRuntimeVersion"), dotRpc<string>("chain_getBlockHash", [0])]);
  const spec = Number(rv?.specVersion), txVersion = Number(rv?.transactionVersion);
  if (genesis !== DOT_GENESIS || rv?.specName !== "statemint" || !Number.isSafeInteger(spec) || !Number.isSafeInteger(txVersion)) throw kitErr("ERR_KIT_RUNTIME");
  if (cached?.spec === spec) return cached.chain;
  const meta = parseMeta(unhex(await dotRpc<string>("state_getMetadata", [], { timeoutMs: 30_000 })));
  const chain = { plan: planOf(meta), meta, spec, txVersion, genesis };
  cached = { spec, chain };
  return chain;
}

export async function dotHead(): Promise<{ number: number; hash: string }> {
  const hash = await dotRpc<string>("chain_getFinalizedHead");
  const h = await dotRpc<{ number?: unknown }>("chain_getHeader", [hash]);
  const n = Number.parseInt(String(h?.number ?? ""), 16);
  if (!Number.isSafeInteger(n) || n <= 0 || unhex(hash).length !== 32) throw kitErr("ERR_PROVIDER");
  return { number: n, hash };
}

async function bestNumber(): Promise<number> {
  const h = await dotRpc<{ number?: unknown }>("chain_getHeader");
  const n = Number.parseInt(String(h?.number ?? ""), 16);
  if (!Number.isSafeInteger(n) || n <= 0) throw kitErr("ERR_PROVIDER");
  return n;
}
export async function dotNonce(address: string): Promise<number> {
  const n = await dotRpc<unknown>("system_accountNextIndex", [address]);
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw kitErr("ERR_PROVIDER");
  return n;
}

export function readDotFee(h: unknown): bigint {
  const s = new Scale(unhex(h));
  s.compact(); s.compact(); s.u8();
  const fee = s.uint(16);
  if (!s.done) throw kitErr("ERR_PROVIDER");
  return fee;
}
const INVALID = ["Call", "Payment", "Future", "Stale", "BadProof", "AncientBirthBlock", "ExhaustsResources", "Custom", "BadMandatory", "MandatoryValidation", "BadSigner", "IndeterminateImplicit", "UnknownOrigin"];

export function readValidity(h: unknown): string | null {
  const b = unhex(h);
  if (b[0] === 0) return null;
  if (b[0] !== 1) throw kitErr("ERR_PROVIDER");
  if (b[1] === 0) return `Invalid${INVALID[b[2]] ?? b[2]}${b[2] === 7 ? `(${b[3]})` : ""}`;
  return `Unknown(${b[2]})`;
}
export const dotValidate = async (ext: Uint8Array, at: string) => readValidity(await dotRpc("state_call", ["TaggedTransactionQueue_validate_transaction", hex(concat([2], ext, unhex(at)))]));

export interface DotQuote { from: string; to: string; amount: bigint; fee: bigint; reserve: bigint; newAccount: boolean }
export function dotRecipient(input: string): string {
  const v = String(input ?? "").trim();
  if (!ss58Decode(v)) throw kitErr("ERR_ADDRESS");
  return v;
}

export function checkDotFunds(o: { amount: bigint; fee: bigint; transferable: bigint; newAccount: boolean; ed: bigint; reserve: bigint }): void {
  if (o.amount <= 0n) throw kitErr("ERR_ZERO");
  if (o.newAccount && o.amount < o.ed) throw kitErr("ERR_KIT_MIN", { need: o.ed });
  if (o.amount + o.fee > o.transferable) { const max = o.transferable - o.fee; throw kitErr("ERR_FUNDS", { max: max > 0n ? max : 0n, reserve: o.reserve }); }
}
async function estimate(ch: DotChain, from: Uint8Array, to: Uint8Array, amount: bigint, nonce: number): Promise<bigint> {
  const head = await dotHead();
  const p = dotParts({ plan: ch.plan, from, to, amount, nonce, spec: ch.spec, txVersion: ch.txVersion, genesis: ch.genesis, birth: head.number, birthHash: head.hash, period: DOT_ERA_PERIOD });
  const ext = dotExtrinsic(from, new Uint8Array(64), p);
  const fee = readDotFee(await dotRpc("state_call", ["TransactionPaymentApi_query_info", hex(concat(ext, leU(BigInt(ext.length), 4)))]));
  const bound = fee + fee / 2n;
  if (bound > MAX_DOT_FEE) throw kitErr("ERR_FEE_HIGH", { fee: bound });
  return bound;
}
export async function quoteDotSend(phrase: string, index: number, toInput: string, amountText: string): Promise<DotQuote> {
  const pub = dotPublicKey(dotSecret(phrase, index)), from = ss58Of(pub), to = dotRecipient(toInput), amount = parseDot(amountText);
  if (amount <= 0n) throw kitErr("ERR_ZERO");
  if (to === from) throw kitErr("ERR_SELF");
  const [ch, me, dest, nonce] = await Promise.all([dotChain(), dotAccount(from), dotAccount(to), dotNonce(from)]);
  if (!me.exists || me.free === 0n) throw kitErr("ERR_KIT_INACTIVE");
  const fee = await estimate(ch, pub, ss58Decode(to)!, amount, nonce);
  const reserve = me.free - dotTransferable(me, ch.plan.ed) > 0n ? me.free - dotTransferable(me, ch.plan.ed) : 0n;
  checkDotFunds({ amount, fee, transferable: dotTransferable(me, ch.plan.ed), newAccount: !dest.exists, ed: ch.plan.ed, reserve });
  return { from, to, amount, fee, reserve, newAccount: !dest.exists };
}
export async function dotSpendable(phrase: string, index: number): Promise<bigint> {
  const pub = dotPublicKey(dotSecret(phrase, index)), from = ss58Of(pub);
  const [ch, me, nonce] = await Promise.all([dotChain(), dotAccount(from), dotNonce(from)]);
  const tr = dotTransferable(me, ch.plan.ed);
  if (tr === 0n) return 0n;
  const fee = await estimate(ch, pub, new Uint8Array(32).fill(5), tr, nonce);
  return tr > fee ? tr - fee : 0n;
}

export interface DotSigned { from: string; to: string; amount: bigint; fee: bigint; hash: string; ext: string; nonce: number; birth: number; period: number; spec: number }
export async function signDotSend(phrase: string, index: number, q: DotQuote): Promise<DotSigned> {
  const secret = dotSecret(phrase, index), pub = dotPublicKey(secret), from = ss58Of(pub);
  if (from !== q.from || q.fee > MAX_DOT_FEE || q.amount <= 0n || q.to === q.from || !isDotAddress(q.to)) throw kitErr("ERR_UNSAFE");
  const [ch, me, dest, nonce, head] = await Promise.all([dotChain(), dotAccount(from), dotAccount(q.to), dotNonce(from), dotHead()]);
  checkDotFunds({ amount: q.amount, fee: q.fee, transferable: dotTransferable(me, ch.plan.ed), newAccount: !dest.exists, ed: ch.plan.ed, reserve: q.reserve });
  const p = dotParts({ plan: ch.plan, from: pub, to: ss58Decode(q.to)!, amount: q.amount, nonce, spec: ch.spec, txVersion: ch.txVersion, genesis: ch.genesis, birth: head.number, birthHash: head.hash, period: DOT_ERA_PERIOD });
  const msg = dotPayload(p), sig = dotSign(secret, msg);
  if (sig.length !== 64 || !dotVerify(msg, sig, pub)) throw kitErr("ERR_UNSAFE");
  const ext = dotExtrinsic(pub, sig, p);

  const why = await dotValidate(ext, head.hash);
  if (why) throw kitErr("ERR_KIT_SIM", { code: why });
  return { from, to: q.to, amount: q.amount, fee: q.fee, hash: dotHash(ext), ext: hex(ext), nonce, birth: head.number, period: DOT_ERA_PERIOD, spec: ch.spec };
}

export function readOutcome(m: DotMeta, plan: DotPlan, eventsHex: unknown, index: number): KitEnd | null {
  const s = new Scale(unhex(eventsHex));
  const vec = tdef(m, plan.eventsType);
  if (vec.k !== "seq") throw kitErr("ERR_PROVIDER");
  const rec = tdef(m, vec.t);
  if (rec.k !== "comp" || rec.f.length !== 3) throw kitErr("ERR_PROVIDER");
  const [phaseT, eventT, topicsT] = rec.f.map((f) => f.t);
  const outer = tdef(m, eventT);
  if (outer.k !== "var") throw kitErr("ERR_PROVIDER");
  const n = s.num();
  for (let k = 0; k < n; k++) {
    const ph = s.u8();
    const at = ph === 0 ? Number(s.uint(4)) : -1;
    if (ph > 2) throw kitErr("ERR_PROVIDER");
    void phaseT;
    const pi = s.u8(), pv = outer.v.find((v) => v.idx === pi);
    if (!pv || pv.f.length !== 1) throw kitErr("ERR_PROVIDER");
    const inner = tdef(m, pv.f[0].t);
    if (inner.k !== "var") throw kitErr("ERR_PROVIDER");
    const ei = s.u8(), ev = inner.v.find((v) => v.idx === ei);
    if (!ev) throw kitErr("ERR_PROVIDER");
    for (const f of ev.f) skip(m, f.t, s);
    skip(m, topicsT, s);
    if (at === index && pi === plan.system) {
      if (ei === plan.successIdx) return { state: "ok" };
      if (ei === plan.failedIdx) return { state: "failed", code: "ExtrinsicFailed" };
    }
  }
  return null;
}
const EVENTS_KEY = hex(concat(twox128("System"), twox128("Events")));
type Seen = { scanned: number; found: { block: string; index: number } | null };
const seen = new Map<string, Seen>();

async function scan(s: DotSigned, head: number, max = 40): Promise<Seen> {
  const st = seen.get(s.hash) ?? { scanned: s.birth - 1, found: null };
  const last = Math.min(head, s.birth + s.period);
  const ext = s.ext.toLowerCase();
  for (let n = st.scanned + 1; n <= last && n <= st.scanned + max && !st.found; n++) {
    const h = await dotRpc<string>("chain_getBlockHash", [n]);
    const b = await dotRpc<{ block?: { extrinsics?: unknown } }>("chain_getBlock", [h], { timeoutMs: 20_000 });
    const xs = b?.block?.extrinsics;
    if (!Array.isArray(xs)) throw kitErr("ERR_PROVIDER");
    const i = xs.findIndex((x) => typeof x === "string" && x.toLowerCase() === ext);
    if (i >= 0) st.found = { block: h, index: i };
    st.scanned = n;
  }
  seen.set(s.hash, st);
  return st;
}

export function judgeDot(st: Seen, s: Pick<DotSigned, "birth" | "period" | "nonce">, head: number, nonce: number | null, outcome: KitEnd | null): KitEnd | null {
  if (st.found) return outcome ?? { state: "ok" };
  if (head <= s.birth + s.period + 1) return null;
  if (st.scanned >= s.birth + s.period) return { state: "dropped" };
  if (nonce != null && nonce <= s.nonce) return { state: "dropped" };
  return null;
}
async function lookDot(s: DotSigned): Promise<KitEnd | null> {
  const head = await bestNumber();
  const st = await scan(s, head);
  let outcome: KitEnd | null = null;
  if (st.found) {
    const ch = await dotChain().catch(() => null);
    if (ch) outcome = await dotRpc("state_getStorage", [EVENTS_KEY, st.found.block], { timeoutMs: 20_000 }).then((ev) => readOutcome(ch.meta, ch.plan, ev, st.found!.index)).catch(() => null);
  }
  const nonce = st.found ? null : await dotNonce(s.from).catch(() => null);
  return judgeDot(st, s, head, nonce, outcome);
}
export async function submitDot(s: DotSigned): Promise<KitSubmit> {
  let unclear = false;
  for (const h of [DOT_RPCS[0], DOT_RPCS[1]]) {
    try {
      const r = await dotRpc<string>("author_submitExtrinsic", [s.ext], { hosts: [h], timeoutMs: 20_000 });
      if (r !== s.hash) throw kitErr("ERR_UNSAFE");
      break;
    } catch (e) {
      if (e instanceof DotError && !unclear && !/Stale|AlreadyImported|Temporarily|Priority|Future/i.test(e.detail)) {

        const n = await dotNonce(s.from).catch(() => null);
        if (n != null && n <= s.nonce) return { state: "refused", code: e.detail.slice(0, 120) };
      }
      unclear = true;
    }
  }
  const end = await waitDot(s, Date.now(), { maxMs: 25_000, everyMs: 4_000 });
  return end.state === "ok" ? { state: "ok" } : end.state === "failed" ? end : { state: "unknown" };
}
export async function waitDot(s: DotSigned, _at: number, o: { maxMs?: number; everyMs?: number } = {}): Promise<KitEnd> {
  const until = Date.now() + (o.maxMs ?? 30_000), every = o.everyMs ?? 4_000;
  for (;;) {
    const end = await lookDot(s).catch(() => null);
    if (end) return end;
    if (Date.now() + every > until) return { state: "pending" };
    await new Promise((r) => setTimeout(r, every));
  }
}

export const dotPendingOf = (s: DotSigned): Omit<PendingPayment, "at"> => ({
  networkId: DOT.id, from: s.from, hash: s.hash,
  data: { to: s.to, amount: s.amount.toString(), fee: s.fee.toString(), ext: s.ext, nonce: s.nonce, birth: s.birth, period: s.period, spec: s.spec },
});

export function dotSignedOf(p: PendingPayment | null): DotSigned | null {
  if (!p || p.networkId !== DOT.id) return null;
  const d = p.data;
  try {
    const s: DotSigned = { from: String(p.from), to: String(d.to), amount: BigInt(String(d.amount)), fee: BigInt(String(d.fee)), hash: String(p.hash), ext: String(d.ext),
      nonce: Number(d.nonce), birth: Number(d.birth), period: Number(d.period), spec: Number(d.spec) };
    if (![s.nonce, s.birth, s.period, s.spec].every(Number.isSafeInteger) || s.period !== DOT_ERA_PERIOD) return null;
    const ext = unhex(s.ext);
    if (dotHash(ext) !== s.hash) return null;
    const r = new Scale(ext);
    const len = r.num();
    if (r.i + len !== ext.length || r.u8() !== 0x84 || r.u8() !== 0) return null;
    const from = r.bytes(32);
    if (ss58Of(from) !== s.from || r.u8() !== 1) return null;
    r.bytes(64);

    const tail = concat([0], ss58Decode(s.to)!, compact(s.amount));
    const call = ext.slice(ext.length - tail.length - 2);
    if (bytesToHex(call.slice(2)) !== bytesToHex(tail)) return null;
    return s;
  } catch { return null; }
}

export const DOT_KIT: SendKit<DotQuote, DotSigned> = {
  id: DOT.id, name: DOT.name, symbol: DOT.symbol, decimals: DOT.decimals, family: "dot", placeholder: "1…",
  address: dotAddress, format: formatDot, quote: quoteDotSend, spendable: dotSpendable, sign: signDotSend, submit: submitDot,
  wait: waitDot, pendingOf: dotPendingOf, signedOf: dotSignedOf, txUrl: dotTxUrl,
};
