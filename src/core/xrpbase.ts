import { notImported } from "./imported";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { base58xrp } from "@scure/base";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { memoAddress, normalizePhrase } from "./account";
import { DEMO_XRP_DROPS, demoOn } from "./demo";
import { hostFetch } from "./hostgate";

export const XRP = { id: "xrp", name: "XRP Ledger", symbol: "XRP", coingecko: "ripple", decimals: 6, explorer: "https://livenet.xrpl.org", family: "xrp" } as const;
export const xrpTxUrl = (hash: string) => `${XRP.explorer}/transactions/${hash}`;
export const XRP_RPCS = ["https://xrplcluster.com", "https://rpc.ankr.com/xrp_mainnet"];

export const LSF_REQUIRE_DEST_TAG = 0x00020000, LSF_DISALLOW_XRP = 0x00080000, LSF_DEPOSIT_AUTH = 0x01000000;
export const MAX_TAG = 4_294_967_295;
const DROPS_MAX = 100_000_000_000n * 1_000_000n;

const dsha = (b: Uint8Array) => sha256(sha256(b));
export function xrpCheckEncode(payload: Uint8Array): string {
  const c = dsha(payload).slice(0, 4);
  return base58xrp.encode(Uint8Array.from([...payload, ...c]));
}
export function xrpCheckDecode(s: string): Uint8Array {
  let raw: Uint8Array;
  try { raw = base58xrp.decode(s); } catch { throw new Error("ERR_ADDRESS"); }
  if (raw.length < 5) throw new Error("ERR_ADDRESS");
  const body = raw.slice(0, -4), c = dsha(body);
  for (let i = 0; i < 4; i++) if (c[i] !== raw[raw.length - 4 + i]) throw new Error("ERR_ADDRESS");
  return body;
}

export function xrpKeysFromSeed(seed: Uint8Array, index = 0): { privateKey: Uint8Array; publicKey: Uint8Array } {
  notImported(index);
  const key = HDKey.fromMasterSeed(seed).derive(`m/44'/144'/0'/0/${index}`);
  if (!key.privateKey || !key.publicKey) throw new Error("derivation failed");
  return { privateKey: key.privateKey, publicKey: key.publicKey };
}
export const xrpKeys = (phrase: string, index = 0) => xrpKeysFromSeed(mnemonicToSeedSync(normalizePhrase(phrase)), index);
export const accountIdOfKey = (pub: Uint8Array) => { if (pub.length !== 33) throw new Error("bad key"); return ripemd160(sha256(pub)); };
export const encodeClassic = (id: Uint8Array) => { if (id.length !== 20) throw new Error("ERR_ADDRESS"); return xrpCheckEncode(Uint8Array.from([0, ...id])); };

export function decodeClassic(addr: string): Uint8Array {
  const v = String(addr ?? "");
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(v)) throw new Error("ERR_ADDRESS");
  const b = xrpCheckDecode(v);
  if (b.length !== 21 || b[0] !== 0) throw new Error("ERR_ADDRESS");
  return b.slice(1);
}
export const isXrpClassic = (a: string) => { try { decodeClassic(String(a ?? "").trim()); return true; } catch { return false; } };
export const xrpAddressOfKey = (pub: Uint8Array) => encodeClassic(accountIdOfKey(pub));
export const xrpAddress = (phrase: string, index = 0): string => memoAddress("xrp", phrase, index, () => xrpAddressOfKey(xrpKeys(phrase, index).publicKey));

const X_MAIN = [0x05, 0x44], X_TEST = [0x04, 0x93];
export function encodeXAddress(id: Uint8Array, tag: number | null, test = false): string {
  if (id.length !== 20 || (tag != null && (!Number.isInteger(tag) || tag < 0 || tag > MAX_TAG))) throw new Error("ERR_ADDRESS");
  const t = tag ?? 0;
  return xrpCheckEncode(Uint8Array.from([...(test ? X_TEST : X_MAIN), ...id, tag == null ? 0 : 1, t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, (t >>> 24) & 0xff, 0, 0, 0, 0]));
}

export function decodeXAddress(x: string): { address: string; tag: number | null } {
  const v = String(x ?? "");
  if (!/^[XT][1-9A-HJ-NP-Za-km-z]{44,50}$/.test(v)) throw new Error("ERR_ADDRESS");
  const b = xrpCheckDecode(v);
  if (b.length !== 31) throw new Error("ERR_ADDRESS");
  const pre = [b[0], b[1]];
  if (pre[0] === X_TEST[0] && pre[1] === X_TEST[1]) throw new Error("ERR_TESTNET");
  if (pre[0] !== X_MAIN[0] || pre[1] !== X_MAIN[1]) throw new Error("ERR_ADDRESS");
  const flag = b[22], tagBytes = b.slice(23, 27), reserved = b.slice(27, 31);
  if (reserved.some((x) => x !== 0)) throw new Error("ERR_ADDRESS");
  const tag = (tagBytes[0] | (tagBytes[1] << 8) | (tagBytes[2] << 16)) + tagBytes[3] * 0x1000000;
  if (flag === 0) { if (tag !== 0) throw new Error("ERR_ADDRESS"); return { address: encodeClassic(b.slice(2, 22)), tag: null }; }
  if (flag !== 1) throw new Error("ERR_ADDRESS");
  return { address: encodeClassic(b.slice(2, 22)), tag };
}
export const isXAddress = (a: string) => { try { decodeXAddress(String(a ?? "").trim()); return true; } catch { return false; } };

export const isXrpAddress = (a: string) => isXrpClassic(a) || isXAddress(a);

export function parseXrpTag(s: string): number | null {
  const v = String(s ?? "").trim();
  if (!v) return null;
  if (!/^\d{1,10}$/.test(v)) throw new Error("ERR_TAG");
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n > MAX_TAG) throw new Error("ERR_TAG");
  return n;
}

export function xrpRecipient(input: string, tagText: string): { address: string; tag: number | null; x: boolean } {
  const v = String(input ?? "").trim();
  const typed = parseXrpTag(tagText);
  if (/^[XT]/.test(v)) {
    const d = decodeXAddress(v);
    if (typed != null && d.tag != null && typed !== d.tag) throw new Error("ERR_TAG_CONFLICT");
    if (typed != null && d.tag == null) throw new Error("ERR_TAG_CONFLICT");
    return { address: d.address, tag: d.tag, x: true };
  }
  decodeClassic(v);
  return { address: v, tag: typed, x: false };
}

export function parseXrp(s: string): bigint {
  const v = String(s ?? "").trim();
  if (!/^\d{1,11}(\.\d{1,6})?$/.test(v)) throw new Error("ERR_AMOUNT");
  const [i, f = ""] = v.split(".");
  const d = BigInt(i) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  if (d > DROPS_MAX) throw new Error("ERR_AMOUNT");
  return d;
}
export const formatXrp = (drops: bigint) => {
  const neg = drops < 0n, a = neg ? -drops : drops;
  const f = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / 1_000_000n}${f ? "." + f : ""}`;
};

export const dropsOf = (v: unknown): bigint | null => (typeof v === "string" && /^\d{1,18}$/.test(v) ? BigInt(v) : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null);

export class XrplError extends Error { readonly code: string; readonly result: Record<string, unknown>; constructor(code: string, result: Record<string, unknown> = {}) { super(code); this.code = code; this.result = result; } }

const BUSY = new Set(["tooBusy", "slowDown", "noNetwork", "noCurrent", "noClosed", "notSynced", "notReady", "amendmentBlocked", "internal", "unknownCmd"]);

export async function xrpRpc<T = Record<string, unknown>>(method: string, params: Record<string, unknown>, o: { hosts?: string[]; timeoutMs?: number } = {}): Promise<T> {
  if (!/^[a-z_]{2,30}$/.test(method)) throw new Error("bad XRPL method");
  const hosts = o.hosts ?? XRP_RPCS;
  let last: unknown = new Error("network");
  for (const host of hosts) {
    if (!XRP_RPCS.includes(host)) throw new Error("bad XRPL host");
    try {
      const r = await hostFetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, params: [params] }) }, o.timeoutMs ?? 10_000);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { result?: Record<string, unknown>; error?: unknown };
      const res = j?.result;
      if (!res || typeof res !== "object") throw new Error("ERR_XRPL");

      if (res.status === "error" || typeof res.error === "string") {
        const code = String(res.error ?? "error");
        if (BUSY.has(code)) throw new Error(code);
        throw new XrplError(code, res);
      }
      return res as T;
    } catch (e) {
      if (e instanceof XrplError) throw e;
      last = e;
    }
  }
  throw last;
}

export interface XrpLedger { baseFee: bigint; reserveBase: bigint; reserveInc: bigint; seq: number }

export function readLedger(res: unknown): XrpLedger {
  const v = (res as { state?: { validated_ledger?: Record<string, unknown> } })?.state?.validated_ledger;
  const baseFee = dropsOf(v?.base_fee), reserveBase = dropsOf(v?.reserve_base), reserveInc = dropsOf(v?.reserve_inc), seq = Number(v?.seq);
  if (baseFee == null || reserveBase == null || reserveInc == null || !Number.isSafeInteger(seq) || seq <= 0) throw new Error("ERR_XRPL");
  if (baseFee < 1n || baseFee > 1_000n || reserveBase > 100_000_000n || reserveInc > 10_000_000n) throw new Error("ERR_XRPL");
  return { baseFee, reserveBase, reserveInc, seq };
}
export async function xrpLedger(hosts?: string[]): Promise<XrpLedger> { return readLedger(await xrpRpc("server_state", {}, { hosts })); }

export interface XrpAccountInfo { exists: boolean; balance: bigint; sequence: number; ownerCount: number; flags: number; requireTag: boolean; disallowXrp: boolean; depositAuth: boolean }
const NONE: XrpAccountInfo = { exists: false, balance: 0n, sequence: 0, ownerCount: 0, flags: 0, requireTag: false, disallowXrp: false, depositAuth: false };

export function readAccount(address: string, res: unknown): XrpAccountInfo {
  const d = (res as { account_data?: Record<string, unknown> })?.account_data;
  const f = (res as { account_flags?: Record<string, unknown> })?.account_flags;
  if (!d || d.Account !== address || d.LedgerEntryType !== "AccountRoot") throw new Error("ERR_XRPL");
  const balance = dropsOf(d.Balance), sequence = Number(d.Sequence), ownerCount = Number(d.OwnerCount ?? 0), flags = Number(d.Flags ?? 0);
  if (balance == null || !Number.isSafeInteger(sequence) || sequence < 0 || !Number.isSafeInteger(ownerCount) || ownerCount < 0 || !Number.isSafeInteger(flags) || flags < 0) throw new Error("ERR_XRPL");

  return {
    exists: true, balance, sequence, ownerCount, flags,
    requireTag: (flags & LSF_REQUIRE_DEST_TAG) !== 0 || f?.requireDestinationTag === true,
    disallowXrp: (flags & LSF_DISALLOW_XRP) !== 0 || f?.disallowIncomingXRP === true,
    depositAuth: (flags & LSF_DEPOSIT_AUTH) !== 0 || f?.depositAuth === true,
  };
}

export async function xrpAccount(address: string, ledger: "validated" | "current" = "validated", hosts?: string[]): Promise<XrpAccountInfo> {
  if (!isXrpClassic(address)) throw new Error("ERR_ADDRESS");
  try { return readAccount(address, await xrpRpc("account_info", { account: address, ledger_index: ledger, strict: true }, { hosts })); }
  catch (e) { if (e instanceof XrplError && e.code === "actNotFound") return { ...NONE }; throw e; }
}

export interface XrpBalances { total: bigint; reserve: bigint; spendable: bigint; active: boolean; reserveBase: bigint }
export const reserveOf = (l: Pick<XrpLedger, "reserveBase" | "reserveInc">, ownerCount: number) => l.reserveBase + BigInt(ownerCount) * l.reserveInc;
export async function xrpBalances(address: string): Promise<XrpBalances> {
  if (import.meta.env.DEV && demoOn()) return { total: DEMO_XRP_DROPS, reserve: 1_000_000n, spendable: DEMO_XRP_DROPS - 1_000_000n, active: true, reserveBase: 1_000_000n };
  const [a, l] = [await xrpAccount(address), await xrpLedger()];
  if (!a.exists) return { total: 0n, reserve: 0n, spendable: 0n, active: false, reserveBase: l.reserveBase };
  const reserve = reserveOf(l, a.ownerCount);
  return { total: a.balance, reserve: reserve < a.balance ? reserve : a.balance, spendable: a.balance > reserve ? a.balance - reserve : 0n, active: true, reserveBase: l.reserveBase };
}
