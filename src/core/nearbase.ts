import { ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import { mnemonicToSeedSync } from "@scure/bip39";
import { memoAddress, normalizePhrase } from "./account";
import { hostFetch } from "./hostgate";
import { notImported } from "./imported";

export const NEAR = { id: "near", name: "NEAR Protocol", symbol: "NEAR", coingecko: "near", decimals: 24, explorer: "https://nearblocks.io", family: "near" } as const;
export const nearTxUrl = (hash: string) => `${NEAR.explorer}/txns/${hash}`;
export const NEAR_RPCS = ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org", "https://rpc.mainnet.near.org"];

export const YOCTO = 10n ** 24n;

export const STORAGE_PER_BYTE = 10n ** 19n;

const YOCTO_MAX = 10n ** 10n * YOCTO;

export function slip10Ed25519(seed: Uint8Array, path: number[]): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  let k = I.slice(0, 32), c = I.slice(32);
  for (const idx of path) {
    if (!Number.isInteger(idx) || idx < 0 || idx > 0x7fffffff) throw new Error("bad path");
    const data = new Uint8Array(37);
    data.set(k, 1);
    new DataView(data.buffer).setUint32(33, (idx | 0x80000000) >>> 0);
    I = hmac(sha512, c, data);
    k = I.slice(0, 32); c = I.slice(32);
  }
  return k;
}

export function nearSecret(phrase: string, index = 0): Uint8Array {
  notImported(index);
  return slip10Ed25519(mnemonicToSeedSync(normalizePhrase(phrase)), [44, 397, index]);
}
export const nearPublicKey = (secret: Uint8Array) => ed25519.getPublicKey(secret);

export const nearImplicitOf = (pub: Uint8Array) => { if (pub.length !== 32) throw new Error("bad key"); return bytesToHex(pub); };

export const nearKeyString = (pub: Uint8Array) => { if (pub.length !== 32) throw new Error("bad key"); return "ed25519:" + base58.encode(pub); };
export const nearAddress = (phrase: string, index = 0): string => memoAddress("near", phrase, index, () => nearImplicitOf(nearPublicKey(nearSecret(phrase, index))));

const NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const isNearImplicit = (a: string) => /^[0-9a-f]{64}$/.test(a);

export const isNearEthImplicit = (a: string) => /^0x[0-9a-f]{40}$/.test(a);

export function isNearAddress(a: string): boolean {
  const v = String(a ?? "").trim();
  if (v.length < 2 || v.length > 64) return false;
  if (isNearEthImplicit(v)) return false;
  return isNearImplicit(v) || NAMED.test(v);
}

export function parseNear(s: string): bigint {
  const v = String(s ?? "").trim();
  if (!/^\d{1,11}(\.\d{1,24})?$/.test(v)) throw new Error("ERR_AMOUNT");
  const [i, f = ""] = v.split(".");
  const y = BigInt(i) * YOCTO + BigInt((f + "0".repeat(24)).slice(0, 24));
  if (y > YOCTO_MAX) throw new Error("ERR_AMOUNT");
  return y;
}

export function formatNear(yocto: bigint): string {
  const neg = yocto < 0n, a = neg ? -yocto : yocto;
  const f = (a % YOCTO).toString().padStart(24, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / YOCTO}${f ? "." + f : ""}`;
}

export const yoctoOf = (v: unknown): bigint | null => (typeof v === "string" && /^\d{1,40}$/.test(v) && BigInt(v) <= YOCTO_MAX ? BigInt(v) : null);

export class NearError extends Error {
  readonly code: string; readonly data: unknown;
  constructor(code: string, data: unknown = null) { super(code); this.code = code; this.data = data; }
}

const BUSY = new Set(["TIMEOUT_ERROR", "INTERNAL_ERROR", "NO_SYNCED_BLOCKS", "NOT_SYNCED_YET", "UNAVAILABLE_SHARD", "UNKNOWN_BLOCK", "GARBAGE_COLLECTED_BLOCK", "PARSE_ERROR", "REQUEST_VALIDATION_ERROR"]);

export function nearErrorCode(e: unknown): string {
  const x = e as { name?: unknown; code?: unknown; cause?: { name?: unknown } };
  if (x?.cause && typeof x.cause.name === "string") return x.cause.name;
  if (x?.code === -32601) return "METHOD_NOT_FOUND";
  return typeof x?.name === "string" ? x.name : "ERROR";
}

function legacyViewError(s: string): string {
  if (/access key .* does not exist/i.test(s)) return "UNKNOWN_ACCESS_KEY";
  if (/does not exist while viewing|UnknownAccount/i.test(s)) return "UNKNOWN_ACCOUNT";
  return "VIEW_ERROR";
}

export async function nearRpc<T = Record<string, unknown>>(method: string, params: unknown, o: { hosts?: string[]; timeoutMs?: number } = {}): Promise<T> {
  if (!/^[A-Za-z_]{2,40}$/.test(method)) throw new Error("bad NEAR method");
  const hosts = o.hosts ?? NEAR_RPCS;
  let last: unknown = new Error("network");
  for (const host of hosts) {
    if (!NEAR_RPCS.includes(host)) throw new Error("bad NEAR host");
    try {
      const r = await hostFetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "madar", method, params }) }, o.timeoutMs ?? 10_000);

      const j = (await r.json().catch(() => null)) as { result?: unknown; error?: Record<string, unknown> } | null;
      if (!j || typeof j !== "object") throw new Error(`HTTP ${r.status}`);
      if (j.error && typeof j.error === "object") {
        const code = nearErrorCode(j.error);
        if (code === "METHOD_NOT_FOUND") throw new NearError(code, j.error);
        if (BUSY.has(code) || code === "ERROR" || code === "HANDLER_ERROR") throw new Error(code);
        throw new NearError(code, j.error.data ?? (j.error.cause as { info?: unknown } | undefined)?.info ?? null);
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const res = j.result;
      if (!res || typeof res !== "object") throw new Error("ERR_NEAR");
      const le = (res as { error?: unknown }).error;
      if (typeof le === "string") throw new NearError(legacyViewError(le), le);
      return res as T;
    } catch (e) {
      if (e instanceof NearError) throw e;
      last = e;
    }
  }
  throw last;
}

export interface NearAccount { exists: boolean; amount: bigint; locked: bigint; storageUsage: number }
const NONE: NearAccount = { exists: false, amount: 0n, locked: 0n, storageUsage: 0 };

export function readNearAccount(res: unknown): NearAccount {
  const r = res as { amount?: unknown; locked?: unknown; storage_usage?: unknown; block_height?: unknown };
  const amount = yoctoOf(r?.amount), locked = yoctoOf(r?.locked ?? "0"), storageUsage = Number(r?.storage_usage);
  if (amount == null || locked == null || !Number.isSafeInteger(storageUsage) || storageUsage < 0 || storageUsage > 1e9) throw new Error("ERR_NEAR");
  return { exists: true, amount, locked, storageUsage };
}

export async function nearAccount(id: string, hosts?: string[]): Promise<NearAccount> {
  if (!isNearAddress(id)) throw new Error("ERR_ADDRESS");
  try { return readNearAccount(await nearRpc("query", { request_type: "view_account", finality: "final", account_id: id.trim() }, { hosts })); }
  catch (e) { if (e instanceof NearError && e.code === "UNKNOWN_ACCOUNT") return { ...NONE }; throw e; }
}

export function nearReserveOf(a: Pick<NearAccount, "amount" | "locked" | "storageUsage">): bigint {
  const need = BigInt(a.storageUsage) * STORAGE_PER_BYTE;
  const r = need > a.locked ? need - a.locked : 0n;
  return r < a.amount ? r : a.amount;
}

export interface NearBalances { total: bigint; reserve: bigint; spendable: bigint; active: boolean }
export async function nearBalances(id: string): Promise<NearBalances> {
  const a = await nearAccount(id);
  if (!a.exists) return { total: 0n, reserve: 0n, spendable: 0n, active: false };
  const reserve = nearReserveOf(a);
  return { total: a.amount, reserve, spendable: a.amount - reserve, active: true };
}
