import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { Token } from "./chains";
import { DEMO_TRX_SUN, demoOn } from "./demo";
import { parseUnitsStr } from "./solbase";
import {
  hexToTron, isTronAddress, TRON, tronAccount, tronAddress, tronHexFromPublicKey, tronKeys, tronPost, tronToHex, tronWord, trc20Balance, uintWord,
} from "./tronbase";
export * from "./tronbase";

export const unsafe = (why: string) => Object.assign(new Error("ERR_UNSAFE"), { why });
const hex = (b: Uint8Array) => bytesToHex(b);
const fromHex = (h: string): Uint8Array => { const s = String(h ?? "").replace(/^0x/, ""); if (!/^([0-9a-fA-F]{2})*$/.test(s)) throw unsafe("hex"); return hexToBytes(s.toLowerCase()); };

export const MAX_TRC20_FEE_LIMIT_SUN = 50_000_000;

export const MAX_BUILD_AHEAD_MS = 10 * 60_000;
export const SUN = 1_000_000n;

function reader(bytes: Uint8Array) {
  let i = 0;
  const varint = (): bigint => {
    let v = 0n, shift = 0n;
    for (;;) {
      if (i >= bytes.length) throw unsafe("pb varint");
      const b = bytes[i++];
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
      shift += 7n;
      if (shift > 63n) throw unsafe("pb varint");
    }
  };
  return {
    done: () => i >= bytes.length,
    field(): { no: number; wt: number; v: bigint | Uint8Array | null } {
      const key = Number(varint()), no = key >>> 3, wt = key & 7;
      if (no === 0) throw unsafe("pb field");
      if (wt === 0) return { no, wt, v: varint() };
      if (wt === 2) { const n = Number(varint()); if (n < 0 || i + n > bytes.length) throw unsafe("pb length"); const v = bytes.slice(i, i + n); i += n; return { no, wt, v }; }
      if (wt === 1) { if (i + 8 > bytes.length) throw unsafe("pb fixed64"); i += 8; return { no, wt, v: null }; }
      if (wt === 5) { if (i + 4 > bytes.length) throw unsafe("pb fixed32"); i += 4; return { no, wt, v: null }; }
      throw unsafe("pb wire type");
    },
  };
}
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const asBytes = (f: { wt: number; v: unknown }) => { if (f.wt !== 2) throw unsafe("pb type"); return f.v as Uint8Array; };
const asInt = (f: { wt: number; v: unknown }) => { if (f.wt !== 0) throw unsafe("pb type"); return f.v as bigint; };

const once = (seen: Set<number>, no: number) => { if (seen.has(no)) throw unsafe("pb repeated"); seen.add(no); };

export interface TronCall { owner?: string; contract?: string; callValue?: bigint; data?: string; extra: number[] }
export interface TronTransfer { owner?: string; to?: string; amount?: bigint; extra: number[] }
export interface TronContract { type?: number; typeUrl?: string; permissionId?: number; extra: (number | string)[]; call?: TronCall; transfer?: TronTransfer }
export interface TronRaw { refBlockBytes?: string; refBlockNum?: bigint; refBlockHash?: string; expiration?: number; timestamp?: number; feeLimit?: number; contracts: TronContract[]; extra: number[];  data?: string }

export function decodeTronRaw(rawHex: string): TronRaw {
  const r = reader(fromHex(rawHex)), out: TronRaw = { contracts: [], extra: [] }, seen = new Set<number>();
  while (!r.done()) {
    const f = r.field();
    if (f.no !== 11) once(seen, f.no);
    switch (f.no) {
      case 1: out.refBlockBytes = hex(asBytes(f)); break;
      case 3: out.refBlockNum = asInt(f); break;
      case 4: out.refBlockHash = hex(asBytes(f)); break;
      case 8: out.expiration = Number(asInt(f)); break;
      case 14: out.timestamp = Number(asInt(f)); break;
      case 18: out.feeLimit = Number(asInt(f)); break;
      case 11: out.contracts.push(decodeContract(asBytes(f))); break;
      case 10: out.data = hex(asBytes(f)); break;
      default: out.extra.push(f.no);
    }
  }
  return out;
}
function decodeContract(bytes: Uint8Array): TronContract {
  const r = reader(bytes), c: TronContract = { extra: [] }, seen = new Set<number>();
  let value: Uint8Array | undefined;
  while (!r.done()) {
    const f = r.field();
    once(seen, f.no);
    if (f.no === 1) c.type = Number(asInt(f));
    else if (f.no === 2) {
      const a = reader(asBytes(f)), s2 = new Set<number>();
      while (!a.done()) { const g = a.field(); once(s2, g.no); if (g.no === 1) c.typeUrl = text(asBytes(g)); else if (g.no === 2) value = asBytes(g); else c.extra.push("any." + g.no); }
    } else if (f.no === 5) c.permissionId = Number(asInt(f));
    else c.extra.push(f.no);
  }
  if (c.type === 31 && value) {
    const t = reader(value), s3 = new Set<number>();
    c.call = { extra: [] };
    while (!t.done()) {
      const g = t.field();
      once(s3, g.no);
      if (g.no === 1) c.call.owner = hex(asBytes(g));
      else if (g.no === 2) c.call.contract = hex(asBytes(g));
      else if (g.no === 3) c.call.callValue = asInt(g);
      else if (g.no === 4) c.call.data = hex(asBytes(g));
      else c.call.extra.push(g.no);
    }
  } else if (c.type === 1 && value) {
    const t = reader(value), s3 = new Set<number>();
    c.transfer = { extra: [] };
    while (!t.done()) {
      const g = t.field();
      once(s3, g.no);
      if (g.no === 1) c.transfer.owner = hex(asBytes(g));
      else if (g.no === 2) c.transfer.to = hex(asBytes(g));
      else if (g.no === 3) c.transfer.amount = asInt(g);
      else c.transfer.extra.push(g.no);
    }
  }
  return c;
}

export interface TronTx { txID: string; raw_data: any; raw_data_hex: string; visible?: boolean }
const TYPE_URL: Record<number, string> = { 1: "type.googleapis.com/protocol.TransferContract", 31: "type.googleapis.com/protocol.TriggerSmartContract" };
const jHex = (a: unknown) => { try { const s = String(a ?? ""); return /^T/.test(s) ? tronToHex(s) : s.toLowerCase(); } catch { return ""; } };

export function checkEnvelope(tt: TronTx, o: { owner: string; type: 1 | 31; maxFeeLimit: number; nowMs: number; maxAheadMs?: number;  memo?: string }): { raw: TronRaw; c: TronContract } {
  if (!tt || typeof tt.raw_data_hex !== "string" || typeof tt.txID !== "string" || !/^[0-9a-fA-F]{64}$/.test(tt.txID)) throw unsafe("tron tx");
  if (hex(sha256(fromHex(tt.raw_data_hex))) !== tt.txID.toLowerCase()) throw unsafe("txID");
  const raw = decodeTronRaw(tt.raw_data_hex);
  if (raw.extra.length) throw unsafe("tron extra fields");

  if ((raw.data ?? "") !== (o.memo ?? "").toLowerCase() || (o.memo != null && o.type !== 1)) throw unsafe("tron memo");
  if (raw.contracts.length !== 1) throw unsafe("tron contracts");
  const c = raw.contracts[0];
  if (c.type !== o.type || c.typeUrl !== TYPE_URL[o.type] || c.extra.length || (c.permissionId ?? 0) !== 0) throw unsafe("tron contract type");
  const owner = tronToHex(o.owner);
  if (o.type === 31) {
    if (!c.call || c.call.extra.length) throw unsafe("tron call fields");
    if (c.call.owner !== owner) throw unsafe("tron owner");
    if ((c.call.callValue ?? 0n) !== 0n) throw unsafe("tron value");
    if (!(raw.feeLimit! > 0) || raw.feeLimit! > o.maxFeeLimit) throw unsafe("tron fee limit");
  } else {
    if (!c.transfer || c.transfer.extra.length) throw unsafe("tron transfer fields");
    if (c.transfer.owner !== owner) throw unsafe("tron owner");
    if ((raw.feeLimit ?? 0) !== 0) throw unsafe("tron fee limit");
  }
  const maxAhead = o.maxAheadMs ?? MAX_BUILD_AHEAD_MS;
  if (!(raw.expiration! > o.nowMs) || raw.expiration! > o.nowMs + maxAhead) throw unsafe("tron expiration");

  const rd = tt.raw_data ?? {}, k = rd.contract?.[0], j = k?.parameter?.value ?? {};
  if ((rd.contract?.length ?? 0) !== 1 || k?.parameter?.type_url !== c.typeUrl || Number(rd.expiration) !== raw.expiration || Number(rd.fee_limit ?? 0) !== (raw.feeLimit ?? 0)) throw unsafe("tron json");
  if (String(rd.data ?? "").toLowerCase() !== (raw.data ?? "")) throw unsafe("tron json");
  if (o.type === 31) {
    if (jHex(j.owner_address) !== c.call!.owner || jHex(j.contract_address) !== c.call!.contract || String(j.data ?? "").toLowerCase() !== (c.call!.data ?? "") || Number(j.call_value ?? 0) !== 0) throw unsafe("tron json");
  } else {
    let amt: bigint;
    try { amt = BigInt(j.amount); } catch { throw unsafe("tron json"); }
    if (jHex(j.owner_address) !== c.transfer!.owner || jHex(j.to_address) !== c.transfer!.to || amt !== c.transfer!.amount) throw unsafe("tron json");
  }
  return { raw, c };
}

export function checkTrxTransfer(tt: TronTx, e: { owner: string; to: string; amount: bigint; nowMs?: number; memo?: string }): TronTx {
  const { c } = checkEnvelope(tt, { owner: e.owner, type: 1, maxFeeLimit: 0, nowMs: e.nowMs ?? Date.now(), memo: e.memo });
  if (c.transfer!.to !== tronToHex(e.to)) throw unsafe("tron recipient");
  if (c.transfer!.amount !== e.amount || e.amount <= 0n) throw unsafe("tron amount");
  return tt;
}

export function checkTronCall(tt: TronTx, e: { owner: string; contract: string; data: string; maxFeeLimit: number; feeLimit?: number; nowMs?: number; maxAheadMs?: number }): TronTx {
  const { raw, c } = checkEnvelope(tt, { owner: e.owner, type: 31, maxFeeLimit: e.maxFeeLimit, nowMs: e.nowMs ?? Date.now(), maxAheadMs: e.maxAheadMs });
  if (c.call!.contract !== tronToHex(e.contract)) throw unsafe("tron contract");
  if (c.call!.data !== e.data.toLowerCase()) throw unsafe("tron call");
  if (e.feeLimit != null && raw.feeLimit !== e.feeLimit) throw unsafe("tron fee limit");
  return tt;
}
export const transferData = (to: string, amount: bigint) => "a9059cbb" + tronWord(to) + uintWord(amount);
export const approveData = (spender: string, amount: bigint) => "095ea7b3" + tronWord(spender) + uintWord(amount);

export function checkTrc20Transfer(tt: TronTx, e: { owner: string; token: string; to: string; amount: bigint; feeLimit?: number; nowMs?: number }): TronTx {
  if (e.amount <= 0n) throw unsafe("tron amount");
  return checkTronCall(tt, { owner: e.owner, contract: e.token, data: transferData(e.to, e.amount), maxFeeLimit: MAX_TRC20_FEE_LIMIT_SUN, feeLimit: e.feeLimit, nowMs: e.nowMs });
}

export function signedHex(rawHex: string, sig: Uint8Array): string {
  if (sig.length !== 65) throw unsafe("signature");
  const raw = fromHex(rawHex);
  const varint = (n: number) => { const o: number[] = []; while (n > 0x7f) { o.push((n & 0x7f) | 0x80); n >>>= 7; } o.push(n); return o; };
  return hex(Uint8Array.from([0x0a, ...varint(raw.length), ...raw, 0x12, 65, ...sig]));
}

export const txBandwidth = (rawHex: string) => { const n = rawHex.length / 2; return 1 + (n > 127 ? (n > 16383 ? 3 : 2) : 1) + n + 67 + 64; };

export function signTronTx(tt: TronTx, phrase: string, index: number, owner: string): { txID: string; hex: string } {
  if (hex(sha256(fromHex(tt.raw_data_hex))) !== tt.txID.toLowerCase()) throw unsafe("txID");
  const { privateKey, publicKey } = tronKeys(phrase, index);
  if (hexToTron(tronHexFromPublicKey(publicKey)) !== owner) throw unsafe("owner key");
  const h = fromHex(tt.txID);
  const rec = secp256k1.sign(h, privateKey, { prehash: false, format: "recovered" });
  privateKey.fill(0);
  const back = secp256k1.recoverPublicKey(rec, h, { prehash: false });
  if (hexToTron(tronHexFromPublicKey(back)) !== owner) throw unsafe("signature");
  const sig = new Uint8Array(65);
  sig.set(rec.slice(1, 65), 0);
  sig[64] = rec[0] + 27;
  return { txID: tt.txID.toLowerCase(), hex: signedHex(tt.raw_data_hex, sig) };
}

const nodeText = (m: unknown) => { const s = String(m ?? ""); if (/^([0-9a-f]{2})+$/i.test(s)) { try { return text(fromHex(s)); } catch { return s; } } return s; };

export async function tronBroadcast(signed: { txID: string; hex: string }): Promise<string> {
  const j = await tronPost<{ result?: boolean; txid?: string; code?: string; message?: string }>("/wallet/broadcasthex", { transaction: signed.hex }, { timeoutMs: 20_000 });
  if (j?.result === true || j?.code === "DUP_TRANSACTION_ERROR") {
    if (j.txid && j.txid.toLowerCase() !== signed.txID) throw unsafe("broadcast txid");
    return signed.txID;
  }
  throw Object.assign(new Error(j?.code === "SIGERROR" ? "ERR_UNSAFE" : "ERR_BROADCAST"), { why: `${j?.code ?? ""} ${nodeText(j?.message).slice(0, 120)}` });
}

export type TronResult = "SUCCESS" | "FAILED";

export async function tronTxResult(txID: string): Promise<TronResult | null> {
  const j = await tronPost<{ id?: string; result?: string; receipt?: { result?: string } }>("/wallet/gettransactioninfobyid", { value: txID });
  if (!j?.id) return null;
  return j.result === "FAILED" || (j.receipt?.result && j.receipt.result !== "SUCCESS") ? "FAILED" : "SUCCESS";
}

export async function waitTron(txID: string, o: { maxMs?: number; everyMs?: number; sleep?: (ms: number) => Promise<void>; read?: typeof tronTxResult } = {}): Promise<void> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))), read = o.read ?? tronTxResult;
  const end = Date.now() + (o.maxMs ?? 90_000);
  for (;;) {
    await sleep(o.everyMs ?? 3_000);
    const r = await read(txID).catch(() => null);
    if (r === "SUCCESS") return;
    if (r === "FAILED") throw Object.assign(new Error("ERR_CHAIN"), { hash: txID });
    if (Date.now() > end) throw Object.assign(new Error("ERR_PENDING"), { hash: txID });
  }
}

export async function tronSettle(txID: string, expiration: number, o: { everyMs?: number; graceMs?: number; sleep?: (ms: number) => Promise<void>; read?: typeof tronTxResult; now?: () => number } = {}): Promise<"landed" | "dropped" | "unknown"> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))), read = o.read ?? tronTxResult, now = o.now ?? Date.now;
  const end = expiration + (o.graceMs ?? 30_000);
  for (;;) {
    let r: TronResult | null | undefined;
    try { r = await read(txID); } catch { r = undefined; }
    if (r === "SUCCESS" || r === "FAILED") return "landed";
    if (now() > end) return r === null ? "dropped" : "unknown";
    await sleep(o.everyMs ?? 3_000);
  }
}

export interface TronPrices { energySun: number; byteSun: number; newAccountSun: number; newAccountBandwidthSun: number;  memoSun?: number }
let pricesCache: { at: number; v: TronPrices } | null = null;

export function readPrices(j: { chainParameter?: { key: string; value?: number }[] }): TronPrices {
  const p = (k: string, d: number) => { const v = Number(j?.chainParameter?.find((x) => x.key === k)?.value); return Number.isFinite(v) && v >= 0 && v < 1e10 ? v : d; };
  return { energySun: p("getEnergyFee", 100), byteSun: p("getTransactionFee", 1000), newAccountSun: p("getCreateNewAccountFeeInSystemContract", 1_000_000), newAccountBandwidthSun: p("getCreateAccountFee", 100_000), memoSun: p("getMemoFee", 1_000_000) };
}
export async function tronPrices(): Promise<TronPrices> {
  if (pricesCache && Date.now() - pricesCache.at < 600_000) return pricesCache.v;
  const v = readPrices(await tronPost("/wallet/getchainparameters", {}));
  pricesCache = { at: Date.now(), v };
  return v;
}
export interface TronResource { freeBandwidth: number; stakedBandwidth: number; energy: number }
export function readResource(j: any): TronResource {
  const n = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  return { freeBandwidth: Math.max(0, n(j?.freeNetLimit) - n(j?.freeNetUsed)), stakedBandwidth: Math.max(0, n(j?.NetLimit) - n(j?.NetUsed)), energy: Math.max(0, n(j?.EnergyLimit) - n(j?.EnergyUsed)) };
}
export const tronResource = async (address: string) => readResource(await tronPost("/wallet/getaccountresource", { address, visible: true }));

export async function tronEnergy(owner: string, contract: string, data: string): Promise<number> {
  const j = await tronPost<any>("/wallet/triggerconstantcontract", { owner_address: owner, contract_address: contract, data: data.replace(/^0x/, ""), visible: true });
  return readEnergy(j);
}
export function readEnergy(j: any): number {
  if (!j?.result?.result || j.result.message || j.transaction?.ret?.[0]?.ret === "FAILED") throw Object.assign(new Error("ERR_TRON_CALL"), { why: nodeText(j?.result?.message).slice(0, 80) });
  const e = Number(j.energy_used ?? 0);
  if (!Number.isFinite(e) || e < 0) throw new Error("ERR_TRON_CALL");
  return e;
}

export function tronFee(o: { bandwidth: number; energy: number; newAccount?: boolean; memo?: boolean; res: TronResource; prices: TronPrices }): { fee: bigint; need: bigint; burnsBandwidth: boolean; burnsEnergy: boolean } {
  let bw = 0n, burnsBandwidth = false;
  if (o.newAccount) {
    bw = BigInt(o.prices.newAccountSun) + (o.res.stakedBandwidth >= o.bandwidth ? 0n : BigInt(o.prices.newAccountBandwidthSun));
    burnsBandwidth = o.res.stakedBandwidth < o.bandwidth;
  } else if (o.res.stakedBandwidth < o.bandwidth && o.res.freeBandwidth < o.bandwidth) {
    bw = BigInt(o.bandwidth) * BigInt(o.prices.byteSun);
    burnsBandwidth = true;
  }
  const short = Math.max(0, o.energy - o.res.energy);
  const en = BigInt(short) * BigInt(o.prices.energySun);
  const memo = o.memo ? BigInt(o.prices.memoSun ?? 1_000_000) : 0n;
  return { fee: bw + en + memo, need: bw + memo + (en * 12n + 9n) / 10n, burnsBandwidth, burnsEnergy: short > 0 };
}

export interface TronQuote {
  kind: "trx" | "token"; to: string; amount: bigint; token?: Token;
   memo?: string;

  fee: bigint; need: bigint; have: bigint; energy: number; bandwidth: number; newAccount: boolean; burnsEnergy: boolean; burnsBandwidth: boolean;
}
const build = async (owner: string, to: string, amount: bigint, token?: Token, memo?: string): Promise<TronTx> => {
  if (!token) {

    const memoText = memo ? new TextDecoder("utf-8", { fatal: true }).decode(fromHex(memo)) : "";
    if (memo && !/^[\x20-\x7e]+$/.test(memoText)) throw unsafe("tron memo text");
    const j = await tronPost<any>("/wallet/createtransaction", { owner_address: owner, to_address: to, amount: Number(amount), visible: true, ...(memo ? { extra_data: memoText } : {}) });
    if (!j?.raw_data_hex) throw Object.assign(new Error(/balance is not sufficient/i.test(String(j?.Error ?? "")) ? "ERR_FUNDS" : "ERR_TRON_BUILD"), { why: String(j?.Error ?? "").slice(0, 120) });
    return checkTrxTransfer(j, { owner, to, amount, memo });
  }
  if (memo) throw unsafe("memo on a token transfer");
  const data = transferData(to, amount);
  const j = await tronPost<any>("/wallet/triggersmartcontract", {
    owner_address: owner, contract_address: token.address, function_selector: "transfer(address,uint256)", parameter: data.slice(8), fee_limit: MAX_TRC20_FEE_LIMIT_SUN, call_value: 0, visible: true,
  });
  if (!j?.result?.result || !j.transaction) throw Object.assign(new Error("ERR_TRON_BUILD"), { why: nodeText(j?.result?.message).slice(0, 120) });
  return checkTrc20Transfer(j.transaction, { owner, token: token.address, to, amount, feeLimit: MAX_TRC20_FEE_LIMIT_SUN });
};
const isVerifiedTronToken = (t: Token) => TRON.tokens.some((x) => x.address === t.address && x.decimals === t.decimals);

export async function quoteTronSend(phrase: string, index: number, to: string, amountStr: string, token?: Token, memoBytes?: Uint8Array): Promise<TronQuote> {
  const memo = memoBytes && memoBytes.length ? hex(memoBytes) : undefined;
  if (memo && (token || memoBytes!.length > 120)) throw unsafe("tron memo");
  const dest = to.trim();
  if (!isTronAddress(dest)) throw new Error("ERR_ADDRESS");
  if (token && !isVerifiedTronToken(token)) throw new Error("ERR_TOKEN");
  const from = tronAddress(phrase, index);
  if (dest === from) throw new Error("ERR_SELF");
  const amount = parseUnitsStr(amountStr, token ? token.decimals : TRON.decimals);
  if (amount <= 0n) throw new Error("ERR_ZERO");
  if (amount > 2n ** 63n - 1n) throw new Error("ERR_AMOUNT");
  if (TRON.tokens.some((x) => x.address === dest)) throw new Error("ERR_PROGRAM");
  if (import.meta.env.DEV && demoOn()) return demoQuote(dest, amount, token);
  const [me, dst, res, prices] = await Promise.all([tronAccount(from), tronPost<{ address?: string; type?: string; create_time?: number }>("/wallet/getaccount", { address: dest, visible: true }), tronResource(from), tronPrices()]);
  if (dst?.type === "Contract") throw new Error("ERR_PROGRAM");
  const newAccount = !(dst?.address || dst?.create_time);
  if (!token) {
    if (me.sun < amount) throw new Error("ERR_FUNDS");
    const tx = await build(from, dest, amount, undefined, memo);
    const bandwidth = txBandwidth(tx.raw_data_hex);
    const f = tronFee({ bandwidth, energy: 0, newAccount, memo: !!memo, res, prices });
    if (me.sun < amount + f.need) throw Object.assign(new Error("ERR_TRX_FEE"), { need: amount + f.need, have: me.sun });
    return { kind: "trx", to: dest, amount, ...(memo ? { memo } : {}), fee: f.fee, need: amount + f.need, have: me.sun, energy: 0, bandwidth, newAccount, burnsEnergy: false, burnsBandwidth: f.burnsBandwidth };
  }
  const have = await trc20Balance(from, token.address);
  if (have < amount) throw new Error("ERR_FUNDS");
  const energy = await tronEnergy(from, token.address, transferData(dest, amount));
  const tx = await build(from, dest, amount, token);
  const bandwidth = txBandwidth(tx.raw_data_hex);
  const f = tronFee({ bandwidth, energy, res, prices });
  if (f.need > BigInt(MAX_TRC20_FEE_LIMIT_SUN)) throw Object.assign(new Error("ERR_FEE_HIGH"), { need: f.need });
  if (me.sun < f.need) throw Object.assign(new Error("ERR_TRX_FEE"), { need: f.need, have: me.sun });
  return { kind: "token", to: dest, amount, token, fee: f.fee, need: f.need, have: me.sun, energy, bandwidth, newAccount: false, burnsEnergy: f.burnsEnergy, burnsBandwidth: f.burnsBandwidth };
}

function demoQuote(to: string, amount: bigint, token?: Token): TronQuote {
  const prices = readPrices({}), res = readResource({ freeNetLimit: 600 }), have = DEMO_TRX_SUN;
  if (!token) { const f = tronFee({ bandwidth: 268, energy: 0, newAccount: true, res, prices }); return { kind: "trx", to, amount, fee: f.fee, need: amount + f.need, have, energy: 0, bandwidth: 268, newAccount: true, burnsEnergy: false, burnsBandwidth: f.burnsBandwidth }; }
  const f = tronFee({ bandwidth: 345, energy: 130285, res, prices });
  return { kind: "token", to, amount, token, fee: f.fee, need: f.need, have, energy: 130285, bandwidth: 345, newAccount: false, burnsEnergy: true, burnsBandwidth: false };
}

export async function sendTron(phrase: string, index: number, q: TronQuote): Promise<string> {
  return tronBroadcast(await signTronSend(phrase, index, q));
}

export async function signTronSend(phrase: string, index: number, q: TronQuote): Promise<{ txID: string; hex: string; expiration: number }> {
  const from = tronAddress(phrase, index);
  const me = await tronAccount(from);
  if (me.sun < q.need) throw Object.assign(new Error("ERR_TRX_FEE"), { need: q.need, have: me.sun });
  const tx = await build(from, q.to, q.amount, q.kind === "token" ? q.token : undefined, q.kind === "trx" ? q.memo : undefined);

  const exp = Number(tx.raw_data?.expiration);
  return { ...signTronTx(tx, phrase, index, from), expiration: Number.isFinite(exp) && exp > 0 ? exp : Date.now() + 15 * 60_000 };
}

export async function tronSpendable(phrase: string, index: number, token?: { address: string }): Promise<bigint> {
  const from = tronAddress(phrase, index);
  if (token) return trc20Balance(from, token.address);
  const { sun } = await tronAccount(from);
  const left = sun - 300_000n;
  return left > 0n ? left : 0n;
}

export async function trc20Allowance(owner: string, token: string, spender: string): Promise<bigint> {
  const j = await tronPost<any>("/wallet/triggerconstantcontract", { owner_address: owner, contract_address: token, function_selector: "allowance(address,address)", parameter: tronWord(owner) + tronWord(spender), visible: true });
  const w = j?.constant_result?.[0];
  if (!j?.result?.result || j.result.message || !/^[0-9a-fA-F]{64}$/.test(w ?? "")) throw new Error("ERR_TRON_CALL");
  return BigInt("0x" + w);
}
